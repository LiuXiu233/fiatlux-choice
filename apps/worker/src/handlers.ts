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
  workflowStepSchema,
} from "@fiatlux/contracts";
import {
  advisorCitations,
  advisorModelCalls,
  advisorRuns,
  approvals,
  auditEvents,
  backups,
  complianceEvents,
  complianceItems,
  complianceSourceSnapshots,
  type Database,
  githubInsights,
  memberships,
  notifications,
  obligations,
  organizations,
  projects,
  promptVersions,
  tasks,
  workflowRuns,
} from "@fiatlux/db";
import {
  assertAdvisorEvidenceAllowed,
  buildAdvisorInput,
  confidenceBasisPoints,
} from "@fiatlux/domain";
import {
  BACKUP_CLAIM_LEASE_SECONDS,
  type GitHubReader,
  type JobPayloads,
  type JobQueue,
  type LlmProvider,
  type OfficialSourceFetcher,
  OfficialSourceReader,
  sanitizeIntegrationError,
} from "@fiatlux/integrations";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { WorkerConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface WorkerDependencies {
  db: Database;
  queue: JobQueue;
  llmProvider: LlmProvider;
  github: GitHubReader;
  officialSource?: OfficialSourceFetcher;
  config: WorkerConfig;
}

function safeError(error: unknown) {
  return sanitizeIntegrationError(error, "Unknown worker error", { maxLength: 5_000 });
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

const RUN_CLAIM_LEASE_MS = 5 * 60 * 1_000;
const STALE_RUN_ERROR =
  "Worker execution lease expired; the prior attempt may have partial effects and requires manual review";

// A database dump can legitimately run for longer than the short advisor/workflow
// lease.  A duplicate delivery only expires a backup after this larger window;
// it never requeues or restarts the external backup command automatically.
export const BACKUP_CLAIM_LEASE_MS = BACKUP_CLAIM_LEASE_SECONDS * 1_000;
export const STALE_BACKUP_ERROR =
  "Backup execution lease expired; the prior attempt may have partial effects and requires manual review";

async function expireStaleAdvisorRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
  now: Date,
) {
  const staleBefore = new Date(now.getTime() - RUN_CLAIM_LEASE_MS);
  const [candidate] = await dependencies.db
    .select()
    .from(advisorRuns)
    .where(
      and(
        eq(advisorRuns.id, payload.runId),
        eq(advisorRuns.orgId, payload.orgId),
        eq(advisorRuns.status, "running"),
        lt(advisorRuns.updatedAt, staleBefore),
        isNull(advisorRuns.archivedAt),
      ),
    )
    .limit(1);
  if (!candidate) return false;

  return dependencies.db.transaction(async (tx) => {
    const [failed] = await tx
      .update(advisorRuns)
      .set({
        status: "failed",
        error: STALE_RUN_ERROR,
        completedAt: now,
        updatedAt: now,
        version: candidate.version + 1,
      })
      .where(
        and(
          eq(advisorRuns.id, candidate.id),
          eq(advisorRuns.orgId, candidate.orgId),
          eq(advisorRuns.status, "running"),
          eq(advisorRuns.version, candidate.version),
          lt(advisorRuns.updatedAt, staleBefore),
          isNull(advisorRuns.archivedAt),
        ),
      )
      .returning();
    if (!failed) return false;
    await tx
      .update(advisorModelCalls)
      .set({ status: "failed", error: STALE_RUN_ERROR, updatedAt: now })
      .where(
        and(
          eq(advisorModelCalls.orgId, payload.orgId),
          eq(advisorModelCalls.runId, candidate.id),
          eq(advisorModelCalls.status, "started"),
        ),
      );
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: "lease_expired",
      resourceType: "advisor-run",
      resourceId: candidate.id,
      before: candidate,
      after: failed,
      metadata: { error: STALE_RUN_ERROR, initiatedBy: candidate.requestedBy },
    });
    return true;
  });
}

