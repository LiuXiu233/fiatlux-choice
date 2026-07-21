import { randomUUID } from "node:crypto";
import {
  approvals,
  auditEvents,
  contracts,
  createDatabase,
  externalActions,
  files,
  financialEntries,
  membershipRoles,
  memberships,
  sessions,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq, sql } from "drizzle-orm";
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

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function completeInitialPasswordChange(
  app: FastifyInstance,
  loginResponse: {
    body: string;
    headers: Record<string, string | string[] | number | undefined>;
  },
  currentPassword: string,
  newPassword: string,
) {
  expect(body(loginResponse).data).toMatchObject({ mustChangePassword: true });
  const sessionCookie = cookie(loginResponse);
  const changed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/change-password",
    headers: { cookie: sessionCookie },
    payload: { currentPassword, newPassword },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  return sessionCookie;
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
      adminMustChangePassword: false,
    });
    await seedDatabase(dbHandle.db, {
      organizationName: "Gap Other Company",
      organizationSlug: `gap-other-${suffix}`,
      adminEmail: `gap-other-${suffix}@example.test`,
      adminDisplayName: "Gap Other Owner",
      adminPassword: "correct-horse-battery-staple-other",
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
  }, 30_000);

  it("cancels the linked approval atomically and never revives a cancelled external action", async () => {
    const createAction = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/external-actions",
        headers: { cookie: ownerCookie },
        payload: {
          kind: "bank_payment",
          adapter: "manual",
          payload: { amountCents: 500, beneficiary: `Cancellation supplier ${label}` },
          idempotencyKey: `cancel-payment-${suffix}-${label}`,
          reason: "Verify cancellation and approval use one truthful transaction boundary",
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      return body(response).data as JsonObject;
    };

    const sequential = await createAction("sequential");
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(sequential.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Withdraw before approval" },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(body(cancelled).data).toMatchObject({ status: "cancelled" });

    const approvalAfterCancellation = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(sequential.approvalId)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "This stale approval must not revive the action",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approvalAfterCancellation.statusCode).toBe(409);
    const [sequentialApproval] = await dbHandle.db
      .select({ status: approvals.status })
      .from(approvals)
      .where(eq(approvals.id, String(sequential.approvalId)));
    expect(sequentialApproval?.status).toBe("cancelled");

    const linkedExpenseResponse = await app.inject({
      method: "POST",
      url: "/api/v1/financial-entries",
      headers: { cookie: ownerCookie },
      payload: {
        occurredAt: "2026-07-19T12:00:00+08:00",
        type: "expense",
        category: "cancellation-reuse",
        description: `Reusable cancellation expense ${suffix}`,
        amountCents: 2_500,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(linkedExpenseResponse.statusCode, linkedExpenseResponse.body).toBe(201);
    const linkedExpense = body(linkedExpenseResponse).data as JsonObject;
    const linkedActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          amountCents: 2_500,
          beneficiary: "Reusable cancellation supplier",
          financialEntryId: linkedExpense.id,
        },
        idempotencyKey: `cancel-linked-payment-${suffix}`,
        reason: "Canceling this request must release its draft expense for re-application",
      },
    });
    expect(linkedActionResponse.statusCode, linkedActionResponse.body).toBe(201);
    const linkedAction = body(linkedActionResponse).data as JsonObject;
    const [linkedBeforeCancel] = await dbHandle.db
      .select({
        externalActionId: financialEntries.externalActionId,
        version: financialEntries.version,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, String(linkedExpense.id)));
    expect(linkedBeforeCancel).toMatchObject({
      externalActionId: linkedAction.id,
      version: 2,
    });
    const archiveWhileLinked = await app.inject({
      method: "DELETE",
      url: `/api/v1/financial-entries/${String(linkedExpense.id)}?expectedVersion=${String(
        linkedBeforeCancel?.version,
      )}`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveWhileLinked.statusCode, archiveWhileLinked.body).toBe(409);
    const linkedCancelled = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(linkedAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Release the expense for a corrected request" },
    });
    expect(linkedCancelled.statusCode, linkedCancelled.body).toBe(200);
    const [linkedAfterCancel] = await dbHandle.db
      .select({
        externalActionId: financialEntries.externalActionId,
        status: financialEntries.status,
        version: financialEntries.version,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, String(linkedExpense.id)));
    expect(linkedAfterCancel).toMatchObject({
      externalActionId: null,
      status: "draft",
      version: 3,
    });
    const cancellationAuditRows = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, String(linkedExpense.id)),
          eq(auditEvents.action, "unlink_payment_cancel"),
        ),
      );
    expect(cancellationAuditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({
            externalActionId: linkedAction.id,
            status: "draft",
            version: 2,
          }),
          after: expect.objectContaining({
            externalActionId: null,
            status: "draft",
            version: 3,
          }),
          metadata: expect.objectContaining({ externalActionId: linkedAction.id }),
        }),
      ]),
    );
    const reusableAction = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          amountCents: 2_500,
          beneficiary: "Corrected cancellation supplier",
          financialEntryId: linkedExpense.id,
        },
        idempotencyKey: `cancel-linked-payment-retry-${suffix}`,
        reason: "Re-apply the released draft expense with corrected beneficiary",
      },
    });
    expect(reusableAction.statusCode, reusableAction.body).toBe(201);

    const rejectedExpenseResponse = await app.inject({
      method: "POST",
      url: "/api/v1/financial-entries",
      headers: { cookie: ownerCookie },
      payload: {
        occurredAt: "2026-07-19T13:00:00+08:00",
        type: "expense",
        category: "rejection-release",
        description: `Rejected payment expense ${suffix}`,
        amountCents: 3_300,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(rejectedExpenseResponse.statusCode, rejectedExpenseResponse.body).toBe(201);
    const rejectedExpense = body(rejectedExpenseResponse).data as JsonObject;
    const rejectedActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          amountCents: 3_300,
          beneficiary: "Rejected payment supplier",
          financialEntryId: rejectedExpense.id,
        },
        idempotencyKey: `reject-linked-payment-${suffix}`,
        reason: "Rejection must release the draft ledger entry",
      },
    });
    expect(rejectedActionResponse.statusCode, rejectedActionResponse.body).toBe(201);
    const rejectedAction = body(rejectedActionResponse).data as JsonObject;
    const rejectedApproval = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(rejectedAction.approvalId)}/reject`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Reject the payment basis and release the draft expense",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(rejectedApproval.statusCode, rejectedApproval.body).toBe(200);
    const [releasedAfterReject] = await dbHandle.db
      .select({
        externalActionId: financialEntries.externalActionId,
        status: financialEntries.status,
        version: financialEntries.version,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, String(rejectedExpense.id)));
    expect(releasedAfterReject).toMatchObject({
      externalActionId: null,
      status: "draft",
      version: 3,
    });
    const manuallyPosted = await app.inject({
      method: "PATCH",
      url: `/api/v1/financial-entries/${String(rejectedExpense.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "posted", expectedVersion: 3 },
    });
    expect(manuallyPosted.statusCode, manuallyPosted.body).toBe(200);
    expect(body(manuallyPosted).data).toMatchObject({
      status: "posted",
      externalActionId: null,
      version: 4,
    });
    const rejectionAuditRows = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.orgId, orgId), eq(auditEvents.resourceId, String(rejectedExpense.id))),
      );
    expect(rejectionAuditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "unlink_payment_reject",
          before: expect.objectContaining({
            externalActionId: rejectedAction.id,
            status: "draft",
          }),
          after: expect.objectContaining({ externalActionId: null, status: "draft" }),
          metadata: expect.objectContaining({
            externalActionId: rejectedAction.id,
            approvalId: rejectedAction.approvalId,
          }),
        }),
      ]),
    );
    const rejectionActionAuditRows = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, String(rejectedAction.id)),
          eq(auditEvents.action, "approval_decision_apply"),
        ),
      );
    expect(rejectionActionAuditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: expect.objectContaining({ status: "pending_approval" }),
          after: expect.objectContaining({ status: "cancelled" }),
          metadata: expect.objectContaining({
            approvalId: rejectedAction.approvalId,
            decision: "rejected",
          }),
        }),
      ]),
    );

    const approvedExpenseResponse = await app.inject({
      method: "POST",
      url: "/api/v1/financial-entries",
      headers: { cookie: ownerCookie },
      payload: {
        occurredAt: "2026-07-19T14:00:00+08:00",
        type: "expense",
        category: "approved-cancellation-release",
        description: `Approved cancellation expense ${suffix}`,
        amountCents: 4_400,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(approvedExpenseResponse.statusCode, approvedExpenseResponse.body).toBe(201);
    const approvedExpense = body(approvedExpenseResponse).data as JsonObject;
    const approvedActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          amountCents: 4_400,
          beneficiary: "Approved cancellation supplier",
          financialEntryId: approvedExpense.id,
        },
        idempotencyKey: `approved-cancel-linked-payment-${suffix}`,
        reason: "An approved payment request must remain cancellable before submission",
      },
    });
    expect(approvedActionResponse.statusCode, approvedActionResponse.body).toBe(201);
    const approvedAction = body(approvedActionResponse).data as JsonObject;
    const approveForCancellation = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(approvedAction.approvalId)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Approve, then withdraw before external submission",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approveForCancellation.statusCode, approveForCancellation.body).toBe(200);
    const cancelApprovedAction = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(approvedAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Withdraw approved request before submission" },
    });
    expect(cancelApprovedAction.statusCode, cancelApprovedAction.body).toBe(200);
    const [releasedApprovedExpense] = await dbHandle.db
      .select({
        externalActionId: financialEntries.externalActionId,
        status: financialEntries.status,
        version: financialEntries.version,
      })
      .from(financialEntries)
      .where(eq(financialEntries.id, String(approvedExpense.id)));
    expect(releasedApprovedExpense).toMatchObject({
      externalActionId: null,
      status: "draft",
      version: 3,
    });
    const archiveAfterCancellation = await app.inject({
      method: "DELETE",
      url: `/api/v1/financial-entries/${String(approvedExpense.id)}?expectedVersion=3`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveAfterCancellation.statusCode, archiveAfterCancellation.body).toBe(200);

    const concurrent = await createAction("concurrent");
    const [approveResponse, cancelResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/approvals/${String(concurrent.approvalId)}/approve`,
        headers: { cookie: ownerCookie },
        payload: {
          comment: "Race approval",
          acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(concurrent.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: { targetStatus: "cancelled", note: "Race cancellation" },
      }),
    ]);
    expect([200, 409]).toContain(approveResponse.statusCode);
    expect(cancelResponse.statusCode, cancelResponse.body).toBe(200);
    const [finalAction, finalApproval] = await Promise.all([
      dbHandle.db
        .select({ status: externalActions.status })
        .from(externalActions)
        .where(eq(externalActions.id, String(concurrent.id))),
      dbHandle.db
        .select({ status: approvals.status })
        .from(approvals)
        .where(eq(approvals.id, String(concurrent.approvalId))),
    ]);
    expect(finalAction[0]?.status).toBe("cancelled");
    expect(["approved", "cancelled"]).toContain(finalApproval[0]?.status);
  }, 30_000);

  it("confirms manual bank, tax, and legal actions without inventing a database target", async () => {
    const cases = [
      {
        kind: "bank_payment",
        payload: { amountCents: 700, beneficiary: "Unlinked manual supplier" },
      },
      {
        kind: "tax_filing",
        payload: { filingPeriod: "2026-07", taxType: "增值税" },
      },
      {
        kind: "external_legal_commitment",
        payload: { counterparty: "Manual counterparty", commitment: "Controlled written promise" },
      },
    ] as const;
    for (const [index, item] of cases.entries()) {
      const createdResponse = await app.inject({
        method: "POST",
        url: "/api/v1/external-actions",
        headers: { cookie: ownerCookie },
        payload: {
          ...item,
          adapter: "manual",
          idempotencyKey: `manual-no-target-${suffix}-${index}`,
          reason: "Manual execution remains outside the product until receipt evidence is recorded",
        },
      });
      expect(createdResponse.statusCode, createdResponse.body).toBe(201);
      const action = body(createdResponse).data as JsonObject;
      expect(action.payload).not.toHaveProperty("targetExpectedVersion");
      const approved = await app.inject({
        method: "POST",
        url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
        headers: { cookie: ownerCookie },
        payload: {
          comment: `Approve ${item.kind} intent`,
          acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
        },
      });
      expect(approved.statusCode, approved.body).toBe(200);
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: {
          targetStatus: "submitted",
          evidence: { externalReference: `manual-submit-${suffix}-${index}` },
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      const confirmed = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: {
          targetStatus: "confirmed",
          evidence: { receiptReference: `manual-receipt-${suffix}-${index}` },
        },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect(body(confirmed).data).toMatchObject({ status: "confirmed" });
    }
  });

  it("links a draft expense atomically and rejects stale payment confirmation", async () => {
    const expenseResponse = await app.inject({
      method: "POST",
      url: "/api/v1/financial-entries",
      headers: { cookie: ownerCookie },
      payload: {
        occurredAt: "2026-07-19T12:00",
        type: "expense",
        category: "stale_payment_test",
        description: "Original approved payment basis",
        amountCents: 42_000,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(expenseResponse.statusCode, expenseResponse.body).toBe(201);
    const expense = body(expenseResponse).data as JsonObject;
    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          financialEntryId: expense.id,
          amountCents: 42_000,
          beneficiary: "Stale payment supplier",
        },
        idempotencyKey: `stale-linked-payment-${suffix}`,
        reason: "The ledger snapshot must remain unchanged through confirmation",
      },
    });
    expect(actionResponse.statusCode, actionResponse.body).toBe(201);
    const action = body(actionResponse).data as JsonObject;
    const linked = await app.inject({
      method: "GET",
      url: `/api/v1/financial-entries/${String(expense.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(body(linked).data).toMatchObject({
      externalActionId: action.id,
      status: "draft",
      version: Number(expense.version) + 1,
    });
    const directRelink = await app.inject({
      method: "PATCH",
      url: `/api/v1/financial-entries/${String(expense.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        externalActionId: randomUUID(),
        expectedVersion: Number(expense.version) + 1,
      },
    });
    expect(directRelink.statusCode).toBe(409);

    const protectedFields = [
      { status: "posted" },
      { type: "income" },
      { amountCents: 42_001 },
      { currency: "USD" },
      { occurredAt: "2026-07-20T12:00:00+08:00" },
    ];
    for (const patch of protectedFields) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/financial-entries/${String(expense.id)}`,
        headers: { cookie: ownerCookie },
        payload: { ...patch, expectedVersion: Number(expense.version) + 1 },
      });
      expect(response.statusCode, `${JSON.stringify(patch)}: ${response.body}`).toBe(409);
    }

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Approve only the frozen expense version",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const mutated = await app.inject({
      method: "PATCH",
      url: `/api/v1/financial-entries/${String(expense.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        description: "Changed after approval and therefore requires reapproval",
        expectedVersion: Number(expense.version) + 1,
      },
    });
    expect(mutated.statusCode, mutated.body).toBe(200);
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "submitted",
        evidence: { externalReference: `stale-submit-${suffix}` },
        note: "Submitted before the stale snapshot was detected",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const staleConfirmation = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "confirmed",
        evidence: { receiptReference: `stale-receipt-${suffix}` },
        note: "Must fail closed",
      },
    });
    expect(staleConfirmation.statusCode).toBe(409);
    const unchanged = await app.inject({
      method: "GET",
      url: `/api/v1/financial-entries/${String(expense.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(body(unchanged).data).toMatchObject({
      status: "draft",
      externalActionId: action.id,
      version: Number(expense.version) + 2,
    });
    const failed = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "failed",
        note: "The submitted payment could not be reconciled with the edited ledger snapshot",
      },
    });
    expect(failed.statusCode, failed.body).toBe(200);
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "cancelled",
        note: "Release the stale payment request before reapplying it",
      },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const released = await app.inject({
      method: "GET",
      url: `/api/v1/financial-entries/${String(expense.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(body(released).data).toMatchObject({
      status: "draft",
      externalActionId: null,
      version: Number(expense.version) + 3,
    });
    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: {
          financialEntryId: expense.id,
          amountCents: 42_000,
          beneficiary: "Retried after stale payment cancellation",
        },
        idempotencyKey: `stale-linked-payment-retry-${suffix}`,
        reason: "Retry only after the stale request is failed and cancelled",
      },
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(body(retry).data).toMatchObject({
      kind: "bank_payment",
      status: "pending_approval",
      payload: expect.objectContaining({ financialEntryId: expense.id }),
    });
  }, 30_000);

  it("terminates an active contract only through the approved, evidenced action", async () => {
    const fileId = randomUUID();
    await dbHandle.db.insert(files).values({
      id: fileId,
      orgId,
      filename: `termination-contract-${suffix}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1,
      checksumSha256: "b".repeat(64),
      storageKey: `${orgId}/${fileId}`,
      uploadStatus: "uploaded",
      uploadedBy: ownerUserId,
    });
    const [contract] = await dbHandle.db
      .insert(contracts)
      .values({
        orgId,
        name: "Approved termination fixture",
        counterparty: "Termination Counterparty",
        contractNumber: `TERM-${suffix}`,
        status: "active",
        currency: "CNY",
        fileId,
      })
      .returning();
    if (!contract) throw new Error("Contract termination fixture was not created");

    const genericTermination = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${contract.id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "terminated", expectedVersion: contract.version },
    });
    expect(genericTermination.statusCode).toBe(409);
    expect(body(genericTermination).error).toMatchObject({ code: "APPROVAL_REQUIRED" });

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_terminate",
        adapter: "manual",
        payload: {
          contractId: contract.id,
          terminationBasis: "双方书面确认提前终止并完成权利义务清理",
          effectiveAt: "2026-07-31T18:00:00+08:00",
        },
        idempotencyKey: `contract-termination-${suffix}`,
        reason: "合同终止属于对外法律承诺，必须人工批准并保留外部凭证",
      },
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const action = body(createdResponse).data as JsonObject;
    expect(action.payload).toMatchObject({
      contractId: contract.id,
      targetExpectedVersion: contract.version,
    });

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "已复核终止依据、相对方确认和后续义务",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "submitted",
        evidence: { externalReference: `termination-notice-${suffix}` },
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const confirmed = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "confirmed",
        evidence: { receiptReference: `signed-termination-${suffix}` },
      },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(body(confirmed).data).toMatchObject({ status: "confirmed" });

    const [terminated] = await dbHandle.db
      .select({ status: contracts.status, version: contracts.version })
      .from(contracts)
      .where(eq(contracts.id, contract.id));
    expect(terminated).toEqual({ status: "terminated", version: contract.version + 1 });

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_terminate",
        adapter: "manual",
        payload: { contractId: contract.id, terminationBasis: "Cannot terminate twice" },
        idempotencyKey: `contract-termination-repeat-${suffix}`,
        reason: "Terminal contracts cannot re-enter the workflow",
      },
    });
    expect(repeated.statusCode).toBe(409);
  });

  it("keeps contract and invoice targets recoverable while controlled actions are unresolved", async () => {
    const fileId = randomUUID();
    await dbHandle.db.insert(files).values({
      id: fileId,
      orgId,
      filename: `controlled-target-${suffix}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1,
      checksumSha256: "d".repeat(64),
      storageKey: `${orgId}/${fileId}`,
      uploadStatus: "uploaded",
      uploadedBy: ownerUserId,
    });

    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: ownerCookie },
      payload: {
        name: `Controlled signature contract ${suffix}`,
        counterparty: "Controlled Contract Counterparty",
        status: "pending_signature",
        currency: "CNY",
        fileId,
      },
    });
    expect(contractResponse.statusCode, contractResponse.body).toBe(201);
    const signatureContract = body(contractResponse).data as JsonObject;
    const signActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_sign",
        adapter: "manual",
        payload: { contractId: signatureContract.id, fileId },
        idempotencyKey: `controlled-contract-sign-${suffix}`,
        reason: "Keep the signature target recoverable until the controlled action is resolved",
      },
    });
    expect(signActionResponse.statusCode, signActionResponse.body).toBe(201);
    const signAction = body(signActionResponse).data as JsonObject;

    const statusWhileSigning = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(signatureContract.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "review", expectedVersion: signatureContract.version },
    });
    expect(statusWhileSigning.statusCode, statusWhileSigning.body).toBe(409);
    const archiveWhileSigning = await app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${String(signatureContract.id)}?expectedVersion=${String(
        signatureContract.version,
      )}`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveWhileSigning.statusCode, archiveWhileSigning.body).toBe(409);
    for (const status of ["expired", "terminated"]) {
      const terminalBypass = await app.inject({
        method: "PATCH",
        url: `/api/v1/contracts/${String(signatureContract.id)}`,
        headers: { cookie: ownerCookie },
        payload: { status, expectedVersion: signatureContract.version },
      });
      expect(terminalBypass.statusCode, `${status}: ${terminalBypass.body}`).toBe(409);
    }
    const cancelSign = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(signAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Withdraw the signature request" },
    });
    expect(cancelSign.statusCode, cancelSign.body).toBe(200);
    const reviewAfterCancellation = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(signatureContract.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "review", expectedVersion: signatureContract.version },
    });
    expect(reviewAfterCancellation.statusCode, reviewAfterCancellation.body).toBe(200);

    const [futureActiveContract, elapsedActiveContract] = await dbHandle.db
      .insert(contracts)
      .values([
        {
          orgId,
          name: `Future active contract ${suffix}`,
          counterparty: "Future Counterparty",
          status: "active",
          endsAt: new Date("2099-12-31T16:00:00.000Z"),
          currency: "CNY",
          fileId,
        },
        {
          orgId,
          name: `Elapsed active contract ${suffix}`,
          counterparty: "Elapsed Counterparty",
          status: "active",
          endsAt: new Date("2020-01-01T00:00:00.000Z"),
          currency: "CNY",
          fileId,
        },
      ])
      .returning();
    if (!futureActiveContract || !elapsedActiveContract) {
      throw new Error("Failed to create active contract expiry fixtures");
    }
    const prematureExpiry = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${futureActiveContract.id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "expired", expectedVersion: futureActiveContract.version },
    });
    expect(prematureExpiry.statusCode, prematureExpiry.body).toBe(409);

    const terminationActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_terminate",
        adapter: "manual",
        payload: {
          contractId: elapsedActiveContract.id,
          terminationBasis: "Controlled action blocks competing expiry until cancellation",
        },
        idempotencyKey: `controlled-contract-terminate-${suffix}`,
        reason: "Do not race a natural expiry against a pending termination commitment",
      },
    });
    expect(terminationActionResponse.statusCode, terminationActionResponse.body).toBe(201);
    const terminationAction = body(terminationActionResponse).data as JsonObject;
    const expiryDuringTermination = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${elapsedActiveContract.id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "expired", expectedVersion: elapsedActiveContract.version },
    });
    expect(expiryDuringTermination.statusCode, expiryDuringTermination.body).toBe(409);
    const cancelTermination = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(terminationAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Use natural expiry instead" },
    });
    expect(cancelTermination.statusCode, cancelTermination.body).toBe(200);
    const expiryAfterCancellation = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${elapsedActiveContract.id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "expired", expectedVersion: elapsedActiveContract.version },
    });
    expect(expiryAfterCancellation.statusCode, expiryAfterCancellation.body).toBe(200);

    const invoiceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { cookie: ownerCookie },
      payload: {
        invoiceNumber: `INV-CONTROLLED-${suffix}`,
        direction: "incoming",
        counterparty: "Controlled Invoice Counterparty",
        amountCents: 8_800,
        taxAmountCents: 0,
        currency: "CNY",
        status: "received",
        fileId,
      },
    });
    expect(invoiceResponse.statusCode, invoiceResponse.body).toBe(201);
    const invoice = body(invoiceResponse).data as JsonObject;
    const redActionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "invoice_red",
        adapter: "manual",
        payload: { invoiceId: invoice.id, reason: "Controlled red-letter correction" },
        idempotencyKey: `controlled-invoice-red-${suffix}`,
        reason: "Keep the invoice state stable until the red-letter action is resolved",
      },
    });
    expect(redActionResponse.statusCode, redActionResponse.body).toBe(201);
    const redAction = body(redActionResponse).data as JsonObject;
    const voidWhileRedPending = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${String(invoice.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "void", expectedVersion: invoice.version },
    });
    expect(voidWhileRedPending.statusCode, voidWhileRedPending.body).toBe(409);
    const archiveIssuedInvoice = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${String(invoice.id)}?expectedVersion=${String(invoice.version)}`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveIssuedInvoice.statusCode, archiveIssuedInvoice.body).toBe(409);
    const cancelRed = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(redAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: { targetStatus: "cancelled", note: "Withdraw the red-letter request" },
    });
    expect(cancelRed.statusCode, cancelRed.body).toBe(200);
    const voidAfterCancellation = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${String(invoice.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "void", expectedVersion: invoice.version },
    });
    expect(voidAfterCancellation.statusCode, voidAfterCancellation.body).toBe(200);
    const archivedVoidInvoice = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${String(invoice.id)}?expectedVersion=${String(
        (body(voidAfterCancellation).data as JsonObject).version,
      )}`,
      headers: { cookie: ownerCookie },
    });
    expect(archivedVoidInvoice.statusCode, archivedVoidInvoice.body).toBe(409);

    const draftInvoiceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { cookie: ownerCookie },
      payload: {
        direction: "incoming",
        counterparty: "Draft Invoice Counterparty",
        amountCents: 100,
        taxAmountCents: 0,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(draftInvoiceResponse.statusCode, draftInvoiceResponse.body).toBe(201);
    const draftInvoice = body(draftInvoiceResponse).data as JsonObject;
    const archiveDraftInvoice = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${String(draftInvoice.id)}?expectedVersion=${String(
        draftInvoice.version,
      )}`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveDraftInvoice.statusCode, archiveDraftInvoice.body).toBe(200);
  }, 30_000);

  it("serializes contract archival against an uncommitted signature action", async () => {
    const fileId = randomUUID();
    await dbHandle.db.insert(files).values({
      id: fileId,
      orgId,
      filename: `contract-race-${suffix}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1,
      checksumSha256: "e".repeat(64),
      storageKey: `${orgId}/${fileId}`,
      uploadStatus: "uploaded",
      uploadedBy: ownerUserId,
    });
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: ownerCookie },
      payload: {
        name: `Signature/archive race ${suffix}`,
        counterparty: "Race Counterparty",
        status: "pending_signature",
        currency: "CNY",
        fileId,
      },
    });
    expect(contractResponse.statusCode, contractResponse.body).toBe(201);
    const contract = body(contractResponse).data as JsonObject;

    const barrierReady = deferred();
    const barrierRelease = deferred();
    const barrierDone = dbHandle.db
      .transaction(async (tx) => {
        const [locked] = await tx
          .select({ id: contracts.id })
          .from(contracts)
          .where(and(eq(contracts.id, String(contract.id)), eq(contracts.orgId, orgId)))
          .for("update");
        if (!locked) throw new Error("Contract race barrier target not found");
        barrierReady.resolve();
        await barrierRelease.promise;
      })
      .catch((error) => {
        barrierReady.reject(error);
        throw error;
      });
    await barrierReady.promise;

    const idempotencyKey = `contract-archive-race-${suffix}`;
    const approvalReason = `Serialize signature/archive race ${suffix}`;
    const archiveRequest = app.inject({
      method: "DELETE",
      url: `/api/v1/contracts/${String(contract.id)}?expectedVersion=${String(contract.version)}`,
      headers: { cookie: ownerCookie },
    });
    const actionRequest = app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_sign",
        adapter: "manual",
        payload: { contractId: contract.id, fileId },
        idempotencyKey,
        reason: approvalReason,
      },
    });

    let lockWaiters = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await dbHandle.db.execute(sql`
        SELECT COUNT(*)::integer AS total
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%contracts%'
      `);
      lockWaiters = Number(Array.from(result)[0]?.total ?? 0);
      if (lockWaiters >= 2) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    barrierRelease.resolve();
    await barrierDone;
    const [archiveResponse, actionResponse] = await Promise.all([archiveRequest, actionRequest]);
    expect(lockWaiters).toBeGreaterThanOrEqual(2);
    const successfulResponses = [archiveResponse, actionResponse].filter(
      (response) => response.statusCode >= 200 && response.statusCode < 300,
    );
    expect(successfulResponses).toHaveLength(1);

    const [storedContract] = await dbHandle.db
      .select()
      .from(contracts)
      .where(and(eq(contracts.id, String(contract.id)), eq(contracts.orgId, orgId)));
    const actionRows = await dbHandle.db
      .select()
      .from(externalActions)
      .where(
        and(eq(externalActions.orgId, orgId), eq(externalActions.idempotencyKey, idempotencyKey)),
      );
    const approvalRows = await dbHandle.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.reason, approvalReason)));
    if (archiveResponse.statusCode === 200) {
      expect(actionResponse.statusCode).toBeGreaterThanOrEqual(400);
      expect(storedContract?.archivedAt).not.toBeNull();
      expect(actionRows).toHaveLength(0);
      expect(approvalRows).toHaveLength(0);
    } else {
      expect(actionResponse.statusCode, actionResponse.body).toBe(201);
      expect(archiveResponse.statusCode).toBe(409);
      expect(storedContract?.archivedAt).toBeNull();
      expect(actionRows).toHaveLength(1);
      expect(actionRows[0]).toMatchObject({ status: "pending_approval" });
      expect(approvalRows).toHaveLength(1);
      expect(approvalRows[0]).toMatchObject({ status: "pending" });
    }
  }, 30_000);

  it("fails closed for unregistered adapters, reserved approvals, and stale external targets", async () => {
    const realAdapter = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "bank_payment",
        adapter: "real",
        payload: { amountCents: 500, beneficiary: "Imaginary real adapter" },
        idempotencyKey: `real-adapter-${suffix}`,
        reason: "No real adapter is registered",
      },
    });
    expect(realAdapter.statusCode).toBe(400);

    for (const resourceType of ["external-action", "membership-lifecycle", "role-assignment"]) {
      const forged = await app.inject({
        method: "POST",
        url: "/api/v1/approvals",
        headers: { cookie: ownerCookie },
        payload: {
          resourceType,
          resourceId: randomUUID(),
          operation: "forged-internal-operation",
          reason: "Generic approval creation must not impersonate an internal workflow",
          riskLevel: "critical",
        },
      });
      expect(forged.statusCode, `${resourceType}: ${forged.body}`).toBe(400);
    }

    const evidenceFileId = randomUUID();
    await dbHandle.db.insert(files).values({
      id: evidenceFileId,
      orgId,
      storageKey: `${orgId}/${evidenceFileId}`,
      filename: `stale-contract-${suffix}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1,
      checksumSha256: "0".repeat(64),
      classification: "confidential",
      uploadStatus: "uploaded",
      uploadedBy: ownerUserId,
    });
    const contractResponse = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: ownerCookie },
      payload: {
        name: `Stale target contract ${suffix}`,
        counterparty: "Gap contract counterparty",
        status: "pending_signature",
        fileId: evidenceFileId,
      },
    });
    expect(contractResponse.statusCode, contractResponse.body).toBe(201);
    const contract = body(contractResponse).data as JsonObject;
    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "contract_sign",
        adapter: "manual",
        payload: { contractId: contract.id, signingBasis: "Approved contract draft" },
        idempotencyKey: `stale-contract-${suffix}`,
        reason: "Confirmation must use the validated contract version",
      },
    });
    expect(actionResponse.statusCode, actionResponse.body).toBe(201);
    const action = body(actionResponse).data as JsonObject;
    expect(action.payload).toMatchObject({ targetExpectedVersion: contract.version });
    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
      headers: { cookie: ownerCookie },
      payload: {
        comment: "Approve the signature intent",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "submitted",
        evidence: { externalReference: `stale-contract-submit-${suffix}` },
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const changedContract = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(contract.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        counterparty: "Changed after approval",
        expectedVersion: contract.version,
      },
    });
    expect(changedContract.statusCode, changedContract.body).toBe(200);
    const staleConfirmation = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(action.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "confirmed",
        evidence: { receiptReference: `stale-contract-receipt-${suffix}` },
      },
    });
    expect(staleConfirmation.statusCode).toBe(409);
    const [unchangedAction] = await dbHandle.db
      .select({ status: externalActions.status })
      .from(externalActions)
      .where(eq(externalActions.id, String(action.id)));
    expect(unchangedAction?.status).toBe("submitted");

    const missingInvoice = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: ownerCookie },
      payload: {
        kind: "invoice_red",
        adapter: "manual",
        payload: { invoiceId: randomUUID(), reason: "Missing invoice must fail" },
        idempotencyKey: `missing-invoice-${suffix}`,
        reason: "Do not create approvals for nonexistent invoice targets",
      },
    });
    expect(missingInvoice.statusCode).toBe(404);
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
    expect(body(activeLogin).data).toMatchObject({ mustChangePassword: true });
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
    const memberCookie = await completeInitialPasswordChange(
      app,
      memberLogin,
      memberPassword,
      "audit-member-replacement-password-long-enough",
    );
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

    const createNotification = async (recipientId: string, title: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/notifications",
        headers: { cookie: ownerCookie },
        payload: { recipientId, title, body: `${title} private body`, channel: "in_app" },
      });
      expect(response.statusCode, response.body).toBe(201);
      return body(response).data as JsonObject;
    };
    const forgedDeliveredNotice = await app.inject({
      method: "POST",
      url: "/api/v1/notifications",
      headers: { cookie: ownerCookie },
      payload: {
        recipientId: ownerUserId,
        title: `Forged delivered ${suffix}`,
        body: "Creation must never bypass delivery state transitions",
        channel: "in_app",
        status: "sent",
      },
    });
    expect(forgedDeliveredNotice.statusCode).toBe(400);
    const ownerNotice = await createNotification(ownerUserId, `Owner-only ${suffix}`);
    const memberNotice = await createNotification(
      String((memberResult.user as JsonObject).id),
      `Member-only ${suffix}`,
    );
    const memberNotices = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?pageSize=100",
      headers: { cookie: memberCookie },
    });
    expect(memberNotices.statusCode, memberNotices.body).toBe(200);
    expect((body(memberNotices).data as JsonObject[]).map((item) => item.id)).toEqual([
      memberNotice.id,
    ]);
    expect(memberNotices.body).not.toContain(`Owner-only ${suffix}`);
    const crossRecipientRead = await app.inject({
      method: "GET",
      url: `/api/v1/notifications/${String(ownerNotice.id)}`,
      headers: { cookie: memberCookie },
    });
    expect(crossRecipientRead.statusCode).toBe(404);
    const crossRecipientMarkRead = await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${String(ownerNotice.id)}/read`,
      headers: { cookie: memberCookie },
      payload: { expectedVersion: ownerNotice.version },
    });
    expect(crossRecipientMarkRead.statusCode).toBe(404);
    const ownMarkRead = await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${String(memberNotice.id)}/read`,
      headers: { cookie: memberCookie },
      payload: { expectedVersion: memberNotice.version },
    });
    expect(ownMarkRead.statusCode, ownMarkRead.body).toBe(200);
    expect(body(ownMarkRead).data).toMatchObject({ status: "read" });
    const memberCannotRewrite = await app.inject({
      method: "PATCH",
      url: `/api/v1/notifications/${String(memberNotice.id)}`,
      headers: { cookie: memberCookie },
      payload: { title: "Rewritten", expectedVersion: Number(memberNotice.version) + 1 },
    });
    expect(memberCannotRewrite.statusCode).toBe(403);
    const ownerCannotRewrite = await app.inject({
      method: "PATCH",
      url: `/api/v1/notifications/${String(ownerNotice.id)}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Rewritten", expectedVersion: ownerNotice.version },
    });
    expect(ownerCannotRewrite.statusCode).toBe(409);

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
      (event) =>
        event.actorUserId === String((memberResult.user as JsonObject).id) &&
        event.resourceId === "/api/v1/users" &&
        (event.metadata as JsonObject).method === "POST",
    );
    expect(forbiddenAudit).toMatchObject({
      resourceType: "request",
      before: null,
      after: null,
      metadata: { method: "POST", code: "FORBIDDEN", status: 403 },
    });
    expect(forbiddenAudit?.metadata).not.toHaveProperty("body");
  });

  it("returns active advisor prompt data scopes and keeps legal scope policy-bound", async () => {
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
    expect(promptVersion.dataScopes as unknown[]).toContain("compliance-events");

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
    const privateCashFlow = await app.inject({
      method: "POST",
      url: "/api/v1/cash-flow",
      headers: { cookie: ownerCookie },
      payload: {
        occurredAt: "2026-07-18T12:00:00+08:00",
        direction: "in",
        category: "viewer-isolation-test",
        amountCents: 987_654,
        currency: "CNY",
        description: "This aggregate must not be visible without cash-flow:read",
        status: "actual",
      },
    });
    expect(privateCashFlow.statusCode, privateCashFlow.body).toBe(201);
    const viewerLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: viewerEmail, password: viewerPassword },
    });
    expect(viewerLogin.statusCode).toBe(200);
    const viewerCookie = await completeInitialPasswordChange(
      app,
      viewerLogin,
      viewerPassword,
      "scope-viewer-replacement-password-long-enough",
    );
    const viewerAdvisors = await app.inject({
      method: "GET",
      url: "/api/v1/advisors",
      headers: { cookie: viewerCookie },
    });
    expect(viewerAdvisors.statusCode).toBe(200);
    const security = (body(viewerAdvisors).data as JsonObject[]).find(
      (advisor) => advisor.key === "information_security",
    );
    expect(security?.dataScopes as unknown[]).not.toContain("audit-events");
    expect(
      ((security?.promptVersion as JsonObject | null)?.dataScopes as unknown[]) ?? [],
    ).toContain("audit-events");

    const viewerDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: viewerCookie },
    });
    expect(viewerDashboard.statusCode, viewerDashboard.body).toBe(200);
    const dashboardData = body(viewerDashboard).data as JsonObject;
    expect(dashboardData.cashFlow).toBeNull();
    expect((dashboardData.summary as JsonObject).pendingApprovals).toBeNull();
    expect((dashboardData.summary as JsonObject).activeObjectives).toEqual(expect.any(Number));
    expect(viewerDashboard.body).not.toContain("987654");
  });
});
