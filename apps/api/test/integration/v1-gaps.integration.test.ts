import { randomUUID } from "node:crypto";
import {
  approvals,
  auditEvents,
  createDatabase,
  externalActions,
  membershipRoles,
  memberships,
  sessions,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
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
  return first.split(";", 1)[0] ?? "";
}

describe.skipIf(!databaseUrl)("API PostgreSQL v1 gap coverage", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let config: ApiConfig;
  let ownerCookie: string;
  let ownerUserId: string;
  let orgId: string;
  let otherCookie: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Gap Test Company",
      organizationSlug: `gap-${suffix}`,
      adminEmail: `gap-owner-${suffix}@example.test`,
      adminDisplayName: "Gap Test Owner",
      adminPassword: "correct-horse-battery-staple-gap",
    });
    await seedDatabase(dbHandle.db, {
      organizationName: "Gap Other Company",
      organizationSlug: `gap-other-${suffix}`,
      adminEmail: `gap-other-${suffix}@example.test`,
      adminDisplayName: "Gap Other Owner",
      adminPassword: "correct-horse-battery-staple-other",
    });
    orgId = seeded.organization.id;
    ownerUserId = seeded.user.id;
    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = {
      send: async () => randomUUID(),
    } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue,
    });

    const login = async (email: string, password: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
    const ownerLogin = await login(
      `gap-owner-${suffix}@example.test`,
      "correct-horse-battery-staple-gap",
    );
    const otherLogin = await login(
      `gap-other-${suffix}@example.test`,
      "correct-horse-battery-staple-other",
    );
    expect(ownerLogin.statusCode).toBe(200);
    expect(otherLogin.statusCode).toBe(200);
    ownerCookie = cookie(ownerLogin);
    otherCookie = cookie(otherLogin);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("replays identical external actions and resolves idempotency races", async () => {
    const idempotencyKey = `gap-payment-${suffix}`;
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { amountCents: 12_345, beneficiary: "Gap supplier" },
        idempotencyKey,
        reason: "Gap payment",
      },
    });
    expect(first.statusCode).toBe(201);
    const firstAction = body(first).data as JsonObject;

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { beneficiary: "Gap supplier", amountCents: 12_345 },
        idempotencyKey,
        reason: "Gap payment",
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(body(replay)).toMatchObject({
      data: { id: firstAction.id },
      meta: { replay: true },
    });

    const mismatch = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { amountCents: 99_999, beneficiary: "Gap supplier" },
        idempotencyKey,
        reason: "Gap payment",
      },
    });
    expect(mismatch.statusCode).toBe(409);

    const racedKey = `gap-race-${suffix}`;
    const raced = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({
          method: "POST",
          url: "/api/v1/external-actions",
          headers: { cookie: ownerCookie },
          payload: {
            kind: "bank_payment",
            adapter: "manual",
            payload: { amountCents: 77, beneficiary: "Race supplier" },
            idempotencyKey: racedKey,
            reason: "Race payment",
          },
        }),
      ),
    );
    expect(
      raced.every((response) => response.statusCode === 201 || response.statusCode === 200),
    ).toBe(true);
    const racedIds = new Set(
      raced.map((response) => String((body(response).data as JsonObject).id)),
    );
    expect(racedIds.size).toBe(1);
    const racedActionId = [...racedIds][0];
    if (!racedActionId) throw new Error("Race did not return an action id");
    const racedRows = await dbHandle.db
      .select({ id: externalActions.id })
      .from(externalActions)
      .where(and(eq(externalActions.orgId, orgId), eq(externalActions.idempotencyKey, racedKey)));
    expect(racedRows).toHaveLength(1);
    const racedApprovals = await dbHandle.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.resourceId, racedActionId)));
    expect(racedApprovals).toHaveLength(1);
  });

  it("keeps a new membership pending until role approval, then activates it atomically", async () => {
    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: { cookie: ownerCookie },
    });
    const memberRole = (body(rolesResponse).data as JsonObject[]).find(
      (role) => role.systemKey === "member",
    );
    if (!memberRole) throw new Error("Member role not found");
    const email = `pending-${suffix}@example.test`;
    const password = "pending-member-password-long-enough";
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: {
        email,
        displayName: "Pending Member",
        password,
        roleId: memberRole.id,
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const result = body(createdResponse).data as JsonObject;
    const membership = result.membership as JsonObject;
    const approval = result.approval as JsonObject;
    expect(membership.status).toBe("pending");
    expect((approval.payload as JsonObject).activateMembership).toBe(true);

    const [beforeSessions] = await dbHandle.db
      .select({ total: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, String((result.user as JsonObject).id)));
    const pendingLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(pendingLogin.statusCode).toBe(403);
    expect(pendingLogin.headers["set-cookie"]).toBeUndefined();
    const [afterSessions] = await dbHandle.db
      .select({ total: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, String((result.user as JsonObject).id)));
    expect(afterSessions?.total).toBe(beforeSessions?.total);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Activate pending member",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode).toBe(200);
    const [activated] = await dbHandle.db
      .select({ status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.id, String(membership.id)), eq(memberships.orgId, orgId)));
    expect(activated?.status).toBe("active");
    const [assigned] = await dbHandle.db
      .select({ roleId: membershipRoles.roleId })
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, String(membership.id)),
          eq(membershipRoles.orgId, orgId),
        ),
      );
    expect(assigned?.roleId).toBe(memberRole.id);

    const activeLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(activeLogin.statusCode).toBe(200);
  });

  it("audits authenticated 4xx refusals without persisting request bodies", async () => {
    const otherObjective = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: otherCookie },
      payload: { title: "Other organization objective" },
    });
    expect(otherObjective.statusCode).toBe(201);
    const otherId = String((body(otherObjective).data as JsonObject).id);
    const crossOrg = await app.inject({
      method: "GET",
      url: `/api/v1/objectives/${otherId}?secret=query-value-must-not-be-audit-body`,
      headers: { cookie: ownerCookie },
    });
    expect(crossOrg.statusCode).toBe(404);

    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: { cookie: ownerCookie },
    });
    const memberRole = (body(rolesResponse).data as JsonObject[]).find(
      (role) => role.systemKey === "member",
    );
    if (!memberRole) throw new Error("Member role not found");
    const memberEmail = `audit-member-${suffix}@example.test`;
    const memberPassword = "audit-member-password-long-enough";
    const memberResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: {
        email: memberEmail,
        displayName: "Audit Member",
        password: memberPassword,
        roleId: memberRole.id,
      },
    });
    const memberResult = body(memberResponse).data as JsonObject;
    const memberApproval = memberResult.approval as JsonObject;
    await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(memberApproval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Activate audit member",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    const memberLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: memberEmail, password: memberPassword },
    });
    expect(memberLogin.statusCode).toBe(200);
    const memberCookie = cookie(memberLogin);
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: memberCookie },
      payload: {
        email: `should-not-create-${suffix}@example.test`,
        displayName: "Should Not Create",
        password: "should-not-create-password-long-enough",
        roleId: memberRole.id,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const events = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.action, "request_rejected")));
    const crossOrgAudit = events.find(
      (event) => event.resourceId === `/api/v1/objectives/${otherId}`,
    );
    expect(crossOrgAudit).toMatchObject({
      actorUserId: ownerUserId,
      resourceType: "request",
      before: null,
      after: null,
      metadata: { method: "GET", code: "NOT_FOUND", status: 404 },
    });
    const forbiddenAudit = events.find(
      (event) => event.actorUserId === String((memberResult.user as JsonObject).id),
    );
    expect(forbiddenAudit).toMatchObject({
      resourceType: "request",
      before: null,
      after: null,
      metadata: { method: "POST", code: "FORBIDDEN", status: 403 },
    });
    expect(forbiddenAudit?.metadata).not.toHaveProperty("body");
  });

  it("returns active advisor prompt data scopes and keeps legal scope narrow", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/advisors",
      headers: { cookie: ownerCookie },
    });
    expect(response.statusCode).toBe(200);
    const legal = (body(response).data as JsonObject[]).find(
      (advisor) => advisor.key === "legal_compliance",
    );
    expect(legal).toBeDefined();
    const promptVersion = legal?.promptVersion as JsonObject;
    expect(promptVersion.dataScopes).toEqual(expect.any(Array));
    expect(promptVersion.dataScopes as unknown[]).not.toContain("compliance-events");

    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: { cookie: ownerCookie },
    });
    const viewerRole = (body(rolesResponse).data as JsonObject[]).find(
      (role) => role.systemKey === "viewer",
    );
    if (!viewerRole) throw new Error("Viewer role not found");
    const viewerEmail = `scope-viewer-${suffix}@example.test`;
    const viewerPassword = "scope-viewer-password-long-enough";
    const viewerResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: ownerCookie },
      payload: {
        email: viewerEmail,
        displayName: "Scope Viewer",
        password: viewerPassword,
        roleId: viewerRole.id,
      },
    });
    const viewerResult = body(viewerResponse).data as JsonObject;
    const viewerApproval = viewerResult.approval as JsonObject;
    const viewerApprove = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(viewerApproval.id)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Activate scope viewer",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(viewerApprove.statusCode).toBe(200);
    const viewerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: viewerEmail, password: viewerPassword },
    });
    expect(viewerLogin.statusCode).toBe(200);
    const viewerAdvisors = await app.inject({
      method: "GET",
      url: "/api/v1/advisors",
      headers: { cookie: cookie(viewerLogin) },
    });
    expect(viewerAdvisors.statusCode).toBe(200);
    const security = (body(viewerAdvisors).data as JsonObject[]).find(
      (advisor) => advisor.key === "information_security",
    );
    expect(security?.dataScopes as unknown[]).not.toContain("audit-events");
    expect(
      ((security?.promptVersion as JsonObject | null)?.dataScopes as unknown[]) ?? [],
    ).toContain("audit-events");
  });
});
