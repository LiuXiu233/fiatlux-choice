import { createHash, randomUUID } from "node:crypto";
import {
  approvals,
  auditEvents,
  backups,
  createDatabase,
  files,
  integrationChecks,
  memberships,
  roles,
  users,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

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

describe.skipIf(!databaseUrl)("API business-write and audit atomicity", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let ownerCookie: string;
  let ownerUserId: string;
  let orgId: string;
  let rejectAuditPrefix: string;
  let triggerName: string;
  let functionName: string;
  let failQueue = false;
  const sentJobs: Array<{ name: string; data: unknown }> = [];
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Atomic Audit Test Company",
      organizationSlug: `atomic-${suffix}`,
      adminEmail: `atomic-${suffix}@example.test`,
      adminDisplayName: "Atomic Owner",
      adminPassword: "correct-horse-battery-staple-atomic",
      adminMustChangePassword: false,
    });
    ownerUserId = seeded.user.id;
    orgId = seeded.organization.id;
    rejectAuditPrefix = `atomic-fail-${suffix}`;
    triggerName = `reject_atomic_audit_trigger_${suffix}`;
    functionName = `reject_atomic_audit_${suffix}`;

    await dbHandle.db.execute(
      sql.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.request_id LIKE '${rejectAuditPrefix}%' THEN
            RAISE EXCEPTION 'forced audit insertion failure for atomicity test';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `),
    );

    const queue = {
      send: async (name: string, data: unknown) => {
        if (failQueue) throw new Error("forced queue failure");
        sentJobs.push({ name, data });
        return randomUUID();
      },
    } as unknown as JobQueue;
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
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
        email: `atomic-${suffix}@example.test`,
        password: "correct-horse-battery-staple-atomic",
      },
    });
    expect(login.statusCode).toBe(200);
    ownerCookie = cookie(login);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (dbHandle && triggerName && functionName) {
      await dbHandle.db.execute(
        sql.raw(`
          DROP TRIGGER IF EXISTS ${triggerName} ON audit_events;
          DROP FUNCTION IF EXISTS ${functionName}();
        `),
      );
    }
    await dbHandle?.client.end();
  });

  function rejectedAuditHeaders(label: string) {
    return { cookie: ownerCookie, "x-request-id": `${rejectAuditPrefix}-${label}` };
  }

  it("rolls back file state changes when their audit insert fails", async () => {
    const data = Buffer.from("atomic file content");
    const metadataResponse = await app.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: ownerCookie },
      payload: {
        filename: "atomic.txt",
        contentType: "text/plain",
        sizeBytes: data.byteLength,
        checksumSha256: createHash("sha256").update(data).digest("hex"),
        classification: "internal",
      },
    });
    expect(metadataResponse.statusCode).toBe(201);
    const metadata = body(metadataResponse).data as { file: JsonObject; upload: JsonObject };
    const fileId = String(metadata.file.id);

    const failedPut = await app.inject({
      method: "PUT",
      url: String(metadata.upload.uploadUrl),
      headers: {
        ...rejectedAuditHeaders("file-put"),
        "content-type": "application/octet-stream",
        "content-length": String(data.byteLength),
      },
      payload: data,
    });
    expect(failedPut.statusCode).toBe(500);
    let [record] = await dbHandle.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(record).toMatchObject({ uploadStatus: "pending", version: 1 });
    const cannotCompleteCrashResidue = await app.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: { cookie: ownerCookie },
    });
    expect(cannotCompleteCrashResidue.statusCode).toBe(409);

    const stored = await app.inject({
      method: "PUT",
      url: String(metadata.upload.uploadUrl),
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "content-length": String(data.byteLength),
      },
      payload: data,
    });
    expect(stored.statusCode).toBe(201);

    const failedComplete = await app.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: rejectedAuditHeaders("file-complete"),
    });
    expect(failedComplete.statusCode).toBe(500);
    [record] = await dbHandle.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(record).toMatchObject({ uploadStatus: "stored", version: 2 });

    const completionResponses = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.inject({
          method: "POST",
          url: `/api/v1/files/${fileId}/complete`,
          headers: { cookie: ownerCookie },
        }),
      ),
    );
    expect(completionResponses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const duplicateComplete = await app.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: { cookie: ownerCookie },
    });
    expect(duplicateComplete.statusCode).toBe(409);
    const duplicatePut = await app.inject({
      method: "PUT",
      url: String(metadata.upload.uploadUrl),
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "content-length": String(data.byteLength),
      },
      payload: data,
    });
    expect(duplicatePut.statusCode).toBe(409);

    const failedArchive = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${fileId}?expectedVersion=3`,
      headers: rejectedAuditHeaders("file-archive"),
    });
    expect(failedArchive.statusCode).toBe(500);
    [record] = await dbHandle.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(record).toMatchObject({ uploadStatus: "uploaded", version: 3, archivedAt: null });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/${fileId}?expectedVersion=3`,
      headers: { cookie: ownerCookie },
    });
    expect(archived.statusCode).toBe(200);
  });

  it("rolls back admin and approval records when their audit insert fails", async () => {
    const [membership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, ownerUserId)))
      .limit(1);
    const [memberRole] = await dbHandle.db
      .select()
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.systemKey, "member")))
      .limit(1);
    if (!membership || !memberRole) throw new Error("Expected seeded membership and member role");

    const failedProfile = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${ownerUserId}`,
      headers: rejectedAuditHeaders("user-update"),
      payload: { displayName: "Must Roll Back", expectedVersion: membership.version },
    });
    expect(failedProfile.statusCode).toBe(500);
    const [unchangedUser] = await dbHandle.db
      .select()
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1);
    const [unchangedMembership] = await dbHandle.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id))
      .limit(1);
    expect(unchangedUser?.displayName).toBe("Atomic Owner");
    expect(unchangedMembership?.version).toBe(membership.version);

    const updatedProfile = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${ownerUserId}`,
      headers: { cookie: ownerCookie },
      payload: { displayName: "Atomic Owner Updated", expectedVersion: membership.version },
    });
    expect(updatedProfile.statusCode).toBe(200);
    expect(body(updatedProfile).data).toMatchObject({ version: membership.version + 1 });
    expect(body(updatedProfile).data).not.toHaveProperty("passwordHash");
    const staleProfile = await app.inject({
      method: "PATCH",
      url: `/api/v1/users/${ownerUserId}`,
      headers: { cookie: ownerCookie },
      payload: { displayName: "Stale Update", expectedVersion: membership.version },
    });
    expect(staleProfile.statusCode).toBe(409);

    const genericResourceId = randomUUID();
    const failedApproval = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: rejectedAuditHeaders("generic-approval"),
      payload: {
        resourceType: "test-resource",
        resourceId: genericResourceId,
        operation: "test-operation",
        reason: "Atomic rollback test",
        riskLevel: "high",
      },
    });
    expect(failedApproval.statusCode).toBe(500);
    const genericApprovals = await dbHandle.db
      .select()
      .from(approvals)
      .where(eq(approvals.resourceId, genericResourceId));
    expect(genericApprovals).toHaveLength(0);

    const failedRoleAssignment = await app.inject({
      method: "POST",
      url: "/api/v1/role-assignments",
      headers: rejectedAuditHeaders("role-assignment"),
      payload: {
        membershipId: membership.id,
        roleId: memberRole.id,
        mode: "assign",
        reason: "Atomic role assignment rollback test",
        expectedVersion: Number((body(updatedProfile).data as Record<string, unknown>).version),
        idempotencyKey: `atomic-role-${suffix}`,
      },
    });
    expect(failedRoleAssignment.statusCode).toBe(500);
    const roleApprovals = await dbHandle.db
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.resourceType, "role-assignment"), eq(approvals.resourceId, membership.id)),
      );
    expect(roleApprovals).toHaveLength(0);

    const failedIntegrationCheck = await app.inject({
      method: "POST",
      url: "/api/v1/settings/integrations/external-manual/test",
      headers: rejectedAuditHeaders("integration-check"),
    });
    expect(failedIntegrationCheck.statusCode).toBe(500);
    const checks = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(
        and(
          eq(integrationChecks.orgId, orgId),
          eq(integrationChecks.integrationId, "external-manual"),
        ),
      );
    expect(checks).toHaveLength(0);
  });

  it("audits backup queue intent and atomically records queue failure", async () => {
    const sentBeforeRejectedAudit = sentJobs.length;
    const rejectedAuditBackup = await app.inject({
      method: "POST",
      url: "/api/v1/backups",
      headers: rejectedAuditHeaders("backup-create"),
      payload: { name: `audit-rejected-${suffix}`, scope: "database" },
    });
    expect(rejectedAuditBackup.statusCode).toBe(500);
    expect(sentJobs).toHaveLength(sentBeforeRejectedAudit);
    const rejectedRecords = await dbHandle.db
      .select()
      .from(backups)
      .where(eq(backups.name, `audit-rejected-${suffix}`));
    expect(rejectedRecords).toHaveLength(0);

    failQueue = true;
    const failedQueueResponse = await app.inject({
      method: "POST",
      url: "/api/v1/backups",
      headers: { cookie: ownerCookie },
      payload: { name: `queue-failed-${suffix}`, scope: "database" },
    });
    failQueue = false;
    expect(failedQueueResponse.statusCode).toBe(503);
    expect(body(failedQueueResponse).error).toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    const [failedBackup] = await dbHandle.db
      .select()
      .from(backups)
      .where(eq(backups.name, `queue-failed-${suffix}`))
      .limit(1);
    expect(failedBackup).toMatchObject({
      status: "failed",
      version: 2,
      error: "forced queue failure",
    });
    if (!failedBackup) throw new Error("Expected failed backup record");
    const backupAudits = await dbHandle.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "backup"),
          eq(auditEvents.resourceId, failedBackup.id),
        ),
      );
    expect(backupAudits.map((event) => event.action).sort()).toEqual(["fail", "queue"]);
  });
});
