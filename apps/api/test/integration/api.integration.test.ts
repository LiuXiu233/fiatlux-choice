import { createHash, randomUUID } from "node:crypto";
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

describe.skipIf(!databaseUrl)("API PostgreSQL vertical slice", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let firstCookie: string;
  let secondCookie: string;
  let firstOrgId: string;
  let secondOrgId: string;
  let firstUserId: string;
  let suffix: string;
  let config: ApiConfig;
  let queuedJobs: Array<{ name: string; data: unknown }>;
  let storage: MemoryObjectStorage;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    suffix = randomUUID().slice(0, 8);
    const firstSeed = await seedDatabase(dbHandle.db, {
      organizationName: "First Test Company",
      organizationSlug: `first-${suffix}`,
      adminEmail: `first-${suffix}@example.test`,
      adminDisplayName: "First Owner",
      adminPassword: "correct-horse-battery-staple-1",
      adminMustChangePassword: false,
    });
    firstOrgId = firstSeed.organization.id;
    firstUserId = firstSeed.user.id;
    const secondSeed = await seedDatabase(dbHandle.db, {
      organizationName: "Second Test Company",
      organizationSlug: `second-${suffix}`,
      adminEmail: `second-${suffix}@example.test`,
      adminDisplayName: "Second Owner",
      adminPassword: "correct-horse-battery-staple-2",
      adminMustChangePassword: false,
    });
    secondOrgId = secondSeed.organization.id;
    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    queuedJobs = [];
    const queue = {
      send: async (name: string, data: unknown) => {
        queuedJobs.push({ name, data });
        return randomUUID();
      },
    } as unknown as JobQueue;
    storage = new MemoryObjectStorage();
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage,
      queue,
    });

    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `first-${suffix}@example.test`,
        password: "correct-horse-battery-staple-1",
      },
    });
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `second-${suffix}@example.test`,
        password: "correct-horse-battery-staple-2",
      },
    });
    expect(firstLogin.statusCode).toBe(200);
    expect(secondLogin.statusCode).toBe(200);
    firstCookie = cookie(firstLogin);
    secondCookie = cookie(secondLogin);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("creates audited records and isolates them by organization", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: firstCookie },
      payload: { title: "Private objective", status: "active", progress: 20 },
    });
    expect(created.statusCode).toBe(201);

    const firstList = await app.inject({
      method: "GET",
      url: "/api/v1/objectives",
      headers: { cookie: firstCookie },
    });
    const secondList = await app.inject({
      method: "GET",
      url: "/api/v1/objectives",
      headers: { cookie: secondCookie },
    });
    expect(firstList.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(firstList.headers.pragma).toBe("no-cache");
    expect(firstList.headers.expires).toBe("0");
    expect(body(firstList).data as JsonObject[]).toHaveLength(1);
    expect(body(secondList).data as JsonObject[]).toHaveLength(0);

    const [event] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceType, "objectives"))
      .limit(1);
    expect(event?.action).toBe("create");
    if (!event) throw new Error("Expected objective audit event");
    await expect(
      dbHandle.db
        .update(auditEvents)
        .set({ action: "tampered" })
        .where(eq(auditEvents.id, event.id)),
    ).rejects.toThrow();
    const [unchangedEvent] = await dbHandle.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.id, event.id))
      .limit(1);
    expect(unchangedEvent?.action).toBe("create");
  });

  it("rejects cross-organization foreign-key references", async () => {
    const secondObjectiveResponse = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: secondCookie },
      payload: { title: "Second company objective", status: "active", progress: 10 },
    });
    const secondObjective = body(secondObjectiveResponse).data as JsonObject;
    const crossOrgProject = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: firstCookie },
      payload: { name: "Invalid cross-org project", objectiveId: secondObjective.id },
    });
    expect(crossOrgProject.statusCode).toBe(400);
    expect(crossOrgProject.body).toContain("does not belong to the active organization");
  });

  it("imports official sources as non-factual pending review records", async () => {
    const imported = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.orgId, firstOrgId));
    expect(imported.length).toBeGreaterThan(10);
    expect(
      imported.every((item) => item.reviewStatus === "pending" && item.status === "draft"),
    ).toBe(true);
    expect(imported.some((item) => item.sourceStatus === "effective")).toBe(true);
    expect(imported.every((item) => /^https?:\/\//.test(item.sourceUrl))).toBe(true);
  });

  it("requires and records explicit human approval", async () => {
    const actionResponse = await app.inject({
      method: "POST",
      url: "/api/v1/external-actions",
      headers: { cookie: firstCookie },
      payload: {
        kind: "bank_payment",
        adapter: "manual",
        payload: { amountCents: 100_00, beneficiary: "Test supplier" },
        idempotencyKey: `payment-${randomUUID()}`,
        reason: "Integration test payment",
      },
    });
    expect(actionResponse.statusCode).toBe(201);
    const action = body(actionResponse).data as JsonObject;
    expect(action.status).toBe("pending_approval");

    const deniedSelfApproval = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
      headers: { cookie: firstCookie },
      payload: { comment: "Approve" },
    });
    expect(deniedSelfApproval.statusCode).toBe(400);

    const approved = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(action.approvalId)}/approve`,
      headers: { cookie: firstCookie },
      payload: {
        comment: "Owner explicitly approves",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approved.statusCode).toBe(200);
    expect((body(approved).data as JsonObject).status).toBe("approved");
  });

  it("rejects protected states during ordinary resource creation", async () => {
    const activeContract = await app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      headers: { cookie: firstCookie },
      payload: {
        name: "Bypass contract",
        counterparty: "Test counterparty",
        status: "active",
        currency: "CNY",
      },
    });
    expect(activeContract.statusCode).toBe(409);

    const redInvoice = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { cookie: firstCookie },
      payload: {
        direction: "outgoing",
        counterparty: "Test counterparty",
        amountCents: 10_000,
        taxAmountCents: 0,
        currency: "CNY",
        status: "red_confirmed",
      },
    });
    expect(redInvoice.statusCode).toBe(409);
  });

  it("stores a bounded file upload through the API and verifies SHA-256", async () => {
    const fileData = Buffer.from("verified file content");
    const checksumSha256 = createHash("sha256").update(fileData).digest("hex");
    const metadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: firstCookie },
      payload: {
        filename: "evidence.txt",
        contentType: "text/plain",
        sizeBytes: fileData.byteLength,
        checksumSha256,
        classification: "confidential",
      },
    });
    expect(metadataResponse.statusCode).toBe(201);
    const metadata = body(metadataResponse).data as { file: JsonObject; upload: JsonObject };
    expect(metadata.upload.uploadUrl).toBe(`/api/v1/files/${String(metadata.file.id)}/content`);

    const uploadResponse = await app.inject({
      method: "PUT",
      url: String(metadata.upload.uploadUrl),
      headers: {
        cookie: firstCookie,
        "content-type": "application/octet-stream",
        "content-length": String(fileData.byteLength),
      },
      payload: fileData,
    });
    expect(uploadResponse.statusCode, uploadResponse.body).toBe(201);
    const completeResponse = await app.inject({
      method: "POST",
      url: `/api/v1/files/${String(metadata.file.id)}/complete`,
      headers: { cookie: firstCookie },
    });
    expect(completeResponse.statusCode).toBe(200);

    const downloadResponse = await app.inject({
      method: "GET",
      url: `/api/v1/files/${String(metadata.file.id)}/download`,
      headers: { cookie: firstCookie },
    });
    expect(downloadResponse.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.rawPayload).toEqual(fileData);

    const [downloadAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceType, "file"),
          eq(auditEvents.resourceId, String(metadata.file.id)),
          eq(auditEvents.action, "download_issued"),
        ),
      )
      .limit(1);
    expect(downloadAudit).toMatchObject({ actorUserId: firstUserId });
    expect(downloadAudit?.metadata).toMatchObject({
      classification: "confidential",
      sizeBytes: fileData.byteLength,
      semantics: "authorized object stream issued; client receipt is not asserted",
    });

    for (const filename of ["renamed.html", "invoice.exe.pdf", "evidence.pdf"]) {
      const invalidRename = await app.inject({
        method: "PATCH",
        url: `/api/v1/files/${String(metadata.file.id)}`,
        headers: { cookie: firstCookie },
        payload: { filename, expectedVersion: 3 },
      });
      expect(invalidRename.statusCode, `${filename}: ${invalidRename.body}`).toBe(400);
      expect(body(invalidRename).error).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("rejects unsafe or mismatched declared file types before issuing upload storage", async () => {
    const base = {
      sizeBytes: 1,
      checksumSha256: "0".repeat(64),
      classification: "internal",
    };
    for (const payload of [
      { ...base, filename: "payload.html", contentType: "text/html" },
      { ...base, filename: "payload.svg", contentType: "image/svg+xml" },
      { ...base, filename: "invoice.exe.pdf", contentType: "application/pdf" },
      { ...base, filename: "invoice.pdf", contentType: "application/octet-stream" },
      { ...base, filename: "invoice.pdf", contentType: "image/png" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/files",
        headers: { cookie: firstCookie },
        payload,
      });
      expect(response.statusCode, `${payload.filename}: ${response.body}`).toBe(400);
      expect(body(response).error).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("rejects disguised binary content before object storage and preserves pending state", async () => {
    const disguised = Buffer.from("MZ renamed executable bytes with a fake %%EOF marker");
    const metadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: firstCookie },
      payload: {
        filename: "disguised.pdf",
        contentType: "application/pdf",
        sizeBytes: disguised.byteLength,
        checksumSha256: createHash("sha256").update(disguised).digest("hex"),
        classification: "confidential",
      },
    });
    expect(metadataResponse.statusCode, metadataResponse.body).toBe(201);
    const metadata = body(metadataResponse).data as { file: JsonObject; upload: JsonObject };
    const fileId = String(metadata.file.id);
    const storageKey = String(metadata.file.storageKey);

    const upload = await app.inject({
      method: "PUT",
      url: String(metadata.upload.uploadUrl),
      headers: {
        cookie: firstCookie,
        "content-type": "application/octet-stream",
        "content-length": String(disguised.byteLength),
      },
      payload: disguised,
    });
    expect(upload.statusCode, upload.body).toBe(400);
    expect(body(upload).error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "File content does not match PDF",
    });
    expect(await storage.head(storageKey)).toBeNull();
    const [record] = await dbHandle.db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, firstOrgId)))
      .limit(1);
    expect(record).toMatchObject({ uploadStatus: "pending", version: 1 });

    const requestId = String((body(upload).error as JsonObject).requestId);
    const [rejectionAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.requestId, requestId),
          eq(auditEvents.action, "request_rejected"),
        ),
      )
      .limit(1);
    expect(rejectionAudit?.metadata).toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      method: "PUT",
    });
    expect(rejectionAudit?.metadata).not.toHaveProperty("body");
  });

  it("rejects unauthenticated uploads before parsing their content type", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/files/${randomUUID()}/content`,
      headers: { "content-type": "application/x-unsupported" },
      payload: "must not be parsed",
    });

    expect(response.statusCode).toBe(401);
    expect(body(response).error).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  });

  it("audits authenticated schema and media-type rejections without storing request bodies", async () => {
    const invalidTask = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: { cookie: firstCookie },
      payload: { title: "" },
    });
    expect(invalidTask.statusCode, invalidTask.body).toBe(400);

    const invalidUpload = await app.inject({
      method: "PUT",
      url: `/api/v1/files/${randomUUID()}/content`,
      headers: { cookie: firstCookie, "content-type": "application/x-unsupported" },
      payload: "must not be parsed",
    });
    expect(invalidUpload.statusCode, invalidUpload.body).toBe(415);

    for (const [response, expected] of [
      [invalidTask, { code: "VALIDATION_FAILED", status: 400, method: "POST" }],
      [invalidUpload, { code: "UNSUPPORTED_MEDIA_TYPE", status: 415, method: "PUT" }],
    ] as const) {
      const requestId = String((body(response).error as JsonObject).requestId);
      const [audit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, firstOrgId),
            eq(auditEvents.requestId, requestId),
            eq(auditEvents.action, "request_rejected"),
          ),
        )
        .limit(1);
      expect(audit).toMatchObject({ actorUserId: firstUserId, metadata: expected });
      expect(audit?.metadata).not.toHaveProperty("body");
      expect(audit?.metadata).not.toHaveProperty("password");
    }
  });

  it("lets members complete only their own file uploads without global update permission", async () => {
    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: { cookie: firstCookie },
    });
    const memberRole = (body(rolesResponse).data as JsonObject[]).find(
      (role) => role.systemKey === "member",
    );
    if (!memberRole) throw new Error("Member role not found");
    const memberEmail = `member-${suffix}@example.test`;
    const memberPassword = "member-password-long-enough";
    const userResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: firstCookie },
      payload: {
        email: memberEmail,
        displayName: "File Upload Member",
        password: memberPassword,
        roleId: memberRole.id,
      },
    });
    expect(userResponse.statusCode).toBe(201);
    const userResult = body(userResponse).data as { approval: JsonObject };
    const approvalResponse = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(userResult.approval.id)}/approve`,
      headers: { cookie: firstCookie },
      payload: {
        comment: "Approve member role for upload test",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approvalResponse.statusCode).toBe(200);
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
      "member-replacement-password-long-enough",
    );

    const ownData = Buffer.from("member-owned upload");
    const ownMetadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: memberCookie },
      payload: {
        filename: "member.txt",
        contentType: "text/plain",
        sizeBytes: ownData.byteLength,
        checksumSha256: createHash("sha256").update(ownData).digest("hex"),
        classification: "internal",
      },
    });
    expect(ownMetadataResponse.statusCode).toBe(201);
    const ownMetadata = body(ownMetadataResponse).data as {
      file: JsonObject;
      upload: JsonObject;
    };
    const ownUpload = await app.inject({
      method: "PUT",
      url: String(ownMetadata.upload.uploadUrl),
      headers: {
        cookie: memberCookie,
        "content-type": "application/octet-stream",
        "content-length": String(ownData.byteLength),
      },
      payload: ownData,
    });
    expect(ownUpload.statusCode, ownUpload.body).toBe(201);
    const ownComplete = await app.inject({
      method: "POST",
      url: `/api/v1/files/${String(ownMetadata.file.id)}/complete`,
      headers: { cookie: memberCookie },
    });
    expect(ownComplete.statusCode).toBe(200);
    expect(body(ownComplete).data).toMatchObject({ uploadStatus: "uploaded" });

    const ownDownload = await app.inject({
      method: "GET",
      url: `/api/v1/files/${String(ownMetadata.file.id)}/download`,
      headers: { cookie: memberCookie },
    });
    expect(ownDownload.statusCode, ownDownload.body).toBe(200);
    expect(ownDownload.rawPayload).toEqual(ownData);

    const forbiddenArchive = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${String(ownMetadata.file.id)}?expectedVersion=3`,
      headers: { cookie: memberCookie },
    });
    expect(forbiddenArchive.statusCode).toBe(403);
    expect(body(forbiddenArchive).error).toMatchObject({ code: "FORBIDDEN" });

    const metadataPatch = await app.inject({
      method: "PATCH",
      url: `/api/v1/files/${String(ownMetadata.file.id)}`,
      headers: { cookie: memberCookie },
      payload: { filename: "renamed.txt", expectedVersion: 3 },
    });
    expect(metadataPatch.statusCode).toBe(403);

    const ownerData = Buffer.from("owner-controlled upload");
    const ownerMetadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: firstCookie },
      payload: {
        filename: "owner.txt",
        contentType: "text/plain",
        sizeBytes: ownerData.byteLength,
        checksumSha256: createHash("sha256").update(ownerData).digest("hex"),
        classification: "confidential",
      },
    });
    expect(ownerMetadataResponse.statusCode).toBe(201);
    const ownerMetadata = body(ownerMetadataResponse).data as {
      file: JsonObject;
      upload: JsonObject;
    };
    const forbiddenUpload = await app.inject({
      method: "PUT",
      url: String(ownerMetadata.upload.uploadUrl),
      headers: {
        cookie: memberCookie,
        "content-type": "application/octet-stream",
        "content-length": String(ownerData.byteLength),
      },
      payload: ownerData,
    });
    expect(forbiddenUpload.statusCode).toBe(403);
    const forbiddenComplete = await app.inject({
      method: "POST",
      url: `/api/v1/files/${String(ownerMetadata.file.id)}/complete`,
      headers: { cookie: memberCookie },
    });
    expect(forbiddenComplete.statusCode).toBe(403);
  });

  it("reports manual GitHub mode without making a network request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network access is forbidden in this test"));
    try {
      const settingsResponse = await app.inject({
        method: "GET",
        url: "/api/v1/settings/integrations",
        headers: { cookie: firstCookie },
      });
      expect(settingsResponse.statusCode).toBe(200);
      const github = (body(settingsResponse).data as JsonObject[]).find(
        (integration) => integration.id === "github",
      );
      expect(github).toMatchObject({ mode: "manual", status: "manual" });

      const testResponse = await app.inject({
        method: "POST",
        url: "/api/v1/settings/integrations/github/test",
        headers: { cookie: firstCookie },
      });
      expect(testResponse.statusCode).toBe(200);
      expect(body(testResponse).data).toMatchObject({
        status: "manual",
        detail: "Manual import is available; no GitHub network request was performed",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("queues only organization-scoped GitHub refreshes in explicit read-only mode", async () => {
    const createInsight = (cookieValue: string, repository: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/github-insights",
        headers: { cookie: cookieValue },
        payload: {
          repository,
          kind: "repository",
          summary: `Manual snapshot for ${repository}`,
          url: `https://github.com/${repository}`,
          capturedAt: new Date().toISOString(),
          payload: {},
        },
      });
    const firstInsightResponse = await createInsight(firstCookie, "fiatlux/choice");
    const secondInsightResponse = await createInsight(secondCookie, "other/private");
    expect(firstInsightResponse.statusCode).toBe(201);
    expect(secondInsightResponse.statusCode).toBe(201);
    const firstInsight = body(firstInsightResponse).data as JsonObject;
    const secondInsight = body(secondInsightResponse).data as JsonObject;

    const queueCount = queuedJobs.length;
    const manualResponse = await app.inject({
      method: "POST",
      url: `/api/v1/github-insights/${String(firstInsight.id)}/refresh`,
      headers: { cookie: firstCookie },
    });
    expect(manualResponse.statusCode).toBe(409);
    expect(queuedJobs).toHaveLength(queueCount);

    config.GITHUB_INTEGRATION_MODE = "read_only";
    try {
      const crossOrganizationResponse = await app.inject({
        method: "POST",
        url: `/api/v1/github-insights/${String(secondInsight.id)}/refresh`,
        headers: { cookie: firstCookie },
      });
      expect(crossOrganizationResponse.statusCode).toBe(404);

      const queuedResponse = await app.inject({
        method: "POST",
        url: `/api/v1/github-insights/${String(firstInsight.id)}/refresh`,
        headers: { cookie: firstCookie },
      });
      expect(queuedResponse.statusCode).toBe(202);
      expect(body(queuedResponse).data).toMatchObject({
        insightId: firstInsight.id,
        repository: "fiatlux/choice",
        expectedVersion: firstInsight.version,
        status: "queued",
      });
      expect(queuedJobs.at(-1)).toEqual({
        name: "github.refresh",
        data: {
          orgId: firstOrgId,
          insightId: firstInsight.id,
          expectedVersion: firstInsight.version,
        },
      });

      const [audit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, firstOrgId),
            eq(auditEvents.resourceId, String(firstInsight.id)),
            eq(auditEvents.action, "queue_refresh"),
          ),
        )
        .limit(1);
      expect(audit?.resourceType).toBe("github-insight");
    } finally {
      config.GITHUB_INTEGRATION_MODE = "manual";
    }
  });

  it("rejects human advisor edits that cite evidence outside the original context", async () => {
    const objectiveResponse = await app.inject({
      method: "POST",
      url: "/api/v1/objectives",
      headers: { cookie: firstCookie },
      payload: { title: "Evidence-bound objective", status: "active", progress: 25 },
    });
    expect(objectiveResponse.statusCode).toBe(201);
    const objective = body(objectiveResponse).data as JsonObject;
    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "general_manager",
        question: "Assess this objective",
        context: [{ resourceType: "objectives", resourceId: objective.id }],
      },
    });
    expect(runResponse.statusCode).toBe(201);
    const run = body(runResponse).data as JsonObject;
    const initialOutput: AdvisorOutput = {
      facts: [
        {
          claim: "The objective is active.",
          evidence: [{ sourceType: "objectives", sourceId: String(objective.id) }],
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
      .where(and(eq(advisorRuns.id, String(run.id)), eq(advisorRuns.orgId, firstOrgId)));

    const invalidOutput: AdvisorOutput = {
      ...initialOutput,
      facts: [
        {
          claim: "An unrelated record proves this claim.",
          evidence: [{ sourceType: "objectives", sourceId: randomUUID() }],
        },
      ],
    };
    const rejectedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: firstCookie },
      payload: {
        output: invalidOutput,
        reason: "Attempt an evidence substitution",
        expectedVersion: run.version,
      },
    });
    expect(rejectedEdit.statusCode).toBe(400);
    expect(rejectedEdit.body).toContain("outside its permission-filtered context");
    const [unchanged] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(eq(advisorRuns.id, String(run.id)))
      .limit(1);
    expect(unchanged?.version).toBe(run.version);
    expect(unchanged?.output).toEqual(initialOutput);
    const rejectedEdits = await dbHandle.db
      .select()
      .from(advisorEdits)
      .where(eq(advisorEdits.runId, String(run.id)));
    expect(rejectedEdits).toHaveLength(0);

    const acceptedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: firstCookie },
      payload: {
        output: { ...initialOutput, confidence: 0.7 },
        reason: "Adjust confidence after human review",
        expectedVersion: run.version,
      },
    });
    expect(acceptedEdit.statusCode).toBe(200);
    expect(body(acceptedEdit).data).toMatchObject({ confidence: 7_000 });
    const acceptedEdits = await dbHandle.db
      .select()
      .from(advisorEdits)
      .where(eq(advisorEdits.runId, String(run.id)));
    expect(acceptedEdits).toHaveLength(1);
  });

  it("provides organization-scoped audit events to the information-security advisor", async () => {
    const [ownAuditEvent] = await dbHandle.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.orgId, firstOrgId))
      .limit(1);
    const [otherAuditEvent] = await dbHandle.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.orgId, secondOrgId))
      .limit(1);
    if (!ownAuditEvent || !otherAuditEvent) throw new Error("Expected audit events for both orgs");

    const crossOrganizationRun = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "information_security",
        question: "Inspect another organization event",
        context: [{ resourceType: "audit-events", resourceId: otherAuditEvent.id }],
      },
    });
    expect(crossOrganizationRun.statusCode).toBe(404);

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "information_security",
        question: "Review this security-relevant audit event",
        context: [{ resourceType: "audit-events", resourceId: ownAuditEvent.id }],
      },
    });
    expect(runResponse.statusCode).toBe(201);
    const run = body(runResponse).data as JsonObject;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/advisor-runs/${String(run.id)}`,
      headers: { cookie: firstCookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = body(detailResponse).data as JsonObject;
    expect(detail.contextSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceType: "audit-events",
          resourceId: ownAuditEvent.id,
        }),
      ]),
    );
    expect(detail.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "company_data.read",
          status: "completed",
        }),
      ]),
    );
  });

  it("enforces the active prompt version's narrowed data scopes", async () => {
    const promptResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisors/market_opportunity/prompt-versions",
      headers: { cookie: firstCookie },
      payload: {
        systemPrompt:
          "Analyze only explicitly supplied product records. Separate facts, inferences, recommendations, risks, and missing information. Human review is required.",
        toolPolicy: { readOnly: true, humanApprovalForSideEffects: true },
        dataScopes: ["products"],
      },
    });
    expect(promptResponse.statusCode).toBe(201);
    const opportunityResponse = await app.inject({
      method: "POST",
      url: "/api/v1/opportunities",
      headers: { cookie: firstCookie },
      payload: { title: "Scope-restricted opportunity", status: "new", currency: "CNY" },
    });
    const productResponse = await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: { cookie: firstCookie },
      payload: {
        name: "Scope-allowed product",
        category: "online_education",
        stage: "validation",
        status: "on_track",
      },
    });
    expect(opportunityResponse.statusCode).toBe(201);
    expect(productResponse.statusCode).toBe(201);
    const opportunity = body(opportunityResponse).data as JsonObject;
    const product = body(productResponse).data as JsonObject;

    const restrictedRun = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "market_opportunity",
        question: "Analyze a scope excluded opportunity",
        context: [{ resourceType: "opportunities", resourceId: opportunity.id }],
      },
    });
    expect(restrictedRun.statusCode).toBe(403);
    const allowedRun = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "market_opportunity",
        question: "Analyze the allowed product",
        context: [{ resourceType: "products", resourceId: product.id }],
      },
    });
    expect(allowedRun.statusCode).toBe(201);
  });

  it("hides advisor history when the role lacks advisor or context data permission", async () => {
    const rolesResponse = await app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: { cookie: firstCookie },
    });
    const viewerRole = (body(rolesResponse).data as JsonObject[]).find(
      (role) => role.systemKey === "viewer",
    );
    if (!viewerRole) throw new Error("Viewer role not found");
    const viewerEmail = `viewer-${suffix}@example.test`;
    const viewerPassword = "viewer-password-long-enough";
    const userResponse = await app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie: firstCookie },
      payload: {
        email: viewerEmail,
        displayName: "Restricted Viewer",
        password: viewerPassword,
        roleId: viewerRole.id,
      },
    });
    expect(userResponse.statusCode).toBe(201);
    const userResult = body(userResponse).data as { approval: JsonObject };
    const approvalResponse = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${String(userResult.approval.id)}/approve`,
      headers: { cookie: firstCookie },
      payload: {
        comment: "Approve restricted viewer role",
        acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED",
      },
    });
    expect(approvalResponse.statusCode).toBe(200);

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
      "viewer-replacement-password-long-enough",
    );

    const financeRecordResponse = await app.inject({
      method: "POST",
      url: "/api/v1/financial-entries",
      headers: { cookie: firstCookie },
      payload: {
        occurredAt: "2026-07-18T12:00",
        type: "expense",
        category: "test",
        description: "Restricted finance context",
        amountCents: 10_000,
        currency: "CNY",
        status: "draft",
      },
    });
    expect(financeRecordResponse.statusCode).toBe(201);
    const financeRecord = body(financeRecordResponse).data as JsonObject;

    const financeRunResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: { advisor: "finance", question: "Restricted finance run", context: [] },
    });
    const managerRunResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "general_manager",
        question: "Restricted context run",
        context: [{ resourceType: "financial-entries", resourceId: financeRecord.id }],
      },
    });
    expect(financeRunResponse.statusCode).toBe(201);
    expect(managerRunResponse.statusCode).toBe(201);
    const privateManagerRunResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: firstCookie },
      payload: {
        advisor: "general_manager",
        question: "Private management notes without record context",
        context: [],
      },
    });
    expect(privateManagerRunResponse.statusCode).toBe(201);
    const financeRun = body(financeRunResponse).data as JsonObject;
    const managerRun = body(managerRunResponse).data as JsonObject;
    const privateManagerRun = body(privateManagerRunResponse).data as JsonObject;

    const viewerList = await app.inject({
      method: "GET",
      url: "/api/v1/advisor-runs?pageSize=100",
      headers: { cookie: viewerCookie },
    });
    expect(viewerList.statusCode).toBe(200);
    const visibleIds = (body(viewerList).data as JsonObject[]).map((run) => run.id);
    expect(visibleIds).not.toContain(financeRun.id);
    expect(visibleIds).not.toContain(managerRun.id);
    expect(visibleIds).not.toContain(privateManagerRun.id);

    for (const run of [financeRun, managerRun, privateManagerRun]) {
      const detail = await app.inject({
        method: "GET",
        url: `/api/v1/advisor-runs/${String(run.id)}`,
        headers: { cookie: viewerCookie },
      });
      expect(detail.statusCode).toBe(404);
    }

    config.GITHUB_INTEGRATION_MODE = "read_only";
    try {
      const forbiddenRefresh = await app.inject({
        method: "POST",
        url: `/api/v1/github-insights/${randomUUID()}/refresh`,
        headers: { cookie: viewerCookie },
      });
      expect(forbiddenRefresh.statusCode).toBe(403);
    } finally {
      config.GITHUB_INTEGRATION_MODE = "manual";
    }
  });

  it("changes the authenticated password, preserves the current session, and revokes others", async () => {
    const originalPassword = "correct-horse-battery-staple-1";
    const newPassword = "rotated-owner-password-long-enough";
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `first-${suffix}@example.test`, password: originalPassword },
    });
    expect(secondLogin.statusCode).toBe(200);
    const otherCookie = cookie(secondLogin);

    const wrongCurrentPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: { cookie: firstCookie },
      payload: { currentPassword: "incorrect-current-password", newPassword },
    });
    expect(wrongCurrentPassword.statusCode).toBe(401);

    const changed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      headers: { cookie: firstCookie },
      payload: { currentPassword: originalPassword, newPassword },
    });
    expect(changed.statusCode).toBe(200);
    expect(body(changed).data).toMatchObject({ changed: true, revokedOtherSessions: 1 });

    const currentSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: firstCookie },
    });
    const revokedSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: otherCookie },
    });
    expect(currentSession.statusCode).toBe(200);
    expect(revokedSession.statusCode).toBe(401);

    const oldPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `first-${suffix}@example.test`, password: originalPassword },
    });
    const newPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `first-${suffix}@example.test`, password: newPassword },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);
    expect(newPasswordLogin.statusCode).toBe(200);

    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, firstUserId),
          eq(auditEvents.action, "password_change"),
        ),
      )
      .limit(1);
    expect(audit).toMatchObject({
      actorUserId: firstUserId,
      resourceType: "user",
      after: { passwordChanged: true, revokedOtherSessionCount: 1 },
    });
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain(originalPassword);
    expect(serializedAudit).not.toContain(newPassword);
  });

  it("audits session row ids without retaining the raw JWT session id", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `first-${suffix}@example.test`,
        password: "rotated-owner-password-long-enough",
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    const sessionCookie = cookie(login);
    const token = sessionCookie.split("=", 2)[1];
    const payloadSegment = token?.split(".", 3)[1];
    if (!payloadSegment) throw new Error("Login cookie did not contain a JWT payload");
    const jwtPayload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as {
      sid: string;
    };
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: sessionCookie },
    });
    expect(logout.statusCode, logout.body).toBe(200);
    const sessionAudits = (
      await dbHandle.db.select().from(auditEvents).where(eq(auditEvents.actorUserId, firstUserId))
    ).filter(
      (event) => event.resourceType === "session" && ["login", "logout"].includes(event.action),
    );
    expect(sessionAudits.some((event) => event.action === "login")).toBe(true);
    expect(sessionAudits.some((event) => event.action === "logout")).toBe(true);
    expect(JSON.stringify(sessionAudits)).not.toContain(jwtPayload.sid);
  });
});
