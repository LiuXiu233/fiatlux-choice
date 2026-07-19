import { randomUUID } from "node:crypto";
import { createDatabase, membershipRoles, memberships, roles, sessions, users } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { type ApiConfig, apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

type JsonObject = Record<string, unknown>;

function body(response: { body: string }) {
  return JSON.parse(response.body) as JsonObject;
}

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  if (!first) throw new Error("Login did not set a cookie");
  const cookieValue = first.split(";", 1)[0];
  if (!cookieValue) throw new Error("Login cookie is empty");
  return cookieValue;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function shortBarrierDelay() {
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}

describe.skipIf(!databaseUrl)("membership and session security concurrency", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let config: ApiConfig;
  let orgId: string;
  let ownerUserId: string;
  let ownerMembershipId: string;
  let ownerCookie: string;
  let approverCookie: string;
  let ownerRoleId: string;
  let adminRoleId: string;
  let memberRoleId: string;
  const suffix = randomUUID().slice(0, 8);

  async function login(email: string, password: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
  }

  async function createActiveMember(roleId: string, label: string) {
    const email = `security-${label}-${suffix}@example.test`;
    const password = `security-${label}-password-long-enough`;
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: { email, displayName: `Security ${label}`, password, roleId },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = body(createdResponse).data as JsonObject;
    const approval = created.approval as JsonObject;
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: `Activate ${label}`,
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode).toBe(200);
    const user = created.user as JsonObject;
    const createdMembership = created.membership as JsonObject;
    const [membership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, String(createdMembership.id)), eq(memberships.orgId, orgId)));
    if (!membership) throw new Error("Activated membership not found");
    await dbHandle.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, String(user.id)));
    return { email, password, userId: String(user.id), membership };
  }

  async function requestLifecycle(input: {
    userId: string;
    expectedVersion: number;
    action: "deactivate" | "offboard" | "reactivate";
    idempotencyKey: string;
    reason: string;
  }) {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/users/${input.userId}/lifecycle`,
      headers: { cookie: ownerCookie },
      payload: input,
    });
    expect(response.statusCode).toBe(201);
    return body(response).data as JsonObject;
  }

  async function holdUserRow(userId: string) {
    const ready = deferred();
    const released = deferred();
    const done = dbHandle.db
      .transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        if (!locked) throw new Error("User barrier target not found");
        ready.resolve();
        await released.promise;
      })
      .catch((error) => {
        ready.reject(error);
        throw error;
      });
    await ready.promise;
    return { release: released.resolve, done };
  }

  async function holdMembershipRow(membershipId: string) {
    const ready = deferred();
    const released = deferred();
    const done = dbHandle.db
      .transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.id, membershipId), eq(memberships.orgId, orgId)))
          .for("update");
        if (!locked) throw new Error("Membership barrier target not found");
        ready.resolve();
        await released.promise;
      })
      .catch((error) => {
        ready.reject(error);
        throw error;
      });
    await ready.promise;
    return { release: released.resolve, done };
  }

  async function holdOwnerInvariantLock() {
    const ready = deferred();
    const released = deferred();
    const done = dbHandle.db
      .transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('fiatlux-active-owner'), hashtext(${orgId}))`,
        );
        ready.resolve();
        await released.promise;
      })
      .catch((error) => {
        ready.reject(error);
        throw error;
      });
    await ready.promise;
    return { release: released.resolve, done };
  }

  async function waitForAdvisoryWaiters(expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await dbHandle.db.execute(sql`
        select count(*)::integer as waiting
        from pg_locks
        where locktype = 'advisory' and not granted
      `);
      const rows = result as unknown as Array<{ waiting: number }>;
      if (Number(rows[0]?.waiting ?? 0) >= expected) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${expected} advisory-lock waiters`);
  }

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Security Concurrency Company",
      organizationSlug: `security-concurrency-${suffix}`,
      adminEmail: `security-owner-${suffix}@example.test`,
      adminDisplayName: "Security Owner",
      adminPassword: "correct-horse-battery-staple-security",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    ownerUserId = seeded.user.id;
    ownerMembershipId = seeded.membership.id;
    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = { send: async () => randomUUID() } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue,
    });
    const ownerLogin = await login(
      `security-owner-${suffix}@example.test`,
      "correct-horse-battery-staple-security",
    );
    expect(ownerLogin.statusCode).toBe(200);
    ownerCookie = cookie(ownerLogin);

    const roleRows = await dbHandle.db
      .select({ id: roles.id, systemKey: roles.systemKey })
      .from(roles)
      .where(eq(roles.orgId, orgId));
    const roleId = (systemKey: string) => {
      const role = roleRows.find((candidate) => candidate.systemKey === systemKey);
      if (!role) throw new Error(`Missing ${systemKey} role`);
      return role.id;
    };
    ownerRoleId = roleId("owner");
    adminRoleId = roleId("admin");
    memberRoleId = roleId("member");
    const approver = await createActiveMember(adminRoleId, "approver");
    const approverLogin = await login(approver.email, approver.password);
    expect(approverLogin.statusCode).toBe(200);
    approverCookie = cookie(approverLogin);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  }, 30_000);

  it("cannot insert an old-password session after a concurrent password change", async () => {
    const target = await createActiveMember(memberRoleId, "password-race");
    const currentLogin = await login(target.email, target.password);
    expect(currentLogin.statusCode).toBe(200);
    const currentCookie = cookie(currentLogin);
    const barrier = await holdUserRow(target.userId);
    let oldLoginSettled = false;
    let passwordChangeSettled = false;
    const oldLogin = login(target.email, target.password).finally(() => {
      oldLoginSettled = true;
    });
    const passwordChange = app
      .inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: currentCookie },
        payload: {
          currentPassword: target.password,
          newPassword: "replacement-password-security-race",
        },
      })
      .finally(() => {
        passwordChangeSettled = true;
      });
    await shortBarrierDelay();
    expect(oldLoginSettled).toBe(false);
    expect(passwordChangeSettled).toBe(false);
    barrier.release();
    await barrier.done;
    const [oldLoginResponse, passwordChangeResponse] = await Promise.all([
      oldLogin,
      passwordChange,
    ]);
    expect([200, 401]).toContain(oldLoginResponse.statusCode);
    expect(passwordChangeResponse.statusCode).toBe(200);

    const unrevoked = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.orgId, orgId),
          eq(sessions.userId, target.userId),
          isNull(sessions.revokedAt),
        ),
      );
    expect(unrevoked).toHaveLength(1);
    const currentSessionStillWorks = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: currentCookie },
    });
    expect(currentSessionStillWorks.statusCode).toBe(200);
  }, 30_000);

  for (const action of ["deactivate", "offboard"] as const) {
    it(`cannot insert a session after concurrent ${action} approval`, async () => {
      const target = await createActiveMember(memberRoleId, `${action}-race`);
      const lifecycleApproval = await requestLifecycle({
        userId: target.userId,
        expectedVersion: target.membership.version,
        action,
        idempotencyKey: `security-${action}-race-${suffix}`,
        reason: `Exercise the login versus ${action} transaction barrier`,
      });
      const barrier = await holdMembershipRow(target.membership.id);
      let loginSettled = false;
      let decisionSettled = false;
      const racingLogin = login(target.email, target.password).finally(() => {
        loginSettled = true;
      });
      const lifecycleDecision = app
        .inject({
          method: "POST",
          url: `/api/v1/approvals/${String(lifecycleApproval.id)}/approve`,
          headers: { cookie: approverCookie },
          payload: { comment: `Approve ${action} while a login is waiting` },
        })
        .finally(() => {
          decisionSettled = true;
        });
      await shortBarrierDelay();
      expect(loginSettled).toBe(false);
      expect(decisionSettled).toBe(false);
      barrier.release();
      await barrier.done;
      const [loginResponse, decisionResponse] = await Promise.all([racingLogin, lifecycleDecision]);
      expect([200, 403]).toContain(loginResponse.statusCode);
      expect(decisionResponse.statusCode).toBe(200);

      const [membership] = await dbHandle.db
        .select({ status: memberships.status })
        .from(memberships)
        .where(eq(memberships.id, target.membership.id));
      expect(membership?.status).toBe(action === "deactivate" ? "inactive" : "offboarded");
      const unrevoked = await dbHandle.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.orgId, orgId),
            eq(sessions.userId, target.userId),
            isNull(sessions.revokedAt),
          ),
        );
      expect(unrevoked).toHaveLength(0);
      if (loginResponse.statusCode === 200) {
        const revokedCookie = cookie(loginResponse);
        const rejectedSession = await app.inject({
          method: "GET",
          url: "/api/v1/dashboard",
          headers: { cookie: revokedCookie },
        });
        expect(rejectedSession.statusCode).toBe(401);
      }
    }, 30_000);
  }

  it("serializes three owner mutations and never commits zero active owners", async () => {
    const inactiveOwner = await createActiveMember(ownerRoleId, "owner-race");
    const deactivateApproval = await requestLifecycle({
      userId: inactiveOwner.userId,
      expectedVersion: inactiveOwner.membership.version,
      action: "deactivate",
      idempotencyKey: `security-owner-deactivate-${suffix}`,
      reason: "Prepare an inactive owner for the controlled three-transaction race",
    });
    const deactivated = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(deactivateApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "The primary owner remains active" },
    });
    expect(deactivated.statusCode).toBe(200);
    const [inactiveMembership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, inactiveOwner.membership.id));
    if (!inactiveMembership) throw new Error("Inactive owner membership not found");
    expect(inactiveMembership.status).toBe("inactive");

    const [primaryOwner] = await dbHandle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, ownerMembershipId), eq(memberships.orgId, orgId)));
    if (!primaryOwner) throw new Error("Primary owner membership not found");
    const offboardPrimary = await requestLifecycle({
      userId: ownerUserId,
      expectedVersion: primaryOwner.version,
      action: "offboard",
      idempotencyKey: `security-owner-offboard-${suffix}`,
      reason: "Controlled owner offboarding race",
    });
    const removeInactiveOwner = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: {
        membershipId: inactiveMembership.id,
        roleId: ownerRoleId,
        mode: "remove",
        reason: "Controlled inactive-owner role removal race",
        expectedVersion: inactiveMembership.version,
        idempotencyKey: `security-owner-remove-${suffix}`,
      },
    });
    expect(removeInactiveOwner.statusCode).toBe(201);
    const removeApproval = body(removeInactiveOwner).data as JsonObject;
    const reactivateInactiveOwner = await requestLifecycle({
      userId: inactiveOwner.userId,
      expectedVersion: inactiveMembership.version,
      action: "reactivate",
      idempotencyKey: `security-owner-reactivate-${suffix}`,
      reason: "Controlled inactive-owner reactivation race",
    });

    const gate = await holdOwnerInvariantLock();
    const decisions = [offboardPrimary, removeApproval, reactivateInactiveOwner].map((approval) =>
      app.inject({
        method: "POST",
        url: `/api/v1/approvals/${String(approval.id)}/approve`,
        headers: { cookie: approverCookie },
        payload: { comment: "Controlled three-transaction owner invariant decision" },
      }),
    );
    try {
      await waitForAdvisoryWaiters(3);
    } finally {
      gate.release();
      await gate.done;
    }
    const decisionResponses = await Promise.all(decisions);
    expect(
      decisionResponses.every((response) => [200, 409].includes(response.statusCode)),
      JSON.stringify(
        decisionResponses.map((response) => ({
          statusCode: response.statusCode,
          body: response.json(),
        })),
      ),
    ).toBe(true);
    expect(decisionResponses.some((response) => response.statusCode === 409)).toBe(true);

    const [activeOwners] = await dbHandle.db
      .select({ total: count() })
      .from(membershipRoles)
      .innerJoin(
        roles,
        and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
      )
      .innerJoin(
        memberships,
        and(
          eq(memberships.id, membershipRoles.membershipId),
          eq(memberships.orgId, membershipRoles.orgId),
        ),
      )
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(roles.systemKey, "owner"),
          isNull(roles.archivedAt),
          eq(memberships.status, "active"),
          isNull(memberships.archivedAt),
        ),
      );
    expect(activeOwners?.total ?? 0).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