export async function handleAdvisorRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
) {
  const claimTime = new Date();
  const [run] = await dependencies.db
    .update(advisorRuns)
    .set({
      status: "running",
      startedAt: claimTime,
      error: null,
      updatedAt: claimTime,
      version: sql`${advisorRuns.version} + 1`,
    })
    .where(
      and(
        eq(advisorRuns.id, payload.runId),
        eq(advisorRuns.orgId, payload.orgId),
        eq(advisorRuns.status, "queued"),
        isNull(advisorRuns.archivedAt),
      ),
    )
    .returning();
  if (!run) {
    await expireStaleAdvisorRun(dependencies, payload, claimTime);
    return;
  }

  let modelCall: typeof advisorModelCalls.$inferSelect | undefined;

  try {
    const [prompt] = await dependencies.db
      .select()
      .from(promptVersions)
      .where(
        and(eq(promptVersions.id, run.promptVersionId), eq(promptVersions.orgId, payload.orgId)),
      )
      .limit(1);
    if (!prompt) throw new Error("Advisor prompt version no longer exists");

    const modelInput = buildAdvisorInput({
      systemPrompt: prompt.systemPrompt,
      question: run.question,
      context: z.array(z.record(z.string(), z.unknown())).parse(run.contextSnapshot),
    });
    [modelCall] = await dependencies.db
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
    const claimedModelCall = modelCall;

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
        .where(eq(advisorModelCalls.id, claimedModelCall.id));
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
        .where(
          and(
            eq(advisorRuns.id, run.id),
            eq(advisorRuns.orgId, payload.orgId),
            eq(advisorRuns.status, "running"),
            eq(advisorRuns.version, run.version),
          ),
        )
        .returning();
      if (!completed) throw new Error("Advisor run claim was lost before completion");
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
        requestId: `worker:${claimedModelCall.id}`,
        before: run,
        after: completed,
        metadata: {
          actorType: "system",
          modelCallId: claimedModelCall.id,
          initiatedBy: run.requestedBy,
        },
      });
    });
  } catch (error) {
    const message = safeError(error);
    await dependencies.db.transaction(async (tx) => {
      if (modelCall) {
        await tx
          .update(advisorModelCalls)
          .set({ status: "failed", error: message, updatedAt: new Date() })
          .where(
            and(eq(advisorModelCalls.id, modelCall.id), eq(advisorModelCalls.status, "started")),
          );
      }
      const [failed] = await tx
        .update(advisorRuns)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
          version: run.version + 1,
        })
        .where(
          and(
            eq(advisorRuns.id, run.id),
            eq(advisorRuns.orgId, payload.orgId),
            eq(advisorRuns.status, "running"),
            eq(advisorRuns.version, run.version),
          ),
        )
        .returning();
      if (failed) {
        await tx.insert(auditEvents).values({
          orgId: payload.orgId,
          actorUserId: null,
          action: "fail",
          resourceType: "advisor-run",
          resourceId: run.id,
          requestId: `worker:${modelCall?.id ?? randomUUID()}`,
          before: run,
          after: failed,
          metadata: {
            actorType: "system",
            ...(modelCall ? { modelCallId: modelCall.id } : {}),
            error: message,
          },
        });
      }
    });
    throw new Error(`Advisor run failed: ${message}`);
  }
}

