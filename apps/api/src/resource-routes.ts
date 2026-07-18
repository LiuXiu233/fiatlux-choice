import {
  idSchema,
  listQuerySchema,
  type ResourceName,
  resourceContracts,
  updateSchemaFor,
} from "@fiatlux/contracts";
import { assertArchivable, assertBusinessRules, DomainError } from "@fiatlux/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { assertResourceReferences } from "./reference-validation.js";
import { ResourceRepository, requestAuditContext } from "./resource-repository.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
const archiveQuerySchema = z.object({ expectedVersion: z.coerce.number().int().min(1) });

const queueFailureMessage = "Background queue dispatch failed";
type ResourceQueueJobData =
  | { orgId: string; runId: string }
  | { orgId: string; notificationId: string };

function safeQueueError(error: unknown, fallback = queueFailureMessage) {
  const raw = error instanceof Error ? error.message : fallback;
  const sanitized = raw
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^,\s"'&}]+/gi, "$1[REDACTED]")
    .replace(/bearer\s+[A-Za-z0-9._~-]+/gi, "bearer [REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
  return sanitized || fallback;
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
        const parsedInput = createSchema.parse(request.body) as Record<string, unknown>;
        const rawBody =
          typeof request.body === "object" && request.body !== null
            ? (request.body as Record<string, unknown>)
            : {};
        if (resource === "compliance-items" && !("status" in rawBody)) {
          parsedInput.status =
            parsedInput.reviewStatus === "reviewed" && parsedInput.lastVerifiedAt
              ? "active"
              : parsedInput.reviewStatus === "stale"
                ? "uncertain"
                : "draft";
        }
        const input =
          resource === "workflow-runs"
            ? { ...parsedInput, requestedBy: request.auth.userId }
            : parsedInput;
        assertBusinessRules(resource, input);
        await assertResourceReferences(dependencies.db, request.auth.orgId, resource, input);
        const created = await repository.create(
          resource,
          request.auth.orgId,
          input,
          requestAuditContext(request),
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
        return { data: await repository.get(resource, request.auth.orgId, id) };
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
        const { expectedVersion, ...patch } = updateSchemaFor(resource).parse(
          request.body,
        ) as Record<string, unknown> & { expectedVersion: number };
        const current = await repository.get(resource, request.auth.orgId, id);
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
        await assertResourceReferences(dependencies.db, request.auth.orgId, resource, patch);
        const updated = await repository.update(
          resource,
          request.auth.orgId,
          id,
          patch,
          expectedVersion,
          requestAuditContext(request),
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
        const { expectedVersion } = archiveQuerySchema.parse(request.query);
        const current = await repository.get(resource, request.auth.orgId, id);
        assertArchivable(resource, current);
        const archived = await repository.archive(
          resource,
          request.auth.orgId,
          id,
          expectedVersion,
          requestAuditContext(request),
        );
        return { data: archived };
      },
    );
  }
}
