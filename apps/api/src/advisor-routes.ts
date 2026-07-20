import { randomUUID } from "node:crypto";
import {
  advisorKeySchema,
  advisorRunCreateSchema,
  advisorRunEditSchema,
  idSchema,
  listQuerySchema,
  resourceNameSchema,
} from "@fiatlux/contracts";
import {
  advisorCitations,
  advisorEdits,
  advisorModelCalls,
  advisorRuns,
  advisorToolCalls,
  auditEvents,
  complianceItems,
  promptVersions,
} from "@fiatlux/db";
import {
  ADVISORS,
  type AdvisorContextCandidate,
  advisorContextSizeBytes,
  assertAdvisorEvidenceAllowed,
  canAdvisorRead,
  confidenceBasisPoints,
  DomainError,
  filterAdvisorContext,
  getAdvisor,
  hasPermission,
  MAX_ADVISOR_CONTEXT_BYTES,
} from "@fiatlux/domain";
import { sanitizeIntegrationError } from "@fiatlux/integrations";
import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { ResourceRepository, requestAuditContext } from "./resource-repository.js";
import type { AppDependencies, RequestAuditContext } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
const advisorParamsSchema = z.object({ key: advisorKeySchema });
export const promptVersionCreateSchema = z.object({
  systemPrompt: z.string().trim().min(100).max(50_000),
  toolPolicy: z
    .record(z.string(), z.unknown())
    .default({ readOnly: true, humanApprovalForSideEffects: true }),
  dataScopes: z.array(z.string().min(1).max(100)).min(1).max(50),
});

function canReadAdvisorRun(
  run: typeof advisorRuns.$inferSelect,
  userId: string,
  permissions: readonly string[],
) {
  const canReadAll = permissions.includes("*") || permissions.includes("advisor-runs:read-all");
  if (run.requestedBy !== userId && !canReadAll) return false;
  const advisorKey = advisorKeySchema.safeParse(run.advisorKey);
  if (!advisorKey.success) return false;
  const advisor = getAdvisor(advisorKey.data);
  if (!hasPermission(permissions, advisor.requiredPermission)) return false;
  const references = z
    .array(z.object({ resourceType: z.string(), resourceId: z.string() }))
    .safeParse(run.contextRefs);
  if (!references.success) return false;
  return references.data.every((reference) =>
    hasPermission(permissions, `${reference.resourceType}:read`),
  );
}

function assertCanReadAdvisorRun(
  run: typeof advisorRuns.$inferSelect,
  userId: string,
  permissions: readonly string[],
) {
  if (!canReadAdvisorRun(run, userId, permissions)) {
    throw new DomainError("NOT_FOUND", "Advisor run not found", 404);
  }
}

