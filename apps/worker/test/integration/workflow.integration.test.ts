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
      .values({ definitionId, orgId, requestedBy: userId, input: {} })
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
      config: workerConfigSchema.parse({ DATABASE_URL: databaseUrl }),
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
});
