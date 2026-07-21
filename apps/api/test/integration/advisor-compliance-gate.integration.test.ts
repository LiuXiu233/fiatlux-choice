import { randomUUID } from "node:crypto";
import type { AdvisorOutput } from "@fiatlux/contracts";
import {
  advisorEdits,
  advisorRuns,
  auditEvents,
  complianceItems,
  createDatabase,
  files,
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
  const [cookieValue] = first.split(";", 1);
  if (!cookieValue) throw new Error("Login cookie is empty");
  return cookieValue;
}

describe.skipIf(!databaseUrl)("advisor compliance derivation gate", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let ownerCookie: string;
  let orgId: string;
  let ownerUserId: string;
  let reviewedFixtureIndex = 0;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Advisor Compliance Gate Company",
      organizationSlug: `advisor-gate-${suffix}`,
      adminEmail: `advisor-gate-${suffix}@example.test`,
      adminDisplayName: "Advisor Gate Owner",
      adminPassword: "correct-horse-battery-staple-advisor-gate",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    ownerUserId = seeded.user.id;
    const config: ApiConfig = apiConfigSchema.parse({
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
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `advisor-gate-${suffix}@example.test`,
        password: "correct-horse-battery-staple-advisor-gate",
      },
    });
    expect(login.statusCode).toBe(200);
    ownerCookie = cookie(login);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  async function createReviewedSourceFixture(input: {
    title: string;
    category: string;
    issuingAuthority: string;
    sourceUrl: string;
    nextReviewAt: string | null;
    summary?: string;
    sourceMetadata?: Record<string, unknown>;
  }) {
    reviewedFixtureIndex += 1;
    const [evidence] = await dbHandle.db
      .insert(files)
      .values({
        orgId,
        storageKey: `advisor-review/${suffix}/${reviewedFixtureIndex}.txt`,
        filename: `advisor-review-${reviewedFixtureIndex}.txt`,
        contentType: "text/plain",
        sizeBytes: 64,
        checksumSha256: reviewedFixtureIndex.toString(16).padStart(64, "0"),
        uploadStatus: "uploaded",
        uploadedBy: ownerUserId,
      })
      .returning();
    if (!evidence) throw new Error("Failed to create advisor review evidence fixture");
    const reviewedAt = new Date("2026-07-01T00:00:00.000Z");
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId,
        ...input,
        nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
        version: 2,
        status: "active",
        reviewStatus: "reviewed",
        reviewOutcome: "applicable",
        reviewerName: "Advisor Gate Professional Reviewer",
        reviewerRole: "Legal compliance reviewer",
        reviewerOrganization: "Advisor Gate Review Organization",
        reviewerQualification: "Qualified to review the supplied legal compliance source",
        reviewMissingInformation: "No known missing information for this test fixture",
        reviewEvidenceFileId: evidence.id,
        reviewedByUserId: ownerUserId,
        reviewedAt,
        reviewedSourceVersion: 1,
        lastVerifiedAt: reviewedAt,
      })
      .returning();
    if (!source) throw new Error("Failed to create reviewed compliance source fixture");
    return source as JsonObject;
  }

  it("withholds unreviewed source-derived records while preserving reviewed and internal chains", async () => {
    const promptResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisors/legal_compliance/prompt-versions",
      headers: { cookie: ownerCookie },
      payload: {
        systemPrompt:
          "Analyze only supplied legal and compliance records. Separate facts, inferences, recommendations, risks, and missing information. Cite every fact and require human review for decisions.",
        toolPolicy: { readOnly: true, humanApprovalForSideEffects: true },
        dataScopes: ["compliance-items", "compliance-events", "obligations"],
      },
    });
    expect(promptResponse.statusCode).toBe(201);

    const createResource = async (resource: string, payload: JsonObject) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${resource}`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(response.statusCode, response.body).toBe(201);
      return body(response).data as JsonObject;
    };

    const pendingSource = await createResource("compliance-items", {
      title: "PENDING-SOURCE-SECRET",
      category: "data",
      issuingAuthority: "Pending test authority",
      sourceUrl: `https://example.test/pending-source-${suffix}`,
      status: "draft",
      reviewStatus: "pending",
      summary: "PENDING-SOURCE-SUMMARY-SECRET",
    });
    const reviewedSource = await createReviewedSourceFixture({
      title: "Reviewed official source",
      category: "data",
      issuingAuthority: "Reviewed test authority",
      sourceUrl: `https://example.test/reviewed-source-${suffix}`,
      nextReviewAt: "2030-01-01T00:00:00.000Z",
      summary: "Reviewed source summary",
      sourceMetadata: {
        apiKey: "REVIEWED-SOURCE-API-KEY-SECRET",
        contact: "reviewer@example.cn 13800138000",
      },
    });
    const pendingSourceObligation = await createResource("obligations", {
      title: "PENDING-SOURCE-OBLIGATION-SECRET",
      description: "PENDING-SOURCE-OBLIGATION-DESCRIPTION-SECRET",
      category: "data",
      status: "open",
      sourceId: pendingSource.id,
    });
    const reviewedSourceObligation = await createResource("obligations", {
      title: "Reviewed source obligation",
      category: "data",
      status: "open",
      sourceId: reviewedSource.id,
    });
    const internalObligation = await createResource("obligations", {
      title: "Internal company obligation",
      category: "corporate",
      status: "open",
    });
    const pendingSourceEvent = await createResource("compliance-events", {
      title: "PENDING-SOURCE-EVENT-SECRET",
      description: "PENDING-SOURCE-EVENT-DESCRIPTION-SECRET",
      category: "data",
      eventType: "review",
      dueDate: "2030-01-01T00:00:00.000Z",
      status: "active",
      reviewStatus: "reviewed",
      sourceId: pendingSource.id,
    });
    const pendingReviewEvent = await createResource("compliance-events", {
      title: "PENDING-REVIEW-EVENT-SECRET",
      description: "PENDING-REVIEW-EVENT-DESCRIPTION-SECRET",
      category: "data",
      eventType: "review",
      dueDate: "2030-02-01T00:00:00.000Z",
      status: "draft",
      reviewStatus: "pending",
      sourceId: reviewedSource.id,
    });
    const reviewedEvent = await createResource("compliance-events", {
      title: "Reviewed compliance event",
      category: "data",
      eventType: "review",
      dueDate: "2030-03-01T00:00:00.000Z",
      status: "active",
      reviewStatus: "reviewed",
      sourceId: reviewedSource.id,
    });

    const references = [
      ["compliance-items", pendingSource],
      ["compliance-items", reviewedSource],
      ["obligations", pendingSourceObligation],
      ["obligations", reviewedSourceObligation],
      ["obligations", internalObligation],
      ["compliance-events", pendingSourceEvent],
      ["compliance-events", pendingReviewEvent],
      ["compliance-events", reviewedEvent],
    ].map(([resourceType, record]) => ({
      resourceType: String(resourceType),
      resourceId: String((record as JsonObject).id),
    }));
    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: ownerCookie },
      payload: {
        advisor: "legal_compliance",
        question: "Which supplied obligations and compliance events are verified?",
        context: references,
      },
    });
    expect(runResponse.statusCode, runResponse.body).toBe(201);
    const run = body(runResponse).data as JsonObject;

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = body(detailResponse).data as JsonObject;
    const contextSnapshot = detail.contextSnapshot as JsonObject[];
    const serializedContext = JSON.stringify(contextSnapshot);
    const acceptedIds = new Set(
      contextSnapshot.flatMap((item) =>
        typeof item.resourceId === "string" ? [item.resourceId] : [],
      ),
    );
    expect(acceptedIds).toEqual(
      new Set([
        String(reviewedSource.id),
        String(reviewedSourceObligation.id),
        String(internalObligation.id),
        String(reviewedEvent.id),
      ]),
    );
    expect(contextSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "compliance-review-gaps",
          withheldCount: 4,
          reasonCounts: {
            compliance_item_not_active_and_reviewed: 1,
            compliance_event_not_reviewed: 1,
            linked_compliance_source_not_active_and_reviewed: 2,
          },
        }),
      ]),
    );
    for (const hiddenValue of [
      "PENDING-SOURCE-SECRET",
      "PENDING-SOURCE-SUMMARY-SECRET",
      "PENDING-SOURCE-OBLIGATION-SECRET",
      "PENDING-SOURCE-OBLIGATION-DESCRIPTION-SECRET",
      "PENDING-SOURCE-EVENT-SECRET",
      "PENDING-SOURCE-EVENT-DESCRIPTION-SECRET",
      "PENDING-REVIEW-EVENT-SECRET",
      "PENDING-REVIEW-EVENT-DESCRIPTION-SECRET",
      String(pendingSource.id),
      String(pendingSourceObligation.id),
      String(pendingSourceEvent.id),
      String(pendingReviewEvent.id),
      "REVIEWED-SOURCE-API-KEY-SECRET",
      "reviewer@example.cn",
      "13800138000",
    ]) {
      expect(serializedContext).not.toContain(hiddenValue);
    }

    const toolCalls = detail.toolCalls as JsonObject[];
    const toolCallFor = (resourceId: unknown) =>
      toolCalls.find(
        (toolCall) => (toolCall.input as JsonObject | undefined)?.resourceId === resourceId,
      );
    expect(toolCallFor(pendingSourceObligation.id)).toMatchObject({
      status: "withheld",
      output: { withheld: true, reasons: ["linked_compliance_source_not_active_and_reviewed"] },
    });
    expect(toolCallFor(pendingSourceEvent.id)).toMatchObject({
      status: "withheld",
      output: { withheld: true, reasons: ["linked_compliance_source_not_active_and_reviewed"] },
    });
    expect(toolCallFor(pendingReviewEvent.id)).toMatchObject({
      status: "withheld",
      output: { withheld: true, reasons: ["compliance_event_not_reviewed"] },
    });
    expect(toolCallFor(reviewedSourceObligation.id)).toMatchObject({ status: "completed" });
    expect(toolCallFor(internalObligation.id)).toMatchObject({ status: "completed" });
    expect(toolCallFor(reviewedEvent.id)).toMatchObject({ status: "completed" });
    expect(JSON.stringify(toolCallFor(pendingSourceObligation.id))).not.toContain(
      "PENDING-SOURCE-OBLIGATION-SECRET",
    );
    expect(JSON.stringify(toolCallFor(reviewedSource.id))).not.toContain(
      "REVIEWED-SOURCE-API-KEY-SECRET",
    );
    expect(toolCallFor(reviewedSource.id)).toMatchObject({
      output: {
        record: {
          sourceMetadata: { contact: "[REDACTED_EMAIL] [REDACTED_PHONE]" },
        },
      },
    });

    const citationKeys = new Set(
      (detail.citations as JsonObject[]).map(
        (citation) => `${String(citation.sourceType)}:${String(citation.sourceId)}`,
      ),
    );
    expect(citationKeys).toEqual(
      new Set([
        `compliance-items:${String(reviewedSource.id)}`,
        `obligations:${String(reviewedSourceObligation.id)}`,
        `obligations:${String(internalObligation.id)}`,
        `compliance-events:${String(reviewedEvent.id)}`,
      ]),
    );

    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.action, "create"),
          eq(auditEvents.resourceType, "advisor-run"),
          eq(auditEvents.resourceId, String(run.id)),
        ),
      )
      .limit(1);
    expect(audit?.metadata).toMatchObject({
      contextCount: 8,
      withheldComplianceCount: 4,
      withheldComplianceReasonCounts: {
        compliance_item_not_active_and_reviewed: 1,
        compliance_event_not_reviewed: 1,
        linked_compliance_source_not_active_and_reviewed: 2,
      },
    });

    const initialOutput: AdvisorOutput = {
      facts: [
        {
          claim: "The reviewed source chain is available.",
          evidence: [
            {
              sourceType: "obligations",
              sourceId: String(reviewedSourceObligation.id),
            },
            { sourceType: "compliance-events", sourceId: String(reviewedEvent.id) },
          ],
        },
      ],
      inferences: [],
      recommendations: [],
      risks: [],
      missingInformation: [],
      confidence: 0.8,
      disclaimer: "Decision support only; human review is required.",
    };
    await dbHandle.db
      .update(advisorRuns)
      .set({ status: "completed", output: initialOutput, confidence: 8_000 })
      .where(and(eq(advisorRuns.orgId, orgId), eq(advisorRuns.id, String(run.id))));

    const rejectedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        output: {
          ...initialOutput,
          facts: [
            {
              claim: "Withheld derived records prove this claim.",
              evidence: [
                {
                  sourceType: "obligations",
                  sourceId: String(pendingSourceObligation.id),
                },
                {
                  sourceType: "compliance-events",
                  sourceId: String(pendingSourceEvent.id),
                },
              ],
            },
          ],
        },
        reason: "Attempt to cite an unreviewed source chain",
        expectedVersion: run.version,
      },
    });
    expect(rejectedEdit.statusCode).toBe(400);
    expect(rejectedEdit.body).toContain("outside its permission-filtered context");
    const rejectedEdits = await dbHandle.db
      .select()
      .from(advisorEdits)
      .where(eq(advisorEdits.runId, String(run.id)));
    expect(rejectedEdits).toHaveLength(0);

    const acceptedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: ownerCookie },
      payload: {
        output: initialOutput,
        reason: "Confirm the reviewed source chain",
        expectedVersion: run.version,
      },
    });
    expect(acceptedEdit.statusCode, acceptedEdit.body).toBe(200);
    expect(body(acceptedEdit).data).toMatchObject({ confidence: 8_000 });
  }, 60_000);

  it("fails closed for expired or unscheduled reviews even when the worker has not swept them", async () => {
    const createResource = async (resource: string, payload: JsonObject) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/${resource}`,
        headers: { cookie: ownerCookie },
        payload,
      });
      expect(response.statusCode, response.body).toBe(201);
      return body(response).data as JsonObject;
    };
    const expiredSource = await createReviewedSourceFixture({
      title: "EXPIRED-REVIEW-SOURCE-CONTENTS",
      category: "tax",
      issuingAuthority: "Expired review authority",
      sourceUrl: `https://example.test/expired-review-${suffix}`,
      nextReviewAt: "2025-02-01T00:00:00.000Z",
    });
    const unscheduledSource = await createReviewedSourceFixture({
      title: "UNSCHEDULED-REVIEW-SOURCE-CONTENTS",
      category: "labor",
      issuingAuthority: "Unscheduled review authority",
      sourceUrl: `https://example.test/unscheduled-review-${suffix}`,
      nextReviewAt: null,
    });
    const expiredObligation = await createResource("obligations", {
      title: "EXPIRED-REVIEW-LINKED-OBLIGATION-CONTENTS",
      category: "tax",
      sourceId: expiredSource.id,
    });
    const unscheduledObligation = await createResource("obligations", {
      title: "UNSCHEDULED-REVIEW-LINKED-OBLIGATION-CONTENTS",
      category: "labor",
      sourceId: unscheduledSource.id,
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: ownerCookie },
      payload: {
        advisor: "legal_compliance",
        question: "Can these unswept sources be used as facts?",
        context: [
          { resourceType: "compliance-items", resourceId: expiredSource.id },
          { resourceType: "compliance-items", resourceId: unscheduledSource.id },
          { resourceType: "obligations", resourceId: expiredObligation.id },
          { resourceType: "obligations", resourceId: unscheduledObligation.id },
        ],
      },
    });
    expect(runResponse.statusCode, runResponse.body).toBe(201);
    const run = body(runResponse).data as JsonObject;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: ownerCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = body(detailResponse).data as JsonObject;
    expect(detail.contextSnapshot).toEqual([
      expect.objectContaining({
        resourceType: "compliance-review-gaps",
        withheldCount: 4,
        reasonCounts: {
          compliance_item_review_expired_or_unscheduled: 2,
          linked_compliance_source_review_expired_or_unscheduled: 2,
        },
      }),
    ]);
    const serialized = JSON.stringify(detail);
    for (const hidden of [
      "EXPIRED-REVIEW-SOURCE-CONTENTS",
      "UNSCHEDULED-REVIEW-SOURCE-CONTENTS",
      "EXPIRED-REVIEW-LINKED-OBLIGATION-CONTENTS",
      "UNSCHEDULED-REVIEW-LINKED-OBLIGATION-CONTENTS",
    ]) {
      expect(serialized).not.toContain(hidden);
    }
    expect(
      (detail.toolCalls as JsonObject[]).map((call) => ({
        resourceId: (call.input as JsonObject).resourceId,
        status: call.status,
        reasons: (call.output as JsonObject).reasons,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          resourceId: expiredSource.id,
          status: "withheld",
          reasons: ["compliance_item_review_expired_or_unscheduled"],
        },
        {
          resourceId: unscheduledSource.id,
          status: "withheld",
          reasons: ["compliance_item_review_expired_or_unscheduled"],
        },
        {
          resourceId: expiredObligation.id,
          status: "withheld",
          reasons: ["linked_compliance_source_review_expired_or_unscheduled"],
        },
        {
          resourceId: unscheduledObligation.id,
          status: "withheld",
          reasons: ["linked_compliance_source_review_expired_or_unscheduled"],
        },
      ]),
    );
  }, 60_000);

  it("rejects oversized UTF-8 model context before creating an advisor run", async () => {
    const [largeAudit] = await dbHandle.db
      .insert(auditEvents)
      .values({
        orgId,
        actorUserId: null,
        action: "context-budget-test",
        resourceType: "security-evidence",
        resourceId: randomUUID(),
        requestId: `context-budget-${suffix}`,
        metadata: { evidence: "界".repeat(180_000) },
      })
      .returning({ id: auditEvents.id });
    if (!largeAudit) throw new Error("Failed to create model-context budget fixture");
    const before = await dbHandle.db
      .select({ id: advisorRuns.id })
      .from(advisorRuns)
      .where(eq(advisorRuns.orgId, orgId));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: ownerCookie },
      payload: {
        advisor: "information_security",
        question: "Summarize the bounded evidence",
        context: [{ resourceType: "audit-events", resourceId: largeAudit.id }],
      },
    });
    expect(response.statusCode, response.body).toBe(413);
    expect(body(response)).toMatchObject({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        details: { maxContextSizeBytes: 512_000 },
      },
    });
    const after = await dbHandle.db
      .select({ id: advisorRuns.id })
      .from(advisorRuns)
      .where(eq(advisorRuns.orgId, orgId));
    expect(after).toHaveLength(before.length);
  }, 60_000);
});
