import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditEvents, backups, createDatabase } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import type { GitHubReader, LlmProvider } from "@fiatlux/integrations";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import {
  BACKUP_CLAIM_LEASE_MS,
  handleBackup,
  STALE_BACKUP_ERROR,
  type WorkerDependencies,
} from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

const github = {} as GitHubReader;
const llmProvider = {} as LlmProvider;

describe.skipIf(!databaseUrl)("backup worker claim and lease PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let userId: string;
  let workspace: string;
  let commandPath: string;
  let markerPath: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Backup Claim Company",
      organizationSlug: `backup-claim-${suffix}`,
      adminEmail: `backup-claim-${suffix}@example.test`,
      adminDisplayName: "Backup Claim Owner",
      adminPassword: "correct-horse-battery-staple-backup",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;

    workspace = await mkdtemp(join(tmpdir(), "fiatlux-backup-worker-"));
    markerPath = join(workspace, "invocations.log");
    commandPath = join(workspace, "controlled-backup.sh");
    await writeFile(
      commandPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$1" >> '${markerPath}'
sleep 1
printf '{"storageKey":"controlled/%s.dump","sizeBytes":42,"checksumSha256":"${"a".repeat(64)}"}\\n' "$1"
`,
      { mode: 0o700 },
    );
    await chmod(commandPath, 0o700);
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  function dependencies(): WorkerDependencies {
    return {
      db: dbHandle.db,
      queue: {} as WorkerDependencies["queue"],
      llmProvider,
      github,
      config: workerConfigSchema.parse({
        DATABASE_URL: testDatabaseUrl,
        BACKUP_COMMAND: commandPath,
        BACKUP_DIR: workspace,
      }),
    };
  }

  async function createQueuedBackup(name: string) {
    const [record] = await dbHandle.db
      .insert(backups)
      .values({
        orgId,
        name,
        scope: "database",
        status: "queued",
        requestedBy: userId,
      })
      .returning();
    if (!record) throw new Error("Failed to create backup fixture");
    return record;
  }

  async function markerCount() {
    try {
      const contents = await readFile(markerPath, "utf8");
      return contents.trim() === "" ? 0 : contents.trim().split("\n").length;
    } catch {
      return 0;
    }
  }

  async function waitForMarkerCount(expected: number) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await markerCount()) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${expected} backup command invocation(s)`);
  }

  it("atomically claims a queued row so concurrent deliveries run one command", async () => {
    const record = await createQueuedBackup(`concurrent-${randomUUID()}`);
    const payload = { orgId, backupId: record.id };

    await Promise.all([
      handleBackup(dependencies(), payload),
      handleBackup(dependencies(), payload),
    ]);

    const [completed] = await dbHandle.db.select().from(backups).where(eq(backups.id, record.id));
    expect(completed).toMatchObject({ status: "completed", version: 3, sizeBytes: 42 });
    expect(completed?.checksumSha256).toBe("a".repeat(64));
    expect(await markerCount()).toBe(1);

    const completionAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, record.id),
          eq(auditEvents.action, "complete"),
        ),
      );
    expect(completionAudits).toHaveLength(1);
  });

  it("uses version CAS and turns an abandoned running row into a manual-review failure", async () => {
    const casRecord = await createQueuedBackup(`cas-${randomUUID()}`);
    const casPayload = { orgId, backupId: casRecord.id };
    const running = handleBackup(dependencies(), casPayload);
    await waitForMarkerCount(2);

    // Simulate an operator/state transition while the external command is still
    // running.  Completion and failure must not overwrite this newer version.
    await dbHandle.db
      .update(backups)
      .set({
        error: "manual intervention",
        updatedAt: new Date(),
        version: sql`${backups.version} + 1`,
      })
      .where(eq(backups.id, casRecord.id));
    await running;

    const [casState] = await dbHandle.db.select().from(backups).where(eq(backups.id, casRecord.id));
    expect(casState).toMatchObject({ status: "running", version: 3, error: "manual intervention" });
    const casAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, casRecord.id),
          eq(auditEvents.action, "complete"),
        ),
      );
    expect(casAudits).toHaveLength(0);

    const replayAt = new Date(Date.now() - 10 * 60_000);
    const staleRecord = await createQueuedBackup(`stale-${randomUUID()}`);
    await dbHandle.db
      .update(backups)
      .set({
        status: "running",
        startedAt: replayAt,
        updatedAt: replayAt,
        version: 2,
      })
      .where(eq(backups.id, staleRecord.id));

    // A normal pg-boss retry around its generic ten-minute window must not
    // claim success and hide a still-running backup row.
    await handleBackup(dependencies(), { orgId, backupId: staleRecord.id });
    const [freshReplay] = await dbHandle.db
      .select()
      .from(backups)
      .where(eq(backups.id, staleRecord.id));
    expect(freshReplay).toMatchObject({ status: "running", version: 2 });
    expect(await markerCount()).toBe(2);
    const earlyLeaseAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, staleRecord.id),
          eq(auditEvents.action, "lease_expired"),
        ),
      );
    expect(earlyLeaseAudits).toHaveLength(0);

    const staleAt = new Date(Date.now() - BACKUP_CLAIM_LEASE_MS - 60_000);
    await dbHandle.db
      .update(backups)
      .set({ updatedAt: staleAt })
      .where(eq(backups.id, staleRecord.id));
    await handleBackup(dependencies(), { orgId, backupId: staleRecord.id });
    const [failed] = await dbHandle.db.select().from(backups).where(eq(backups.id, staleRecord.id));
    expect(failed).toMatchObject({
      status: "failed",
      version: 3,
      error: STALE_BACKUP_ERROR,
    });
    expect(failed?.completedAt).toBeInstanceOf(Date);
    expect(await markerCount()).toBe(2);

    const leaseAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, staleRecord.id),
          eq(auditEvents.action, "lease_expired"),
        ),
      );
    expect(leaseAudits).toHaveLength(1);
    expect(leaseAudits[0]?.metadata).toMatchObject({ automaticRetry: false });

    // A later duplicate delivery remains a no-op; stale handling never queues
    // or invokes the external command again.
    await handleBackup(dependencies(), { orgId, backupId: staleRecord.id });
    expect(await markerCount()).toBe(2);
    const leaseAuditsAfterDuplicate = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, staleRecord.id),
          eq(auditEvents.action, "lease_expired"),
        ),
      );
    expect(leaseAuditsAfterDuplicate).toHaveLength(1);

    // Leave the simulated manual-intervention row in a terminal state for a
    // clean fixture; this is not performed by the worker automatically.
    await dbHandle.db
      .update(backups)
      .set({ status: "failed", completedAt: new Date(), updatedAt: new Date(), version: 4 })
      .where(eq(backups.id, casRecord.id));
  });
});