async function expireStaleWorkflowRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
  now: Date,
) {
  const staleBefore = new Date(now.getTime() - RUN_CLAIM_LEASE_MS);
  const [candidate] = await dependencies.db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, payload.runId),
        eq(workflowRuns.orgId, payload.orgId),
        eq(workflowRuns.status, "running"),
        lt(workflowRuns.updatedAt, staleBefore),
        isNull(workflowRuns.archivedAt),
      ),
    )
    .limit(1);
  if (!candidate) return false;

  return dependencies.db.transaction(async (tx) => {
    const [failed] = await tx
      .update(workflowRuns)
      .set({
        status: "failed",
        error: STALE_RUN_ERROR,
        finishedAt: now,
        updatedAt: now,
        version: candidate.version + 1,
      })
      .where(
        and(
          eq(workflowRuns.id, candidate.id),
          eq(workflowRuns.orgId, candidate.orgId),
          eq(workflowRuns.status, "running"),
          eq(workflowRuns.version, candidate.version),
          lt(workflowRuns.updatedAt, staleBefore),
          isNull(workflowRuns.archivedAt),
        ),
      )
      .returning();
    if (!failed) return false;
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: "lease_expired",
      resourceType: "workflow-run",
      resourceId: candidate.id,
      before: candidate,
      after: failed,
      metadata: { error: STALE_RUN_ERROR, initiatedBy: candidate.requestedBy },
    });
    return true;
  });
}

async function checkpointWorkflowRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
  claimVersion: number,
  results: Array<Record<string, unknown>>,
) {
  const [checkpointed] = await dependencies.db
    .update(workflowRuns)
    .set({ output: { steps: results }, updatedAt: new Date() })
    .where(
      and(
        eq(workflowRuns.id, payload.runId),
        eq(workflowRuns.orgId, payload.orgId),
        eq(workflowRuns.status, "running"),
        eq(workflowRuns.version, claimVersion),
      ),
    )
    .returning({ id: workflowRuns.id });
  if (!checkpointed) throw new Error("Workflow run claim was lost while checkpointing");
}

