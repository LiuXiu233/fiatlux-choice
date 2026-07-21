import { randomUUID } from "node:crypto";
import {
  auditEvents,
  complianceItems,
  complianceSourceSnapshots,
  createDatabase,
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

describe.skipIf(!databaseUrl)("compliance monitor API PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  let config: ApiConfig;
  let firstCookie: string;
  let secondCookie: string;
  let firstOrgId: string;
  let secondOrgId: string;
  let sourceId: string;
  let failureSourceId: string;
  const jobs: Array<{ name: string; data: unknown; id: string }> = [];

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const firstPassword = "correct-horse-battery-staple-monitor-api-one";
    const secondPassword = "correct-horse-battery-staple-monitor-api-two";
    const firstEmail = `monitor-api-one-${suffix}@example.test`;
    const secondEmail = `monitor-api-two-${suffix}@example.test`;
    const first = await seedDatabase(dbHandle.db, {
      organizationName: "Monitor API One",
      organizationSlug: `monitor-api-one-${suffix}`,
      adminEmail: firstEmail,
      adminDisplayName: "Monitor API Owner",
      adminPassword: firstPassword,
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/monitor-api-one.json",
    });
    const second = await seedDatabase(dbHandle.db, {
      organizationName: "Monitor API Two",
      organizationSlug: `monitor-api-two-${suffix}`,
      adminEmail: secondEmail,
      adminDisplayName: "Second Monitor API Owner",
      adminPassword: secondPassword,
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/monitor-api-two.json",
    });
    firstOrgId = first.organization.id;
    secondOrgId = second.organization.id;
    const [source, failureSource, pendingSource] = await dbHandle.db
      .insert(complianceItems)
      .values([
        {
          orgId: firstOrgId,
          title: "API 监控来源",
          category: "company_governance",
          issuingAuthority: "国务院",
          sourceUrl: "https://www.gov.cn/policy",
          contentHashStatus: "changed",
          reviewStatus: "stale",
          nextMonitorAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        {
          orgId: firstOrgId,
          title: "API 队列失败来源",
          category: "data_security",
          issuingAuthority: "国务院",
          sourceUrl: "https://www.gov.cn/queue-failure",
          contentHashStatus: "failed",
          monitoringFailureCount: 3,
          reviewStatus: "reviewed",
          nextReviewAt: new Date("2020-01-01T00:00:00.000Z"),
          nextMonitorAt: new Date("2035-01-01T00:00:00.000Z"),
        },
        {
          orgId: firstOrgId,
          title: "API 首次待抓取来源",
          category: "tax_invoice",
          issuingAuthority: "国家税务总局",
          sourceUrl: "https://www.chinatax.gov.cn/pending-fetch",
          nextMonitorAt: new Date("2020-02-01T00:00:00.000Z"),
          monitoringLeaseToken: `monitor-status-lease-${suffix}`,
          monitoringLeaseUntil: new Date("2035-02-01T00:00:00.000Z"),
          monitoringJobId: `monitor-status-job-${suffix}`,
        },
      ])
      .returning();
    if (!source || !failureSource || !pendingSource)
      throw new Error("Failed to create compliance sources");
    sourceId = source.id;
    failureSourceId = failureSource.id;
    await dbHandle.db.insert(complianceItems).values({
      orgId: secondOrgId,
      title: "其他组织监控来源",
      category: "company_governance",
      issuingAuthority: "国务院",
      sourceUrl: "https://www.gov.cn/other-organization-monitoring-status",
      nextMonitorAt: new Date("2019-01-01T00:00:00.000Z"),
    });
    await dbHandle.db.insert(complianceItems).values({
      orgId: firstOrgId,
      title: "已归档来源不应进入监控汇总",
      category: "company_governance",
      issuingAuthority: "国务院",
      sourceUrl: "https://www.gov.cn/archived-monitoring-status",
      nextMonitorAt: new Date("2018-01-01T00:00:00.000Z"),
      archivedAt: new Date("2026-07-19T00:00:00.000Z"),
    });
    await dbHandle.db.insert(auditEvents).values([
      {
        orgId: firstOrgId,
        actorUserId: null,
        action: "monitor_dispatch",
        resourceType: "compliance-source-monitor",
        resourceId: firstOrgId,
        requestId: `monitor-status-first-${suffix}`,
        metadata: {
          actorType: "system",
          batchLimit: 12,
          dueCount: 3,
          queuedCount: 2,
          hasMoreDue: true,
        },
        createdAt: new Date("2026-07-19T18:30:00.000Z"),
      },
      {
        orgId: secondOrgId,
        actorUserId: null,
        action: "monitor_dispatch",
        resourceType: "compliance-source-monitor",
        resourceId: secondOrgId,
        requestId: `monitor-status-second-${suffix}`,
        metadata: {
          actorType: "system",
          batchLimit: 99,
          dueCount: 1,
          queuedCount: 1,
          hasMoreDue: false,
        },
        createdAt: new Date("2026-07-19T19:30:00.000Z"),
      },
    ]);
    config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: "compliance-monitor-integration-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = {
      send: async (name: string, data: unknown) => {
        const id = randomUUID();
        jobs.push({ name, data, id });
        return id;
      },
      healthCheck: async () => undefined,
    } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue,
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

  it("summarizes monitoring workload without crossing organization boundaries", async () => {
    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/v1/compliance-items/monitoring-status",
    });
    expect(unauthorized.statusCode).toBe(401);

    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/v1/compliance-items/monitoring-status",
      headers: { cookie: firstCookie },
    });
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    expect(body(firstResponse).data).toMatchObject({
      sourceCount: 3,
      dueAvailableCount: 1,
      inFlightCount: 1,
      pendingFetchCount: 1,
      failedCount: 1,
      changedCount: 1,
      staleReviewCount: 1,
      overdueReviewCount: 1,
      oldestDueAt: "2020-01-01T00:00:00.000Z",
      nextFutureMonitorAt: "2035-01-01T00:00:00.000Z",
      latestDispatch: {
        occurredAt: "2026-07-19T18:30:00.000Z",
        batchLimit: 12,
        dueCount: 3,
        queuedCount: 2,
        hasMoreDue: true,
      },
    });
    expect(Date.parse(String((body(firstResponse).data as JsonObject).generatedAt))).not.toBeNaN();

    const secondResponse = await app.inject({
      method: "GET",
      url: "/api/v1/compliance-items/monitoring-status",
      headers: { cookie: secondCookie },
    });
    expect(secondResponse.statusCode, secondResponse.body).toBe(200);
    expect(body(secondResponse).data).toMatchObject({
      sourceCount: 1,
      dueAvailableCount: 1,
      failedCount: 0,
      changedCount: 0,
      latestDispatch: {
        occurredAt: "2026-07-19T19:30:00.000Z",
        batchLimit: 99,
        dueCount: 1,
        queuedCount: 1,
        hasMoreDue: false,
      },
    });

    await dbHandle.db.insert(auditEvents).values({
      orgId: firstOrgId,
      actorUserId: null,
      action: "monitor_dispatch",
      resourceType: "compliance-source-monitor",
      resourceId: firstOrgId,
      requestId: `monitor-status-invalid-${randomUUID()}`,
      metadata: {
        actorType: "system",
        batchLimit: 12,
        dueCount: 1,
        queuedCount: 2,
        hasMoreDue: false,
      },
      createdAt: new Date(Date.now() + 60_000),
    });
    const invalidHistoryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/compliance-items/monitoring-status",
      headers: { cookie: firstCookie },
    });
    expect(invalidHistoryResponse.statusCode, invalidHistoryResponse.body).toBe(200);
    expect((body(invalidHistoryResponse).data as JsonObject).latestDispatch).toBeNull();
  });

  it("queues an organization-scoped manual check and records actor audit events", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/monitor`,
      payload: {},
    });
    expect(unauthorized.statusCode).toBe(401);

    const crossTenant = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/monitor`,
      headers: { cookie: secondCookie },
      payload: { reason: "不应跨组织访问" },
    });
    expect(crossTenant.statusCode).toBe(404);
    expect(jobs).toHaveLength(0);

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/monitor`,
      headers: { cookie: firstCookie },
      payload: { reason: "法规复核前人工检查" },
    });
    expect(queued.statusCode).toBe(202);
    expect(body(queued).data).toMatchObject({ sourceId, status: "queued" });
    expect(jobs).toEqual([
      expect.objectContaining({
        name: "compliance-source.monitor",
        data: expect.objectContaining({ orgId: firstOrgId, sourceId }),
      }),
    ]);
    const audits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, firstOrgId), eq(auditEvents.resourceId, sourceId)));
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["monitor_request", "monitor_dispatch"]),
    );
    expect(audits.find((audit) => audit.action === "monitor_request")?.metadata).toMatchObject({
      reason: "法规复核前人工检查",
      sourceHost: "www.gov.cn",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/compliance-items/${sourceId}/monitor`,
      headers: { cookie: firstCookie },
      payload: { reason: "重复点击应复用在途任务" },
    });
    expect(duplicate.statusCode).toBe(202);
    expect((body(duplicate).data as JsonObject).jobId).toBe(
      (body(queued).data as JsonObject).jobId,
    );
    expect(jobs).toHaveLength(1);
    const [deduplicated] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, sourceId),
          eq(auditEvents.action, "monitor_deduplicated"),
        ),
      );
    expect(deduplicated).toBeDefined();
  });

  it("lists detailed snapshots newest first and refuses cross-organization reads", async () => {
    await dbHandle.db.insert(complianceSourceSnapshots).values([
      {
        orgId: firstOrgId,
        sourceId,
        requestedUrl: "https://www.gov.cn/policy",
        finalUrl: "https://www.gov.cn/policy-v1",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        sizeBytes: 128,
        rawHash: "1".repeat(64),
        normalizedHash: "2".repeat(64),
        previousContentHash: null,
        normalizedExcerpt: "第一版官方正文摘录",
        changed: false,
        notModified: false,
        fetcherVersion: "integration-v1",
        fetchedAt: new Date("2026-07-17T00:00:00.000Z"),
      },
      {
        orgId: firstOrgId,
        sourceId,
        requestedUrl: "https://www.gov.cn/policy",
        finalUrl: "https://www.gov.cn/policy-v2",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        sizeBytes: 256,
        rawHash: "3".repeat(64),
        normalizedHash: "4".repeat(64),
        previousContentHash: "2".repeat(64),
        normalizedExcerpt: "第二版发生变化的官方正文摘录",
        changed: true,
        notModified: false,
        fetcherVersion: "integration-v1",
        fetchedAt: new Date("2026-07-18T00:00:00.000Z"),
      },
    ]);

    const crossTenant = await app.inject({
      method: "GET",
      url: `/api/v1/compliance-items/${sourceId}/snapshots`,
      headers: { cookie: secondCookie },
    });
    expect(crossTenant.statusCode).toBe(404);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/compliance-items/${sourceId}/snapshots?page=1&pageSize=1`,
      headers: { cookie: firstCookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(body(response).meta).toMatchObject({ page: 1, pageSize: 1, total: 2, pageCount: 2 });
    expect(body(response).data).toEqual([
      expect.objectContaining({
        sourceId,
        finalUrl: "https://www.gov.cn/policy-v2",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        sizeBytes: 256,
        normalizedHash: "4".repeat(64),
        previousContentHash: "2".repeat(64),
        normalizedExcerpt: "第二版发生变化的官方正文摘录",
        changed: true,
      }),
    ]);
  });

  it("returns a real failure and audits a redacted queue error", async () => {
    const failingApp = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue: {
        healthCheck: async () => undefined,
        send: async () => {
          throw new Error(
            "queue unavailable password=definitely-sensitive-monitor-queue-placeholder",
          );
        },
      } as unknown as JobQueue,
    });
    try {
      const response = await failingApp.inject({
        method: "POST",
        url: `/api/v1/compliance-items/${failureSourceId}/monitor`,
        headers: { cookie: firstCookie },
        payload: {},
      });
      expect(response.statusCode).toBe(503);
      expect(body(response).error).toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
      const failureAudits = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, firstOrgId),
            eq(auditEvents.resourceId, failureSourceId),
            eq(auditEvents.action, "monitor_dispatch_fail"),
          ),
        );
      expect(failureAudits.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(failureAudits);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).not.toContain("definitely-sensitive-monitor-queue-placeholder");
    } finally {
      await failingApp.close();
    }
  });
});
