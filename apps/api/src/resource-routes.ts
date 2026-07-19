import {
  idSchema,
  listQuerySchema,
  notificationMarkReadSchema,
  type ResourceName,
  resourceContracts,
  updateSchemaFor,
  workflowStepSchema,
} from "@fiatlux/contracts";
import { auditEvents, type Database, notifications, workflowDefinitions } from "@fiatlux/db";
import {
  assertArchivable,
  assertBusinessRules,
  DomainError,
  getAdvisor,
  hasPermission,
} from "@fiatlux/domain";
import { sanitizeIntegrationError } from "@fiatlux/integrations";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { assertResourceReferences } from "./reference-validation.js";
import { ResourceRepository, requestAuditContext } from "./resource-repository.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
export const resourceArchiveQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});

const queueFailureMessage = "Background queue dispatch failed";
type ResourceQueueJobData =
  | { orgId: string; runId: string }
  | { orgId: string; notificationId: string };

function canManageNotifications(request: FastifyRequest) {
  return (
    request.auth.permissions.includes("*") ||
    request.auth.permissions.includes("notifications:manage")
  );
}

function safeQueueError(error: unknown, fallback = queueFailureMessage) {
  return sanitizeIntegrationError(error, fallback, { maxLength: 500 });
}

async function assertNoLiveControlledAction(
  executor: Pick<Database, "execute">,
  input: {
    orgId: string;
    resource: "contracts" | "invoices";
    resourceId: string;
    operation: "update status" | "archive";
  },
) {
  const targetFilter =
    input.resource === "contracts"
      ? sql`kind IN ('contract_sign', 'contract_terminate') AND payload ->> 'contractId' = ${input.resourceId}`
      : sql`kind = 'invoice_red' AND payload ->> 'invoiceId' = ${input.resourceId}`;
  const result = await executor.execute(sql`
    SELECT id
    FROM external_actions
    WHERE org_id = ${input.orgId}
      AND archived_at IS NULL
      AND status IN ('pending_approval', 'approved', 'submitted', 'failed')
      AND ${targetFilter}
    LIMIT 1
  `);
  if (Array.from(result).length > 0) {
    throw new DomainError(
      "CONFLICT",
      `Cannot ${input.operation} while a controlled external action is unresolved`,
      409,
    );
  }
}

async function markQueueResourceFailed(
  repository: ResourceRepository,
  resource: "workflow-runs" | "notifications",
  created: Record<string, unknown>,
  request: FastifyRequest,
  reason: string,
) {
  const id = String(created.id);
  const expectedVersion = Number(created.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    request.log.error({ resource, id }, "queued resource has an invalid version");
    return;
  }
  try {
    await repository.update(
      resource,
      request.auth.orgId,
      id,
      resource === "workflow-runs"
        ? { status: "failed", error: reason }
        : { status: "failed", failureReason: reason },
      expectedVersion,
      requestAuditContext(request),
    );
  } catch (error) {
    request.log.error(
      { err: error, resource, id, requestId: request.id },
      "failed to persist queued-resource failure",
    );
  }
}

async function dispatchResourceJob(
  dependencies: AppDependencies,
  repository: ResourceRepository,
  resource: "workflow-runs" | "notifications",
  created: Record<string, unknown>,
  request: FastifyRequest,
  jobName: "workflow.run" | "notification.deliver",
  jobData: ResourceQueueJobData,
) {
  if (!dependencies.queue) {
    await markQueueResourceFailed(
      repository,
      resource,
      created,
      request,
      safeQueueError(
        new Error("Background queue is unavailable"),
        "Background queue is unavailable",
      ),
    );
    throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
  }
  try {
    await dependencies.queue.send(jobName, jobData);
  } catch (error) {
    await markQueueResourceFailed(repository, resource, created, request, safeQueueError(error));
    throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
  }
}

