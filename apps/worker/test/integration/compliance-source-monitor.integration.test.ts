import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  auditEvents,
  complianceItems,
  complianceSourceSnapshots,
  createDatabase,
  membershipRoles,
  memberships,
  notifications,
  roles,
  tasks,
  users,
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
  let firstMemberId: string;
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
    const [member] = await dbHandle.db
      .insert(users)
      .values({
        email: `compliance-monitor-member-${randomUUID().slice(0, 8)}@example.test`,
        displayName: "Compliance Monitor Member",
        passwordHash: first.user.passwordHash,
      })
      .returning({ id: users.id });
    if (!member) throw new Error("Failed to create compliance monitor member");
    await dbHandle.db.insert(memberships).values({
      orgId: firstOrgId,
      userId: member.id,
      status: "active",
    });
    const [memberMembership] = await dbHandle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, firstOrgId), eq(memberships.userId, member.id)));
    const [adminRole] = await dbHandle.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, firstOrgId), eq(roles.systemKey, "admin")));
    if (!memberMembership || !adminRole)
      throw new Error("Failed to resolve compliance monitor member role");
    await dbHandle.db.insert(membershipRoles).values({
      orgId: firstOrgId,
      membershipId: memberMembership.id,
      roleId: adminRole.id,
    });
    firstMemberId = member.id;
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
    const notificationAuditRows = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          inArray(auditEvents.action, ["create", "deliver"]),
          eq(auditEvents.resourceType, "notification"),
        ),
      );
    const notificationAudits = notificationAuditRows.filter((audit) => {
      const metadata = audit.metadata as Record<string, unknown> | null;
      return (
        metadata?.complianceSourceId === sourceId && metadata.escalationReason === escalationReason
      );
    });
    const notificationIds = [...new Set(notificationAudits.map((audit) => audit.resourceId))];
    const notificationRecords = notificationIds.length
      ? await dbHandle.db
          .select()
          .from(notifications)
          .where(
            and(eq(notifications.orgId, firstOrgId), inArray(notifications.id, notificationIds)),
          )
      : [];
    return { audits, records, notificationAudits, notificationRecords };
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

  it("persists fresh source imports in separate initial daily monitoring buckets", async () => {
    const firstUrl = `https://www.gov.cn/initial-spread-a-${randomUUID()}`;
    const secondUrl = `https://www.gov.cn/initial-spread-b-${randomUUID()}`;
    const beforeImport = Date.now();
    const result = await importOfficialComplianceSources(
      dbHandle.db,
      firstOrgId,
      "/unused/in-memory-compliance-sources.json",
      {
        missing: false,
        parsedDocument: {
          sources: [
            {
              title: "首轮分批来源一",
              category: "tax_invoice",
              issuingAuthority: "国务院",
              sourceUrl: firstUrl,
              jurisdiction: "中国",
              reviewStatus: "pending",
              contentHashStatus: "pending_fetch",
            },
            {
              title: "首轮分批来源二",
              category: "tax_invoice",
              issuingAuthority: "国务院",
              sourceUrl: secondUrl,
              jurisdiction: "中国",
              reviewStatus: "pending",
              contentHashStatus: "pending_fetch",
            },
          ],
        },
      },
    );
    const afterImport = Date.now();
    expect(result).toMatchObject({ imported: 2, skipped: 0, missing: false });

    const imported = await dbHandle.db
      .select({
        sourceUrl: complianceItems.sourceUrl,
        nextMonitorAt: complianceItems.nextMonitorAt,
      })
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.orgId, firstOrgId),
          inArray(complianceItems.sourceUrl, [firstUrl, secondUrl]),
        ),
      );
    const byUrl = new Map(imported.map((source) => [source.sourceUrl, source.nextMonitorAt]));
    const firstMonitorAt = byUrl.get(firstUrl);
    const secondMonitorAt = byUrl.get(secondUrl);
    expect(firstMonitorAt).toBeDefined();
    expect(secondMonitorAt).toBeDefined();
    expect(firstMonitorAt?.getTime()).toBeGreaterThanOrEqual(beforeImport);
    expect(firstMonitorAt?.getTime()).toBeLessThanOrEqual(afterImport);
    expect((secondMonitorAt?.getTime() ?? 0) - (firstMonitorAt?.getTime() ?? 0)).toBe(
      24 * 60 * 60 * 1_000,
    );
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
      requestedBy: firstMemberId,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect((await complianceEscalations(source.id, "content_changed")).records).toHaveLength(0);

    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
      requestedBy: firstMemberId,
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
      requestedBy: firstMemberId,
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
      initiatedBy: firstMemberId,
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
      assigneeId: firstMemberId,
    });
    expect(changeEscalation.records[0]?.title).toContain("官方正文哈希发生变化");
    expect(changeEscalation.records[0]?.description).toContain(`来源 ID：${source.id}`);
    expect(changeEscalation.records[0]?.description).toContain("国务院");
    expect(changeEscalation.audits[0]?.metadata).toMatchObject({
      actorType: "system",
      trigger: "compliance_source_monitor",
      complianceSourceId: source.id,
      escalationReason: "content_changed",
      initiatedBy: firstMemberId,
      assigneeId: firstMemberId,
      assignmentStrategy: "initiator",
      notificationId: changeEscalation.notificationRecords[0]?.id,
    });
    expect(changeEscalation.notificationRecords).toHaveLength(1);
    expect(changeEscalation.notificationRecords[0]).toMatchObject({
      orgId: firstOrgId,
      recipientId: firstMemberId,
      channel: "in_app",
      status: "sent",
      readAt: null,
    });
    expect(changeEscalation.notificationRecords[0]?.sentAt).toBeInstanceOf(Date);
    expect(changeEscalation.notificationRecords[0]?.body).toContain(
      "不表示法规有效、适用或已经完成专业复核",
    );
    expect(changeEscalation.notificationAudits.map((audit) => audit.action).sort()).toEqual([
      "create",
      "deliver",
    ]);
    expect(changeEscalation.notificationAudits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            taskId: changeEscalation.records[0]?.id,
            deliveryMode: "atomic_in_app",
          }),
        }),
      ]),
    );
    expect(changeAudit?.metadata).toMatchObject({
      escalationTaskId: changeEscalation.records[0]?.id,
      escalationNotificationId: changeEscalation.notificationRecords[0]?.id,
      escalationAssigneeId: firstMemberId,
      assignmentStrategy: "initiator",
    });

    await handleComplianceSourceMonitor(deps, {
      orgId: firstOrgId,
      sourceId: source.id,
      requestedBy: firstMemberId,
    });
    const deduplicatedChange = await complianceEscalations(source.id, "content_changed");
    expect(deduplicatedChange.records).toHaveLength(1);
    expect(deduplicatedChange.notificationRecords).toHaveLength(1);
  });

  it("falls back to an active owner when the manual initiator is no longer authorized", async () => {
    const [memberMembership] = await dbHandle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, firstOrgId), eq(memberships.userId, firstMemberId)));
    if (!memberMembership) throw new Error("Failed to resolve compliance monitor member");
    await dbHandle.db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.orgId, firstOrgId),
          eq(membershipRoles.membershipId, memberMembership.id),
        ),
      );
    const baselineHash = "1".repeat(64);
    const changedHash = "2".repeat(64);
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "触发者已失权的来源",
        category: "company_governance",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/unauthorized-initiator",
        contentHash: baselineHash,
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(),
      })
      .returning();
    if (!source) throw new Error("Failed to create unauthorized-initiator source");

    await handleComplianceSourceMonitor(
      dependencies({ fetch: async () => snapshot(changedHash) }),
      {
        orgId: firstOrgId,
        sourceId: source.id,
        requestedBy: firstMemberId,
      },
    );

    const escalation = await complianceEscalations(source.id, "content_changed");
    expect(escalation.records).toHaveLength(1);
    expect(escalation.records[0]?.assigneeId).toBe(firstUserId);
    expect(escalation.notificationRecords).toHaveLength(1);
    expect(escalation.notificationRecords[0]).toMatchObject({
      recipientId: firstUserId,
      status: "sent",
      channel: "in_app",
    });
    expect(escalation.audits[0]?.metadata).toMatchObject({
      initiatedBy: firstMemberId,
      assigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
      notificationId: escalation.notificationRecords[0]?.id,
    });
  });

  it("falls back to an active owner when the manual initiator user is disabled", async () => {
    const [disabledUser] = await dbHandle.db
      .insert(users)
      .values({
        email: `disabled-compliance-monitor-${randomUUID().slice(0, 8)}@example.test`,
        displayName: "Disabled Compliance Monitor",
        passwordHash: "not-used-by-this-worker-integration-test",
        status: "inactive",
      })
      .returning({ id: users.id });
    if (!disabledUser) throw new Error("Failed to create disabled compliance monitor user");
    const [disabledMembership] = await dbHandle.db
      .insert(memberships)
      .values({
        orgId: firstOrgId,
        userId: disabledUser.id,
        status: "active",
      })
      .returning({ id: memberships.id });
    const [adminRole] = await dbHandle.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, firstOrgId), eq(roles.systemKey, "admin")));
    if (!disabledMembership || !adminRole)
      throw new Error("Failed to resolve disabled compliance monitor role");
    await dbHandle.db.insert(membershipRoles).values({
      orgId: firstOrgId,
      membershipId: disabledMembership.id,
      roleId: adminRole.id,
    });

    const baselineHash = "3".repeat(64);
    const changedHash = "4".repeat(64);
    const [source] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: firstOrgId,
        title: "触发者已停用的来源",
        category: "company_governance",
        issuingAuthority: "国务院",
        sourceUrl: "https://www.gov.cn/disabled-initiator",
        contentHash: baselineHash,
        contentHashStatus: "current",
        reviewStatus: "reviewed",
        status: "active",
        lastVerifiedAt: new Date(),
      })
      .returning();
    if (!source) throw new Error("Failed to create disabled-initiator source");

    await handleComplianceSourceMonitor(
      dependencies({ fetch: async () => snapshot(changedHash) }),
      {
        orgId: firstOrgId,
        sourceId: source.id,
        requestedBy: disabledUser.id,
      },
    );

    const escalation = await complianceEscalations(source.id, "content_changed");
    expect(escalation.records).toHaveLength(1);
    expect(escalation.records[0]?.assigneeId).toBe(firstUserId);
    expect(escalation.notificationRecords).toHaveLength(1);
    expect(escalation.notificationRecords[0]).toMatchObject({
      recipientId: firstUserId,
      status: "sent",
      channel: "in_app",
    });
    expect(escalation.audits[0]?.metadata).toMatchObject({
      initiatedBy: disabledUser.id,
      assigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
      notificationId: escalation.notificationRecords[0]?.id,
    });
  });

  it("keeps the task unassigned without guessing across tenants when no active owner exists", async () => {
    const [ownerMembership] = await dbHandle.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.orgId, firstOrgId), eq(memberships.userId, firstUserId)));
    if (!ownerMembership) throw new Error("Failed to resolve compliance monitor owner");
    await dbHandle.db
      .update(memberships)
      .set({ status: "inactive" })
      .where(and(eq(memberships.orgId, firstOrgId), eq(memberships.id, ownerMembership.id)));

    try {
      const baselineHash = "5".repeat(64);
      const changedHash = "6".repeat(64);
      const [source] = await dbHandle.db
        .insert(complianceItems)
        .values({
          orgId: firstOrgId,
          title: "没有有效 owner 的 legacy 来源",
          category: "company_governance",
          issuingAuthority: "国务院",
          sourceUrl: "https://www.gov.cn/no-active-owner",
          contentHash: baselineHash,
          contentHashStatus: "current",
          reviewStatus: "reviewed",
          status: "active",
          lastVerifiedAt: new Date(),
        })
        .returning();
      if (!source) throw new Error("Failed to create no-active-owner source");

      await handleComplianceSourceMonitor(
        dependencies({ fetch: async () => snapshot(changedHash) }),
        { orgId: firstOrgId, sourceId: source.id },
      );

      const escalation = await complianceEscalations(source.id, "content_changed");
      expect(escalation.records).toHaveLength(1);
      expect(escalation.records[0]).toMatchObject({
        orgId: firstOrgId,
        status: "todo",
        priority: "high",
        assigneeId: null,
      });
      expect(escalation.notificationRecords).toHaveLength(0);
      expect(escalation.notificationAudits).toHaveLength(0);
      expect(escalation.audits[0]?.metadata).toMatchObject({
        assigneeId: null,
        assignmentStrategy: "unassigned_no_active_owner",
        notificationId: null,
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
        escalationTaskId: escalation.records[0]?.id,
        escalationNotificationId: null,
        escalationAssigneeId: null,
        assignmentStrategy: "unassigned_no_active_owner",
      });
    } finally {
      await dbHandle.db
        .update(memberships)
        .set({ status: "active" })
        .where(and(eq(memberships.orgId, firstOrgId), eq(memberships.id, ownerMembership.id)));
    }
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
      assigneeId: firstUserId,
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
      escalationNotificationId: failureEscalation.notificationRecords[0]?.id,
      escalationAssigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
    });
    expect(failureEscalation.audits[0]?.metadata).toMatchObject({
      assigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
      notificationId: failureEscalation.notificationRecords[0]?.id,
    });
    expect(failureEscalation.notificationRecords).toHaveLength(1);
    expect(failureEscalation.notificationRecords[0]).toMatchObject({
      recipientId: firstUserId,
      channel: "in_app",
      status: "sent",
    });

    await expect(
      handleComplianceSourceMonitor(deps, {
        orgId: firstOrgId,
        sourceId: source.id,
        claimToken: "failure-retry-claim",
      }),
    ).rejects.toThrow("upstream timeout");
    const deduplicatedFailure = await complianceEscalations(source.id, "monitor_failed");
    expect(deduplicatedFailure.records).toHaveLength(1);
    expect(deduplicatedFailure.notificationRecords).toHaveLength(1);
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
      assigneeId: firstUserId,
    });
    expect(expiryEscalation.records[0]?.description).toContain(`来源 ID：${source.id}`);
    expect(expiryEscalation.records[0]?.description).toContain("人工复核日期已到期");
    expect(audit?.metadata).toMatchObject({
      escalationTaskId: expiryEscalation.records[0]?.id,
      escalationNotificationId: expiryEscalation.notificationRecords[0]?.id,
      escalationAssigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
    });
    expect(expiryEscalation.audits[0]?.metadata).toMatchObject({
      assigneeId: firstUserId,
      assignmentStrategy: "primary_active_owner",
      notificationId: expiryEscalation.notificationRecords[0]?.id,
    });
    expect(expiryEscalation.notificationRecords).toHaveLength(1);
    expect(expiryEscalation.notificationRecords[0]).toMatchObject({
      recipientId: firstUserId,
      channel: "in_app",
      status: "sent",
    });

    await handleComplianceSourceMonitor(
      dependencies({
        async fetch() {
          throw new Error("Sweep must enqueue rather than fetch inline");
        },
      }),
      { orgId: firstOrgId },
    );
    const deduplicatedExpiry = await complianceEscalations(source.id, "review_expired");
    expect(deduplicatedExpiry.records).toHaveLength(1);
    expect(deduplicatedExpiry.notificationRecords).toHaveLength(1);
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

  it("bounds a scheduled organization sweep and drains the oldest due sources first", async () => {
    queuedJobs.length = 0;
    await dbHandle.db
      .update(complianceItems)
      .set({ nextMonitorAt: new Date("2036-01-01T00:00:00.000Z") })
      .where(eq(complianceItems.orgId, firstOrgId));
    const dueSources = await dbHandle.db
      .insert(complianceItems)
      .values([
        {
          orgId: firstOrgId,
          title: "批次容量来源一",
          category: "company_governance",
          issuingAuthority: "国务院",
          sourceUrl: `https://www.gov.cn/batch-oldest-${randomUUID()}`,
          nextMonitorAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        {
          orgId: firstOrgId,
          title: "批次容量来源二",
          category: "company_governance",
          issuingAuthority: "国务院",
          sourceUrl: `https://www.gov.cn/batch-middle-${randomUUID()}`,
          nextMonitorAt: new Date("2020-01-02T00:00:00.000Z"),
        },
        {
          orgId: firstOrgId,
          title: "批次容量来源三",
          category: "company_governance",
          issuingAuthority: "国务院",
          sourceUrl: `https://www.gov.cn/batch-newest-${randomUUID()}`,
          nextMonitorAt: new Date("2020-01-03T00:00:00.000Z"),
        },
      ])
      .returning({ id: complianceItems.id });
    expect(dueSources).toHaveLength(3);
    const [otherOrganizationSource] = await dbHandle.db
      .insert(complianceItems)
      .values({
        orgId: secondOrgId,
        title: "其他组织更早到期来源",
        category: "company_governance",
        issuingAuthority: "国务院",
        sourceUrl: `https://www.gov.cn/batch-other-organization-${randomUUID()}`,
        nextMonitorAt: new Date("2019-01-01T00:00:00.000Z"),
      })
      .returning({ id: complianceItems.id });
    expect(otherOrganizationSource).toBeDefined();
    const deps = dependencies({
      async fetch() {
        throw new Error("Scheduled sweep must enqueue rather than fetch inline");
      },
    });
    deps.config = workerConfigSchema.parse({
      DATABASE_URL: testDatabaseUrl,
      COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE: 2,
    });

    await handleComplianceSourceMonitor(deps, { orgId: firstOrgId });
    expect(queuedJobs.map((job) => (job.data as { sourceId?: string }).sourceId)).toEqual([
      dueSources[0]?.id,
      dueSources[1]?.id,
    ]);
    expect(
      queuedJobs.some(
        (job) => (job.data as { sourceId?: string }).sourceId === otherOrganizationSource?.id,
      ),
    ).toBe(false);
    expect(
      queuedJobs.every(
        (job) =>
          job.name === "compliance-source.monitor" &&
          (job.data as { orgId?: string }).orgId === firstOrgId,
      ),
    ).toBe(true);

    const firstDispatchAudits = await dbHandle.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.action, "monitor_dispatch"),
          eq(auditEvents.resourceType, "compliance-source-monitor"),
        ),
      );
    expect(firstDispatchAudits.map((audit) => audit.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          batchLimit: 2,
          dueCount: 2,
          queuedCount: 2,
          hasMoreDue: true,
        }),
      ]),
    );

    queuedJobs.length = 0;
    await handleComplianceSourceMonitor(deps, { orgId: firstOrgId });
    expect(queuedJobs).toHaveLength(1);
    await handleComplianceSourceMonitor(
      dependencies({ fetch: async () => snapshot("9".repeat(64)) }),
      queuedJobs[0]?.data as { orgId: string; sourceId: string; claimToken: string },
    );
    expect(queuedJobs[0]).toEqual(
      expect.objectContaining({
        name: "compliance-source.monitor",
        data: expect.objectContaining({
          orgId: firstOrgId,
          sourceId: dueSources[2]?.id,
        }),
      }),
    );
    const secondDispatchAudits = await dbHandle.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, firstOrgId),
          eq(auditEvents.action, "monitor_dispatch"),
          eq(auditEvents.resourceType, "compliance-source-monitor"),
        ),
      );
    expect(secondDispatchAudits.map((audit) => audit.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          batchLimit: 2,
          dueCount: 1,
          queuedCount: 1,
          hasMoreDue: false,
        }),
      ]),
    );
  });
});
