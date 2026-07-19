import { randomUUID } from "node:crypto";
import { approvals, createDatabase } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
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

describe.skipIf(!databaseUrl)("approval linked external action projection", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let config: ApiConfig;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let orgId: string;
  let ownerUserId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Linked Approval Test Company",
      organizationSlug: `linked-approval-${suffix}`,
      adminEmail: `linked-approval-owner-${suffix}@example.test`,
      adminDisplayName: "Linked Approval Owner",
      adminPassword: "correct-horse-battery-staple-linked-approval",
      adminMustChangePassword: false,
    });
    await seedDatabase(dbHandle.db, {
      organizationName: "Linked Approval Other Company",
      organizationSlug: `linked-approval-other-${suffix}`,
      adminEmail: `linked-approval-other-${suffix}@example.test`,
      adminDisplayName: "Linked Approval Other Owner",
      adminPassword: "correct-horse-battery-staple-linked-other",
      adminMustChangePassword: false,
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
    const queue = { send: async () => randomUUID() } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue,
    });

    const [ownerLogin, otherOwnerLogin] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: `linked-approval-owner-${suffix}@example.test`,
          password: "correct-horse-battery-staple-linked-approval",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: `linked-approval-other-${suffix}@example.test`,
          password: "correct-horse-battery-staple-linked-other",
        },
      }),
    ]);
    expect(ownerLogin.statusCode, ownerLogin.body).toBe(200);
    expect(otherOwnerLogin.statusCode, otherOwnerLogin.body).toBe(200);
    ownerCookie = cookie(ownerLogin);
    otherOwnerCookie = cookie(otherOwnerLogin);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("returns truthful linked execution state without leaking cross-organization actions", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { amountCents: 50_000, beneficiary: "Linked supplier" },
        idempotencyKey: `linked-payment-${suffix}`,
        reason: "Record the approved payment and its external receipt",
      },
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const action = body(createdResponse).data as JsonObject;
    const actionId = String(action.id);
    const approvalId = String(action.approvalId);

    const pendingResponse = await app.inject({
      method: "GET",
      url: "/api/v1/approvals?status=pending&pageSize=100",
      headers: { cookie: ownerCookie },
    });
    expect(pendingResponse.statusCode, pendingResponse.body).toBe(200);
    const pendingItems = body(pendingResponse).data as JsonObject[];
    expect(pendingItems.find((item) => item.id === approvalId)).toMatchObject({
      id: approvalId,
      status: "pending",
      linkedExternalAction: {
        id: actionId,
        status: "pending_approval",
        adapter: "manual",
        evidence: null,
        externalReference: null,
      },
    });

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${approvalId}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Payment intent and beneficiary checked",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode, approved.body).toBe(200);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${actionId}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "submitted",
        evidence: { externalReference: `manual-submit-${suffix}` },
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${actionId}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "confirmed",
        evidence: { receiptReference: `manual-receipt-${suffix}` },
      },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/v1/approvals/${approvalId}`,
      headers: { cookie: ownerCookie },
    });
    expect(readResponse.statusCode, readResponse.body).toBe(200);
    expect(body(readResponse).data).toMatchObject({
      id: approvalId,
      status: "approved",
      linkedExternalAction: {
        id: actionId,
        status: "confirmed",
        adapter: "manual",
        evidence: {
          externalReference: `manual-submit-${suffix}`,
          receiptReference: `manual-receipt-${suffix}`,
        },
        externalReference: `manual-receipt-${suffix}`,
      },
    });

    const otherActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: otherOwnerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { amountCents: 10_000, beneficiary: "Other organization supplier" },
        idempotencyKey: `linked-other-payment-${suffix}`,
        reason: "Other organization payment must remain isolated",
      },
    });
    expect(otherActionResponse.statusCode, otherActionResponse.body).toBe(201);
    const otherAction = body(otherActionResponse).data as JsonObject;

    const forgedApprovalId = randomUUID();
    const mismatchedApprovalId = randomUUID();
    const internalApprovalId = randomUUID();
    await dbHandle.db.insert(approvals).values([
      {
        id: forgedApprovalId,
        orgId,
        resourceType: "external-action",
        resourceId: String(otherAction.id),
        operation: "bank_payment",
        reason: "Forged cross-organization resource reference",
        riskLevel: "critical",
        requestedBy: ownerUserId,
      },
      {
        id: mismatchedApprovalId,
        orgId,
        resourceType: "external-action",
        resourceId: actionId,
        operation: "bank_payment",
        reason: "Same-organization action with a mismatched approval link",
        riskLevel: "critical",
        requestedBy: ownerUserId,
      },
      {
        id: internalApprovalId,
        orgId,
        resourceType: "membership",
        resourceId: randomUUID(),
        operation: "membership_deactivate",
        reason: "Internal membership lifecycle approval",
        riskLevel: "critical",
        requestedBy: ownerUserId,
      },
    ]);

    const forgedReadResponse = await app.inject({
      method: "GET",
      url: `/api/v1/approvals/${forgedApprovalId}`,
      headers: { cookie: ownerCookie },
    });
    expect(forgedReadResponse.statusCode, forgedReadResponse.body).toBe(200);
    expect(body(forgedReadResponse).data).toMatchObject({
      id: forgedApprovalId,
      linkedExternalAction: null,
    });

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/approvals?pageSize=100",
      headers: { cookie: ownerCookie },
    });
    expect(listResponse.statusCode, listResponse.body).toBe(200);
    const items = body(listResponse).data as JsonObject[];
    expect(items.find((item) => item.id === forgedApprovalId)).toMatchObject({
      linkedExternalAction: null,
    });
    expect(items.find((item) => item.id === forgedApprovalId)).not.toHaveProperty(
      "linkedExternalAction.id",
    );
    expect(items.find((item) => item.id === mismatchedApprovalId)).toMatchObject({
      linkedExternalAction: null,
    });
    expect(items.find((item) => item.id === internalApprovalId)).not.toHaveProperty(
      "linkedExternalAction",
    );
  });
});