export async function handleWorkflowRun(
  dependencies: WorkerDependencies,
  payload: { orgId: string; runId: string },
) {
  const claimTime = new Date();
  const [run] = await dependencies.db
    .update(workflowRuns)
    .set({
      status: "running",
      startedAt: claimTime,
      finishedAt: null,
      output: null,
      error: null,
      updatedAt: claimTime,
      version: sql`${workflowRuns.version} + 1`,
    })
    .where(
      and(
        eq(workflowRuns.id, payload.runId),
        eq(workflowRuns.orgId, payload.orgId),
        eq(workflowRuns.status, "queued"),
        isNull(workflowRuns.archivedAt),
      ),
    )
    .returning();
  if (!run) {
    await expireStaleWorkflowRun(dependencies, payload, claimTime);
    return;
  }
  const results: Array<Record<string, unknown>> = [];

  try {
    if (!Number.isInteger(run.definitionVersion) || !run.stepsSnapshot) {
      throw new Error("Workflow run is missing its immutable definition snapshot");
    }
    const steps = z.array(workflowStepSchema).parse(run.stepsSnapshot);
    for (const [index, step] of steps.entries()) {
      let enqueueAfterCheckpoint: (() => Promise<unknown>) | undefined;
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
        results.push({ index, type: step.type, resourceId: created.id });
        enqueueAfterCheckpoint = () =>
          dependencies.queue.send("notification.deliver", {
            orgId: payload.orgId,
            notificationId: created.id,
          });
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
        if (dependencies.config.LLM_DRIVER === "disabled") {
          throw new Error("AI advisors are explicitly disabled");
        }
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
        results.push({ index, type: step.type, resourceId: created.id });
        enqueueAfterCheckpoint = () =>
          dependencies.queue.send("advisor.run", { orgId: payload.orgId, runId: created.id });
      }
      await checkpointWorkflowRun(dependencies, payload, run.version, results);
      await enqueueAfterCheckpoint?.();
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
        .where(
          and(
            eq(workflowRuns.id, run.id),
            eq(workflowRuns.orgId, payload.orgId),
            eq(workflowRuns.status, "running"),
            eq(workflowRuns.version, run.version),
          ),
        )
        .returning();
      if (!completed) throw new Error("Workflow run claim was lost before completion");
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
    const message = safeError(error);
    await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(workflowRuns)
        .set({
          status: "failed",
          error: message,
          finishedAt: new Date(),
          updatedAt: new Date(),
          version: run.version + 1,
        })
        .where(
          and(
            eq(workflowRuns.id, run.id),
            eq(workflowRuns.orgId, payload.orgId),
            eq(workflowRuns.status, "running"),
            eq(workflowRuns.version, run.version),
          ),
        )
        .returning();
      if (failed) {
        await appendSystemAudit(tx, {
          orgId: payload.orgId,
          action: "fail",
          resourceType: "workflow-run",
          resourceId: run.id,
          before: run,
          after: failed,
          metadata: { error: message, initiatedBy: run.requestedBy },
        });
      }
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
        version: sql`${notifications.version} + 1`,
      })
      .where(
        and(
          eq(notifications.id, notification.id),
          eq(notifications.orgId, payload.orgId),
          eq(notifications.status, "queued"),
          eq(notifications.version, notification.version),
        ),
      )
      .returning();
    if (!updated) return;
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
  payload: JobPayloads["github.refresh"],
) {
  const [insight] = await dependencies.db
    .select()
    .from(githubInsights)
    .where(
      and(
        eq(githubInsights.id, payload.insightId),
        eq(githubInsights.orgId, payload.orgId),
        eq(githubInsights.version, payload.expectedVersion),
        isNull(githubInsights.archivedAt),
      ),
    )
    .limit(1);
  if (!insight) return;
  let snapshot: Awaited<ReturnType<GitHubReader["getRepository"]>>;
  try {
    snapshot = await dependencies.github.getRepository(insight.repository);
  } catch (error) {
    const message = safeError(error);
    await appendSystemAudit(dependencies.db, {
      orgId: payload.orgId,
      action: "refresh_fail",
      resourceType: "github-insight",
      resourceId: insight.id,
      before: insight,
      metadata: { error: message, integrationMode: "read_only" },
    });
    throw new Error(`GitHub refresh failed: ${message}`);
  }
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
      .where(
        and(
          eq(githubInsights.id, insight.id),
          eq(githubInsights.orgId, payload.orgId),
          eq(githubInsights.version, payload.expectedVersion),
          isNull(githubInsights.archivedAt),
        ),
      )
      .returning();
    if (!updated) return;
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

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const MONITORING_LEASE_MS = 2 * 60 * 60 * 1_000;

function nextMonitorAt(now: Date, cadenceDays: number, failed = false) {
  const days = failed ? Math.min(cadenceDays, 1) : cadenceDays;
  return new Date(now.getTime() + Math.max(1, days) * ONE_DAY_MS);
}

async function expireOverdueComplianceReviews(
  dependencies: WorkerDependencies,
  orgId: string,
  now: Date,
) {
  return dependencies.db.transaction(async (tx) => {
    const overdue = await tx
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.orgId, orgId),
          eq(complianceItems.reviewStatus, "reviewed"),
          lte(complianceItems.nextReviewAt, now),
          isNull(complianceItems.archivedAt),
        ),
      );
    const expiredIds: string[] = [];
    for (const source of overdue) {
      const [expired] = await tx
        .update(complianceItems)
        .set({
          reviewStatus: "stale",
          status: "uncertain",
          nextMonitorAt: now,
          updatedAt: now,
          version: sql`${complianceItems.version} + 1`,
        })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, orgId),
            eq(complianceItems.reviewStatus, "reviewed"),
            eq(complianceItems.version, source.version),
            lte(complianceItems.nextReviewAt, now),
          ),
        )
        .returning();
      if (!expired) continue;
      expiredIds.push(expired.id);
      await appendSystemAudit(tx, {
        orgId,
        action: "review_expired",
        resourceType: "compliance-item",
        resourceId: expired.id,
        before: {
          reviewStatus: source.reviewStatus,
          status: source.status,
          nextReviewAt: source.nextReviewAt,
        },
        after: {
          reviewStatus: expired.reviewStatus,
          status: expired.status,
          nextReviewAt: expired.nextReviewAt,
        },
        metadata: { trigger: "schedule" },
      });
    }
    return expiredIds;
  });
}

