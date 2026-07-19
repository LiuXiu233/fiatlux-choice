import { createHash, randomUUID } from "node:crypto";
import {
  approvals,
  auditEvents,
  cashFlowEntries,
  complianceEvents,
  complianceItems,
  contracts,
  createDatabase,
  decisions,
  externalActions,
  files,
  financialEntries,
  invoices,
  lockReferenceChain,
  objectives,
  obligations,
  opportunities,
  products,
  projects,
  tasks,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import {
  type JobQueue,
  MemoryObjectStorage,
  type ObjectStorage,
  S3ObjectStorage,
} from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";
const s3Endpoint = process.env.TEST_S3_ENDPOINT;

type JsonObject = Record<string, unknown>;

function body(response: { body: string }) {
  return JSON.parse(response.body) as JsonObject;
}

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  if (!first) throw new Error("Login did not set a cookie");
  const [cookieValue] = first.split(";", 1);
  if (!cookieValue) throw new Error("Login cookie is empty");
  return cookieValue;
}

function testStorage(): ObjectStorage {
  if (!s3Endpoint) return new MemoryObjectStorage();
  const accessKeyId = process.env.TEST_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.TEST_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("TEST_S3 credentials are required when TEST_S3_ENDPOINT is configured");
  }
  return new S3ObjectStorage({
    endpoint: s3Endpoint,
    region: process.env.TEST_S3_REGION ?? "us-east-1",
    bucket: process.env.TEST_S3_BUCKET ?? "fiatlux-choice",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  });
}

