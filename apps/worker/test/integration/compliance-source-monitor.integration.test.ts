import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  auditEvents,
  complianceItems,
  complianceSourceSnapshots,
  createDatabase,
  tasks,
} from "@fiatlux/db";
import { importOfficialComplianceSources, seedDatabase } from "@fiatlux/db/seed";
import type {
  GitHubReader,
  JobQueue,
  LlmProvider,
  OfficialSourceFetcher,
  OfficialSourceSnapshot,
} from "@fiatlux/integrations";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import { handleComplianceSourceMonitor, type WorkerDependencies } from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

function snapshot(hash: string): OfficialSourceSnapshot {
  return {
    requestedUrl: "https://www.gov.cn/policy",
    finalUrl: "https://www.gov.cn/policy/current",
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    sizeBytes: 128,
    etag: `"${hash.slice(0, 8)}"`,
    lastModified: "Sat, 18 Jul 2026 00:00:00 GMT",
    rawHash: hash,
    normalizedHash: hash,
    normalizedExcerpt: "官方政策正文摘录",
    notModified: false,
    fetcherVersion: "integration-test-fetcher-v1",
  };
}

describe.skipIf(!databaseUrl)("compliance source monitoring PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let firstOrgId: string;
  let secondOrgId: string;
  let firstUserId: string;
  const queuedJobs: Array<{ name: string; data: unknown }> = [];

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const first = await seedDatabase(dbHandle.db, {
      organizationName: "Compliance Monitor One",
      organizationSlug: `compliance-monitor-one-${randomUUID().slice(0, 8)}`,
      adminEmail: `compliance-monitor-one-${randomUUID().slice(0, 8)}@example.test`,
      adminDisplayName: "Compliance Monitor Owner",
      adminPassword: "correct-horse-battery-staple-compliance-one",
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/compliance-monitor-one.json",
    });
    const second = await seedDatabase(dbHandle.db, {
      organizationName: "Compliance Monitor Two",
      organizationSlug: `compliance-monitor-two-${randomUUID().slice(0, 8)}`,
      adminEmail: `compliance-monitor-two-${randomUUID().slice(0, 8)}@example.test`,
      adminDisplayName: "Second Compliance Owner",
      adminPassword: "correct-horse-battery-staple-compliance-two",
      adminMustChangePassword: false,
      complianceSourcesFile: "/nonexistent/compliance-monitor-two.json",
    });
    firstOrgId = first.organization.id;
    secondOrgId = second.organization.id;
    firstUserId = first.user.id;
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  function dependencies(officialSource: OfficialSourceFetcher): WorkerDependencies {
    return {
      db: dbHandle.db,
      queue: {
        send: async (name: string, data: unknown) => {
          queuedJobs.push({ name, data });
          return randomUUID();
        },
      } as unknown as JobQueue,
      llmProvider: {} as LlmProvider,
      github: {} as GitHubReader,
      officialSource,
      config: workerConfigSchema.parse({ DATABASE_URL: testDatabaseUrl }),
    };
  }

  async function complianceEscalations(sourceId: string, escalationReason: string) {
    const taskAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.action, "create"),
          eq(auditEvents.resourceType, "task"),
        ),
      );
    const audits = taskAudits.filter((audit) => {
      const metadata = audit.metadata as Record<string, unknown> | null;
      return (
        metadata?.complianceSourceId === sourceId && metadata.escalationReason === escalationReason
      );
    });
    const records = audits.length
      ? await dbHandle.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, firstOrgId),
              inArray(
                tasks.id,
                audits.map((audit) => audit.resourceId),
              ),
            ),
          )
      : [];
    return { audits, records };
  }

  it("imports JSON freshness and next-review metadata into PostgreSQL", async () => {
    const result = await importOfficialComplianceSources(
      dbHandle.db,
      firstOrgId,
      fileURLToPath(new URL("../fixtures/official-source.json", import.meta.url)),
    );
    expect(result).toMatchObject({ imported: 1, skipped: 0, missing: false });
    const [imported] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.orgId, firstOrgId),
          eq(complianceItems.sourceUrl, "https://www.gov.cn/integration-fixture"),
        ),
      );
    expect(imported).toMatchObject({
      contentHashStatus: "pending_fetch",
      monitoringCadenceDays: 90,
    });
    expect(imported?.nextReviewAt?.toISOString()).toBe("2027-01-17T16:00:00.000Z");
  });

  it("persists append-only hashes and makes a changed source stale without crossing tenants", async () => {
    const firstHash = "a".repeat(64);
    const changedHash = "b".repeat(64);
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "受监控官方来源",
        category: "tax_invoice",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/policy",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(),
        monitoringCadenceDays: 7,
      })
      .returning();
    if (!source) throw new Error("Failed to create compliance source");

    const fetch = vi
      .fn<OfficialSourceFetcher["fetch"]>()
      .mockResolvedValueOnce(snapshot(firstHash))
      .mockResolvedValueOnce(snapshot(changedHash))
      .mockResolvedValueOnce(snapshot(changedHash));
    const deps = dependencies({ fetch });

    await handleComplianceSourceMonitor(deps, {
      orgId: secondOrgId,
      sourceId: source.id,
      requestedBy: firstUserId,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await complianceEscalations(source.id, "content_changed")).records).toHaveLength(0);

    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
      requestedBy: firstUserId,
    });
    const [initial] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(and(eq(complianceItems.id, source.id), eq(complianceItems.orgId, firstOrgId)));
    expect(initial).toMatchObject({
      contentHash: firstHash,
      rawSnapshotHash: firstHash,
      contentHashStatus: "current",
      reviewStatus: "reviewed",
      status: "active",
      monitoringFailureCount: 0,
    });

    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
      requestedBy: firstUserId,
    });
    const [changed] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.id, source.id));
    expect(changed).toMatchObject({
      contentHash: changedHash,
      contentHashStatus: "changed",
      reviewStatus: "stale",
      status: "uncertain",
      lastMonitoringError: null,
    });
    expect(changed?.nextMonitorAt.getTime()).toBeGreaterThan(Date.now());

    const snapshots = await dbHandle.db
      .select()
      .from(complianceSourceSnapshots)
      .where(
        and(
          eq(complianceSourceSnapshots.orgId, firstOrgId),
          eq(complianceSourceSnapshots.sourceId, source.id),
        ),
      );
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({
      previousContentHash: firstHash,
      normalizedHash: changedHash,
      changed: true,
      normalizedExcerpt: "官方政策正文摘录",
    });
    const [changeAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, source.id),
          eq(auditEvents.action, "monitor_change_detected"),
        ),
      );
    expect(changeAudit?.metadata).toMatchObject({
      actorType: "system",
      initiatedBy: firstUserId,
      trigger: "manual",
      finalHost: "www.gov.cn",
    });
    const changeEscalation = await complianceEscalations(source.id, "content_changed");
    expect(changeEscalation.audits).toHaveLength(1);
    expect(changeEscalation.records).toHaveLength(1);
    expect(changeEscalation.records[0]).toMatchObject({
      orgId: firstOrgId,
      status: "todo",
      priority: "high",
      assigneeId: null,
    });
    expect(changeEscalation.records[0]?.title).toContain("官方正文哈希发生变化");
    expect(changeEscalation.records[0]?.description).toContain(`来源 ID：${source.id}`);
    expect(changeEscalation.records[0]?.description).toContain("国务院");
    expect(changeEscalation.audits[0]?.metadata).toMatchObject({
      actorType: "system",
      trigger: "compliance_source_monitor",
      complianceSourceId: source.id,
      escalationReason: "content_changed",
      initiatedBy: firstUserId,
    });
    expect(changeAudit?.metadata).toMatchObject({
      escalationTaskId: changeEscalation.records[0]?.id,
    });

    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
      requestedBy: firstUserId,
    });
    expect((await complianceEscalations(source.id, "content_changed")).records).toHaveLength(1);
  });

  it("redacts failures, retains the last good hash and requires review after three attempts", async () => {
    const baselineHash = "c".repeat(64);
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "失败监控来源",
        category: "data_security",
        issuingAuthority: "国家互联网信息办公室",
        sourceUrl: "https://www.cac.gov.cn/policy",
        contentHash: baselineHash,
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        monitoringLeaseToken: "failure-retry-claim",
        monitoringLeaseUntil: new Date(Date.now() + 60 * 60 * 1_000),
      })
      .returning();
    if (!source) throw new Error("Failed to create failing compliance source");
    const deps = dependencies({
      async fetch() {
        throw new Error(
          "upstream timeout authorization=Bearer definitely-sensitive-monitor-placeholder",
        );
      },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      let monitoringError: unknown;
      try {
        await handleComplianceSourceMonitor(deps, {
          orgId: firstOrgId,
          sourceId: source.id,
          claimToken: "failure-retry-claim",
        });
      } catch (error) {
        monitoringError = error;
      }
      expect(monitoringError).toBeInstanceOf(Error);
      expect(String(monitoringError)).toContain("upstream timeout");
      expect(String(monitoringError)).toContain("[REDACTED]");
      expect(String(monitoringError)).not.toContain("definitely-sensitive-monitor-placeholder");
    }
    const [failed] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.id, source.id));
    expect(failed).toMatchObject({
      contentHash: baselineHash,
      contentHashStatus: "failed",
      monitoringFailureCount: 3,
      reviewStatus: "stale",
      status: "uncertain",
    });
    expect(failed?.lastMonitoringError).toContain("[REDACTED]");
    expect(failed?.lastMonitoringError).not.toContain("definitely-sensitive-monitor-placeholder");
    const failureAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, source.id),
          eq(auditEvents.action, "monitor_fail"),
        ),
      );
    expect(failureAudits).toHaveLength(3);
    expect(JSON.stringify(failureAudits)).not.toContain("definitely-sensitive-monitor-placeholder");
    const failureEscalation = await complianceEscalations(source.id, "monitor_failed");
    expect(failureEscalation.audits).toHaveLength(1);
    expect(failureEscalation.records).toHaveLength(1);
    expect(failureEscalation.records[0]).toMatchObject({
      orgId: firstOrgId,
      status: "todo",
      priority: "high",
      assigneeId: null,
    });
    expect(failureEscalation.records[0]?.description).toContain(`来源 ID：${source.id}`);
    expect(failureEscalation.records[0]?.description).toContain("国家互联网信息办公室");
    expect(failureEscalation.records[0]?.description).toContain("[REDACTED]");
    expect(failureEscalation.records[0]?.description).not.toContain(
      "definitely-sensitive-monitor-placeholder",
    );
    const thirdFailureAudit = failureAudits.find(
      (audit) =>
        (audit.after as { monitoringFailureCount?: number } | null)?.monitoringFailureCount === 3,
    );
    expect(thirdFailureAudit?.metadata).toMatchObject({
      escalationTaskId: failureEscalation.records[0]?.id,
    });

    await expect(
      handleComplianceSourceMonitor(deps, {
        orgId: firstOrgId,
        sourceId: source.id,
        claimToken: "failure-retry-claim",
      }),
    ).rejects.toThrow("upstream timeout");
    expect((await complianceEscalations(source.id, "monitor_failed")).records).toHaveLength(1);
  });

  it("atomically expires overdue human reviews and forces a source check", async () => {
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "人工复核已到期来源",
        category: "contract",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/review-expired",
        contentHash: "d".repeat(64),
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(0),
        nextReviewAt: new Date(0),
        nextMonitorAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000),
      })
      .returning();
    if (!source) throw new Error("Failed to create overdue review source");
    queuedJobs.length = 0;

    await handleComplianceSourceMonitor(
      dependencies({
        async fetch() {
          throw new Error("Sweep must enqueue rather than fetch inline");
        },
      }),
      { orgId: firstOrgId },
    );

    const [expired] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.id, source.id));
    expect(expired).toMatchObject({ reviewStatus: "stale", status: "uncertain" });
    expect(queuedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "compliance-source.monitor",
          data: expect.objectContaining({ orgId: firstOrgId, sourceId: source.id }),
        }),
      ]),
    );
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, source.id),
          eq(auditEvents.action, "review_expired"),
        ),
      );
    expect(audit?.after).toMatchObject({ reviewStatus: "stale", status: "uncertain" });
    const expiryEscalation = await complianceEscalations(source.id, "review_expired");
    expect(expiryEscalation.audits).toHaveLength(1);
    expect(expiryEscalation.records).toHaveLength(1);
    expect(expiryEscalation.records[0]).toMatchObject({
      orgId: firstOrgId,
      status: "todo",
      priority: "high",
      assigneeId: null,
    });
    expect(expiryEscalation.records[0]?.description).toContain(`来源 ID：${source.id}`);
    expect(expiryEscalation.records[0]?.description).toContain("人工复核日期已到期");
    expect(audit?.metadata).toMatchObject({
      escalationTaskId: expiryEscalation.records[0]?.id,
    });

    await handleComplianceSourceMonitor(
      dependencies({
        async fetch() {
          throw new Error("Sweep must enqueue rather than fetch inline");
        },
      }),
      { orgId: firstOrgId },
    );
    expect((await complianceEscalations(source.id, "review_expired")).records).toHaveLength(1);
  });

  it("deduplicates concurrent handlers without creating a false failure", async () => {
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "并发监控来源",
        category: "intellectual_property",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/concurrent-monitor",
        contentHash: "e".repeat(64),
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(),
      })
      .returning();
    if (!source) throw new Error("Failed to create concurrent monitor source");
    let releaseFetch: ((value: OfficialSourceSnapshot) => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const fetch = vi.fn<OfficialSourceFetcher["fetch"]>(
      () =>
        new Promise<OfficialSourceSnapshot>((resolve) => {
          releaseFetch = resolve;
          signalStarted?.();
        }),
    );
    const deps = dependencies({ fetch });
    const first = handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
    });
    await started;
    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
    });
    releaseFetch?.(snapshot("e".repeat(64)));
    await first;

    expect(fetch).toHaveBeenCalledTimes(1);
    const [unchanged] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.id, source.id));
    expect(unchanged).toMatchObject({
      reviewStatus: "reviewed",
      status: "active",
      contentHashStatus: "current",
      monitoringFailureCount: 0,
      monitoringLeaseToken: null,
      monitoringLeaseUntil: null,
    });
    const falseFailures = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, source.id),
          eq(auditEvents.action, "monitor_fail"),
        ),
      );
    expect(falseFailures).toHaveLength(0);
    expect((await complianceEscalations(source.id, "content_changed")).records).toHaveLength(0);
  });

  it("discards a stale fetch when a human edits the source during monitoring", async () => {
    const baselineHash = "f".repeat(64);
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "人工并发编辑来源",
        category: "labor_employment",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/human-edit-during-monitor",
        contentHash: baselineHash,
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(),
      })
      .returning();
    if (!source) throw new Error("Failed to create human-edited monitor source");
    let releaseFetch: ((value: OfficialSourceSnapshot) => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const deps = dependencies({
      fetch: async () =>
        new Promise<OfficialSourceSnapshot>((resolve) => {
          releaseFetch = resolve;
          signalStarted?.();
        }),
    });
    const running = handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
    });
    await started;
    await dbHandle.db
      .update(complianceItems)
      .set({
        summary: "人工在监控期间补充的说明",
        updatedAt: new Date(),
        version: sql`${complianceItems.version} + 1`,
      })
      .where(and(eq(complianceItems.id, source.id), eq(complianceItems.orgId, firstOrgId)));
    releaseFetch?.(snapshot("0".repeat(64)));
    await running;

    const [preserved] = await dbHandle.db
      .select()
      .from(complianceItems)
      .where(eq(complianceItems.id, source.id));
    expect(preserved).toMatchObject({
      summary: "人工在监控期间补充的说明",
      contentHash: baselineHash,
      contentHashStatus: "current",
      reviewStatus: "reviewed",
      status: "active",
      monitoringFailureCount: 0,
      monitoringLeaseToken: null,
    });
    const [discardAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.resourceId, source.id),
          eq(auditEvents.action, "monitor_result_discarded"),
        ),
      );
    expect(discardAudit?.metadata).toMatchObject({
      actorType: "system",
      reason: "source_changed_concurrently",
    });
    const snapshots = await dbHandle.db
      .select()
      .from(complianceSourceSnapshots)
      .where(eq(complianceSourceSnapshots.sourceId, source.id));
    expect(snapshots).toHaveLength(0);
    expect((await complianceEscalations(source.id, "content_changed")).records).toHaveLength(0);
    expect((await complianceEscalations(source.id, "monitor_failed")).records).toHaveLength(0);
  });

  it("queues only due sources inside the requested organization", async () => {
    queuedJobs.length = 0;
    await dbHandle.db
      .update(complianceItems)
      .set({ nextMonitorAt: new Date(0) })
      .where(eq(complianceItems.orgId, firstOrgId));
    await handleComplianceSourceMonitor(
      dependencies({
        async fetch() {
          throw new Error("Scheduled sweep must enqueue rather than fetch inline");
        },
      }),
      { orgId: firstOrgId },
    );
    expect(queuedJobs.length).toBeGreaterThanOrEqual(2);
    expect(queuedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "compliance-source.monitor",
          data: expect.objectContaining({ orgId: firstOrgId }),
        }),
      ]),
    );
    expect(
      queuedJobs.every(
        (job) =>
          job.name === "compliance-source.monitor" &&
          (job.data as { orgId?: string }).orgId === firstOrgId,
      ),
    ).toBe(true);
  });
});
