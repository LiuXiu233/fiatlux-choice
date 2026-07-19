import { randomUUID } from "node:crypto";
import { auditEvents, complianceItems, createDatabase, files } from "@fiatlux/db";
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

describe.skipIf(!databaseUrl)("compliance professional review PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  let config: ApiConfig;
  let firstCookie: string;
  let secondCookie: string;
  let firstOrgId: string;
  let sourceId: string;
  let evidenceFileId: string;
  let replacementEvidenceFileId: string;
  let pendingEvidenceFileId: string;
  let crossOrgEvidenceFileId: string;
  let nextReviewAt: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const firstPassword = "correct-horse-battery-staple-review-one";
    const secondPassword = "correct-horse-battery-staple-review-two";
    const firstEmail = `review-one-${suffix}@example.test`;
    const secondEmail = `review-two-${suffix}@example.test`;
    const first = await seedDatabase(dbHandle.db, {
      organizationName: "Professional Review One",
      organizationSlug: `professional-review-one-${suffix}`,
      adminEmail: firstEmail,
      adminDisplayName: "Review Recorder",
      adminPassword: firstPassword,
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/professional-review-one.json",
    });
    const second = await seedDatabase(dbHandle.db, {
      organizationName: "Professional Review Two",
      organizationSlug: `professional-review-two-${suffix}`,
      adminEmail: secondEmail,
      adminDisplayName: "Other Review Recorder",
      adminPassword: secondPassword,
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/professional-review-two.json",
    });
    firstOrgId = first.organization.id;

    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "待专业复核的公司治理来源",
        category: "company_governance",
        issuingAuthority: "全国人民代表大会常务委员会",
        sourceUrl: `https://flk.npc.gov.cn/review-${suffix}`,
        status: "uncertain",
        reviewStatus: "stale",
        contentHashStatus: "changed",
        contentHash: "a".repeat(64),
        metadataHash: "b".repeat(64),
      })
      .returning();
    if (!source) throw new Error("Failed to create compliance review source");
    sourceId = source.id;

    const [uploadedEvidence, replacementEvidence, pendingEvidence, crossOrgEvidence] =
      await dbHandle.db
        .insert(files)
        .values([
          {
            orgId: firstOrgId,
            storageKey: `review/${suffix}/uploaded.txt`,
            filename: "professional-review-evidence.txt",
            contentType: "text/plain",
            sizeBytes: 128,
            checksumSha256: "c".repeat(64),
            classification: "confidential",
            uploadStatus: "uploaded",
            uploadedBy: first.user.id,
          },
          {
            orgId: firstOrgId,
            storageKey: `review/${suffix}/replacement.txt`,
            filename: "replacement-professional-review-evidence.txt",
            contentType: "text/plain",
            sizeBytes: 96,
            checksumSha256: "f".repeat(64),
            classification: "confidential",
            uploadStatus: "uploaded",
            uploadedBy: first.user.id,
          },
          {
            orgId: firstOrgId,
            storageKey: `review/${suffix}/pending.txt`,
            filename: "pending-review-evidence.txt",
            contentType: "text/plain",
            sizeBytes: 64,
            checksumSha256: "d".repeat(64),
            classification: "confidential",
            uploadStatus: "pending",
            uploadedBy: first.user.id,
          },
          {
            orgId: second.organization.id,
            storageKey: `review/${suffix}/cross-org.txt`,
            filename: "cross-org-review-evidence.txt",
            contentType: "text/plain",
            sizeBytes: 64,
            checksumSha256: "e".repeat(64),
            classification: "confidential",
            uploadStatus: "uploaded",
            uploadedBy: second.user.id,
          },
        ])
        .returning();
    if (!uploadedEvidence || !replacementEvidence || !pendingEvidence || !crossOrgEvidence) {
      throw new Error("Failed to create compliance review evidence fixtures");
    }
    evidenceFileId = uploadedEvidence.id;
    replacementEvidenceFileId = replacementEvidence.id;
    pendingEvidenceFileId = pendingEvidence.id;
    crossOrgEvidenceFileId = crossOrgEvidence.id;
    nextReviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();

    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: "compliance-professional-review-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue: { healthCheck: async () => undefined } as unknown as JobQueue,
    });
    const [firstLogin, secondLogin] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: firstEmail, password: firstPassword },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: secondEmail, password: secondPassword },
      }),
    ]);
    firstCookie = cookie(firstLogin);
    secondCookie = cookie(secondLogin);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  function reviewPayload(overrides: JsonObject = {}) {
    return {
      expectedVersion: 1,
      reviewOutcome: "applicable",
      resultingStatus: "active",
      reviewerName: "张复核",
      reviewerRole: "公司治理法律顾问",
      reviewerOrganization: "示例法律服务机构",
      reviewerQualification: "基于公司治理与商事合规执业经验进行适用性复核",
      evidenceFileId,
      applicability: "适用于当前公司治理、决策权限和会议记录维护。",
      summary: "已核对官方来源、施行状态和耀光当前治理事实。",
      missingInformation: "暂无已知缺失信息；章程变化后需要重新复核。",
      nextReviewAt,
      reason: "登记可追溯专业意见，供义务、日历和法务顾问后续使用。",
      ...overrides,
    };
  }

  it("blocks generic reviewed states and evidence-less professional claims", async () => {
    const genericCreate = await app.inject({
      method: "POST",
      url: "/api/v1/compliance-items",
      headers: { cookie: firstCookie },
      payload: {
        title: "不能直接生效的来源",
        category: "tax",
        issuingAuthority: "国家税务总局",
        sourceUrl: `https://chinatax.gov.cn/review-${randomUUID()}`,
        status: "active",
        reviewStatus: "reviewed",
        lastVerifiedAt: new Date().toISOString(),
      },
    });
    expect(genericCreate.statusCode).toBe(409);
    expect(body(genericCreate).error).toMatchObject({
      code: "PROFESSIONAL_REVIEW_REQUIRED",
    });

    const genericPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-items/${sourceId}`,
      headers: { cookie: firstCookie },
      payload: { expectedVersion: 1, reviewStatus: "reviewed" },
    });
    expect(genericPatch.statusCode).toBe(409);
    expect(body(genericPatch).error).toMatchObject({
      code: "PROFESSIONAL_REVIEW_REQUIRED",
    });

    const genericActivePatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-items/${sourceId}`,
      headers: { cookie: firstCookie },
      payload: { expectedVersion: 1, status: "active" },
    });
    expect(genericActivePatch.statusCode).toBe(409);
    expect(body(genericActivePatch).error).toMatchObject({
      code: "PROFESSIONAL_REVIEW_REQUIRED",
    });

    const genericRepealedPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-items/${sourceId}`,
      headers: { cookie: firstCookie },
      payload: { expectedVersion: 1, status: "repealed" },
    });
    expect(genericRepealedPatch.statusCode).toBe(409);
    expect(body(genericRepealedPatch).error).toMatchObject({
      code: "PROFESSIONAL_REVIEW_REQUIRED",
    });

    for (const [label, requestPayload, expectedStatus] of [
      ["cross organization", reviewPayload({ evidenceFileId: crossOrgEvidenceFileId }), 400],
      ["pending upload", reviewPayload({ evidenceFileId: pendingEvidenceFileId }), 400],
      ["missing reviewer organization", reviewPayload({ reviewerOrganization: null }), 400],
      ["missing information not recorded", reviewPayload({ missingInformation: "" }), 400],
      ["stale source version", reviewPayload({ expectedVersion: 99 }), 409],
      [
        "unresolved conclusion marked active",
        reviewPayload({ reviewOutcome: "changes_required", resultingStatus: "active" }),
        400,
      ],
      [
        "review deadline too far away",
        reviewPayload({
          nextReviewAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000).toISOString(),
        }),
        400,
      ],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/compliance-items/${sourceId}/reviews`,
        headers: { cookie: firstCookie },
        payload: requestPayload,
      });
      expect(response.statusCode, `${label}: ${response.body}`).toBe(expectedStatus);
    }

    const crossTenant = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/reviews`,
      headers: { cookie: secondCookie },
      payload: reviewPayload(),
    });
    expect(crossTenant.statusCode).toBe(404);
    const professionalAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, sourceId),
          eq(auditEvents.action, "professional_review"),
        ),
      );
    expect(professionalAudits).toHaveLength(0);
  });

  it("records a version-bound review, immutable evidence reference, and append-only history", async () => {
    const reviewed = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/reviews`,
      headers: { cookie: firstCookie },
      payload: reviewPayload(),
    });
    expect(reviewed.statusCode, reviewed.body).toBe(201);
    expect(body(reviewed).data).toMatchObject({
      id: sourceId,
      version: 2,
      status: "active",
      reviewStatus: "reviewed",
      reviewOutcome: "applicable",
      reviewerName: "张复核",
      reviewerRole: "公司治理法律顾问",
      reviewEvidenceFileId: evidenceFileId,
      reviewMissingInformation: "暂无已知缺失信息；章程变化后需要重新复核。",
      reviewedSourceVersion: 1,
      reviewedContentHash: "a".repeat(64),
      reviewedMetadataHash: "b".repeat(64),
      contentHashStatus: "current",
    });
    expect(body(reviewed).meta).toMatchObject({ reviewId: expect.any(String) });

    const [stored] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(and(eq(complianceItems.orgId, firstOrgId), eq(complianceItems.id, sourceId)));
    expect(stored).toMatchObject({
      reviewedByUserId: expect.any(String),
      reviewedAt: expect.any(Date),
      nextReviewAt: expect.any(Date),
    });

    const crossTenantHistory = await app.inject({
      method: "GET",
      url: `/api/v1/compliance-items/${sourceId}/reviews`,
      headers: { cookie: secondCookie },
    });
    expect(crossTenantHistory.statusCode).toBe(404);

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/compliance-items/${sourceId}/reviews?page=1&pageSize=10`,
      headers: { cookie: firstCookie },
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(body(history).meta).toMatchObject({ page: 1, pageSize: 10, total: 1, pageCount: 1 });
    expect(body(history).data).toEqual([
      expect.objectContaining({
        sourceId,
        reviewOutcome: "applicable",
        resultingStatus: "active",
        reviewerName: "张复核",
        evidenceFileId,
        missingInformation: "暂无已知缺失信息；章程变化后需要重新复核。",
        reviewedSourceVersion: 1,
        reviewedContentHash: "a".repeat(64),
        recordedByDisplayName: "Review Recorder",
      }),
    ]);

    const archiveEvidence = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${evidenceFileId}?expectedVersion=1`,
      headers: { cookie: firstCookie },
    });
    expect(archiveEvidence.statusCode).toBe(409);
    expect(archiveEvidence.body).toContain("Referenced business evidence cannot be archived");
  });

  it("fails closed when reviewed conclusions change and keeps later unresolved reviews visible", async () => {
    const substantiveEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/compliance-items/${sourceId}`,
      headers: { cookie: firstCookie },
      payload: {
        expectedVersion: 2,
        summary: "官方来源出现新的公司事实，需要重新形成专业结论。",
      },
    });
    expect(substantiveEdit.statusCode, substantiveEdit.body).toBe(200);
    expect(body(substantiveEdit).data).toMatchObject({
      version: 3,
      status: "uncertain",
      reviewStatus: "stale",
    });

    const unresolved = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/reviews`,
      headers: { cookie: firstCookie },
      payload: reviewPayload({
        expectedVersion: 3,
        reviewOutcome: "insufficient_information",
        resultingStatus: "uncertain",
        applicability: "尚缺耀光现行章程、股权结构和内部授权事实。",
        summary: "官方文本已核对，但公司事实不足，不能形成确定适用结论。",
        missingInformation: "尚缺耀光现行章程、股权结构和内部授权事实。",
        evidenceFileId: replacementEvidenceFileId,
        reason: "保留缺失信息和下一次复核安排，不把未完成意见写成已适用。",
      }),
    });
    expect(unresolved.statusCode, unresolved.body).toBe(201);
    expect(body(unresolved).data).toMatchObject({
      version: 4,
      status: "uncertain",
      reviewStatus: "stale",
      reviewOutcome: "insufficient_information",
    });

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/compliance-items/${sourceId}/reviews?page=1&pageSize=10`,
      headers: { cookie: firstCookie },
    });
    expect(body(history).meta).toMatchObject({ total: 2 });
    const entries = body(history).data as JsonObject[];
    expect(entries.map((entry) => entry.reviewOutcome)).toEqual([
      "insufficient_information",
      "applicable",
    ]);
    expect(entries.map((entry) => entry.evidenceFileId)).toEqual([
      replacementEvidenceFileId,
      evidenceFileId,
    ]);

    const archiveHistoricalEvidence = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${evidenceFileId}?expectedVersion=1`,
      headers: { cookie: firstCookie },
    });
    expect(archiveHistoricalEvidence.statusCode).toBe(409);
    expect(archiveHistoricalEvidence.body).toContain(
      "Referenced business evidence cannot be archived",
    );
  });
});
