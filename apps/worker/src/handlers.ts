import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  advisorKeySchema,
  advisorOutputSchema,
  approvalRequestSchema,
  notificationCreateSchema,
  taskCreateSchema,
} from "@fiatlux/contracts";
import {
  advisorCitations,
  advisorModelCalls,
  advisorRuns,
  approvals,
  auditEvents,
  backups,
  complianceEvents,
  type Database,
  githubInsights,
  memberships,
  notifications,
  obligations,
  organizations,
  projects,
  promptVersions,
  tasks,
  workflowDefinitions,
  workflowRuns,
} from "@fiatlux/db";
import {
  assertAdvisorEvidenceAllowed,
  buildAdvisorInput,
  confidenceBasisPoints,
} from "@fiatlux/domain";
import type { GitHubReader, JobQueue, LlmProvider } from "@fiatlux/integrations";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import type { WorkerConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface WorkerDependencies {
  db: Database;
  queue: JobQueue;
  llmProvider: LlmProvider;
  github: GitHubReader;
  config: WorkerConfig;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 5_000) : "Unknown worker error";
}

async function appendSystemAudit(
  db: Pick<Database, "insert">,
  input: {
    orgId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    orgId: input.orgId,
    actorUserId: null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: `worker:${randomUUID()}`,
    before: input.before,
    after: input.after,
    metadata: { actorType: "system", ...(input.metadata ?? {}) },
  });
}