async function enqueueDueComplianceSources(dependencies: WorkerDependencies, orgId: string) {
  const now = new Date();
  const expiredReviewIds = await expireOverdueComplianceReviews(dependencies, orgId, now);
  const dueSources = await dependencies.db
    .select({ id: complianceItems.id, version: complianceItems.version })
    .from(complianceItems)
    .where(
      and(
        eq(complianceItems.orgId, orgId),
        lte(complianceItems.nextMonitorAt, now),
        or(
          isNull(complianceItems.monitoringLeaseUntil),
          lte(complianceItems.monitoringLeaseUntil, now),
        ),
        isNull(complianceItems.archivedAt),
      ),
    )
    .limit(250);
  const queuedSourceIds: string[] = [];
  for (const source of dueSources) {
    const claimToken = randomUUID();
    const leaseUntil = new Date(now.getTime() + MONITORING_LEASE_MS);
    const [claimed] = await dependencies.db
      .update(complianceItems)
      .set({
        monitoringLeaseToken: claimToken,
        monitoringLeaseUntil: leaseUntil,
        monitoringJobId: null,
        updatedAt: now,
        version: sql`${complianceItems.version} + 1`,
      })
      .where(
        and(
          eq(complianceItems.id, source.id),
          eq(complianceItems.orgId, orgId),
          eq(complianceItems.version, source.version),
          lte(complianceItems.nextMonitorAt, now),
          or(
            isNull(complianceItems.monitoringLeaseUntil),
            lte(complianceItems.monitoringLeaseUntil, now),
          ),
          isNull(complianceItems.archivedAt),
        ),
      )
      .returning({ id: complianceItems.id });
    if (!claimed) continue;
    try {
      const jobId = await dependencies.queue.send("compliance-source.monitor", {
        orgId,
        sourceId: source.id,
        claimToken,
      });
      await dependencies.db
        .update(complianceItems)
        .set({ monitoringJobId: jobId, updatedAt: new Date() })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, orgId),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        );
      queuedSourceIds.push(source.id);
    } catch (error) {
      await dependencies.db
        .update(complianceItems)
        .set({
          monitoringLeaseToken: null,
          monitoringLeaseUntil: null,
          monitoringJobId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, orgId),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        );
      await appendSystemAudit(dependencies.db, {
        orgId,
        action: "monitor_dispatch_fail",
        resourceType: "compliance-item",
        resourceId: source.id,
        metadata: { error: safeError(error), trigger: "schedule" },
      });
      throw new Error(`Compliance monitoring dispatch failed: ${safeError(error)}`);
    }
  }
  await appendSystemAudit(dependencies.db, {
    orgId,
    action: "monitor_dispatch",
    resourceType: "compliance-source-monitor",
    resourceId: orgId,
    after: { queuedSourceIds },
    metadata: {
      trigger: "schedule",
      dueCount: dueSources.length,
      expiredReviewIds,
    },
  });
}

async function claimComplianceSource(
  dependencies: WorkerDependencies,
  payload: { orgId: string; sourceId: string; claimToken?: string },
) {
  if (payload.claimToken) {
    const [claimed] = await dependencies.db
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.id, payload.sourceId),
          eq(complianceItems.orgId, payload.orgId),
          eq(complianceItems.monitoringLeaseToken, payload.claimToken),
          isNull(complianceItems.archivedAt),
        ),
      )
      .limit(1);
    return claimed ? { source: claimed, claimToken: payload.claimToken } : null;
  }

  const now = new Date();
  const claimToken = randomUUID();
  const [claimed] = await dependencies.db
    .update(complianceItems)
    .set({
      monitoringLeaseToken: claimToken,
      monitoringLeaseUntil: new Date(now.getTime() + MONITORING_LEASE_MS),
      monitoringJobId: null,
      updatedAt: now,
      version: sql`${complianceItems.version} + 1`,
    })
    .where(
      and(
        eq(complianceItems.id, payload.sourceId),
        eq(complianceItems.orgId, payload.orgId),
        or(
          isNull(complianceItems.monitoringLeaseUntil),
          lte(complianceItems.monitoringLeaseUntil, now),
        ),
        isNull(complianceItems.archivedAt),
      ),
    )
    .returning();
  return claimed ? { source: claimed, claimToken } : null;
}