export function registerResourceRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  const repository = new ResourceRepository(dependencies.db);

  for (const [resource, createSchema] of Object.entries(resourceContracts) as [
    ResourceName,
    (typeof resourceContracts)[ResourceName],
  ][]) {
    const basePath = `/api/v1/${resource}`;

    app.get(
      basePath,
      {
        preHandler: [authenticate, requirePermission(`${resource}:read`)],
        schema: { tags: [resource], summary: `List ${resource}` },
      },
      async (request) => {
        const query = listQuerySchema.parse(request.query);
        const result = await repository.list(resource, {
          orgId: request.auth.orgId,
          page: query.page,
          pageSize: query.pageSize,
          ...(query.search ? { search: query.search } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(resource === "notifications" && !canManageNotifications(request)
            ? { recipientId: request.auth.userId }
            : {}),
        });
        return {
          data: result.items,
          meta: {
            page: query.page,
            pageSize: query.pageSize,
            total: result.total,
            pageCount: Math.ceil(result.total / query.pageSize),
          },
        };
      },
    );

    app.post(
      basePath,
      {
        preHandler: [authenticate, requirePermission(`${resource}:create`)],
        schema: { tags: [resource], summary: `Create ${resource}` },
      },
      async (request, reply) => {
        if (resource === "notifications" && !canManageNotifications(request)) {
          throw new DomainError("FORBIDDEN", "Only notification managers can create notices", 403);
        }
        const parsedInput = createSchema.parse(request.body) as Record<string, unknown>;
        const rawBody =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        if (resource === "financial-entries" && "externalActionId" in rawBody) {
          throw new DomainError(
            "APPROVAL_REQUIRED",
            "Payment links can only be created by the controlled bank-payment workflow",
            409,
          );
        }
        if (resource === "compliance-items" && !("status" in rawBody)) {
          parsedInput.status =
            parsedInput.reviewStatus === "reviewed" && parsedInput.lastVerifiedAt
              ? "active"
              : parsedInput.reviewStatus === "stale"
                ? "uncertain"
                : "draft";
        }
        let workflowDefinitionSnapshot:
          | { id: string; version: number; steps: z.infer<typeof workflowStepSchema>[] }
          | undefined;
        if (resource === "workflow-runs") {
          const [definition] = await dependencies.db
            .select()
            .from(workflowDefinitions)
            .where(
              and(
                eq(workflowDefinitions.id, String(parsedInput.definitionId)),
                eq(workflowDefinitions.orgId, request.auth.orgId),
                eq(workflowDefinitions.enabled, true),
                isNull(workflowDefinitions.archivedAt),
              ),
            )
            .limit(1);
          if (!definition) {
            throw new DomainError("CONFLICT", "Enabled workflow definition not found", 409);
          }
          const steps = z.array(workflowStepSchema).parse(definition.steps);
          for (const step of steps) {
            const requiredPermissions =
              step.type === "notify"
                ? ["notifications:create", "notifications:manage"]
                : step.type === "create_task"
                  ? ["tasks:create"]
                  : step.type === "request_approval"
                    ? ["approvals:create"]
                    : ["advisor-runs:create", getAdvisor(step.config.advisor).requiredPermission];
            if (
              requiredPermissions.some(
                (permission) => !hasPermission(request.auth.permissions, permission),
              )
            ) {
              throw new DomainError(
                "FORBIDDEN",
                `Workflow step ${step.type} exceeds the requester's permissions`,
                403,
              );
            }
            if (step.type === "advisor_run" && dependencies.config.LLM_DRIVER === "disabled") {
              throw new DomainError(
                "INTEGRATION_UNAVAILABLE",
                "AI advisors are explicitly disabled",
                503,
              );
            }
          }
          workflowDefinitionSnapshot = {
            id: definition.id,
            version: definition.version,
            steps,
          };
        }
        const input = workflowDefinitionSnapshot
          ? {
              ...parsedInput,
              requestedBy: request.auth.userId,
              definitionVersion: workflowDefinitionSnapshot.version,
              stepsSnapshot: workflowDefinitionSnapshot.steps,
            }
          : parsedInput;
        assertBusinessRules(resource, input);
        const created = await repository.create(
          resource,
          request.auth.orgId,
          input,
          requestAuditContext(request),
          async (tx) => {
            await assertResourceReferences(tx, request.auth.orgId, resource, input);
            if (workflowDefinitionSnapshot) {
              const locked = await tx.execute(sql`
                SELECT 1 FROM workflow_definitions
                WHERE id = ${workflowDefinitionSnapshot.id}
                  AND org_id = ${request.auth.orgId}
                  AND version = ${workflowDefinitionSnapshot.version}
                  AND enabled = true
                  AND archived_at IS NULL
                LIMIT 1
                FOR SHARE
              `);
              if (Array.from(locked).length === 0) {
                throw new DomainError(
                  "CONFLICT",
                  "Workflow definition changed while the run was being created",
                  409,
                );
              }
            }
          },
        );

        if (resource === "workflow-runs") {
          await dispatchResourceJob(
            dependencies,
            repository,
            resource,
            created,
            request,
            "workflow.run",
            { orgId: request.auth.orgId, runId: String(created.id) },
          );
        }
        if (resource === "notifications") {
          await dispatchResourceJob(
            dependencies,
            repository,
            resource,
            created,
            request,
            "notification.deliver",
            { orgId: request.auth.orgId, notificationId: String(created.id) },
          );
        }

        return reply.status(201).send({ data: created });
      },
    );

    app.get(
      `${basePath}/:id`,
      {
        preHandler: [authenticate, requirePermission(`${resource}:read`)],
        schema: { tags: [resource], summary: `Read one ${resource} record` },
      },
      async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        return {
          data: await repository.get(
            resource,
            request.auth.orgId,
            id,
            resource === "notifications" && !canManageNotifications(request)
              ? request.auth.userId
              : undefined,
          ),
        };
      },
    );

    app.patch(
      `${basePath}/:id`,
      {
        preHandler: [authenticate, requirePermission(`${resource}:update`)],
        schema: { tags: [resource], summary: `Update one ${resource} record` },
      },
      async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        if (resource === "notifications") {
          throw new DomainError(
            "INVALID_TRANSITION",
            "Notification content is immutable; use the dedicated read endpoint",
            409,
          );
        }
        const rawBody =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        if (resource === "financial-entries" && "externalActionId" in rawBody) {
          throw new DomainError(
            "APPROVAL_REQUIRED",
            "Payment links can only be changed by the controlled bank-payment workflow",
            409,
          );
        }
        const { expectedVersion, ...patch } = updateSchemaFor(resource).parse(rawBody) as Record<
          string,
          unknown
        > & { expectedVersion: number };
        const current = await repository.get(resource, request.auth.orgId, id);
        if (expectedVersion !== current.version) {
          throw new DomainError("CONFLICT", "The record changed since it was loaded", 409, {
            expectedVersion,
            actualVersion: current.version,
          });
        }
        if (
          resource === "compliance-items" &&
          !("status" in patch) &&
          ("reviewStatus" in patch || "lastVerifiedAt" in patch)
        ) {
          const reviewStatus = patch.reviewStatus ?? current.reviewStatus;
          const lastVerifiedAt = patch.lastVerifiedAt ?? current.lastVerifiedAt;
          patch.status =
            reviewStatus === "reviewed" && lastVerifiedAt
              ? "active"
              : reviewStatus === "stale"
                ? "uncertain"
                : "draft";
        }
        assertBusinessRules(resource, patch, current);
        const updated = await repository.update(
          resource,
          request.auth.orgId,
          id,
          patch,
          expectedVersion,
          requestAuditContext(request),
          async (tx) => {
            await assertResourceReferences(tx, request.auth.orgId, resource, patch);
            if (
              (resource === "contracts" || resource === "invoices") &&
              "status" in patch &&
              patch.status !== current.status
            ) {
              await assertNoLiveControlledAction(tx, {
                orgId: request.auth.orgId,
                resource,
                resourceId: id,
                operation: "update status",
              });
            }
          },
        );
        return { data: updated };
      },
    );

    app.delete(
      `${basePath}/:id`,
      {
        preHandler: [authenticate, requirePermission(`${resource}:delete`)],
        schema: { tags: [resource], summary: `Archive one ${resource} record` },
      },
      async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        if (resource === "notifications" && !canManageNotifications(request)) {
          throw new DomainError("FORBIDDEN", "Only notification managers can archive notices", 403);
        }
        const { expectedVersion } = resourceArchiveQuerySchema.parse(request.query);
        const current = await repository.get(resource, request.auth.orgId, id);
        if (expectedVersion !== current.version) {
          throw new DomainError("CONFLICT", "The record changed since it was loaded", 409, {
            expectedVersion,
            actualVersion: current.version,
          });
        }
        assertArchivable(resource, current);
        const archived = await repository.archive(
          resource,
          request.auth.orgId,
          id,
          expectedVersion,
          requestAuditContext(request),
          resource === "contracts" || resource === "invoices"
            ? (tx) =>
                assertNoLiveControlledAction(tx, {
                  orgId: request.auth.orgId,
                  resource,
                  resourceId: id,
                  operation: "archive",
                })
            : undefined,
        );
        return { data: archived };
      },
    );
  }

  app.post(
    "/api/v1/notifications/:id/read",
    {
      preHandler: [authenticate, requirePermission("notifications:read")],
      schema: { tags: ["notifications"], summary: "Mark the current user's in-app notice read" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const { expectedVersion } = notificationMarkReadSchema.parse(request.body);
      const context = requestAuditContext(request);
      const [result] = await dependencies.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.id, id),
              eq(notifications.orgId, request.auth.orgId),
              eq(notifications.recipientId, request.auth.userId),
              isNull(notifications.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND", "Notification not found", 404);
        if (current.version !== expectedVersion) {
          throw new DomainError("CONFLICT", "Notification changed concurrently", 409, {
            expectedVersion,
            actualVersion: current.version,
          });
        }
        if (current.readAt) return [current];
        if (current.channel !== "in_app" || !["queued", "sent"].includes(current.status)) {
          throw new DomainError(
            "INVALID_TRANSITION",
            "Only queued or delivered in-app notifications can be marked read",
            409,
          );
        }
        const now = new Date();
        const [changed] = await tx
          .update(notifications)
          .set({
            status: "read",
            readAt: now,
            updatedAt: now,
            version: sql`${notifications.version} + 1`,
          })
          .where(
            and(
              eq(notifications.id, current.id),
              eq(notifications.orgId, request.auth.orgId),
              eq(notifications.recipientId, request.auth.userId),
              eq(notifications.version, expectedVersion),
              inArray(notifications.status, ["queued", "sent"]),
            ),
          )
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "Notification changed concurrently", 409);
        await tx.insert(auditEvents).values({
          orgId: context.orgId,
          actorUserId: context.actorUserId,
          action: "mark_read",
          resourceType: "notification",
          resourceId: current.id,
          requestId: context.requestId,
          before: current,
          after: changed,
          metadata: {},
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
        return [changed];
      });
      return { data: result };
    },
  );
}