export async function handleAdvisorRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
) {
  const [run] = await dependencies.db
    .select()
    .from(advisorRuns)
    .where(
      and(
        eq(advisorRuns.id, payload.runId),
        eq(advisorRuns.orgId, payload.orgId),
        inArray(advisorRuns.status, ["queued", "failed"]),
        isNull(advisorRuns.archivedAt),
      ),
    )
    .limit(1);
  if (!run) return;
  const [prompt] = await dependencies.db
    .select()
    .from(promptVersions)
    .where(and(eq(promptVersions.id, run.promptVersionId), eq(promptVersions.orgId, payload.orgId)))
    .limit(1);
  if (!prompt) throw new Error("Advisor prompt version no longer exists");

  const modelInput = buildAdvisorInput({
    systemPrompt: prompt.systemPrompt,
    question: run.question,
    context: z.array(z.record(z.string(), z.unknown())).parse(run.contextSnapshot),
  });
  const [modelCall] = await dependencies.db
    .insert(advisorModelCalls)
    .values({
      orgId: payload.orgId,
      runId: run.id,
      provider: dependencies.config.LLM_DRIVER,
      model:
        dependencies.config.LLM_DRIVER === "mock"
          ? "simulated-advisor-v1"
          : dependencies.config.LLM_MODEL,
      promptVersionId: prompt.id,
      requestPayload: modelInput,
      status: "started",
    })
    .returning();
  if (!modelCall) throw new Error("Failed to create model-call audit record");
  await dependencies.db
    .update(advisorRuns)
    .set({
      status: "running",
      startedAt: new Date(),
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(advisorRuns.id, run.id));

  try {
    const result = await dependencies.llmProvider.completeAdvisor(modelInput);
    const output = advisorOutputSchema.parse(result.output);
    assertAdvisorEvidenceAllowed(
      output,
      z.array(z.record(z.string(), z.unknown())).parse(run.contextSnapshot),
    );
    await dependencies.db.transaction(async (tx) => {
      await tx
        .update(advisorModelCalls)
        .set({
          provider: result.provider,
          model: result.model,
          responsePayload: result.rawResponse,
          status: "completed",
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          updatedAt: new Date(),
        })
        .where(eq(advisorModelCalls.id, modelCall.id));
      const [completed] = await tx
        .update(advisorRuns)
        .set({
          status: "completed",
          output,
          confidence: confidenceBasisPoints(output),
          completedAt: new Date(),
          updatedAt: new Date(),
          version: run.version + 1,
        })
        .where(eq(advisorRuns.id, run.id))
        .returning();
      const citations = output.facts.flatMap((fact) =>
        fact.evidence.map((evidence) => ({
          orgId: payload.orgId,
          runId: run.id,
          sourceType: evidence.sourceType,
          sourceId: evidence.sourceId,
          excerpt: evidence.excerpt,
        })),
      );
      if (citations.length > 0) await tx.insert(advisorCitations).values(citations);
      await tx.insert(auditEvents).values({
        orgId: payload.orgId,
        actorUserId: null,
        action: "complete",
        resourceType: "advisor-run",
        resourceId: run.id,
        requestId: `worker:${modelCall.id}`,
        before: run,
        after: completed,
        metadata: { actorType: "system", modelCallId: modelCall.id, initiatedBy: run.requestedBy },
      });
    });
  } catch (error) {
    const message = safeError(error);
    await dependencies.db.transaction(async (tx) => {
      await tx
        .update(advisorModelCalls)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(eq(advisorModelCalls.id, modelCall.id));
      await tx
        .update(advisorRuns)
        .set({ status: "failed", error: message, updatedAt: new Date() })
        .where(eq(advisorRuns.id, run.id));
      await tx.insert(auditEvents).values({
        orgId: payload.orgId,
        actorUserId: null,
        action: "fail",
        resourceType: "advisor-run",
        resourceId: run.id,
        requestId: `worker:${modelCall.id}`,
        metadata: { actorType: "system", modelCallId: modelCall.id, error: message },
      });
    });
    throw error;
  }
}

const workflowStepSchema = z.object({
  type: z.enum(["notify", "create_task", "request_approval", "advisor_run"]),
  config: z.record(z.string(), z.unknown()),
});

export async function handleWorkflowRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
) {
  const [run] = await dependencies.db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, payload.runId),
        eq(workflowRuns.orgId, payload.orgId),
        eq(workflowRuns.status, "queued"),
      ),
    )
    .limit(1);
  if (!run) return;
  const [definition] = await dependencies.db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, run.definitionId),
        eq(workflowDefinitions.orgId, payload.orgId),
        eq(workflowDefinitions.enabled, true),
        isNull(workflowDefinitions.archivedAt),
      ),
    )
    .limit(1);
  if (!definition) throw new Error("Enabled workflow definition not found");
  const steps = z.array(workflowStepSchema).parse(definition.steps);
  await dependencies.db
    .update(workflowRuns)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(workflowRuns.id, run.id));
  const results: Array<Record<string, unknown>> = [];

  try {
    for (const [index, step] of steps.entries()) {
      if (step.type === "notify") {
        const notification = notificationCreateSchema.parse(step.config);
        const [recipient] = await dependencies.db
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, payload.orgId),
              eq(memberships.userId, notification.recipientId),
              eq(memberships.status, "active"),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1);
        if (!recipient)
          throw new Error("Workflow notification recipient is outside the organization");
        const created = await dependencies.db.transaction(async (tx) => {
          const [record] = await tx
            .insert(notifications)
            .values({
              orgId: payload.orgId,
              ...notification,
            })
            .returning();
          if (!record) throw new Error("Workflow failed to create notification");
          await appendSystemAudit(tx, {
            orgId: payload.orgId,
            action: "create",
            resourceType: "notification",
            resourceId: record.id,
            after: record,
            metadata: {
              workflowRunId: run.id,
              stepIndex: index,
              initiatedBy: run.requestedBy,
            },
          });
          return record;
        });
        await dependencies.queue.send("notification.deliver", {
          orgId: payload.orgId,
          notificationId: created.id,
        });
        results.push({ index, type: step.type, resourceId: created.id });
      }
      if (step.type === "create_task") {
        const task = taskCreateSchema.parse(step.config);
        if (task.projectId) {
          const [project] = await dependencies.db
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, task.projectId),
                eq(projects.orgId, payload.orgId),
                isNull(projects.archivedAt),
              ),
            )
            .limit(1);
          if (!project) throw new Error("Workflow task project is outside the organization");
        }
        if (task.assigneeId) {
          const [assignee] = await dependencies.db
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.orgId, payload.orgId),
                eq(memberships.userId, task.assigneeId),
                eq(memberships.status, "active"),
                isNull(memberships.archivedAt),
              ),
            )
            .limit(1);
          if (!assignee) throw new Error("Workflow task assignee is outside the organization");
        }
        const created = await dependencies.db.transaction(async (tx) => {
          const [record] = await tx
            .insert(tasks)
            .values({
              orgId: payload.orgId,
              ...task,
              dueAt: task.dueAt ? new Date(task.dueAt) : null,
            })
            .returning();
          if (!record) throw new Error("Workflow failed to create task");
          await appendSystemAudit(tx, {
            orgId: payload.orgId,
            action: "create",
            resourceType: "task",
            resourceId: record.id,
            after: record,
            metadata: {
              workflowRunId: run.id,
              stepIndex: index,
              initiatedBy: run.requestedBy,
            },
          });
          return record;
        });
        results.push({ index, type: step.type, resourceId: created.id });
      }
      if (step.type === "request_approval") {
        const approval = approvalRequestSchema.parse(step.config);
        const created = await dependencies.db.transaction(async (tx) => {
          const [record] = await tx
            .insert(approvals)
            .values({
              orgId: payload.orgId,
              ...approval,
              requestedBy: run.requestedBy,
            })
            .returning();
          if (!record) throw new Error("Workflow failed to request approval");
          await appendSystemAudit(tx, {
            orgId: payload.orgId,
            action: "create",
            resourceType: "approval",
            resourceId: record.id,
            after: record,
            metadata: {
              workflowRunId: run.id,
              stepIndex: index,
              initiatedBy: run.requestedBy,
            },
          });
          return record;
        });
        results.push({ index, type: step.type, resourceId: created.id });
      }
      if (step.type === "advisor_run") {
        const advisor = z
          .object({ advisor: advisorKeySchema, question: z.string().min(1).max(20_000) })
          .parse(step.config);
        const [prompt] = await dependencies.db
          .select()
          .from(promptVersions)
          .where(
            and(
              eq(promptVersions.orgId, payload.orgId),
              eq(promptVersions.advisorKey, advisor.advisor),
              eq(promptVersions.active, true),
              isNull(promptVersions.archivedAt),
            ),
          )
          .limit(1);
        if (!prompt) throw new Error(`No active prompt for ${advisor.advisor}`);
        const created = await dependencies.db.transaction(async (tx) => {
          const [record] = await tx
            .insert(advisorRuns)
            .values({
              orgId: payload.orgId,
              advisorKey: advisor.advisor,
              promptVersionId: prompt.id,
              requestedBy: run.requestedBy,
              question: advisor.question,
              contextRefs: [],
              contextSnapshot: [],
            })
            .returning();
          if (!record) throw new Error("Workflow failed to create advisor run");
          await appendSystemAudit(tx, {
            orgId: payload.orgId,
            action: "create",
            resourceType: "advisor-run",
            resourceId: record.id,
            after: record,
            metadata: {
              workflowRunId: run.id,
              stepIndex: index,
              initiatedBy: run.requestedBy,
            },
          });
          return record;
        });
        await dependencies.queue.send("advisor.run", { orgId: payload.orgId, runId: created.id });
        results.push({ index, type: step.type, resourceId: created.id });
      }
    }

    await dependencies.db.transaction(async (tx) => {
      const [completed] = await tx
        .update(workflowRuns)
        .set({
          status: "completed",
          output: { steps: results },
          finishedAt: new Date(),
          updatedAt: new Date(),
          version: run.version + 1,
        })
        .where(eq(workflowRuns.id, run.id))
        .returning();
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "complete",
        resourceType: "workflow-run",
        resourceId: run.id,
        before: run,
        after: completed,
        metadata: { initiatedBy: run.requestedBy },
      });
    });
  } catch (error) {
    await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(workflowRuns)
        .set({
          status: "failed",
          error: safeError(error),
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(workflowRuns.id, run.id))
        .returning();
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "fail",
        resourceType: "workflow-run",
        resourceId: run.id,
        before: run,
        after: failed,
        metadata: { error: safeError(error), initiatedBy: run.requestedBy },
      });
    });
  }
}

