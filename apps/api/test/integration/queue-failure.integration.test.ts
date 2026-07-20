import { createHash } from "node:crypto";
import {
  advisorRuns,
  auditEvents,
  backups,
  createDatabase,
  githubInsights,
  integrationChecks,
  notifications,
  workflowRuns,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage, type ObjectStorage } from "@fiatlux/integrations";
import { and, desc, eq } from "drizzle-orm";
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

describe.skipIf(!databaseUrl)("API queue dispatch failure integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let config: ApiConfig;
  let orgId: string;
  let userId: string;
  let email: string;
  let password: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = Math.random().toString(36).slice(2, 10);
    email = `queue-failure-${suffix}@example.test`;
    password = "correct-horse-battery-staple-queue";
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Queue Failure Company",
      organizationSlug: `queue-failure-${suffix}`,
      adminEmail: email,
      adminDisplayName: "Queue Failure Owner",
      adminPassword: password,
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  async function build(
    queue?: JobQueue,
    options: { appConfig?: ApiConfig; storage?: ObjectStorage } = {},
  ) {
    return buildApp({
      config: options.appConfig ?? config,
      db: dbHandle.db,
      storage: options.storage ?? new MemoryObjectStorage(),
      ...(queue ? { queue } : {}),
    });
  }

  async function login(app: FastifyInstance) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return cookie(response);
  }

  async function createWorkflowDefinition(app: FastifyInstance, sessionCookie: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workflow-definitions",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Queue failure workflow",
        trigger: `queue.failure.${Date.now()}`,
        steps: [
          {
            type: "notify",
            config: { recipientId: userId, title: "Workflow notice", body: "Workflow body" },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    return String((body(response).data as JsonObject).id);
  }

  async function exerciseFailures(app: FastifyInstance, sessionCookie: string) {
    const definitionId = await createWorkflowDefinition(app, sessionCookie);
    const workflowResponse = await app.inject({
      method: "POST",
      url: "/api/v1/workflow-runs",
      headers: { cookie: sessionCookie },
      payload: { definitionId, input: {} },
    });
    expect(workflowResponse.statusCode).toBe(503);
    expect(body(workflowResponse).error).toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    const workflowId = String((body(workflowResponse).data as JsonObject | undefined)?.id ?? "");

    const notificationResponse = await app.inject({
      method: "POST",
      url: "/api/v1/notifications",
      headers: { cookie: sessionCookie },
      payload: { recipientId: userId, title: "Direct notice", body: "Direct body" },
    });
    expect(notificationResponse.statusCode).toBe(503);
    expect(body(notificationResponse).error).toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    const notificationId = String(
      (body(notificationResponse).data as JsonObject | undefined)?.id ?? "",
    );

    const advisorResponse = await app.inject({
      method: "POST",
      url: "/api/v1/advisor-runs",
      headers: { cookie: sessionCookie },
      payload: { advisor: "finance", question: "Queue failure test", context: [] },
    });
    expect(advisorResponse.statusCode).toBe(503);
    expect(body(advisorResponse).error).toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    const advisorId = String((body(advisorResponse).data as JsonObject | undefined)?.id ?? "");

    // The failed responses intentionally do not return resource bodies. Locate the
    // newest rows for this test through their distinctive fields and assert status.
    const [workflow] = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.orgId, orgId), eq(workflowRuns.definitionId, definitionId)))
      .orderBy(desc(workflowRuns.createdAt))
      .limit(1);
    const [notification] = await dbHandle.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), eq(notifications.title, "Direct notice")))
      .orderBy(desc(notifications.createdAt))
      .limit(1);
    const [advisor] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(and(eq(advisorRuns.orgId, orgId), eq(advisorRuns.question, "Queue failure test")))
      .orderBy(desc(advisorRuns.createdAt))
      .limit(1);
    expect(workflow?.status).toBe("failed");
    expect(workflow?.definitionVersion).toBe(1);
    expect(workflow?.stepsSnapshot).toEqual([
      {
        type: "notify",
        config: {
          recipientId: userId,
          title: "Workflow notice",
          body: "Workflow body",
          channel: "in_app",
          status: "queued",
        },
      },
    ]);
    expect(notification?.status).toBe("failed");
    expect(advisor?.status).toBe("failed");
    expect(workflow?.error).toBeTruthy();
    expect(notification?.failureReason).toBeTruthy();
    expect(advisor?.error).toBeTruthy();
    return {
      workflowId,
      notificationId,
      advisorId,
      workflow,
      notification,
      advisor,
    };
  }

  it("marks all created jobs failed when the queue is unavailable", async () => {
    const app = await build();
    try {
      const sessionCookie = await login(app);
      const result = await exerciseFailures(app, sessionCookie);
      expect(result.workflow?.error).toBe("Background queue is unavailable");
      expect(result.notification?.failureReason).toBe("Background queue is unavailable");
      expect(result.advisor?.error).toBe("Background queue is unavailable");
      const [queueFailAudit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, orgId),
            eq(auditEvents.action, "queue_fail"),
            eq(auditEvents.resourceId, result.advisor?.id ?? ""),
          ),
        )
        .limit(1);
      expect(queueFailAudit?.resourceType).toBe("advisor-run");
    } finally {
      await app.close();
    }
  });

  it("marks all created jobs failed and redacts queue errors when dispatch throws", async () => {
    const leakedToken = `fixture-${Math.random().toString(36).slice(2)}-${"x".repeat(16)}`;
    const leakedPassword = `fixture-${Math.random().toString(36).slice(2)}-${"y".repeat(16)}`;
    const leakedUrlPassword = `fixture-${Math.random().toString(36).slice(2)}-${"u".repeat(16)}`;
    const leakedQuerySecret = `fixture-${Math.random().toString(36).slice(2)}-${"q".repeat(16)}`;
    const tokenLabel = ["to", "ken"].join("");
    const passwordLabel = ["pass", "word"].join("");
    const queue = {
      send: async () => {
        throw new Error(
          `${tokenLabel}=${leakedToken} ${passwordLabel}:${leakedPassword} ` +
            `postgresql://runtime:${leakedUrlPassword}@db.internal/app ` +
            `https://queue.test/send?token=${leakedQuerySecret}`,
        );
      },
    } as unknown as JobQueue;
    const app = await build(queue);
    try {
      const sessionCookie = await login(app);
      const result = await exerciseFailures(app, sessionCookie);
      const backupName = `Queue dispatch failure ${Math.random().toString(36).slice(2)}`;
      const backupResponse = await app.inject({
        method: "POST",
        url: "/api/v1/backups",
        headers: { cookie: sessionCookie },
        payload: { name: backupName, scope: "database" },
      });
      expect(backupResponse.statusCode).toBe(503);
      const [failedBackup] = await dbHandle.db
        .select()
        .from(backups)
        .where(and(eq(backups.orgId, orgId), eq(backups.name, backupName)))
        .limit(1);
      expect(failedBackup).toMatchObject({ status: "failed" });
      const secrets = [leakedToken, leakedPassword, leakedUrlPassword, leakedQuerySecret];
      for (const value of [
        result.workflow?.error,
        result.notification?.failureReason,
        result.advisor?.error,
        failedBackup?.error,
      ]) {
        for (const secret of secrets) expect(value).not.toContain(secret);
        expect(String(value).length).toBeLessThanOrEqual(500);
      }
      const [queueFailAudit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, orgId),
            eq(auditEvents.action, "queue_fail"),
            eq(auditEvents.resourceId, result.advisor?.id ?? ""),
          ),
        )
        .limit(1);
      for (const secret of secrets) expect(JSON.stringify(queueFailAudit)).not.toContain(secret);
      const backupAudits = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, orgId),
            eq(auditEvents.resourceType, "backup"),
            eq(auditEvents.resourceId, failedBackup?.id ?? ""),
          ),
        );
      for (const secret of secrets) expect(JSON.stringify(backupAudits)).not.toContain(secret);
    } finally {
      await app.close();
    }
  });

  it("redacts worker-only integration probe dispatch failures before persistence and audit", async () => {
    const leakedBasic = `basic-${Math.random().toString(36).slice(2)}-${"b".repeat(16)}`;
    const leakedUrlPassword = `url-${Math.random().toString(36).slice(2)}-${"u".repeat(16)}`;
    const queue = {
      send: async () => {
        throw new Error(
          `Authorization: Basic ${leakedBasic} redis://:${leakedUrlPassword}@cache.internal/0`,
        );
      },
    } as unknown as JobQueue;
    const app = await build(queue, {
      appConfig: {
        ...config,
        LLM_DRIVER: "compatible",
        LLM_BASE_URL: "https://llm.example.test",
      },
    });
    try {
      const sessionCookie = await login(app);
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/settings/integrations/llm/test",
        headers: { cookie: sessionCookie },
      });
      expect(response.statusCode, response.body).toBe(503);
      const [check] = await dbHandle.db
        .select()
        .from(integrationChecks)
        .where(and(eq(integrationChecks.orgId, orgId), eq(integrationChecks.integrationId, "llm")))
        .orderBy(desc(integrationChecks.createdAt))
        .limit(1);
      expect(check).toMatchObject({ status: "unhealthy" });
      const [audit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, orgId),
            eq(auditEvents.resourceType, "integration"),
            eq(auditEvents.resourceId, "llm"),
          ),
        )
        .orderBy(desc(auditEvents.createdAt))
        .limit(1);
      for (const secret of [leakedBasic, leakedUrlPassword]) {
        expect(response.body).not.toContain(secret);
        expect(JSON.stringify(check)).not.toContain(secret);
        expect(JSON.stringify(audit)).not.toContain(secret);
      }
      expect(check?.detail).toContain("[REDACTED]");
      expect(audit?.action).toBe("queue_test_fail");
    } finally {
      await app.close();
    }
  });

  it("redacts object-storage adapter failures returned by file upload", async () => {
    const leakedToken = `storage-${Math.random().toString(36).slice(2)}-${"s".repeat(16)}`;
    const storage = new MemoryObjectStorage();
    storage.putVerified = async () => {
      throw new Error(`Authorization: Bearer ${leakedToken}`);
    };
    const app = await build(undefined, { storage });
    try {
      const sessionCookie = await login(app);
      const content = Buffer.from("adapter failure evidence");
      const metadataResponse = await app.inject({
        method: "POST",
        url: "/api/v1/files",
        headers: { cookie: sessionCookie },
        payload: {
          filename: "adapter-failure.txt",
          contentType: "text/plain",
          sizeBytes: content.byteLength,
          checksumSha256: createHash("sha256").update(content).digest("hex"),
          classification: "confidential",
        },
      });
      expect(metadataResponse.statusCode, metadataResponse.body).toBe(201);
      const metadata = body(metadataResponse).data as { upload: JsonObject };
      const uploadResponse = await app.inject({
        method: "PUT",
        url: String(metadata.upload.uploadUrl),
        headers: {
          cookie: sessionCookie,
          "content-type": "application/octet-stream",
          "content-length": String(content.byteLength),
        },
        payload: content,
      });
      expect(uploadResponse.statusCode, uploadResponse.body).toBe(400);
      expect(uploadResponse.body).not.toContain(leakedToken);
      expect(uploadResponse.body).toContain("[REDACTED]");
    } finally {
      await app.close();
    }
  });

  it("redacts GitHub refresh dispatch failures before response or audit", async () => {
    const leakedToken = `github-queue-${Math.random().toString(36).slice(2)}-${"g".repeat(16)}`;
    const [insight] = await dbHandle.db
      .insert(githubInsights)
      .values({
        orgId,
        repository: "owner/queue-failure-test",
        kind: "repository",
        summary: "Awaiting refresh",
        url: "https://github.com/owner/queue-failure-test",
        capturedAt: new Date(0),
        payload: {},
      })
      .returning();
    if (!insight) throw new Error("Failed to create GitHub queue failure fixture");
    const queue = {
      send: async () => {
        throw new Error(`Authorization: Bearer ${leakedToken}`);
      },
    } as unknown as JobQueue;
    const app = await build(queue, {
      appConfig: { ...config, GITHUB_INTEGRATION_MODE: "read_only" },
    });
    try {
      const sessionCookie = await login(app);
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/github-insights/${insight.id}/refresh`,
        headers: { cookie: sessionCookie },
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.body).not.toContain(leakedToken);
      const [audit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, orgId),
            eq(auditEvents.resourceId, insight.id),
            eq(auditEvents.action, "queue_refresh_fail"),
          ),
        )
        .limit(1);
      expect(JSON.stringify(audit)).not.toContain(leakedToken);
      expect(audit?.metadata).toMatchObject({ error: expect.stringContaining("[REDACTED]") });
    } finally {
      await app.close();
    }
  });
});
