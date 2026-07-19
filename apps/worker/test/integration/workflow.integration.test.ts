import { randomUUID } from "node:crypto";
import {
  advisorRuns,
  approvals,
  auditEvents,
  createDatabase,
  notifications,
  promptVersions,
  tasks,
  workflowDefinitions,
  workflowRuns,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import type { GitHubReader, JobQueue, LlmProvider } from "@fiatlux/integrations";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import { handleWorkflowRun, type WorkerDependencies } from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

const github: GitHubReader = {
  async getRepository(repository) {
    return {
      repository,
      url: `https://github.com/${repository}`,
      description: null,
      stars: 0,
      forks: 0,
      openIssues: 0,
      defaultBranch: "main",
      pushedAt: null,
      archived: false,
      license: null,
    };
  },
};

const llmProvider = {
  async completeAdvisor() {
    throw new Error("Advisor execution is queued separately in this test");
  },
} as unknown as LlmProvider;

describe.skipIf(!databaseUrl)("workflow worker child audit PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let userId: string;
  let financePromptId: string;
  const sentJobs: Array<{ name: string; data: unknown }> = [];

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Workflow Audit Company",
      organizationSlug: `workflow-audit-${randomUUID().slice(0, 8)}`,
      adminEmail: `workflow-audit-${randomUUID().slice(0, 8)}@example.test`,
      adminDisplayName: "Workflow Audit Owner",
      adminPassword: "correct-horse-battery-staple-workflow",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
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
    if (!prompt) throw new Error("Seed did not create finance prompt");
    financePromptId = prompt.id;
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  it("creates each workflow child together with a system audit event", async () => {
    const definitionId = randomUUID();
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        id: definitionId,
        orgId,
        name: "Audit child workflow",
        trigger: "integration.test",
        enabled: true,
        steps: [
          {
            type: "notify",
            config: { recipientId: userId, title: "Workflow notice", body: "Created by workflow" },
          },
          { type: "create_task", config: { title: "Workflow task" } },
          {
            type: "request_approval",
            config: {
              resourceType: "contract",
              resourceId: randomUUID(),
              operation: "review",
              reason: "Workflow approval",
              riskLevel: "high",
            },
          },
          {
            type: "advisor_run",
            config: { advisor: "finance", question: "Review workflow context" },
          },
        ],
      })
      .returning();
    if (!definition) throw new Error("Failed to create workflow definition");
    const [run] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        definitionId,
        orgId,
        requestedBy: userId,
        input: {},
        definitionVersion: definition.version,
        stepsSnapshot: definition.steps,
      })
      .returning();
    if (!run) throw new Error("Failed to create workflow run");

    sentJobs.length = 0;
    const queue = {
      send: async (name: string, data: unknown) => {
        sentJobs.push({ name, data });
        return randomUUID();
      },
    } as unknown as JobQueue;
    const dependencies: WorkerDependencies = {
      db: dbHandle.db,
      queue,
      llmProvider,
      github,
      config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
    };
    await handleWorkflowRun(dependencies, { orgId, runId: run.id });

    const [completed] = await dbHandle.db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    expect(completed?.status).toBe("completed");

    const [notification] = await dbHandle.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), eq(notifications.title, "Workflow notice")));
    const [task] = await dbHandle.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.title, "Workflow task")));
    const [approval] = await dbHandle.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.reason, "Workflow approval")));
    const [advisorRun] = await dbHandle.db
      .select({ id: advisorRuns.id, promptVersionId: advisorRuns.promptVersionId })
      .from(advisorRuns)
      .where(
        and(eq(advisorRuns.orgId, orgId), eq(advisorRuns.question, "Review workflow context")),
      );
    expect(notification).toBeDefined();
    expect(task).toBeDefined();
    expect(approval).toBeDefined();
    expect(advisorRun).toMatchObject({ promptVersionId: financePromptId });

    const childIds = [notification?.id, task?.id, approval?.id, advisorRun?.id].filter(
      (id): id is string => Boolean(id),
    );
    const childAudits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.action, "create"),
          inArray(auditEvents.resourceId, childIds),
        ),
      );
    expect(childAudits).toHaveLength(4);
    for (const audit of childAudits) {
      expect(audit.actorUserId).toBeNull();
      expect(audit.metadata).toMatchObject({
        actorType: "system",
        workflowRunId: run.id,
        initiatedBy: userId,
      });
      expect(typeof (audit.metadata as Record<string, unknown>).stepIndex).toBe("number");
      expect(audit.before).toBeNull();
      expect(audit.after).toBeTruthy();
    }
    expect(sentJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "notification.deliver" }),
        expect.objectContaining({ name: "advisor.run" }),
      ]),
    );
  });

  it("fails closed when a workflow tries to forge an internal approval type", async () => {
    for (const resourceType of ["external-action", "membership-lifecycle", "role-assignment"]) {
      const resourceId = randomUUID();
      const [definition] = await dbHandle.db
        .insert(workflowDefinitions)
        .values({
          orgId,
          name: `Reserved approval ${resourceType}`,
          trigger: "integration.reserved-approval",
          enabled: true,
          steps: [
            {
              type: "request_approval",
              config: {
                resourceType,
                resourceId,
                operation: "forged",
                reason: "A workflow must not impersonate a controlled approval",
              },
            },
          ],
        })
        .returning();
      if (!definition) throw new Error("Failed to create reserved approval workflow");
      const [run] = await dbHandle.db
        .insert(workflowRuns)
        .values({
          definitionId: definition.id,
          orgId,
          requestedBy: userId,
          input: {},
          definitionVersion: definition.version,
          stepsSnapshot: definition.steps,
        })
        .returning();
      if (!run) throw new Error("Failed to create reserved approval run");

      const dependencies: WorkerDependencies = {
        db: dbHandle.db,
        queue: { send: async () => randomUUID() } as unknown as JobQueue,
        llmProvider,
        github,
        config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
      };
      await handleWorkflowRun(dependencies, { orgId, runId: run.id });

      const [failed] = await dbHandle.db
        .select({ status: workflowRuns.status, error: workflowRuns.error })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, run.id));
      expect(failed).toMatchObject({ status: "failed" });
      expect(failed?.error).toContain("controlled business workflow");
      const forged = await dbHandle.db
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(eq(approvals.orgId, orgId), eq(approvals.resourceId, resourceId)));
      expect(forged).toHaveLength(0);
    }
  });

  it("atomically claims duplicate delivery and creates one set of child resources", async () => {
    const suffix = randomUUID().slice(0, 8);
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        orgId,
        name: `Concurrent workflow ${suffix}`,
        trigger: "integration.concurrent-delivery",
        enabled: true,
        steps: [
          {
            type: "notify",
            config: {
              recipientId: userId,
              title: `Concurrent notice ${suffix}`,
              body: "Created once",
            },
          },
          { type: "create_task", config: { title: `Concurrent task ${suffix}` } },
          {
            type: "request_approval",
            config: {
              resourceType: "contract",
              resourceId: randomUUID(),
              operation: "review",
              reason: `Concurrent approval ${suffix}`,
              riskLevel: "high",
            },
          },
          {
            type: "advisor_run",
            config: { advisor: "finance", question: `Concurrent advisor ${suffix}` },
          },
        ],
      })
      .returning();
    if (!definition) throw new Error("Failed to create concurrent workflow definition");
    const [run] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        definitionId: definition.id,
        orgId,
        requestedBy: userId,
        input: {},
        definitionVersion: definition.version,
        stepsSnapshot: definition.steps,
      })
      .returning();
    if (!run) throw new Error("Failed to create concurrent workflow run");

    let enterQueue!: () => void;
    let releaseQueue!: () => void;
    let sendCalls = 0;
    const queueEntered = new Promise<void>((resolve) => {
      enterQueue = resolve;
    });
    const queueGate = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queue = {
      send: async () => {
        sendCalls += 1;
        if (sendCalls === 1) enterQueue();
        await queueGate;
        return randomUUID();
      },
    } as unknown as JobQueue;
    const dependencies: WorkerDependencies = {
      db: dbHandle.db,
      queue,
      llmProvider,
      github,
      config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
    };

    const first = handleWorkflowRun(dependencies, { orgId, runId: run.id });
    await queueEntered;
    await handleWorkflowRun(dependencies, { orgId, runId: run.id });
    releaseQueue();
    await first;

    const [completed] = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    const createdNotifications = await dbHandle.db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.orgId, orgId), eq(notifications.title, `Concurrent notice ${suffix}`)),
      );
    const createdTasks = await dbHandle.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.title, `Concurrent task ${suffix}`)));
    const createdApprovals = await dbHandle.db
      .select()
      .from(approvals)
      .where(
        and(eq(approvals.orgId, orgId), eq(approvals.reason, `Concurrent approval ${suffix}`)),
      );
    const createdAdvisorRuns = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(
        and(eq(advisorRuns.orgId, orgId), eq(advisorRuns.question, `Concurrent advisor ${suffix}`)),
      );
    expect(completed?.status).toBe("completed");
    expect((completed?.output as { steps?: unknown[] } | null)?.steps).toHaveLength(4);
    expect(createdNotifications).toHaveLength(1);
    expect(createdTasks).toHaveLength(1);
    expect(createdApprovals).toHaveLength(1);
    expect(createdAdvisorRuns).toHaveLength(1);
    expect(sendCalls).toBe(2);
  });

  it("executes the immutable step snapshot even when the definition changes after queueing", async () => {
    const suffix = randomUUID().slice(0, 8);
    const originalTitle = `Frozen workflow task ${suffix}`;
    const replacementTitle = `Unapproved replacement task ${suffix}`;
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        orgId,
        name: `Frozen workflow ${suffix}`,
        trigger: "manual",
        enabled: true,
        steps: [{ type: "create_task", config: { title: originalTitle } }],
      })
      .returning();
    if (!definition) throw new Error("Failed to create frozen workflow definition");
    const [run] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        definitionId: definition.id,
        orgId,
        requestedBy: userId,
        input: {},
        definitionVersion: definition.version,
        stepsSnapshot: definition.steps,
      })
      .returning();
    if (!run) throw new Error("Failed to create frozen workflow run");
    await dbHandle.db
      .update(workflowDefinitions)
      .set({
        steps: [{ type: "create_task", config: { title: replacementTitle } }],
        version: definition.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowDefinitions.id, definition.id));

    await handleWorkflowRun(
      {
        db: dbHandle.db,
        queue: { send: async () => randomUUID() } as unknown as JobQueue,
        llmProvider,
        github,
        config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
      },
      { orgId, runId: run.id },
    );
    const created = await dbHandle.db
      .select({ title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.title, [originalTitle, replacementTitle]));
    expect(created).toEqual([{ title: originalTitle }]);
  });

  it("fails an expired running workflow without replaying partial steps", async () => {
    const suffix = randomUUID().slice(0, 8);
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        orgId,
        name: `Stale workflow ${suffix}`,
        trigger: "integration.stale-run",
        enabled: true,
        steps: [{ type: "create_task", config: { title: `Must not replay ${suffix}` } }],
      })
      .returning();
    if (!definition) throw new Error("Failed to create stale workflow definition");
    const [partialTask] = await dbHandle.db
      .insert(tasks)
      .values({ orgId, title: `Existing partial effect ${suffix}` })
      .returning();
    if (!partialTask) throw new Error("Failed to create partial workflow evidence");
    const partialOutput = {
      steps: [{ index: 0, type: "create_task", resourceId: partialTask.id }],
    };
    const staleAt = new Date(Date.now() - 10 * 60 * 1_000);
    const [run] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        definitionId: definition.id,
        orgId,
        requestedBy: userId,
        input: {},
        definitionVersion: definition.version,
        stepsSnapshot: definition.steps,
        output: partialOutput,
        status: "running",
        startedAt: staleAt,
        updatedAt: staleAt,
        version: 4,
      })
      .returning();
    if (!run) throw new Error("Failed to create stale workflow run");
    let sendCalls = 0;
    const dependencies: WorkerDependencies = {
      db: dbHandle.db,
      queue: {
        send: async () => {
          sendCalls += 1;
          return randomUUID();
        },
      } as unknown as JobQueue,
      llmProvider,
      github,
      config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
    };

    await handleWorkflowRun(dependencies, { orgId, runId: run.id });

    const [failed] = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    const replayedTasks = await dbHandle.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.orgId, orgId), eq(tasks.title, `Must not replay ${suffix}`)));
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, run.id),
          eq(auditEvents.action, "lease_expired"),
        ),
      );
    expect(failed).toMatchObject({ status: "failed", version: 5, output: partialOutput });
    expect(failed?.error).toContain("manual review");
    expect(replayedTasks).toHaveLength(0);
    expect(sendCalls).toBe(0);
    expect(audit?.metadata).toMatchObject({ actorType: "system" });
  });

  it("checkpoints a created child before a downstream enqueue failure", async () => {
    const suffix = randomUUID().slice(0, 8);
    const secret = `queue-secret-${suffix}`;
    const [definition] = await dbHandle.db
      .insert(workflowDefinitions)
      .values({
        orgId,
        name: `Queue failure workflow ${suffix}`,
        trigger: "integration.queue-failure",
        enabled: true,
        steps: [
          {
            type: "notify",
            config: {
              recipientId: userId,
              title: `Queue failure notice ${suffix}`,
              body: "Preserve this child as partial evidence",
            },
          },
        ],
      })
      .returning();
    if (!definition) throw new Error("Failed to create queue failure definition");
    const [run] = await dbHandle.db
      .insert(workflowRuns)
      .values({
        definitionId: definition.id,
        orgId,
        requestedBy: userId,
        input: {},
        definitionVersion: definition.version,
        stepsSnapshot: definition.steps,
      })
      .returning();
    if (!run) throw new Error("Failed to create queue failure workflow run");
    const dependencies: WorkerDependencies = {
      db: dbHandle.db,
      queue: {
        send: async () => {
          throw new Error(`Authorization: Bearer ${secret}`);
        },
      } as unknown as JobQueue,
      llmProvider,
      github,
      config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl, LLM_DRIVER: "mock" }),
    };

    await handleWorkflowRun(dependencies, { orgId, runId: run.id });

    const [failed] = await dbHandle.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, run.id));
    const [created] = await dbHandle.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.orgId, orgId),
          eq(notifications.title, `Queue failure notice ${suffix}`),
        ),
      );
    expect(failed?.status).toBe("failed");
    expect(failed?.error).not.toContain(secret);
    expect(failed?.error).toContain("[REDACTED]");
    expect((failed?.output as { steps?: Array<{ resourceId?: string }> } | null)?.steps).toEqual([
      expect.objectContaining({ index: 0, type: "notify", resourceId: created?.id }),
    ]);
  });
});