export async function handleNotification(
  dependencies: WorkerDependencies,
  payload: { orgId: string; notificationId: string },
) {
  const [notification] = await dependencies.db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, payload.notificationId),
        eq(notifications.orgId, payload.orgId),
        eq(notifications.status, "queued"),
      ),
    )
    .limit(1);
  if (!notification) return;
  const isInApp = notification.channel === "in_app";
  await dependencies.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(notifications)
      .set({
        status: isInApp ? "sent" : "failed",
        sentAt: isInApp ? new Date() : null,
        failureReason: isInApp
          ? null
          : `${notification.channel} delivery adapter is not configured`,
        updatedAt: new Date(),
        version: notification.version + 1,
      })
      .where(eq(notifications.id, notification.id))
      .returning();
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: isInApp ? "deliver" : "delivery_fail",
      resourceType: "notification",
      resourceId: notification.id,
      before: notification,
      after: updated,
    });
  });
}

export async function handleGitHubRefresh(
  dependencies: WorkerDependencies,
  payload: { orgId: string; insightId: string },
) {
  const [insight] = await dependencies.db
    .select()
    .from(githubInsights)
    .where(
      and(
        eq(githubInsights.id, payload.insightId),
        eq(githubInsights.orgId, payload.orgId),
        isNull(githubInsights.archivedAt),
      ),
    )
    .limit(1);
  if (!insight) return;
  const snapshot = await dependencies.github.getRepository(insight.repository);
  await dependencies.db.transaction(async (tx) => {
    const [updated] = await tx
      .update(githubInsights)
      .set({
        summary: snapshot.description ?? `GitHub repository ${snapshot.repository}`,
        url: snapshot.url,
        capturedAt: new Date(),
        payload: snapshot,
        updatedAt: new Date(),
        version: insight.version + 1,
      })
      .where(eq(githubInsights.id, insight.id))
      .returning();
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: "refresh",
      resourceType: "github-insight",
      resourceId: insight.id,
      before: insight,
      after: updated,
    });
  });
}

