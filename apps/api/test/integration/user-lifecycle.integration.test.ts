import { createHash, randomUUID } from "node:crypto";
import {
  approvals,
  auditEvents,
  createDatabase,
  membershipRoles,
  memberships,
  roles,
  sessions,
  users,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq, isNull } from "drizzle-orm";
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

function sessionHash(label: string) {
  return createHash("sha256").update(`${label}-${randomUUID()}`).digest("hex");
}

describe.skipIf(!databaseUrl)("organization membership lifecycle", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let config: ApiConfig;
  let orgId: string;
  let otherOrgId: string;
  let ownerUserId: string;
  let ownerMembershipId: string;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let approverCookie: string;
  let ownerRoleId: string;
  let adminRoleId: string;
  let memberRoleId: string;
  let otherMemberRoleId: string;
  const suffix = randomUUID().slice(0, 8);

  async function login(email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return cookie(response);
  }

  async function createActiveMember(roleId: string, label: string) {
    const email = `lifecycle-${label}-${suffix}@example.test`;
    const password = `lifecycle-${label}-password-long-enough`;
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: { email, displayName: `Lifecycle ${label}`, password, roleId },
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
      .where(and(eq(memberships.id, String(createdMembership.id)), eq(memberships.orgId, orgId)))
      .limit(1);
    if (!membership) throw new Error("Activated membership not found");
    expect(membership.status).toBe("active");
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
    requestCookie?: string;
  }) {
    return app.inject({
      method: "POST",
      url: `/api/v1/users/${input.userId}/lifecycle`,
      headers: { cookie: input.requestCookie ?? ownerCookie },
      payload: {
        action: input.action,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      },
    });
  }

  async function createInactiveMember(label: string) {
    const target = await createActiveMember(memberRoleId, label);
    await dbHandle.db.insert(sessions).values({
      orgId,
      userId: target.userId,
      tokenHash: sessionHash(`reactivation-old-session-${label}`),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const requested = await requestLifecycle({
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "deactivate",
      idempotencyKey: `lifecycle-deactivate-${label}-${suffix}`,
      reason: `Deactivate ${label} before testing controlled reactivation`,
    });
    expect(requested.statusCode).toBe(201);
    const approval = body(requested).data as JsonObject;
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: `Deactivate ${label} with a documented review basis` },
    });
    expect(approved.statusCode).toBe(200);
    const [inactiveMembership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, target.membership.id), eq(memberships.orgId, orgId)));
    if (!inactiveMembership) throw new Error("Inactive membership not found");
    expect(inactiveMembership.status).toBe("inactive");
    return { ...target, membership: inactiveMembership };
  }

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Lifecycle Test Company",
      organizationSlug: `lifecycle-${suffix}`,
      adminEmail: `lifecycle-owner-${suffix}@example.test`,
      adminDisplayName: "Lifecycle Owner",
      adminPassword: "correct-horse-battery-staple-lifecycle",
      adminMustChangePassword: false,
    });
    const otherSeeded = await seedDatabase(dbHandle.db, {
      organizationName: "Lifecycle Other Company",
      organizationSlug: `lifecycle-other-${suffix}`,
      adminEmail: `lifecycle-other-owner-${suffix}@example.test`,
      adminDisplayName: "Lifecycle Other Owner",
      adminPassword: "correct-horse-battery-staple-other-lifecycle",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    otherOrgId = otherSeeded.organization.id;
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
    ownerCookie = await login(
      `lifecycle-owner-${suffix}@example.test`,
      "correct-horse-battery-staple-lifecycle",
    );
    otherOwnerCookie = await login(
      `lifecycle-other-owner-${suffix}@example.test`,
      "correct-horse-battery-staple-other-lifecycle",
    );

    const roleRows = await dbHandle.db
      .select({ id: roles.id, orgId: roles.orgId, systemKey: roles.systemKey })
      .from(roles);
    const roleId = (targetOrgId: string, systemKey: string) => {
      const role = roleRows.find(
        (candidate) => candidate.orgId === targetOrgId && candidate.systemKey === systemKey,
      );
      if (!role) throw new Error(`Missing ${systemKey} role`);
      return role.id;
    };
    ownerRoleId = roleId(orgId, "owner");
    adminRoleId = roleId(orgId, "admin");
    memberRoleId = roleId(orgId, "member");
    otherMemberRoleId = roleId(otherOrgId, "member");

    const approver = await createActiveMember(adminRoleId, "approver");
    approverCookie = await login(approver.email, approver.password);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("serializes idempotent requests, exposes pending state, and rejects cross-tenant targets", async () => {
    const target = await createActiveMember(memberRoleId, "idempotent");
    const request = {
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "deactivate" as const,
      idempotencyKey: `lifecycle-idempotent-${suffix}`,
      reason: "Temporarily suspend access while responsibilities are reviewed",
    };
    const responses = await Promise.all(Array.from({ length: 4 }, () => requestLifecycle(request)));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(3);
    const approvalIds = new Set(
      responses.map((response) => String((body(response).data as JsonObject).id)),
    );
    expect(approvalIds.size).toBe(1);
    const approvalId = [...approvalIds][0];
    if (!approvalId) throw new Error("Lifecycle request did not return an approval");

    const lifecycleApprovals = await dbHandle.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.orgId, orgId),
          eq(approvals.resourceType, "membership-lifecycle"),
          eq(approvals.resourceId, target.membership.id),
        ),
      );
    expect(lifecycleApprovals).toEqual([{ id: approvalId }]);

    const membersResponse = await app.inject({
      method: "GET",
      url: "/api/v1/users?status=active&pageSize=100",
      headers: { cookie: ownerCookie },
    });
    expect(membersResponse.statusCode).toBe(200);
    const targetRow = (body(membersResponse).data as JsonObject[]).find(
      (member) => member.id === target.userId,
    );
    expect(targetRow).toMatchObject({
      membershipStatus: "active",
      pendingLifecycleAction: "deactivate",
      pendingLifecycleApprovalId: approvalId,
    });

    const keyMismatch = await requestLifecycle({
      ...request,
      reason: "A different semantic request",
    });
    expect(keyMismatch.statusCode).toBe(409);
    const secondPending = await requestLifecycle({
      ...request,
      action: "offboard",
      idempotencyKey: `lifecycle-second-${suffix}`,
    });
    expect(secondPending.statusCode).toBe(409);
    const crossTenant = await requestLifecycle({
      ...request,
      idempotencyKey: `lifecycle-cross-${suffix}`,
      requestCookie: otherOwnerCookie,
    });
    expect(crossTenant.statusCode).toBe(404);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approvalId}/reject`,
      headers: { cookie: approverCookie },
      payload: { comment: "Access remains required; reject the suspension" },
    });
    expect(rejected.statusCode).toBe(200);
    const replayAfterDecision = await requestLifecycle(request);
    expect(replayAfterDecision.statusCode).toBe(200);
    expect(body(replayAfterDecision)).toMatchObject({
      data: { id: approvalId, status: "rejected" },
      meta: { replay: true },
    });
    const duplicateDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approvalId}/reject`,
      headers: { cookie: approverCookie },
      payload: { comment: "Duplicate rejection must not apply" },
    });
    expect(duplicateDecision.statusCode).toBe(409);
  });

  it("keeps self-approval behind the existing explicit acknowledgement", async () => {
    const target = await createActiveMember(memberRoleId, "self-approval");
    const targetCookie = await login(target.email, target.password);
    const requested = await requestLifecycle({
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "offboard",
      idempotencyKey: `lifecycle-self-${suffix}`,
      reason: "Complete an approved end-of-engagement handover",
    });
    expect(requested.statusCode).toBe(201);
    const approval = body(requested).data as JsonObject;
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: { comment: "Missing explicit self-approval acknowledgement" },
    });
    expect(denied.statusCode).toBe(400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "One-person exception is explicitly recorded for later review",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode).toBe(200);
    const [membership] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(and(eq(memberships.id, target.membership.id), eq(memberships.orgId, orgId)));
    expect(membership?.status).toBe("offboarded");
    if (!membership) throw new Error("Offboarded membership not found");
    const forbiddenReactivation = await requestLifecycle({
      userId: target.userId,
      expectedVersion: membership.version,
      action: "reactivate",
      idempotencyKey: `lifecycle-offboarded-reactivate-${suffix}`,
      reason: "Offboarded members must not bypass a new onboarding process",
    });
    expect(forbiddenReactivation.statusCode).toBe(409);
    const revokedRequest = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: targetCookie },
    });
    expect(revokedRequest.statusCode).toBe(401);
  });

  it("applies approval atomically and revokes only the target organization's sessions", async () => {
    const target = await createActiveMember(memberRoleId, "tenant-sessions");
    const targetCookie = await login(target.email, target.password);
    await dbHandle.db.insert(sessions).values({
      orgId,
      userId: target.userId,
      tokenHash: sessionHash("same-org"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const [otherMembership] = await dbHandle.db
      .insert(memberships)
      .values({ orgId: otherOrgId, userId: target.userId, status: "active" })
      .returning();
    if (!otherMembership) throw new Error("Other-organization membership was not created");
    await dbHandle.db.insert(membershipRoles).values({
      orgId: otherOrgId,
      membershipId: otherMembership.id,
      roleId: otherMemberRoleId,
    });
    await dbHandle.db.insert(sessions).values({
      orgId: otherOrgId,
      userId: target.userId,
      tokenHash: sessionHash("other-org"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const requested = await requestLifecycle({
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "deactivate",
      idempotencyKey: `lifecycle-tenant-${suffix}`,
      reason: "Suspend this organization membership without affecting another company",
    });
    expect(requested.statusCode).toBe(201);
    const approval = body(requested).data as JsonObject;
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "Scope and handover verified" },
    });
    expect(approved.statusCode).toBe(200);

    const scopedMemberships = await dbHandle.db
      .select({ orgId: memberships.orgId, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.userId, target.userId));
    expect(scopedMemberships).toEqual(
      expect.arrayContaining([
        { orgId, status: "inactive" },
        { orgId: otherOrgId, status: "active" },
      ]),
    );
    const [globalUser] = await dbHandle.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, target.userId));
    expect(globalUser?.status).toBe("active");

    const scopedSessions = await dbHandle.db
      .select({ orgId: sessions.orgId, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(eq(sessions.userId, target.userId));
    const sameOrgSessions = scopedSessions.filter((session) => session.orgId === orgId);
    const otherOrgSessions = scopedSessions.filter((session) => session.orgId === otherOrgId);
    expect(sameOrgSessions).toHaveLength(2);
    expect(sameOrgSessions.every((session) => session.revokedAt instanceof Date)).toBe(true);
    expect(otherOrgSessions).toHaveLength(1);
    expect(otherOrgSessions[0]?.revokedAt).toBeNull();
    const revokedRequest = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: targetCookie },
    });
    expect(revokedRequest.statusCode).toBe(401);

    const events = await dbHandle.db
      .select({
        action: auditEvents.action,
        resourceType: auditEvents.resourceType,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.resourceId, target.membership.id)));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "request", resourceType: "membership-lifecycle" }),
        expect.objectContaining({ action: "deactivate", resourceType: "membership" }),
        expect.objectContaining({
          action: "revoke_for_membership_lifecycle",
          resourceType: "session",
          metadata: expect.objectContaining({ revokedSessionCount: 2 }),
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("tokenHash");
  });

  it("rejects without changing membership or sessions", async () => {
    const target = await createActiveMember(memberRoleId, "rejected");
    await login(target.email, target.password);
    const requested = await requestLifecycle({
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "offboard",
      idempotencyKey: `lifecycle-reject-${suffix}`,
      reason: "Proposed offboarding pending management review",
    });
    const approval = body(requested).data as JsonObject;
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/reject`,
      headers: { cookie: approverCookie },
      payload: { comment: "Offboarding basis is incomplete" },
    });
    expect(rejected.statusCode).toBe(200);
    const [membership] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(eq(memberships.id, target.membership.id));
    expect(membership).toMatchObject({
      status: "active",
      version: target.membership.version,
    });
    const [activeSession] = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.orgId, orgId),
          eq(sessions.userId, target.userId),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    expect(activeSession).toBeDefined();
    const [rejectionAudit] = await dbHandle.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "membership-lifecycle"),
          eq(auditEvents.resourceId, target.membership.id),
          eq(auditEvents.action, "reject"),
        ),
      )
      .limit(1);
    expect(rejectionAudit?.metadata).toMatchObject({ membershipChanged: false });
  });

  it("reactivates only inactive members while preserving old-session revocation", async () => {
    const successTarget = await createInactiveMember("reactivate-success");
    const oldSessionsBefore = await dbHandle.db
      .select({ id: sessions.id, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, successTarget.userId)));
    expect(oldSessionsBefore.length).toBeGreaterThan(0);
    expect(oldSessionsBefore.every((session) => session.revokedAt instanceof Date)).toBe(true);

    const successRequest = await requestLifecycle({
      userId: successTarget.userId,
      expectedVersion: successTarget.membership.version,
      action: "reactivate",
      idempotencyKey: `lifecycle-reactivate-success-${suffix}`,
      reason: "Identity and responsibilities were reverified before restoring access",
    });
    expect(successRequest.statusCode).toBe(201);
    const successApproval = body(successRequest).data as JsonObject;
    const successDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(successApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "Reactivation scope and current role were independently reviewed" },
    });
    expect(successDecision.statusCode).toBe(200);
    const [reactivated] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(eq(memberships.id, successTarget.membership.id));
    expect(reactivated).toMatchObject({
      status: "active",
      version: successTarget.membership.version + 1,
    });
    const oldSessionsAfter = await dbHandle.db
      .select({ id: sessions.id, revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, successTarget.userId)));
    expect(oldSessionsAfter).toEqual(oldSessionsBefore);

    const newCookie = await login(successTarget.email, successTarget.password);
    const newlyAuthenticated = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: newCookie },
    });
    expect(newlyAuthenticated.statusCode).toBe(200);
    const sessionsAfterLogin = await dbHandle.db
      .select({ revokedAt: sessions.revokedAt })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, successTarget.userId)));
    expect(sessionsAfterLogin.filter((session) => session.revokedAt === null)).toHaveLength(1);
    const [reactivationSessionAudit] = await dbHandle.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, successTarget.membership.id),
          eq(auditEvents.resourceType, "session"),
          eq(auditEvents.action, "ensure_revoked_for_membership_reactivation"),
        ),
      );
    expect(reactivationSessionAudit?.metadata).toMatchObject({
      revokedSessionCount: 0,
      requiresNewLogin: true,
    });

    const rejectedTarget = await createInactiveMember("reactivate-rejected");
    const rejectedRequest = await requestLifecycle({
      userId: rejectedTarget.userId,
      expectedVersion: rejectedTarget.membership.version,
      action: "reactivate",
      idempotencyKey: `lifecycle-reactivate-rejected-${suffix}`,
      reason: "Proposed restoration requires independent review",
    });
    const rejectedApproval = body(rejectedRequest).data as JsonObject;
    const rejectedDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(rejectedApproval.id)}/reject`,
      headers: { cookie: approverCookie },
      payload: { comment: "Identity revalidation is incomplete" },
    });
    expect(rejectedDecision.statusCode).toBe(200);
    const [stillInactiveAfterRejection] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(eq(memberships.id, rejectedTarget.membership.id));
    expect(stillInactiveAfterRejection).toMatchObject({
      status: "inactive",
      version: rejectedTarget.membership.version,
    });
    const rejectedLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: rejectedTarget.email, password: rejectedTarget.password },
    });
    expect(rejectedLogin.statusCode).toBe(403);
    expect(rejectedLogin.headers["set-cookie"]).toBeUndefined();

    const staleTarget = await createInactiveMember("reactivate-stale");
    const staleRequest = await requestLifecycle({
      userId: staleTarget.userId,
      expectedVersion: staleTarget.membership.version,
      action: "reactivate",
      idempotencyKey: `lifecycle-reactivate-stale-${suffix}`,
      reason: "This request will become stale after a concurrent profile update",
    });
    const staleApproval = body(staleRequest).data as JsonObject;
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${staleTarget.userId}`,
      headers: { cookie: ownerCookie },
      payload: {
        displayName: "Reactivation Stale Updated",
        expectedVersion: staleTarget.membership.version,
      },
    });
    expect(changed.statusCode).toBe(200);
    const staleDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(staleApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "The stale request must not restore access" },
    });
    expect(staleDecision.statusCode).toBe(409);
    const [stillInactiveAfterStaleDecision] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(eq(memberships.id, staleTarget.membership.id));
    expect(stillInactiveAfterStaleDecision).toMatchObject({
      status: "inactive",
      version: staleTarget.membership.version + 1,
    });
    const [stillPending] = await dbHandle.db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, String(staleApproval.id)));
    expect(stillPending?.status).toBe("pending");

    const noRoleTarget = await createInactiveMember("reactivate-without-role");
    await dbHandle.db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(membershipRoles.membershipId, noRoleTarget.membership.id),
        ),
      );
    const noRoleRequest = await requestLifecycle({
      userId: noRoleTarget.userId,
      expectedVersion: noRoleTarget.membership.version,
      action: "reactivate",
      idempotencyKey: `lifecycle-reactivate-no-role-${suffix}`,
      reason: "A membership without any current role must remain inactive",
    });
    const noRoleApproval = body(noRoleRequest).data as JsonObject;
    const noRoleDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(noRoleApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "This must fail until a role is approved" },
    });
    expect(noRoleDecision.statusCode).toBe(409);
    const [stillInactiveWithoutRole] = await dbHandle.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(eq(memberships.id, noRoleTarget.membership.id));
    expect(stillInactiveWithoutRole?.status).toBe("inactive");
  });

  it("lists current roles and applies only versioned, human-approved role transitions", async () => {
    const target = await createActiveMember(memberRoleId, "role-change");
    const listBefore = await app.inject({
      method: "GET",
      url: `/api/v1/users?search=${encodeURIComponent(target.email)}`,
      headers: { cookie: ownerCookie },
    });
    expect(listBefore.statusCode, listBefore.body).toBe(200);
    const listedBefore = (body(listBefore).data as JsonObject[])[0];
    expect(listedBefore?.membershipId).toBe(target.membership.id);
    expect(listedBefore?.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: memberRoleId, systemKey: "member" })]),
    );

    const assignRequestPayload = {
      membershipId: target.membership.id,
      roleId: adminRoleId,
      mode: "assign" as const,
      reason: "Temporarily add a separately reviewed administration duty",
      expectedVersion: target.membership.version,
      idempotencyKey: `role-assign-${suffix}`,
    };
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: assignRequestPayload,
    });
    expect(requested.statusCode, requested.body).toBe(201);
    const approval = body(requested).data as JsonObject;
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: assignRequestPayload,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect((body(replay).data as JsonObject).id).toBe(approval.id);
    expect(body(replay).meta).toMatchObject({ replay: true });

    const conflictingPending = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: {
        ...assignRequestPayload,
        roleId: ownerRoleId,
        idempotencyKey: `role-conflict-${suffix}`,
      },
    });
    expect(conflictingPending.statusCode).toBe(409);
    const assignedBeforeApproval = await dbHandle.db
      .select()
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(membershipRoles.membershipId, target.membership.id),
          eq(membershipRoles.roleId, adminRoleId),
        ),
      );
    expect(assignedBeforeApproval).toHaveLength(0);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "Scope and minimum privileges were independently reviewed" },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const [membershipAfterAssign] = await dbHandle.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, target.membership.id));
    expect(membershipAfterAssign?.version).toBe(target.membership.version + 1);
    const assignedAfterApproval = await dbHandle.db
      .select()
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(membershipRoles.membershipId, target.membership.id),
          eq(membershipRoles.roleId, adminRoleId),
        ),
      );
    expect(assignedAfterApproval).toHaveLength(1);

    const removeRequest = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: {
        membershipId: target.membership.id,
        roleId: adminRoleId,
        mode: "remove",
        reason: "The temporary administration duty has ended",
        expectedVersion: membershipAfterAssign?.version,
        idempotencyKey: `role-remove-${suffix}`,
      },
    });
    expect(removeRequest.statusCode, removeRequest.body).toBe(201);
    const removeApproval = body(removeRequest).data as JsonObject;
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(removeApproval.id)}/reject`,
      headers: { cookie: approverCookie },
      payload: { comment: "Keep the duty until the handover evidence is complete" },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const assignmentAfterRejection = await dbHandle.db
      .select()
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(membershipRoles.membershipId, target.membership.id),
          eq(membershipRoles.roleId, adminRoleId),
        ),
      );
    expect(assignmentAfterRejection).toHaveLength(1);

    const duplicateAssign = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: {
        ...assignRequestPayload,
        expectedVersion: membershipAfterAssign?.version,
        idempotencyKey: `role-duplicate-${suffix}`,
      },
    });
    expect(duplicateAssign.statusCode).toBe(409);
  });

  it("protects the last unarchived active owner for lifecycle and role removal", async () => {
    const inactiveOwner = await createActiveMember(ownerRoleId, "inactive-owner");
    const deactivateRequest = await requestLifecycle({
      userId: inactiveOwner.userId,
      expectedVersion: inactiveOwner.membership.version,
      action: "deactivate",
      idempotencyKey: `lifecycle-owner-inactive-${suffix}`,
      reason: "Remove the secondary owner from active duty",
    });
    const deactivateApproval = body(deactivateRequest).data as JsonObject;
    const deactivateApproved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(deactivateApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "A primary active owner remains" },
    });
    expect(deactivateApproved.statusCode).toBe(200);

    const archivedOwner = await createActiveMember(ownerRoleId, "archived-owner");
    await dbHandle.db
      .update(memberships)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(memberships.id, archivedOwner.membership.id), eq(memberships.orgId, orgId)));

    const [ownerMembership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, ownerMembershipId), eq(memberships.orgId, orgId)));
    if (!ownerMembership) throw new Error("Primary owner membership not found");
    const lifecycleRequest = await requestLifecycle({
      userId: ownerUserId,
      expectedVersion: ownerMembership.version,
      action: "offboard",
      idempotencyKey: `lifecycle-final-owner-${suffix}`,
      reason: "Attempt to offboard the final active owner",
    });
    const lifecycleApproval = body(lifecycleRequest).data as JsonObject;
    const lifecycleDenied = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(lifecycleApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "Should be blocked by the final-owner invariant" },
    });
    expect(lifecycleDenied.statusCode).toBe(409);

    const roleRequest = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: { cookie: ownerCookie },
      payload: {
        membershipId: ownerMembershipId,
        roleId: ownerRoleId,
        mode: "remove",
        reason: "Attempt to remove the final active owner role",
        expectedVersion: ownerMembership.version,
        idempotencyKey: `final-owner-role-${suffix}`,
      },
    });
    expect(roleRequest.statusCode).toBe(201);
    const roleApproval = body(roleRequest).data as JsonObject;
    const roleDenied = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(roleApproval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "Should also be blocked by the active-owner invariant" },
    });
    expect(roleDenied.statusCode).toBe(409);

    const [stillOwner] = await dbHandle.db
      .select({ membershipId: membershipRoles.membershipId })
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, orgId),
          eq(membershipRoles.membershipId, ownerMembershipId),
          eq(membershipRoles.roleId, ownerRoleId),
        ),
      );
    expect(stillOwner).toBeDefined();
    const [stillActive] = await dbHandle.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(eq(memberships.id, ownerMembershipId));
    expect(stillActive?.status).toBe("active");
  });

  it("rolls back a stale approval after a concurrent membership version change", async () => {
    const target = await createActiveMember(memberRoleId, "stale");
    await dbHandle.db.insert(sessions).values({
      orgId,
      userId: target.userId,
      tokenHash: sessionHash("stale-approval-session"),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const requested = await requestLifecycle({
      userId: target.userId,
      expectedVersion: target.membership.version,
      action: "deactivate",
      idempotencyKey: `lifecycle-stale-${suffix}`,
      reason: "Request created before a concurrent profile update",
    });
    const approval = body(requested).data as JsonObject;
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${target.userId}`,
      headers: { cookie: ownerCookie },
      payload: {
        displayName: "Lifecycle Stale Updated",
        expectedVersion: target.membership.version,
      },
    });
    expect(changed.statusCode).toBe(200);
    const staleDecision = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: approverCookie },
      payload: { comment: "This stale approval must not apply" },
    });
    expect(staleDecision.statusCode).toBe(409);
    const [unchangedMembership] = await dbHandle.db
      .select({ status: memberships.status, version: memberships.version })
      .from(memberships)
      .where(eq(memberships.id, target.membership.id));
    expect(unchangedMembership).toMatchObject({
      status: "active",
      version: target.membership.version + 1,
    });
    const [pendingApproval] = await dbHandle.db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, String(approval.id)));
    expect(pendingApproval?.status).toBe("pending");
    const [stillUnrevoked] = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.orgId, orgId),
          eq(sessions.userId, target.userId),
          isNull(sessions.revokedAt),
        ),
      );
    expect(stillUnrevoked).toBeDefined();
  });
});