export async function handleComplianceSourceMonitor(
  dependencies: WorkerDependencies,
  payload: {
    orgId: string;
    sourceId?: string;
    requestedBy?: string;
    claimToken?: string;
  },
) {
  if (payload.orgId === "*") {
    const orgRows = await dependencies.db.select({ id: organizations.id }).from(organizations);
    for (const organization of orgRows) {
      await enqueueDueComplianceSources(dependencies, organization.id);
    }
    return;
  }
  if (!payload.sourceId) {
    await enqueueDueComplianceSources(dependencies, payload.orgId);
    return;
  }

  const claim = await claimComplianceSource(dependencies, {
    orgId: payload.orgId,
    sourceId: payload.sourceId,
    ...(payload.claimToken ? { claimToken: payload.claimToken } : {}),
  });
  if (!claim) return;
  const { source, claimToken } = claim;
  const reader = dependencies.officialSource ?? new OfficialSourceReader();
  const checkedAt = new Date();

  try {
    const snapshot = await reader.fetch({
      url: source.sourceUrl,
      etag: source.lastEtag,
      lastModified: source.lastModified,
    });
    if (snapshot.notModified && !source.contentHash) {
      throw new Error("Official source returned not-modified without a stored content baseline");
    }
    const observedHash = snapshot.normalizedHash ?? source.contentHash;
    const changed = Boolean(
      !snapshot.notModified &&
        source.contentHash &&
        observedHash &&
        source.contentHash !== observedHash,
    );
    const nextStatus = changed ? "changed" : "current";
    const updated = await dependencies.db.transaction(async (tx) => {
      const [savedSnapshot] = await tx
        .insert(complianceSourceSnapshots)
        .values({
          orgId: payload.orgId,
          sourceId: source.id,
          requestedUrl: snapshot.requestedUrl,
          finalUrl: snapshot.finalUrl,
          httpStatus: snapshot.httpStatus,
          contentType: snapshot.contentType,
          sizeBytes: snapshot.sizeBytes,
          etag: snapshot.etag,
          lastModified: snapshot.lastModified,
          rawHash: snapshot.rawHash,
          normalizedHash: snapshot.normalizedHash,
          previousContentHash: source.contentHash,
          normalizedExcerpt: snapshot.normalizedExcerpt,
          changed,
          notModified: snapshot.notModified,
          fetcherVersion: snapshot.fetcherVersion,
          fetchedAt: checkedAt,
        })
        .returning({ id: complianceSourceSnapshots.id });
      if (!savedSnapshot) throw new Error("Failed to persist the compliance source snapshot");
      const [record] = await tx
        .update(complianceItems)
        .set({
          contentHash: observedHash,
          rawSnapshotHash: snapshot.rawHash ?? source.rawSnapshotHash,
          contentHashStatus: nextStatus,
          reviewStatus: changed ? "stale" : source.reviewStatus,
          status: changed ? "uncertain" : source.status,
          lastCheckedAt: checkedAt,
          lastFetchedAt: checkedAt,
          lastResolvedUrl: snapshot.finalUrl,
          lastHttpStatus: snapshot.httpStatus,
          lastEtag: snapshot.etag ?? source.lastEtag,
          lastModified: snapshot.lastModified ?? source.lastModified,
          monitoringFailureCount: 0,
          lastMonitoringError: null,
          monitoringLeaseToken: null,
          monitoringLeaseUntil: null,
          monitoringJobId: null,
          nextMonitorAt: nextMonitorAt(checkedAt, source.monitoringCadenceDays),
          updatedAt: checkedAt,
          version: sql`${complianceItems.version} + 1`,
        })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, payload.orgId),
            eq(complianceItems.version, source.version),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        )
        .returning();
      if (!record) throw new Error("Compliance source changed concurrently during monitoring");
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: changed ? "monitor_change_detected" : "monitor_complete",
        resourceType: "compliance-item",
        resourceId: source.id,
        before: {
          contentHash: source.contentHash,
          contentHashStatus: source.contentHashStatus,
          reviewStatus: source.reviewStatus,
          status: source.status,
          monitoringFailureCount: source.monitoringFailureCount,
        },
        after: {
          contentHash: record.contentHash,
          contentHashStatus: record.contentHashStatus,
          reviewStatus: record.reviewStatus,
          status: record.status,
          monitoringFailureCount: record.monitoringFailureCount,
          snapshotId: savedSnapshot.id,
        },
        metadata: {
          initiatedBy: payload.requestedBy ?? null,
          trigger: payload.requestedBy ? "manual" : "schedule",
          httpStatus: snapshot.httpStatus,
          finalHost: new URL(snapshot.finalUrl).hostname,
          fetcherVersion: snapshot.fetcherVersion,
          notModified: snapshot.notModified,
        },
      });
      return record;
    });
    return updated;
  } catch (error) {
    const message = safeError(error);
    const failureCount = source.monitoringFailureCount + 1;
    const requiresReview = failureCount >= 3;
    const failurePersisted = await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(complianceItems)
        .set({
          contentHashStatus: "failed",
          lastCheckedAt: checkedAt,
          monitoringFailureCount: failureCount,
          lastMonitoringError: message,
          monitoringLeaseUntil: new Date(checkedAt.getTime() + MONITORING_LEASE_MS),
          reviewStatus: requiresReview ? "stale" : source.reviewStatus,
          status: requiresReview ? "uncertain" : source.status,
          nextMonitorAt: nextMonitorAt(checkedAt, source.monitoringCadenceDays, true),
          updatedAt: checkedAt,
          version: sql`${complianceItems.version} + 1`,
        })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, payload.orgId),
            eq(complianceItems.version, source.version),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        )
        .returning();
      if (!failed) return false;
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "monitor_fail",
        resourceType: "compliance-item",
        resourceId: source.id,
        before: {
          contentHashStatus: source.contentHashStatus,
          reviewStatus: source.reviewStatus,
          status: source.status,
          monitoringFailureCount: source.monitoringFailureCount,
        },
        after: {
          contentHashStatus: failed.contentHashStatus,
          reviewStatus: failed.reviewStatus,
          status: failed.status,
          monitoringFailureCount: failed.monitoringFailureCount,
        },
        metadata: {
          error: message,
          initiatedBy: payload.requestedBy ?? null,
          trigger: payload.requestedBy ? "manual" : "schedule",
        },
      });
      return true;
    });
    if (!failurePersisted) {
      await dependencies.db
        .update(complianceItems)
        .set({
          monitoringLeaseToken: null,
          monitoringLeaseUntil: null,
          monitoringJobId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, payload.orgId),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        );
      await appendSystemAudit(dependencies.db, {
        orgId: payload.orgId,
        action: "monitor_result_discarded",
        resourceType: "compliance-item",
        resourceId: source.id,
        metadata: {
          reason: "source_changed_concurrently",
          initiatedBy: payload.requestedBy ?? null,
        },
      });
      return;
    }
    throw new Error(`Compliance source monitoring failed: ${message}`);
  }
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
  const startOfTodayInChina = startOfChinaCalendarDay(now);
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
          lt(complianceEvents.dueDate, startOfTodayInChina),
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

