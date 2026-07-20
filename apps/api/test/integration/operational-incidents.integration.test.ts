import { randomUUID } from "node:crypto";
import {
  advisorRuns,
  auditEvents,
  backups,
  createDatabase,
  promptVersions,
  workflowDefinitions,
  workflowRuns,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
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

describe.skipIf(!databaseUrl)("operational incident investigation", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let ownerCookie: string;
  let orgId: string;
  let workflowRunId: string;
  let workflowIncidentId: string;
  let otherIncidentId: string;
  const queueCalls: Array<{ name: string; data: unknown }> = [];
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const primary = await seedDatabase(dbHandle.db, {
      organizationName: "Operational Incident Test Company",
      organizationSlug: `incident-${suffix}`,
      adminEmail: `incident-${suffix}@example.test`,
      adminDisplayName: "Incident Owner",
      adminPassword: "correct-horse-battery-staple-incident",
      adminMustChangePassword: false,
    });
    const secondary = await seedDatabase(dbHandle.db, {
      organizationName: "Other Operational Incident Company",
      organizationSlug: `incident-other-${suffix}`,
      adminEmail: `incident-other-${suffix}@example.test`,
      adminDisplayName: "Other Owner",
      adminPassword: "correct-horse-battery-staple-other",
      adminMustChangePassword: false,
    });
    orgId = primary.organization.id;

    const [prompt] = await dbHandle.db
      .select({ id: promptVersions.id })
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.orgId, orgId),
          eq(promptVersions.advisorKey, "finance"),
          eq(promptVersions.active, true),
        ),
      )
      .limit(1);
    if (!prompt) throw new Error("Missing seeded finance prompt");

    const [advisor] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId: prompt.id,
        requestedBy: primary.user.id,
        question: "检查本周现金流异常",
        contextRefs: [],
        contextSnapshot: [],
        status: "failed",
        error: "Worker execution lease expired; requires manual review",
        completedAt: new Date(),
        version: 4,
      })
      .returning();
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        orgId,
        name: "每周经营检查",
        trigger: "manual",
        enabled: true,
        steps: [],
      })
      .returning();
    if (!definition) throw new Error("Failed to create workflow definition");
    const [workflow] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        orgId,
        definitionId: definition.id,
        requestedBy: primary.user.id,
        status: "failed",
        input: {},
        definitionVersion: 1,
        stepsSnapshot: [],
        output: { steps: [{ index: 0, type: "create_task", resourceId: randomUUID() }] },
        error: "Worker execution lease expired; requires manual review",
        finishedAt: new Date(),
        version: 5,
      })
      .returning();
    const [backup] = await dbHandle.db
      .insert(backups)
      .values({
        orgId,
        name: "nightly-database-backup",
        scope: "database",
        requestedBy: primary.user.id,
        status: "failed",
        error: "Backup execution lease expired; requires manual review",
        completedAt: new Date(),
        version: 3,
      })
      .returning();
    if (!advisor || !workflow || !backup) throw new Error("Failed to create incident fixtures");
    workflowRunId = workflow.id;

    const incidentValues = [
      { sourceType: "advisor-run", sourceId: advisor.id },
      { sourceType: "workflow-run", sourceId: workflow.id },
      { sourceType: "backup", sourceId: backup.id },
    ].map(({ sourceType, sourceId }) => ({
      orgId,
      actorUserId: null,
      action: "lease_expired",
      resourceType: sourceType,
      resourceId: sourceId,
      requestId: `worker:${randomUUID()}`,
      metadata: { actorType: "system", automaticRetry: false },
    }));
    const createdIncidents = await dbHandle.db
      .insert(auditEvents)
      .values(incidentValues)
      .returning({ id: auditEvents.id, resourceType: auditEvents.resourceType });
    const workflowIncident = createdIncidents.find(
      (incident) => incident.resourceType === "workflow-run",
    );
    const advisorIncident = createdIncidents.find(
      (incident) => incident.resourceType === "advisor-run",
    );
    const backupIncident = createdIncidents.find((incident) => incident.resourceType === "backup");
    if (!advisorIncident || !workflowIncident || !backupIncident)
      throw new Error("Missing operational incident fixture");
    workflowIncidentId = workflowIncident.id;
    await dbHandle.db.insert(auditEvents).values({
      orgId,
      actorUserId: primary.user.id,
      action: "manual_review_completed",
      resourceType: "advisor-run",
      resourceId: advisor.id,
      requestId: `malformed:${randomUUID()}`,
      metadata: {
        schemaVersion: 1,
        incidentAuditId: advisorIncident.id,
        resolution: "manual_compensation_completed",
        reviewSummary: "Malformed evidence must not hide an open incident.",
        evidenceReferences: [null],
        compensationReference: "task:malformed-fixture",
        acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
      },
    });
    await dbHandle.db.insert(auditEvents).values({
      orgId,
      actorUserId: primary.user.id,
      action: "manual_review_completed",
      resourceType: "backup",
      resourceId: backup.id,
      requestId: `legacy:${randomUUID()}`,
      metadata: {
        incidentAuditId: backupIncident.id,
        resolution: "no_partial_effects_found",
        reviewSummary: "Legacy record without the no-replay acknowledgement must not close work.",
        evidenceReferences: ["legacy:test"],
      },
    });

    const [otherBackup] = await dbHandle.db
      .insert(backups)
      .values({
        orgId: secondary.organization.id,
        name: "other-org-backup",
        scope: "database",
        requestedBy: secondary.user.id,
        status: "failed",
        error: "Lease expired",
      })
      .returning();
    if (!otherBackup) throw new Error("Failed to create other organization backup");
    const [otherIncident] = await dbHandle.db
      .insert(auditEvents)
      .values({
        orgId: secondary.organization.id,
        actorUserId: null,
        action: "lease_expired",
        resourceType: "backup",
        resourceId: otherBackup.id,
        requestId: `worker:${randomUUID()}`,
        metadata: { actorType: "system" },
      })
      .returning({ id: auditEvents.id });
    if (!otherIncident) throw new Error("Missing other organization incident");
    otherIncidentId = otherIncident.id;

    const queue = {
      healthCheck: async () => undefined,
      send: async (name: string, data: unknown) => {
        queueCalls.push({ name, data });
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
        email: `incident-${suffix}@example.test`,
        password: "correct-horse-battery-staple-incident",
      },
    });
    expect(login.statusCode).toBe(200);
    ownerCookie = cookie(login);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("lists only organization-scoped lease incidents and distinguishes recorded partial effects", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/operations/incidents?status=open&pageSize=20",
      headers: { cookie: ownerCookie },
    });
    expect(response.statusCode, response.body).toBe(200);
    const payload = body(response);
    const data = payload.data as JsonObject[];
    expect((payload.meta as JsonObject).total).toBe(3);
    expect(data).toHaveLength(3);
    expect(data.map((incident) => incident.sourceType).sort()).toEqual([
      "advisor-run",
      "backup",
      "workflow-run",
    ]);
    expect(JSON.stringify(data)).not.toContain("other-org-backup");
    expect(data.find((incident) => incident.sourceType === "workflow-run")).toMatchObject({
      incidentId: workflowIncidentId,
      title: "每周经营检查",
      status: "open",
      possiblePartialEffects: true,
      recordedPartialEffects: true,
      recordedPartialCount: 1,
    });
    expect(data.find((incident) => incident.sourceType === "backup")).toMatchObject({
      title: "nightly-database-backup",
      recordedPartialEffects: false,
    });
    expect(data.find((incident) => incident.sourceType === "advisor-run")).toMatchObject({
      title: "检查本周现金流异常",
      status: "open",
      resolution: null,
    });
  });

  it("requires compensation for recorded partial effects and resolves exactly once without replay", async () => {
    const before = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId));
    const invalidOutcome = await app.inject({
      method: "POST",
      url: `/api/v1/operations/incidents/${workflowIncidentId}/resolve`,
      headers: { cookie: ownerCookie },
      payload: {
        resolution: "no_partial_effects_found",
        reviewSummary: "已检查审计和工作流输出，但该运行已经记录一个部分步骤。",
        evidenceReferences: [`audit:${workflowIncidentId}`],
        acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
      },
    });
    expect(invalidOutcome.statusCode).toBe(409);

    const payload = {
      resolution: "manual_compensation_completed",
      reviewSummary: "已核对部分创建的任务并完成业务补偿，保留原失败记录作为证据。",
      evidenceReferences: [`audit:${workflowIncidentId}`, "task:manual-review-20260720"],
      compensationReference: "task:manual-review-20260720",
      acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
    };
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.inject({
          method: "POST",
          url: `/api/v1/operations/incidents/${workflowIncidentId}/resolve`,
          headers: { cookie: ownerCookie },
          payload,
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const successful = responses.find((response) => response.statusCode === 200);
    expect(successful ? body(successful).data : null).toMatchObject({
      incidentId: workflowIncidentId,
      sourceId: workflowRunId,
      status: "resolved",
      resolution: "manual_compensation_completed",
      sourceRecordChanged: false,
      automaticReplay: false,
    });

    const after = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId));
    expect(after).toEqual(before);
    expect(queueCalls).toHaveLength(0);
    const resolutionAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, workflowRunId),
          eq(auditEvents.action, "manual_review_completed"),
        ),
      );
    expect(resolutionAudits).toHaveLength(1);
    expect(resolutionAudits[0]?.metadata).toMatchObject({
      incidentAuditId: workflowIncidentId,
      automaticReplay: false,
      compensationReference: "task:manual-review-20260720",
    });

    const [open, resolved] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/operations/incidents?status=open",
        headers: { cookie: ownerCookie },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/operations/incidents?status=resolved",
        headers: { cookie: ownerCookie },
      }),
    ]);
    expect(open.statusCode, open.body).toBe(200);
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect((body(open).meta as JsonObject).total).toBe(2);
    expect((body(resolved).meta as JsonObject).total).toBe(1);
    expect((body(resolved).data as JsonObject[])[0]).toMatchObject({
      incidentId: workflowIncidentId,
      status: "resolved",
      resolution: {
        resolution: "manual_compensation_completed",
        compensationReference: "task:manual-review-20260720",
      },
    });
  });

  it("fails closed for missing evidence and incidents belonging to another organization", async () => {
    const missingEvidence = await app.inject({
      method: "POST",
      url: `/api/v1/operations/incidents/${workflowIncidentId}/resolve`,
      headers: { cookie: ownerCookie },
      payload: {
        resolution: "manual_compensation_completed",
        reviewSummary: "说明存在补偿但故意省略证据和补偿引用，应由契约拒绝。",
        evidenceReferences: [],
        acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
      },
    });
    expect(missingEvidence.statusCode).toBe(400);

    const otherOrganization = await app.inject({
      method: "POST",
      url: `/api/v1/operations/incidents/${otherIncidentId}/resolve`,
      headers: { cookie: ownerCookie },
      payload: {
        resolution: "no_partial_effects_found",
        reviewSummary: "尝试跨组织关闭不属于当前组织的运行异常，必须按不存在处理。",
        evidenceReferences: [`audit:${otherIncidentId}`],
        acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
      },
    });
    expect(otherOrganization.statusCode).toBe(404);
  });
});