describe.skipIf(!databaseUrl)("API PostgreSQL repeatable core business chain", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let ownerCookie: string;
  let otherOwnerCookie: string;
  let orgId: string;
  let otherOrgId: string;
  let ownerUserId: string;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const primary = await seedDatabase(dbHandle.db, {
      organizationName: "Core Business Chain Company",
      organizationSlug: `core-chain-${suffix}`,
      adminEmail: `core-chain-${suffix}@example.test`,
      adminDisplayName: "Core Chain Owner",
      adminPassword: "correct-horse-battery-staple-core",
      adminMustChangePassword: false,
    });
    const secondary = await seedDatabase(dbHandle.db, {
      organizationName: "Core Business Other Company",
      organizationSlug: `core-chain-other-${suffix}`,
      adminEmail: `core-chain-other-${suffix}@example.test`,
      adminDisplayName: "Core Chain Other Owner",
      adminPassword: "correct-horse-battery-staple-other",
      adminMustChangePassword: false,
    });
    orgId = primary.organization.id;
    otherOrgId = secondary.organization.id;
    ownerUserId = primary.user.id;

    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
      GITHUB_INTEGRATION_MODE: "manual",
    });
    const queue = {
      send: async () => randomUUID(),
    } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: testStorage(),
      queue,
    });

    const primaryLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `core-chain-${suffix}@example.test`,
        password: "correct-horse-battery-staple-core",
      },
    });
    const secondaryLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `core-chain-other-${suffix}@example.test`,
        password: "correct-horse-battery-staple-other",
      },
    });
    expect(primaryLogin.statusCode).toBe(200);
    expect(secondaryLogin.statusCode).toBe(200);
    ownerCookie = cookie(primaryLogin);
    otherOwnerCookie = cookie(secondaryLogin);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("persists the core operating chains, preserves approval truth, audit append-only behavior, and tenant isolation", async () => {
    const createResource = async (resource: string, payload: JsonObject) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${resource}`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(response.statusCode, `${resource}: ${response.body}`).toBe(201);
      return body(response).data as JsonObject;
    };
    const readResource = async (resource: string, id: unknown) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/${resource}/${String(id)}`,
        headers: { cookie: ownerCookie },
      });
      expect(response.statusCode, `${resource}/${String(id)}: ${response.body}`).toBe(200);
      return body(response).data as JsonObject;
    };
    const approveManualAction = async (action: JsonObject, comment: string) => {
      expect(action).toMatchObject({
        adapter: "manual",
        status: "pending_approval",
      });
      expect(action.approvalId).toEqual(expect.any(String));

      const prematureSubmission = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: {
          targetStatus: "submitted",
          evidence: { externalReference: `not-executed-${suffix}` },
          note: "This must be rejected before human approval",
        },
      });
      expect(prematureSubmission.statusCode, prematureSubmission.body).toBe(409);

      const approvalResponse = await app.inject({
        method: "POST",
        url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
        headers: { cookie: ownerCookie },
        payload: {
          comment,
          acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
        },
      });
      expect(approvalResponse.statusCode, approvalResponse.body).toBe(200);
      expect(body(approvalResponse).data).toMatchObject({ status: "approved" });

      const approvedAction = await readResource("external-actions", action.id);
      expect(approvedAction).toMatchObject({
        adapter: "manual",
        status: "approved",
        evidence: null,
        submittedAt: null,
        confirmedAt: null,
      });
      return approvedAction;
    };

    // Goal -> project -> task is backed by organization-scoped foreign-key validation.
    const objective = await createResource("objectives", {
      title: `Launch esports education operations ${suffix}`,
      description: "Build a sustainable online esports education line.",
      status: "active",
      progress: 10,
      ownerId: ownerUserId,
      startsAt: "2026-07-20T09:00",
      dueAt: "2027-06-30T18:00",
    });
    const deliveryProject = await createResource("projects", {
      objectiveId: objective.id,
      name: `Education MVP delivery ${suffix}`,
      description: "Deliver the first curriculum and operating workflow.",
      status: "active",
      ownerId: ownerUserId,
      startsAt: "2026-07-21T09:00",
      dueAt: "2026-12-31T18:00",
    });
    const deliveryTask = await createResource("tasks", {
      projectId: deliveryProject.id,
      title: `Validate curriculum with learners ${suffix}`,
      description: "Run interviews and document evidence.",
      status: "in_progress",
      priority: "high",
      assigneeId: ownerUserId,
      dueAt: "2026-08-31T18:00",
    });

    const proposedDecision = await createResource("decisions", {
      objectiveId: objective.id,
      projectId: deliveryProject.id,
      taskId: deliveryTask.id,
      title: `Pilot cohort go/no-go ${suffix}`,
      context: "Review the learner-validation evidence before committing to a pilot cohort.",
      status: "proposed",
    });
    const decisionResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/decisions/${String(proposedDecision.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        status: "approved",
        decision: "Proceed with a capped pilot cohort after the documented validation step.",
        decidedAt: "2026-07-18T18:30",
        expectedVersion: proposedDecision.version,
      },
    });
    expect(decisionResponse.statusCode, decisionResponse.body).toBe(200);
    const approvedDecision = body(decisionResponse).data as JsonObject;
    expect(approvedDecision).toMatchObject({ status: "approved", version: 2 });

    const officialCompanyLawUrl =
      "https://flk.npc.gov.cn/detail?bbbs=ff8081818c9108eb018cb6922f750c07";
    const [officialSource] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.orgId, orgId),
          eq(complianceItems.sourceUrl, officialCompanyLawUrl),
          eq(complianceItems.reviewStatus, "pending"),
          eq(complianceItems.status, "draft"),
        ),
      )
      .limit(1);
    if (!officialSource) throw new Error("Expected a seeded pending official compliance source");
    expect(new URL(officialSource.sourceUrl).protocol).toBe("https:");
    expect(new URL(officialSource.sourceUrl).hostname).toMatch(/(?:gov\.cn|npc\.gov\.cn)$/);

    const sourceResponse = await readResource("compliance-items", officialSource.id);
    expect(sourceResponse).toMatchObject({
      id: officialSource.id,
      reviewStatus: "pending",
      status: "draft",
    });
    const prohibitedSourceActivation = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-items/${officialSource.id}`,
      headers: { cookie: ownerCookie },
      payload: { status: "active", expectedVersion: officialSource.version },
    });
    expect(prohibitedSourceActivation.statusCode, prohibitedSourceActivation.body).toBe(409);
    expect(body(prohibitedSourceActivation).error).toMatchObject({
      code: "PROFESSIONAL_REVIEW_REQUIRED",
    });

    const obligation = await createResource("obligations", {
      title: `Review annual-report applicability ${suffix}`,
      description: "Confirm the filing window and company-specific prerequisites manually.",
      category: "corporate",
      status: "open",
      ownerId: ownerUserId,
      dueAt: "2026-12-15T18:00",
      recurrenceRule: "FREQ=YEARLY",
      sourceId: officialSource.id,
    });
    const complianceEvent = await createResource("compliance-events", {
      title: `Annual-report requirement review ${suffix}`,
      category: "corporate",
      dueDate: "2026-12-15",
      status: "pending",
      reviewStatus: "pending",
      description: "A review date, not an automated filing or a fixed legal conclusion.",
      eventType: "review",
      sourceId: officialSource.id,
      ownerId: ownerUserId,
    });

    const contractBytes = Buffer.from(
      `FIAT LUX CHOICE unsigned education service contract draft ${suffix}`,
    );
    const fileMetadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: ownerCookie },
      payload: {
        filename: `unsigned-education-contract-${suffix}.txt`,
        contentType: "text/plain",
        sizeBytes: contractBytes.byteLength,
        checksumSha256: createHash("sha256").update(contractBytes).digest("hex"),
        classification: "confidential",
      },
    });
    expect(fileMetadataResponse.statusCode, fileMetadataResponse.body).toBe(201);
    const fileTicket = body(fileMetadataResponse).data as {
      file: JsonObject;
      upload: JsonObject;
    };
    const fileId = String(fileTicket.file.id);
    const pendingEvidenceReference = await app.inject({
      method: "POST",
      url: "/api/v1/obligations",
      headers: { cookie: ownerCookie },
      payload: {
        title: `Must reject pending evidence ${suffix}`,
        category: "archive",
        evidenceFileId: fileId,
      },
    });
    expect(pendingEvidenceReference.statusCode, pendingEvidenceReference.body).toBe(400);
    const uploadResponse = await app.inject({
      method: "PUT",
      url: String(fileTicket.upload.uploadUrl),
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "content-length": String(contractBytes.byteLength),
      },
      payload: contractBytes,
    });
    expect(uploadResponse.statusCode, uploadResponse.body).toBe(201);
    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: { cookie: ownerCookie },
    });
    expect(completeResponse.statusCode, completeResponse.body).toBe(200);
    expect(body(completeResponse).data).toMatchObject({ uploadStatus: "uploaded" });
    const obligationEvidenceResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/obligations/${String(obligation.id)}`,
      headers: { cookie: ownerCookie },
      payload: { evidenceFileId: fileId, expectedVersion: obligation.version },
    });
    expect(obligationEvidenceResponse.statusCode, obligationEvidenceResponse.body).toBe(200);
    const complianceEventEvidenceResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-events/${String(complianceEvent.id)}`,
      headers: { cookie: ownerCookie },
      payload: { evidenceFileId: fileId, expectedVersion: complianceEvent.version },
    });
    expect(complianceEventEvidenceResponse.statusCode, complianceEventEvidenceResponse.body).toBe(
      200,
    );
    const downloadResponse = await app.inject({
      method: "GET",
      url: `/api/v1/files/${fileId}/download`,
      headers: { cookie: ownerCookie },
    });
    expect(downloadResponse.statusCode, downloadResponse.body).toBe(200);
    expect(downloadResponse.rawPayload).toEqual(contractBytes);

    const contract = await createResource("contracts", {
      name: `Pilot education service agreement ${suffix}`,
      counterparty: "Integration Test School",
      contractNumber: `FL-${suffix}`,
      status: "pending_signature",
      startsAt: "2026-09-01T00:00",
      endsAt: "2027-08-31T23:59",
      valueCents: 128_000,
      currency: "CNY",
      fileId,
      ownerId: ownerUserId,
    });
    const directContractActivation = await app.inject({
      method: "PATCH",
      url: `/api/v1/contracts/${String(contract.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "active", expectedVersion: contract.version },
    });
    expect(directContractActivation.statusCode, directContractActivation.body).toBe(409);

    const contractSignAction = await createResource("external-actions", {
      kind: "contract_sign",
      adapter: "manual",
      payload: { contractId: contract.id, fileId },
      idempotencyKey: `contract-sign-${suffix}`,
      reason: "Formal signature requires explicit human approval and later external evidence.",
    });
    const approvedContractSignAction = await approveManualAction(
      contractSignAction,
      "Approve the intent to sign; this is not proof of external signature.",
    );
    const shortcutContractConfirmation = await app.inject({
      method: "POST",
      url: `/api/v1/external-actions/${String(contractSignAction.id)}/transition`,
      headers: { cookie: ownerCookie },
      payload: {
        targetStatus: "confirmed",
        evidence: { receiptReference: "must-not-be-accepted-without-submission" },
      },
    });
    expect(shortcutContractConfirmation.statusCode, shortcutContractConfirmation.body).toBe(409);
    expect(await readResource("contracts", contract.id)).toMatchObject({
      status: "pending_signature",
      fileId,
    });

    const incomeEntry = await createResource("financial-entries", {
      occurredAt: "2026-07-18T10:00",
      type: "income",
      category: "education_service",
      description: "Pilot deposit recorded from verified internal evidence.",
      amountCents: 20_000,
      currency: "CNY",
      status: "posted",
    });
    const expenseEntry = await createResource("financial-entries", {
      occurredAt: "2026-07-18T11:00",
      type: "expense",
      category: "curriculum_production",
      description: "Supplier payment request; it remains a draft until paid and reconciled.",
      amountCents: 8_800,
      currency: "CNY",
      status: "draft",
    });
    const bankPaymentAction = await createResource("external-actions", {
      kind: "bank_payment",
      adapter: "manual",
      payload: {
        financialEntryId: expenseEntry.id,
        amountCents: 8_800,
        beneficiary: "Integration Curriculum Supplier",
      },
      idempotencyKey: `bank-payment-${suffix}`,
      reason: "Bank payment requires human approval and separately captured bank evidence.",
    });
    expect(await readResource("financial-entries", expenseEntry.id)).toMatchObject({
      externalActionId: bankPaymentAction.id,
      status: "draft",
      version: Number(expenseEntry.version) + 1,
    });
    const approvedBankPaymentAction = await approveManualAction(
      bankPaymentAction,
      "Approve payment intent only; bank execution is still manual and unconfirmed.",
    );
    expect(await readResource("financial-entries", expenseEntry.id)).toMatchObject({
      status: "draft",
      externalActionId: bankPaymentAction.id,
    });

    const invoice = await createResource("invoices", {
      invoiceNumber: `TEST-${suffix}`,
      direction: "outgoing",
      counterparty: "Integration Test School",
      amountCents: 20_000,
      taxAmountCents: 1_132,
      currency: "CNY",
      status: "issued",
      issuedAt: "2026-07-18T12:00",
      dueAt: "2026-08-18T18:00",
      fileId,
    });
    const directRedInvoice = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${String(invoice.id)}`,
      headers: { cookie: ownerCookie },
      payload: { status: "red_pending", expectedVersion: invoice.version },
    });
    expect(directRedInvoice.statusCode, directRedInvoice.body).toBe(409);

    const invoiceRedAction = await createResource("external-actions", {
      kind: "invoice_red",
      adapter: "manual",
      payload: { invoiceId: invoice.id, reasonCode: "integration-correction" },
      idempotencyKey: `invoice-red-${suffix}`,
      reason: "A red-letter invoice requires human approval and tax-platform evidence.",
    });
    const approvedInvoiceRedAction = await approveManualAction(
      invoiceRedAction,
      "Approve the red-letter request intent; no tax-platform operation has occurred.",
    );
    expect(await readResource("invoices", invoice.id)).toMatchObject({ status: "issued" });

    const cashFlow = await createResource("cash-flow", {
      occurredAt: "2026-08-01T09:00",
      direction: "out",
      category: "curriculum_production",
      amountCents: 8_800,
      currency: "CNY",
      description: `Forecast corresponding to payment request ${String(bankPaymentAction.id)}.`,
      status: "forecast",
    });

    const marketProject = await createResource("projects", {
      objectiveId: objective.id,
      name: `School pilot conversion ${suffix}`,
      description: "Convert the qualified school opportunity into a controlled education pilot.",
      status: "planned",
      ownerId: ownerUserId,
      startsAt: "2026-08-01T09:00",
      dueAt: "2026-10-31T18:00",
    });
    const product = await createResource("products", {
      projectId: marketProject.id,
      name: `FIAT LUX Esports Education ${suffix}`,
      description: "An online course and coaching product for esports learners.",
      category: "online_education",
      stage: "validation",
      status: "on_track",
      ownerId: ownerUserId,
    });
    const opportunity = await createResource("opportunities", {
      productId: product.id,
      projectId: marketProject.id,
      title: `School pilot opportunity ${suffix}`,
      source: "company-website",
      organization: "Integration Test School",
      contact: "Manual follow-up required",
      status: "qualified",
      valueCents: 128_000,
      currency: "CNY",
      nextActionAt: "2026-07-30T10:00",
      ownerId: ownerUserId,
    });

    const [storedObjective, storedProject, storedTask, storedDecision] = await Promise.all([
      dbHandle.db
        .select()
        .from(objectives)
        .where(eq(objectives.id, String(objective.id)))
        .limit(1),
      dbHandle.db
        .select()
        .from(projects)
        .where(eq(projects.id, String(deliveryProject.id)))
        .limit(1),
      dbHandle.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, String(deliveryTask.id)))
        .limit(1),
      dbHandle.db
        .select()
        .from(decisions)
        .where(eq(decisions.id, String(approvedDecision.id)))
        .limit(1),
    ]);
    expect(storedObjective[0]).toMatchObject({ orgId, ownerId: ownerUserId });
    expect(storedProject[0]).toMatchObject({ orgId, objectiveId: objective.id });
    expect(storedTask[0]).toMatchObject({ orgId, projectId: deliveryProject.id });
    expect(storedDecision[0]).toMatchObject({
      orgId,
      objectiveId: objective.id,
      projectId: deliveryProject.id,
      taskId: deliveryTask.id,
    });

    const [storedObligation, storedComplianceEvent, sourceAfterRejectedActivation] =
      await Promise.all([
        dbHandle.db
          .select()
          .from(obligations)
          .where(eq(obligations.id, String(obligation.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(complianceEvents)
          .where(eq(complianceEvents.id, String(complianceEvent.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(complianceItems)
          .where(eq(complianceItems.id, officialSource.id))
          .limit(1),
      ]);
    expect(storedObligation[0]).toMatchObject({
      orgId,
      sourceId: officialSource.id,
      evidenceFileId: fileId,
    });
    expect(storedComplianceEvent[0]).toMatchObject({
      orgId,
      sourceId: officialSource.id,
      evidenceFileId: fileId,
      reviewStatus: "pending",
    });
    expect(sourceAfterRejectedActivation[0]).toMatchObject({
      reviewStatus: "pending",
      status: "draft",
      version: officialSource.version,
    });

    const [storedFile, storedContract, storedIncome, storedExpense, storedInvoice, storedCashFlow] =
      await Promise.all([
        dbHandle.db.select().from(files).where(eq(files.id, fileId)).limit(1),
        dbHandle.db
          .select()
          .from(contracts)
          .where(eq(contracts.id, String(contract.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(financialEntries)
          .where(eq(financialEntries.id, String(incomeEntry.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(financialEntries)
          .where(eq(financialEntries.id, String(expenseEntry.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(invoices)
          .where(eq(invoices.id, String(invoice.id)))
          .limit(1),
        dbHandle.db
          .select()
          .from(cashFlowEntries)
          .where(eq(cashFlowEntries.id, String(cashFlow.id)))
          .limit(1),
      ]);
    expect(storedFile[0]).toMatchObject({ orgId, uploadStatus: "uploaded" });
    expect(storedContract[0]).toMatchObject({ orgId, fileId, status: "pending_signature" });
    expect(storedIncome[0]).toMatchObject({ orgId, type: "income", status: "posted" });
    expect(storedExpense[0]).toMatchObject({
      orgId,
      externalActionId: bankPaymentAction.id,
      status: "draft",
    });
    expect(storedInvoice[0]).toMatchObject({ orgId, fileId, status: "issued" });
    expect(storedCashFlow[0]).toMatchObject({ orgId, status: "forecast" });

    const approvedActionIds = [
      String(approvedContractSignAction.id),
      String(approvedBankPaymentAction.id),
      String(approvedInvoiceRedAction.id),
    ];
    for (const actionId of approvedActionIds) {
      const [storedAction] = await dbHandle.db
        .select()
        .from(externalActions)
        .where(eq(externalActions.id, actionId))
        .limit(1);
      expect(storedAction).toMatchObject({
        orgId,
        adapter: "manual",
        status: "approved",
        evidence: null,
        submittedAt: null,
        confirmedAt: null,
      });
    }

    const submitAndConfirmManualAction = async (action: JsonObject, label: string) => {
      const submission = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: {
          targetStatus: "submitted",
          evidence: { externalReference: `manual-submission-${label}-${suffix}` },
          note: "An operator recorded the external submission reference after approval.",
        },
      });
      expect(submission.statusCode, submission.body).toBe(200);
      expect(body(submission).data).toMatchObject({
        status: "submitted",
        evidence: { externalReference: `manual-submission-${label}-${suffix}` },
      });

      const confirmationWithoutReceipt = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: { targetStatus: "confirmed", evidence: { note: "not a receipt" } },
      });
      expect(confirmationWithoutReceipt.statusCode, confirmationWithoutReceipt.body).toBe(400);

      const confirmation = await app.inject({
        method: "POST",
        url: `/api/v1/external-actions/${String(action.id)}/transition`,
        headers: { cookie: ownerCookie },
        payload: {
          targetStatus: "confirmed",
          evidence: { receiptReference: `manual-receipt-${label}-${suffix}` },
          note: "The operator verified and recorded external receipt evidence.",
        },
      });
      expect(confirmation.statusCode, confirmation.body).toBe(200);
      expect(body(confirmation).data).toMatchObject({
        status: "confirmed",
        evidence: {
          externalReference: `manual-submission-${label}-${suffix}`,
          receiptReference: `manual-receipt-${label}-${suffix}`,
        },
      });
      return body(confirmation).data as JsonObject;
    };

    const confirmedContractSignAction = await submitAndConfirmManualAction(
      approvedContractSignAction,
      "contract-sign",
    );
    const confirmedInvoiceRedAction = await submitAndConfirmManualAction(
      approvedInvoiceRedAction,
      "invoice-red",
    );
    const confirmedBankPaymentAction = await submitAndConfirmManualAction(
      approvedBankPaymentAction,
      "bank-payment",
    );
    expect(confirmedContractSignAction).toMatchObject({
      submittedAt: expect.any(String),
      confirmedAt: expect.any(String),
    });
    expect(confirmedInvoiceRedAction).toMatchObject({
      submittedAt: expect.any(String),
      confirmedAt: expect.any(String),
    });
    expect(confirmedBankPaymentAction).toMatchObject({
      submittedAt: expect.any(String),
      confirmedAt: expect.any(String),
    });
    expect(await readResource("contracts", contract.id)).toMatchObject({ status: "active" });
    expect(await readResource("invoices", invoice.id)).toMatchObject({ status: "red_confirmed" });
    expect(await readResource("financial-entries", expenseEntry.id)).toMatchObject({
      status: "posted",
      externalActionId: bankPaymentAction.id,
    });
    const activeContractRecord = await readResource("contracts", contract.id);
    const redInvoiceRecord = await readResource("invoices", invoice.id);
    const postedIncomeRecord = await readResource("financial-entries", incomeEntry.id);
    for (const attempt of [
      {
        resource: "contracts",
        id: contract.id,
        payload: {
          counterparty: "Rewritten after signature",
          expectedVersion: activeContractRecord.version,
        },
      },
      {
        resource: "contracts",
        id: contract.id,
        payload: {
          status: "pending_signature",
          expectedVersion: activeContractRecord.version,
        },
      },
      {
        resource: "invoices",
        id: invoice.id,
        payload: { status: "paid", expectedVersion: redInvoiceRecord.version },
      },
      {
        resource: "financial-entries",
        id: incomeEntry.id,
        payload: { amountCents: 1, expectedVersion: postedIncomeRecord.version },
      },
    ]) {
      const immutable = await app.inject({
        method: "PATCH",
        url: `/api/v1/${attempt.resource}/${String(attempt.id)}`,
        headers: { cookie: ownerCookie },
        payload: attempt.payload,
      });
      expect(immutable.statusCode, `${attempt.resource}: ${immutable.body}`).toBe(409);
    }
    const archiveReferencedEvidence = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${fileId}?expectedVersion=3`,
      headers: { cookie: ownerCookie },
    });
    expect(archiveReferencedEvidence.statusCode, archiveReferencedEvidence.body).toBe(409);
    expect(await readResource("external-actions", approvedBankPaymentAction.id)).toMatchObject({
      status: "confirmed",
      evidence: {
        externalReference: `manual-submission-bank-payment-${suffix}`,
        receiptReference: `manual-receipt-bank-payment-${suffix}`,
      },
      submittedAt: expect.any(String),
      confirmedAt: expect.any(String),
    });

    const [storedProduct, storedOpportunity, storedMarketProject] = await Promise.all([
      dbHandle.db
        .select()
        .from(products)
        .where(eq(products.id, String(product.id)))
        .limit(1),
      dbHandle.db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, String(opportunity.id)))
        .limit(1),
      dbHandle.db
        .select()
        .from(projects)
        .where(eq(projects.id, String(marketProject.id)))
        .limit(1),
    ]);
    expect(storedProduct[0]).toMatchObject({
      orgId,
      projectId: marketProject.id,
      category: "online_education",
    });
    expect(storedOpportunity[0]).toMatchObject({
      orgId,
      productId: product.id,
      projectId: marketProject.id,
    });
    expect(storedMarketProject[0]).toMatchObject({ orgId, objectiveId: objective.id });

    const crossOrganizationRecords: Array<[string, string]> = [
      ["objectives", String(objective.id)],
      ["projects", String(deliveryProject.id)],
      ["tasks", String(deliveryTask.id)],
      ["decisions", String(approvedDecision.id)],
      ["compliance-items", officialSource.id],
      ["obligations", String(obligation.id)],
      ["compliance-events", String(complianceEvent.id)],
      ["files", fileId],
      ["contracts", String(contract.id)],
      ["financial-entries", String(expenseEntry.id)],
      ["invoices", String(invoice.id)],
      ["cash-flow", String(cashFlow.id)],
      ["products", String(product.id)],
      ["opportunities", String(opportunity.id)],
      ["external-actions", String(bankPaymentAction.id)],
      ["approvals", String(bankPaymentAction.approvalId)],
    ];
    for (const [resource, id] of crossOrganizationRecords) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/${resource}/${id}`,
        headers: { cookie: otherOwnerCookie },
      });
      expect(response.statusCode, `cross-org ${resource}/${id}: ${response.body}`).toBe(404);
    }

    const crossOrganizationProject = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: otherOwnerCookie },
      payload: { name: "Must reject cross-organization objective", objectiveId: objective.id },
    });
    expect(crossOrganizationProject.statusCode, crossOrganizationProject.body).toBe(400);
    const crossOrganizationReferenceCases = [
      {
        resource: "decisions",
        payload: {
          title: "Invalid objective decision",
          context: "test",
          objectiveId: objective.id,
        },
      },
      {
        resource: "decisions",
        payload: {
          title: "Invalid project decision",
          context: "test",
          projectId: deliveryProject.id,
        },
      },
      {
        resource: "decisions",
        payload: { title: "Invalid task decision", context: "test", taskId: deliveryTask.id },
      },
      {
        resource: "products",
        payload: { name: "Invalid project product", projectId: marketProject.id },
      },
      {
        resource: "opportunities",
        payload: { title: "Invalid product opportunity", productId: product.id },
      },
      {
        resource: "opportunities",
        payload: { title: "Invalid project opportunity", projectId: marketProject.id },
      },
      {
        resource: "obligations",
        payload: {
          title: "Invalid source obligation",
          category: "archive",
          sourceId: officialSource.id,
        },
      },
      {
        resource: "obligations",
        payload: {
          title: "Invalid evidence obligation",
          category: "archive",
          evidenceFileId: fileId,
        },
      },
      {
        resource: "compliance-events",
        payload: {
          title: "Invalid evidence event",
          category: "archive",
          dueDate: "2027-01-01",
          evidenceFileId: fileId,
        },
      },
    ];
    for (const testCase of crossOrganizationReferenceCases) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${testCase.resource}`,
        headers: { cookie: otherOwnerCookie },
        payload: testCase.payload,
      });
      expect(response.statusCode, `${testCase.resource}: ${response.body}`).toBe(400);
      expect(response.body).toContain("does not belong to the active organization");
    }

    const missingReferenceId = randomUUID();
    const missingReferenceCases = [
      {
        resource: "decisions",
        payload: {
          title: "Missing objective decision",
          context: "test",
          objectiveId: missingReferenceId,
        },
      },
      {
        resource: "decisions",
        payload: {
          title: "Missing project decision",
          context: "test",
          projectId: missingReferenceId,
        },
      },
      {
        resource: "decisions",
        payload: { title: "Missing task decision", context: "test", taskId: missingReferenceId },
      },
      {
        resource: "products",
        payload: { name: "Missing project product", projectId: missingReferenceId },
      },
      {
        resource: "opportunities",
        payload: { title: "Missing product opportunity", productId: missingReferenceId },
      },
      {
        resource: "opportunities",
        payload: { title: "Missing project opportunity", projectId: missingReferenceId },
      },
      {
        resource: "obligations",
        payload: {
          title: "Missing evidence obligation",
          category: "archive",
          evidenceFileId: missingReferenceId,
        },
      },
      {
        resource: "compliance-events",
        payload: {
          title: "Missing evidence event",
          category: "archive",
          dueDate: "2027-01-01",
          evidenceFileId: missingReferenceId,
        },
      },
    ];
    for (const testCase of missingReferenceCases) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${testCase.resource}`,
        headers: { cookie: ownerCookie },
        payload: testCase.payload,
      });
      expect(response.statusCode, `${testCase.resource}: ${response.body}`).toBe(400);
      expect(response.body).toContain("does not belong to the active organization");
    }
    const crossOrganizationContract = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: otherOwnerCookie },
      payload: {
        name: "Must reject cross-organization file",
        counterparty: "Invalid",
        status: "draft",
        currency: "CNY",
        fileId,
      },
    });
    expect(crossOrganizationContract.statusCode, crossOrganizationContract.body).toBe(400);

    expect(otherOrgId).not.toBe(orgId);
    const primaryAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.orgId, orgId));
    const expectAudit = (resourceType: string, resourceId: string, action: string) => {
      const event = primaryAudits.find(
        (candidate) =>
          candidate.resourceType === resourceType &&
          candidate.resourceId === resourceId &&
          candidate.action === action,
      );
      expect(event, `missing audit ${resourceType}:${resourceId}:${action}`).toBeDefined();
      expect(event?.actorUserId).toBe(ownerUserId);
      return event;
    };

    const expectedCreateAudits: Array<[string, string]> = [
      ["objectives", String(objective.id)],
      ["projects", String(deliveryProject.id)],
      ["tasks", String(deliveryTask.id)],
      ["decisions", String(approvedDecision.id)],
      ["obligations", String(obligation.id)],
      ["compliance-events", String(complianceEvent.id)],
      ["file", fileId],
      ["contracts", String(contract.id)],
      ["financial-entries", String(incomeEntry.id)],
      ["financial-entries", String(expenseEntry.id)],
      ["invoices", String(invoice.id)],
      ["cash-flow", String(cashFlow.id)],
      ["products", String(product.id)],
      ["opportunities", String(opportunity.id)],
      ["projects", String(marketProject.id)],
    ];
    for (const [resourceType, resourceId] of expectedCreateAudits) {
      expectAudit(resourceType, resourceId, "create");
    }
    expectAudit("decisions", String(approvedDecision.id), "update");
    expectAudit("financial-entries", String(expenseEntry.id), "external_action_apply");
    expectAudit("file", fileId, "content_stored");
    expectAudit("file", fileId, "upload_verified");
    const downloadIssuedAudit = expectAudit("file", fileId, "download_issued");
    expect(downloadIssuedAudit?.metadata).toMatchObject({
      classification: "confidential",
      sizeBytes: contractBytes.byteLength,
    });
    for (const action of [contractSignAction, bankPaymentAction, invoiceRedAction]) {
      expectAudit("external-action", String(action.id), "create");
      expectAudit("approval", String(action.approvalId), "approve");
    }
    expect(
      primaryAudits.some(
        (event) => event.resourceId === officialSource.id && event.action === "update",
      ),
    ).toBe(false);

    const objectiveCreateAudit = expectAudit("objectives", String(objective.id), "create");
    if (!objectiveCreateAudit) throw new Error("Expected objective creation audit");
    await expect(
      dbHandle.db
        .update(auditEvents)
        .set({ action: "tampered" })
        .where(eq(auditEvents.id, objectiveCreateAudit.id)),
    ).rejects.toThrow();
    const [unchangedAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, objectiveCreateAudit.id))
      .limit(1);
    expect(unchangedAudit).toMatchObject({
      orgId,
      actorUserId: ownerUserId,
      action: "create",
      resourceType: "objectives",
      resourceId: objective.id,
    });

    const otherOrgApprovals = await dbHandle.db
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.orgId, otherOrgId),
          eq(approvals.resourceId, String(bankPaymentAction.id)),
        ),
      );
    expect(otherOrgApprovals).toHaveLength(0);
  }, 60_000);

  it("rejects decision and opportunity references that do not form one active business chain", async () => {
    const createResource = async (resource: string, payload: JsonObject) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${resource}`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(response.statusCode, `${resource}: ${response.body}`).toBe(201);
      return body(response).data as JsonObject;
    };
    const expectValidationFailure = (
      response: { statusCode: number; body: string },
      message: string,
    ) => {
      expect(response.statusCode, response.body).toBe(400);
      expect(body(response).error).toMatchObject({ code: "VALIDATION_FAILED", message });
    };
    const expectConflict = (response: { statusCode: number; body: string }, message: string) => {
      expect(response.statusCode, response.body).toBe(409);
      expect(body(response).error).toMatchObject({ code: "CONFLICT", message });
    };

    const objectiveA = await createResource("objectives", {
      title: `Chain objective A ${suffix}`,
      status: "active",
    });
    const objectiveB = await createResource("objectives", {
      title: `Chain objective B ${suffix}`,
      status: "active",
    });
    const projectA = await createResource("projects", {
      objectiveId: objectiveA.id,
      name: `Chain project A ${suffix}`,
      status: "active",
    });
    const projectB = await createResource("projects", {
      objectiveId: objectiveB.id,
      name: `Chain project B ${suffix}`,
      status: "active",
    });
    const taskA = await createResource("tasks", {
      projectId: projectA.id,
      title: `Chain task A ${suffix}`,
    });
    const taskB = await createResource("tasks", {
      projectId: projectB.id,
      title: `Chain task B ${suffix}`,
    });
    const productA = await createResource("products", {
      projectId: projectA.id,
      name: `Chain product A ${suffix}`,
    });
    const productB = await createResource("products", {
      projectId: projectB.id,
      name: `Chain product B ${suffix}`,
    });
    const productWithoutProject = await createResource("products", {
      name: `Unassigned chain product ${suffix}`,
    });

    const decisionPairCases = [
      {
        payload: {
          objectiveId: objectiveA.id,
          projectId: projectB.id,
          title: `Mismatched decision objective-project ${suffix}`,
          context: "The project belongs to another objective.",
        },
        message: "projectId must reference a project in objectiveId",
      },
      {
        payload: {
          projectId: projectA.id,
          taskId: taskB.id,
          title: `Mismatched decision project-task ${suffix}`,
          context: "The task belongs to another project.",
        },
        message: "taskId must reference a task in projectId",
      },
      {
        payload: {
          objectiveId: objectiveA.id,
          taskId: taskB.id,
          title: `Mismatched decision objective-task ${suffix}`,
          context: "The task's project belongs to another objective.",
        },
        message: "taskId must reference a task whose project belongs to objectiveId",
      },
    ];
    for (const testCase of decisionPairCases) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/decisions",
        headers: { cookie: ownerCookie },
        payload: testCase.payload,
      });
      expectValidationFailure(response, testCase.message);
    }

    const validDecision = await createResource("decisions", {
      objectiveId: objectiveA.id,
      projectId: projectA.id,
      taskId: taskA.id,
      title: `Valid chain decision ${suffix}`,
      context: "All references belong to one chain.",
    });
    const invalidDecisionPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/decisions/${String(validDecision.id)}`,
      headers: { cookie: ownerCookie },
      payload: { projectId: projectB.id, expectedVersion: validDecision.version },
    });
    expectValidationFailure(
      invalidDecisionPatch,
      "objectiveId, projectId, and taskId must form one active objective-project-task chain",
    );
    const unchangedDecision = await app.inject({
      method: "GET",
      url: `/api/v1/decisions/${String(validDecision.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(unchangedDecision.statusCode, unchangedDecision.body).toBe(200);
    expect(body(unchangedDecision).data).toMatchObject({
      objectiveId: objectiveA.id,
      projectId: projectA.id,
      taskId: taskA.id,
      version: validDecision.version,
    });

    const invalidOpportunity = await app.inject({
      method: "POST",
      url: "/api/v1/opportunities",
      headers: { cookie: ownerCookie },
      payload: {
        productId: productA.id,
        projectId: projectB.id,
        title: `Mismatched product-project opportunity ${suffix}`,
      },
    });
    expectValidationFailure(
      invalidOpportunity,
      "productId and projectId must reference the same active project chain",
    );
    const unassignedProductOpportunity = await app.inject({
      method: "POST",
      url: "/api/v1/opportunities",
      headers: { cookie: ownerCookie },
      payload: {
        productId: productWithoutProject.id,
        projectId: projectA.id,
        title: `Unassigned product with explicit project ${suffix}`,
      },
    });
    expectValidationFailure(
      unassignedProductOpportunity,
      "productId and projectId must reference the same active project chain",
    );

    const validOpportunity = await createResource("opportunities", {
      productId: productA.id,
      projectId: projectA.id,
      title: `Valid chain opportunity ${suffix}`,
    });
    const invalidOpportunityPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/opportunities/${String(validOpportunity.id)}`,
      headers: { cookie: ownerCookie },
      payload: { productId: productB.id, expectedVersion: validOpportunity.version },
    });
    expectValidationFailure(
      invalidOpportunityPatch,
      "productId and projectId must reference the same active project chain",
    );
    const unchangedOpportunity = await app.inject({
      method: "GET",
      url: `/api/v1/opportunities/${String(validOpportunity.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(unchangedOpportunity.statusCode, unchangedOpportunity.body).toBe(200);
    expect(body(unchangedOpportunity).data).toMatchObject({
      productId: productA.id,
      projectId: projectA.id,
      version: validOpportunity.version,
    });

    const parentMutationCases = [
      {
        resource: "projects",
        id: projectA.id,
        payload: { objectiveId: objectiveB.id, expectedVersion: projectA.version },
        message:
          "Project objective cannot change while active decisions depend on the existing chain",
      },
      {
        resource: "tasks",
        id: taskA.id,
        payload: { projectId: projectB.id, expectedVersion: taskA.version },
        message: "Task project cannot change while active decisions depend on the existing chain",
      },
      {
        resource: "products",
        id: productA.id,
        payload: { projectId: projectB.id, expectedVersion: productA.version },
        message:
          "Product project cannot change while active opportunities depend on the existing chain",
      },
    ];
    for (const testCase of parentMutationCases) {
      const response = await app.inject({
        method: "PATCH",
        url: `/api/v1/${testCase.resource}/${String(testCase.id)}`,
        headers: { cookie: ownerCookie },
        payload: testCase.payload,
      });
      expectConflict(response, testCase.message);
    }

    const archiveDependencyCases = [
      {
        resource: "objectives",
        id: objectiveA.id,
        version: objectiveA.version,
        message: "Cannot archive objectives while active projects reference it",
      },
      {
        resource: "projects",
        id: projectA.id,
        version: projectA.version,
        message: "Cannot archive projects while active tasks reference it",
      },
      {
        resource: "tasks",
        id: taskA.id,
        version: taskA.version,
        message: "Cannot archive tasks while active decisions reference it",
      },
      {
        resource: "products",
        id: productA.id,
        version: productA.version,
        message: "Cannot archive products while active opportunities reference it",
      },
    ];
    for (const testCase of archiveDependencyCases) {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/v1/${testCase.resource}/${String(testCase.id)}?expectedVersion=${String(testCase.version)}`,
        headers: { cookie: ownerCookie },
      });
      expectConflict(response, testCase.message);
    }

    const clearDecisionTask = await app.inject({
      method: "PATCH",
      url: `/api/v1/decisions/${String(validDecision.id)}`,
      headers: { cookie: ownerCookie },
      payload: { taskId: null, expectedVersion: validDecision.version },
    });
    expect(clearDecisionTask.statusCode, clearDecisionTask.body).toBe(200);
    expect(body(clearDecisionTask).data).toMatchObject({
      objectiveId: objectiveA.id,
      projectId: projectA.id,
      taskId: null,
      version: Number(validDecision.version) + 1,
    });

    const assignPreviouslyUnassignedProduct = await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${String(productWithoutProject.id)}`,
      headers: { cookie: ownerCookie },
      payload: { projectId: projectA.id, expectedVersion: productWithoutProject.version },
    });
    expect(
      assignPreviouslyUnassignedProduct.statusCode,
      assignPreviouslyUnassignedProduct.body,
    ).toBe(200);
    expect(body(assignPreviouslyUnassignedProduct).data).toMatchObject({
      projectId: projectA.id,
      version: Number(productWithoutProject.version) + 1,
    });

    const clearProduct = await app.inject({
      method: "PATCH",
      url: `/api/v1/opportunities/${String(validOpportunity.id)}`,
      headers: { cookie: ownerCookie },
      payload: { productId: null, expectedVersion: validOpportunity.version },
    });
    expect(clearProduct.statusCode, clearProduct.body).toBe(200);
    expect(body(clearProduct).data).toMatchObject({
      productId: null,
      projectId: projectA.id,
      version: Number(validOpportunity.version) + 1,
    });
  }, 60_000);

  it("serializes a decision write against a concurrent task reparent", async () => {
    const createResource = async (resource: string, payload: JsonObject) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${resource}`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(response.statusCode, `${resource}: ${response.body}`).toBe(201);
      return body(response).data as JsonObject;
    };
    const objectiveA = await createResource("objectives", {
      title: `Concurrent chain objective A ${suffix}`,
      status: "active",
    });
    const objectiveB = await createResource("objectives", {
      title: `Concurrent chain objective B ${suffix}`,
      status: "active",
    });
    const projectA = await createResource("projects", {
      objectiveId: objectiveA.id,
      name: `Concurrent chain project A ${suffix}`,
      status: "active",
    });
    const projectB = await createResource("projects", {
      objectiveId: objectiveB.id,
      name: `Concurrent chain project B ${suffix}`,
      status: "active",
    });
    const task = await createResource("tasks", {
      projectId: projectA.id,
      title: `Concurrent chain task ${suffix}`,
    });

    let signalLocked: (() => void) | undefined;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const reparent = dbHandle.db.transaction(async (tx) => {
      await lockReferenceChain(tx, orgId);
      signalLocked?.();
      await release;
      await tx
        .update(tasks)
        .set({ projectId: String(projectB.id), updatedAt: new Date() })
        .where(and(eq(tasks.orgId, orgId), eq(tasks.id, String(task.id))));
    });
    await locked;

    let requestSettled = false;
    const decisionRequest = app
      .inject({
        method: "POST",
        url: "/api/v1/decisions",
        headers: { cookie: ownerCookie },
        payload: {
          objectiveId: objectiveA.id,
          projectId: projectA.id,
          taskId: task.id,
          title: `Concurrent chain decision ${suffix}`,
          context: "The request must validate after the serialized reparent commits.",
        },
      })
      .then((response) => {
        requestSettled = true;
        return response;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(requestSettled).toBe(false);
    } finally {
      releaseLock?.();
    }
    await reparent;
    const decisionResponse = await decisionRequest;
    expect(decisionResponse.statusCode, decisionResponse.body).toBe(400);
    expect(body(decisionResponse).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message:
        "objectiveId, projectId, and taskId must form one active objective-project-task chain",
    });
  }, 60_000);
});