export function startOfChinaCalendarDay(now: Date): Date {
  const chinaCalendarDate = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${chinaCalendarDate}T00:00:00+08:00`);
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

async function expireStaleBackup(
  dependencies: WorkerDependencies,
  payload: { orgId: string; backupId: string },
  now: Date,
) {
  const staleBefore = new Date(now.getTime() - BACKUP_CLAIM_LEASE_MS);
  const [candidate] = await dependencies.db
    .select()
    .from(backups)
    .where(
      and(
        eq(backups.id, payload.backupId),
        eq(backups.orgId, payload.orgId),
        eq(backups.status, "running"),
        lt(backups.updatedAt, staleBefore),
        isNull(backups.archivedAt),
      ),
    )
    .limit(1);
  if (!candidate) return false;

  return dependencies.db.transaction(async (tx) => {
    const [failed] = await tx
      .update(backups)
      .set({
        status: "failed",
        error: STALE_BACKUP_ERROR,
        completedAt: now,
        updatedAt: now,
        version: candidate.version + 1,
      })
      .where(
        and(
          eq(backups.id, candidate.id),
          eq(backups.orgId, candidate.orgId),
          eq(backups.status, "running"),
          eq(backups.version, candidate.version),
          lt(backups.updatedAt, staleBefore),
          isNull(backups.archivedAt),
        ),
      )
      .returning();
    if (!failed) return false;
    await appendSystemAudit(tx, {
      orgId: payload.orgId,
      action: "lease_expired",
      resourceType: "backup",
      resourceId: candidate.id,
      before: candidate,
      after: failed,
      metadata: {
        error: STALE_BACKUP_ERROR,
        initiatedBy: candidate.requestedBy,
        automaticRetry: false,
      },
    });
    return true;
  });
}

export async function handleBackup(
  dependencies: WorkerDependencies,
  payload: { orgId: string; backupId: string },
) {
  const claimTime = new Date();
  // Claim in one conditional UPDATE.  Two workers receiving the same pg-boss
  // delivery can therefore never both run the external backup command.
  const [backup] = await dependencies.db
    .update(backups)
    .set({
      status: "running",
      startedAt: claimTime,
      completedAt: null,
      error: null,
      updatedAt: claimTime,
      version: sql`${backups.version} + 1`,
    })
    .where(
      and(
        eq(backups.id, payload.backupId),
        eq(backups.orgId, payload.orgId),
        eq(backups.status, "queued"),
        isNull(backups.archivedAt),
      ),
    )
    .returning();
  if (!backup) {
    // A duplicate delivery is a no-op while another worker is still within its
    // lease.  Once the lease is stale, fail the row for human investigation;
    // never restart a command that may have produced partial backup data.
    await expireStaleBackup(dependencies, payload, claimTime);
    return;
  }
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
          version: sql`${backups.version} + 1`,
        })
        .where(
          and(
            eq(backups.id, backup.id),
            eq(backups.orgId, payload.orgId),
            eq(backups.status, "running"),
            eq(backups.version, backup.version),
            isNull(backups.archivedAt),
          ),
        )
        .returning();
      if (!completed) throw new Error("Backup claim was lost before completion");
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
    const message = safeError(error);
    await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(backups)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${backups.version} + 1`,
        })
        .where(
          and(
            eq(backups.id, backup.id),
            eq(backups.orgId, payload.orgId),
            eq(backups.status, "running"),
            eq(backups.version, backup.version),
            isNull(backups.archivedAt),
          ),
        )
        .returning();
      if (!failed) return;
      await appendSystemAudit(tx, {
        orgId: payload.orgId,
        action: "fail",
        resourceType: "backup",
        resourceId: backup.id,
        before: backup,
        after: failed,
        metadata: { error: message },
      });
    });
  }
}