export async function handleObligationSweep(
  dependencies: WorkerDependencies,
  payload: { orgId: string },
) {
  if (payload.orgId === "*") {
    const orgRows = await dependencies.db.select({ id: organizations.id }).from(organizations);
    for (const organization of orgRows) {
      await handleObligationSweep(dependencies, { orgId: organization.id });
    }
    return;
  }
  const now = new Date();
  await dependencies.db.transaction(async (tx) => {
    const overdueObligations = await tx
      .update(obligations)
      .set({
        status: "overdue",
        updatedAt: now,
        version: sql`${obligations.version} + 1`,
      })
      .where(
        and(
          eq(obligations.orgId, payload.orgId),
          inArray(obligations.status, ["open", "in_progress"]),
          lt(obligations.dueAt, now),
          isNull(obligations.archivedAt),
        ),
      )
      .returning({ id: obligations.id });
    const overdueEvents = await tx
      .update(complianceEvents)
      .set({
        status: "overdue",
        updatedAt: now,
        version: sql`${complianceEvents.version} + 1`,
      })
      .where(
        and(
          eq(complianceEvents.orgId, payload.orgId),
          inArray(complianceEvents.status, ["active", "pending"]),
          lt(complianceEvents.dueDate, now),
          isNull(complianceEvents.archivedAt),
        ),
      )
      .returning({ id: complianceEvents.id });
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: "sweep",
      resourceType: "compliance-calendar",
      resourceId: payload.orgId,
      after: {
        overdueObligationIds: overdueObligations.map((item) => item.id),
        overdueEventIds: overdueEvents.map((item) => item.id),
      },
    });
  });
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function runDatabaseBackup(config: WorkerConfig, backupId: string) {
  await mkdir(config.BACKUP_DIR, { recursive: true, mode: 0o700 });
  const target = join(config.BACKUP_DIR, `${backupId}.dump`);
  const url = new URL(config.DATABASE_URL);
  await execFileAsync(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--host",
      url.hostname,
      "--port",
      url.port || "5432",
      "--username",
      decodeURIComponent(url.username),
      "--dbname",
      url.pathname.replace(/^\//, ""),
      "--file",
      target,
    ],
    {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      timeout: 30 * 60 * 1_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const fileStat = await stat(target);
  return { storageKey: target, sizeBytes: fileStat.size, checksumSha256: await hashFile(target) };
}

export async function handleBackup(
  dependencies: WorkerDependencies,
  payload: { orgId: string; backupId: string },
) {
  const [backup] = await dependencies.db
    .select()
    .from(backups)
    .where(
      and(
        eq(backups.id, payload.backupId),
        eq(backups.orgId, payload.orgId),
        eq(backups.status, "queued"),
      ),
    )
    .limit(1);
  if (!backup) return;
  await dependencies.db
    .update(backups)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(backups.id, backup.id));
  try {
    let result: { storageKey: string; sizeBytes: number; checksumSha256: string };
    if (dependencies.config.BACKUP_COMMAND) {
      const commandResult = await execFileAsync(
        dependencies.config.BACKUP_COMMAND,
        [backup.id, backup.scope, dependencies.config.BACKUP_DIR],
        {
          timeout: 60 * 60 * 1_000,
          maxBuffer: 1024 * 1024,
        },
      );
      result = z
        .object({
          storageKey: z.string().min(1),
          sizeBytes: z.number().int().nonnegative(),
          checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(JSON.parse(commandResult.stdout.trim()));
    } else {
      if (backup.scope !== "database") {
        throw new Error("Full and file backups require the controlled BACKUP_COMMAND adapter");
      }
      result = await runDatabaseBackup(dependencies.config, backup.id);
    }
    await dependencies.db.transaction(async (tx) => {
      const [completed] = await tx
        .update(backups)
        .set({
          status: "completed",
          ...result,
          completedAt: new Date(),
          updatedAt: new Date(),
          version: backup.version + 1,
        })
        .where(eq(backups.id, backup.id))
        .returning();
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "complete",
        resourceType: "backup",
        resourceId: backup.id,
        before: backup,
        after: completed,
      });
    });
  } catch (error) {
    await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(backups)
        .set({
          status: "failed",
          error: safeError(error),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backups.id, backup.id))
        .returning();
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "fail",
        resourceType: "backup",
        resourceId: backup.id,
        before: backup,
        after: failed,
        metadata: { error: safeError(error) },
      });
    });
  }
}