function auditValue(
  context: RequestAuditContext,
  event: {
    action: string;
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  return {
    orgId: context.orgId,
    actorUserId: context.actorUserId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    requestId: context.requestId,
    before: event.before,
    after: event.after,
    metadata: event.metadata ?? {},
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}

const advisorQueueFailureMessage = "Background queue dispatch failed";

function safeQueueError(error: unknown, fallback = advisorQueueFailureMessage) {
  return sanitizeIntegrationError(error, fallback, { maxLength: 500 });
}

async function markAdvisorQueueFailed(
  dependencies: AppDependencies,
  request: FastifyRequest,
  created: typeof advisorRuns.$inferSelect,
  reason: string,
) {
  try {
    await dependencies.db.transaction(async (tx) => {
      const [failed] = await tx
        .update(advisorRuns)
        .set({
          status: "failed",
          error: reason,
          updatedAt: new Date(),
          version: sql`${advisorRuns.version} + 1`,
        })
        .where(
          and(
            eq(advisorRuns.id, created.id),
            eq(advisorRuns.orgId, request.auth.orgId),
            eq(advisorRuns.status, "queued"),
            eq(advisorRuns.version, created.version),
          ),
        )
        .returning();
      if (!failed) throw new Error("Advisor run changed before queue failure was recorded");
      await tx.insert(auditEvents).values(
        auditValue(requestAuditContext(request), {
          action: "queue_fail",
          resourceType: "advisor-run",
          resourceId: created.id,
          before: created,
          after: failed,
          metadata: { error: reason },
        }),
      );
    });
  } catch (error) {
    request.log.error(
      { err: error, runId: created.id, requestId: request.id },
      "failed to persist advisor queue failure",
    );
  }
}

export function registerAdvisorRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  const repository = new ResourceRepository(dependencies.db);

  app.get(
    "/api/v1/advisors",
    {
      preHandler: [authenticate, requirePermission("advisors:read")],
      schema: { tags: ["advisors"], summary: "List permission-aware company advisors" },
    },
    async (request) => {
      const activePrompts = await dependencies.db
        .select({
          advisorKey: promptVersions.advisorKey,
          versionNumber: promptVersions.versionNumber,
          updatedAt: promptVersions.updatedAt,
          dataScopes: promptVersions.dataScopes,
        })
        .from(promptVersions)
        .where(
          and(
            eq(promptVersions.orgId, request.auth.orgId),
            eq(promptVersions.active, true),
            isNull(promptVersions.archivedAt),
          ),
        );
      const data = ADVISORS.filter((advisor) =>
        hasPermission(request.auth.permissions, advisor.requiredPermission),
      ).map((advisor) => ({
        ...advisor,
        dataScopes: advisor.dataScopes.filter((scope) =>
          hasPermission(request.auth.permissions, `${scope}:read`),
        ),
        promptVersion: activePrompts.find((prompt) => prompt.advisorKey === advisor.key) ?? null,
      }));
      return { data };
    },
  );

  app.get(
    "/api/v1/advisors/:key/prompt-versions",
    {
      preHandler: [authenticate, requirePermission("advisors:read")],
      schema: { tags: ["advisors"], summary: "List auditable advisor prompt versions" },
    },
    async (request) => {
      const { key } = advisorParamsSchema.parse(request.params);
      const data = await dependencies.db
        .select()
        .from(promptVersions)
        .where(
          and(
            eq(promptVersions.orgId, request.auth.orgId),
            eq(promptVersions.advisorKey, key),
            isNull(promptVersions.archivedAt),
          ),
        )
        .orderBy(desc(promptVersions.versionNumber));
      return { data };
    },
  );

  app.post(
    "/api/v1/advisors/:key/prompt-versions",
    {
      preHandler: [authenticate, requirePermission("advisors:update")],
      schema: { tags: ["advisors"], summary: "Create and activate a new advisor prompt version" },
    },
    async (request, reply) => {
      const { key } = advisorParamsSchema.parse(request.params);
      const input = promptVersionCreateSchema.parse(request.body);
      const allowedScopes = getAdvisor(key).dataScopes;
      if (input.dataScopes.some((scope) => !allowedScopes.includes(scope))) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Prompt data scope exceeds the advisor policy",
          400,
        );
      }
      const existing = await dependencies.db
        .select({ versionNumber: promptVersions.versionNumber })
        .from(promptVersions)
        .where(
          and(eq(promptVersions.orgId, request.auth.orgId), eq(promptVersions.advisorKey, key)),
        )
        .orderBy(desc(promptVersions.versionNumber))
        .limit(1);
      const versionNumber = (existing[0]?.versionNumber ?? 0) + 1;
      const context = requestAuditContext(request);
      const [created] = await dependencies.db.transaction(async (tx) => {
        await tx
          .update(promptVersions)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(promptVersions.orgId, request.auth.orgId),
              eq(promptVersions.advisorKey, key),
              eq(promptVersions.active, true),
            ),
          );
        const [record] = await tx
          .insert(promptVersions)
          .values({
            orgId: request.auth.orgId,
            advisorKey: key,
            versionNumber,
            systemPrompt: input.systemPrompt,
            toolPolicy: input.toolPolicy,
            dataScopes: input.dataScopes,
            active: true,
            createdBy: request.auth.userId,
          })
          .returning();
        if (!record) throw new Error("Failed to create prompt version");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "prompt-version",
            resourceId: record.id,
            after: record,
          }),
        );
        return [record];
      });
      return reply.status(201).send({ data: created });
    },
  );

  app.get(
    "/api/v1/advisor-runs",
    {
      preHandler: [authenticate, requirePermission("advisor-runs:read")],
      schema: { tags: ["advisor-runs"], summary: "List advisor runs" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const clauses = [eq(advisorRuns.orgId, request.auth.orgId), isNull(advisorRuns.archivedAt)];
      if (query.status)
        clauses.push(
          eq(
            advisorRuns.status,
            query.status as "queued" | "running" | "completed" | "failed" | "cancelled",
          ),
        );
      if (query.search) clauses.push(ilike(advisorRuns.question, `%${query.search}%`));
      const where = and(...clauses);
      const authorized = (
        await dependencies.db
          .select()
          .from(advisorRuns)
          .where(where)
          .orderBy(desc(advisorRuns.createdAt))
      ).filter((run) => canReadAdvisorRun(run, request.auth.userId, request.auth.permissions));
      const total = authorized.length;
      const items = authorized.slice(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize,
      );
      return {
        data: items,
        meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) },
      };
    },
  );

  app.post(
    "/api/v1/advisor-runs",
    {
      preHandler: [authenticate, requirePermission("advisor-runs:create")],
      config: { rateLimit: { max: 12, timeWindow: "1 hour" } },
      schema: { tags: ["advisor-runs"], summary: "Queue a permission-filtered advisor run" },
    },
    async (request, reply) => {
      if (dependencies.config.LLM_DRIVER === "disabled") {
        throw new DomainError(
          "INTEGRATION_UNAVAILABLE",
          "AI advisors are explicitly disabled",
          503,
        );
      }
      const input = advisorRunCreateSchema.parse(request.body);
      const advisor = getAdvisor(input.advisor);
      if (!hasPermission(request.auth.permissions, advisor.requiredPermission)) {
        throw new DomainError(
          "FORBIDDEN",
          "The advisor requires data permissions you do not have",
          403,
        );
      }
      const [prompt] = await dependencies.db
        .select()
        .from(promptVersions)
        .where(
          and(
            eq(promptVersions.orgId, request.auth.orgId),
            eq(promptVersions.advisorKey, input.advisor),
            eq(promptVersions.active, true),
            isNull(promptVersions.archivedAt),
          ),
        )
        .orderBy(desc(promptVersions.versionNumber))
        .limit(1);
      if (!prompt)
        throw new DomainError("CONFLICT", "No active prompt version exists for this advisor", 409);
      const promptDataScopes = z.array(z.string()).parse(prompt.dataScopes);

      const candidates: AdvisorContextCandidate[] = [];
      for (const reference of input.context) {
        if (!canAdvisorRead(input.advisor, reference.resourceType)) {
          throw new DomainError(
            "FORBIDDEN",
            `Advisor cannot access ${reference.resourceType}`,
            403,
          );
        }
        if (!promptDataScopes.includes(reference.resourceType)) {
          throw new DomainError(
            "FORBIDDEN",
            `Active prompt version cannot access ${reference.resourceType}`,
            403,
          );
        }
        if (!hasPermission(request.auth.permissions, `${reference.resourceType}:read`)) {
          throw new DomainError(
            "FORBIDDEN",
            `You cannot provide ${reference.resourceType} context`,
            403,
          );
        }
        let record: Record<string, unknown>;
        if (reference.resourceType === "audit-events") {
          const [auditEvent] = await dependencies.db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.id, reference.resourceId),
                eq(auditEvents.orgId, request.auth.orgId),
              ),
            )
            .limit(1);
          if (!auditEvent) throw new DomainError("NOT_FOUND", "Audit event not found", 404);
          record = auditEvent;
        } else {
          const resourceResult = resourceNameSchema.safeParse(reference.resourceType);
          if (!resourceResult.success) {
            throw new DomainError(
              "VALIDATION_FAILED",
              `Unsupported advisor context type: ${reference.resourceType}`,
              400,
            );
          }
          record = await repository.get(
            resourceResult.data,
            request.auth.orgId,
            reference.resourceId,
          );
        }
        candidates.push({
          resourceType: reference.resourceType,
          resourceId: reference.resourceId,
          record,
        });
      }

      const complianceSourceIds = [
        ...new Set(
          candidates.flatMap((candidate) => {
            if (
              candidate.resourceType !== "compliance-events" &&
              candidate.resourceType !== "obligations"
            ) {
              return [];
            }
            return typeof candidate.record.sourceId === "string" ? [candidate.record.sourceId] : [];
          }),
        ),
      ];
      const complianceSourceReviews =
        complianceSourceIds.length > 0
          ? await dependencies.db
              .select({
                resourceId: complianceItems.id,
                version: complianceItems.version,
                status: complianceItems.status,
                reviewStatus: complianceItems.reviewStatus,
                contentHash: complianceItems.contentHash,
                metadataHash: complianceItems.metadataHash,
                reviewOutcome: complianceItems.reviewOutcome,
                reviewerName: complianceItems.reviewerName,
                reviewerRole: complianceItems.reviewerRole,
                reviewerOrganization: complianceItems.reviewerOrganization,
                reviewerQualification: complianceItems.reviewerQualification,
                reviewMissingInformation: complianceItems.reviewMissingInformation,
                reviewEvidenceFileId: complianceItems.reviewEvidenceFileId,
                reviewedByUserId: complianceItems.reviewedByUserId,
                reviewedAt: complianceItems.reviewedAt,
                reviewedSourceVersion: complianceItems.reviewedSourceVersion,
                reviewedContentHash: complianceItems.reviewedContentHash,
                reviewedMetadataHash: complianceItems.reviewedMetadataHash,
                nextReviewAt: complianceItems.nextReviewAt,
              })
              .from(complianceItems)
              .where(
                and(
                  eq(complianceItems.orgId, request.auth.orgId),
                  inArray(complianceItems.id, complianceSourceIds),
                  isNull(complianceItems.archivedAt),
                ),
              )
          : [];
      const complianceSourceReviewById = new Map(
        complianceSourceReviews.map((source) => [source.resourceId, source]),
      );
      for (const candidate of candidates) {
        if (
          candidate.resourceType !== "compliance-events" &&
          candidate.resourceType !== "obligations"
        ) {
          continue;
        }
        const sourceId = candidate.record.sourceId;
        if (sourceId !== undefined && sourceId !== null) {
          candidate.complianceSourceReview =
            typeof sourceId === "string"
              ? (complianceSourceReviewById.get(sourceId) ?? null)
              : null;
        }
      }
      const filteredContext = filterAdvisorContext(candidates);
      const contextSnapshot = filteredContext.modelContext;
      const contextSizeBytes = advisorContextSizeBytes(contextSnapshot);
      if (contextSizeBytes > MAX_ADVISOR_CONTEXT_BYTES) {
        throw new DomainError(
          "PAYLOAD_TOO_LARGE",
          "Advisor context exceeds the 512 KB model-input safety limit; select fewer or smaller records",
          413,
          { contextSizeBytes, maxContextSizeBytes: MAX_ADVISOR_CONTEXT_BYTES },
        );
      }

      const runId = randomUUID();
      const context = requestAuditContext(request);
      const [created] = await dependencies.db.transaction(async (tx) => {
        const [run] = await tx
          .insert(advisorRuns)
          .values({
            id: runId,
            orgId: request.auth.orgId,
            advisorKey: input.advisor,
            promptVersionId: prompt.id,
            requestedBy: request.auth.userId,
            question: input.question,
            contextRefs: input.context,
            contextSnapshot,
          })
          .returning();
        if (!run) throw new Error("Failed to create advisor run");
        if (input.context.length > 0) {
          await tx.insert(advisorToolCalls).values(
            input.context.map((reference) => {
              const accepted = filteredContext.accepted.find(
                (candidate) =>
                  candidate.resourceId === reference.resourceId &&
                  candidate.resourceType === reference.resourceType,
              );
              const withheld = filteredContext.withheld.find(
                (candidate) =>
                  candidate.resourceId === reference.resourceId &&
                  candidate.resourceType === reference.resourceType,
              );
              const modelContext = contextSnapshot.find(
                (candidate) =>
                  candidate.resourceId === reference.resourceId &&
                  candidate.resourceType === reference.resourceType,
              );
              return {
                orgId: request.auth.orgId,
                runId,
                toolName: "company_data.read",
                input: reference,
                output:
                  accepted && modelContext
                    ? modelContext
                    : {
                        withheld: true,
                        reasons: withheld?.reasons ?? ["compliance_review_policy_failed_closed"],
                      },
                status: accepted && modelContext ? "completed" : "withheld",
              };
            }),
          );
          if (filteredContext.accepted.length > 0)
            await tx.insert(advisorCitations).values(
              filteredContext.accepted.map((reference) => ({
                orgId: request.auth.orgId,
                runId,
                sourceType: reference.resourceType,
                sourceId: reference.resourceId,
              })),
            );
        }
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "advisor-run",
            resourceId: runId,
            after: run,
            metadata: {
              promptVersionId: prompt.id,
              contextCount: input.context.length,
              contextSizeBytes,
              withheldComplianceCount: filteredContext.withheldComplianceCount,
              withheldComplianceReasonCounts: filteredContext.withheldReasonCounts,
            },
          }),
        );
        return [run];
      });

      try {
        if (!dependencies.queue) {
          throw new Error("Background queue is unavailable");
        }
        await dependencies.queue.send("advisor.run", { orgId: request.auth.orgId, runId });
      } catch (error) {
        await markAdvisorQueueFailed(dependencies, request, created, safeQueueError(error));
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      }
      return reply.status(201).send({ data: created });
    },
  );

  app.get(
    "/api/v1/advisor-runs/:id",
    {
      preHandler: [authenticate, requirePermission("advisor-runs:read")],
      schema: { tags: ["advisor-runs"], summary: "Read a complete advisor audit record" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [run] = await dependencies.db
        .select()
        .from(advisorRuns)
        .where(
          and(
            eq(advisorRuns.id, id),
            eq(advisorRuns.orgId, request.auth.orgId),
            isNull(advisorRuns.archivedAt),
          ),
        )
        .limit(1);
      if (!run) throw new DomainError("NOT_FOUND", "Advisor run not found", 404);
      assertCanReadAdvisorRun(run, request.auth.userId, request.auth.permissions);
      const [modelCalls, toolCalls, citations, edits] = await Promise.all([
        dependencies.db
          .select()
          .from(advisorModelCalls)
          .where(
            and(eq(advisorModelCalls.orgId, request.auth.orgId), eq(advisorModelCalls.runId, id)),
          )
          .orderBy(advisorModelCalls.createdAt),
        dependencies.db
          .select()
          .from(advisorToolCalls)
          .where(
            and(eq(advisorToolCalls.orgId, request.auth.orgId), eq(advisorToolCalls.runId, id)),
          )
          .orderBy(advisorToolCalls.createdAt),
        dependencies.db
          .select()
          .from(advisorCitations)
          .where(
            and(eq(advisorCitations.orgId, request.auth.orgId), eq(advisorCitations.runId, id)),
          ),
        dependencies.db
          .select()
          .from(advisorEdits)
          .where(and(eq(advisorEdits.orgId, request.auth.orgId), eq(advisorEdits.runId, id)))
          .orderBy(advisorEdits.createdAt),
      ]);
      return { data: { ...run, modelCalls, toolCalls, citations, edits } };
    },
  );

  app.patch(
    "/api/v1/advisor-runs/:id",
    {
      preHandler: [authenticate, requirePermission("advisor-runs:update")],
      schema: { tags: ["advisor-runs"], summary: "Record a human edit to advisor output" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = advisorRunEditSchema.parse(request.body);
      const [current] = await dependencies.db
        .select()
        .from(advisorRuns)
        .where(
          and(
            eq(advisorRuns.id, id),
            eq(advisorRuns.orgId, request.auth.orgId),
            isNull(advisorRuns.archivedAt),
          ),
        )
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "Advisor run not found", 404);
      assertCanReadAdvisorRun(current, request.auth.userId, request.auth.permissions);
      if (input.expectedVersion !== current.version) {
        throw new DomainError("CONFLICT", "Advisor run changed concurrently", 409, {
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }
      if (current.status !== "completed")
        throw new DomainError("CONFLICT", "Only completed advisor output can be edited", 409);
      try {
        assertAdvisorEvidenceAllowed(
          input.output,
          z.array(z.record(z.string(), z.unknown())).parse(current.contextSnapshot),
        );
      } catch (error) {
        throw new DomainError(
          "VALIDATION_FAILED",
          error instanceof Error ? error.message : "Advisor evidence is not allowed",
          400,
        );
      }
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(advisorRuns)
          .set({
            output: input.output,
            confidence: confidenceBasisPoints(input.output),
            version: sql`${advisorRuns.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(advisorRuns.id, id), eq(advisorRuns.version, input.expectedVersion)))
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "Advisor run changed concurrently", 409);
        await tx.insert(advisorEdits).values({
          orgId: request.auth.orgId,
          runId: id,
          editedBy: request.auth.userId,
          before: current.output ?? {},
          after: input.output,
          reason: input.reason,
        });
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "human_edit",
            resourceType: "advisor-run",
            resourceId: id,
            before: current.output,
            after: input.output,
            metadata: { reason: input.reason },
          }),
        );
        return [changed];
      });
      return { data: updated };
    },
  );
}
