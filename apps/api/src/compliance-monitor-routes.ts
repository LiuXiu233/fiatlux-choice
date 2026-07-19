import { randomUUID } from "node:crypto";
import { complianceMonitorRequestSchema, idSchema } from "@fiatlux/contracts";
import { complianceItems, complianceSourceSnapshots } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { sanitizeIntegrationError } from "@fiatlux/integrations";
import { and, count, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { appendAuditEvent } from "./audit.js";
import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
export const complianceSnapshotListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
});
const MONITORING_LEASE_MS = 2 * 60 * 60 * 1_000;

function safeQueueError(error: unknown) {
  return sanitizeIntegrationError(error, "Background queue dispatch failed", { maxLength: 500 });
}

export function registerComplianceMonitorRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/compliance-items/:id/snapshots",
    {
      preHandler: [authenticate, requirePermission("compliance-items:read")],
      schema: {
        tags: ["compliance-items"],
        summary: "List append-only official-source monitoring snapshots",
      },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const query = complianceSnapshotListQuerySchema.parse(request.query);
      const [source] = await dependencies.db
        .select({ id: complianceItems.id })
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.id, id),
            eq(complianceItems.orgId, request.auth.orgId),
            isNull(complianceItems.archivedAt),
          ),
        )
        .limit(1);
      if (!source) throw new DomainError("NOT_FOUND", "Compliance source not found", 404);
      const where = and(
        eq(complianceSourceSnapshots.orgId, request.auth.orgId),
        eq(complianceSourceSnapshots.sourceId, source.id),
        isNull(complianceSourceSnapshots.archivedAt),
      );
      const [data, totals] = await Promise.all([
        dependencies.db
          .select()
          .from(complianceSourceSnapshots)
          .where(where)
          .orderBy(desc(complianceSourceSnapshots.fetchedAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(complianceSourceSnapshots).where(where),
      ]);
      const total = totals[0]?.total ?? 0;
      return {
        data,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  app.post(
    "/api/v1/compliance-items/:id/monitor",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preHandler: [authenticate, requirePermission("compliance-items:update")],
      schema: {
        tags: ["compliance-items"],
        summary: "Queue an allowlisted official-source monitoring check",
      },
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = complianceMonitorRequestSchema.parse(request.body ?? {});
      const [source] = await dependencies.db
        .select({
          id: complianceItems.id,
          sourceUrl: complianceItems.sourceUrl,
          contentHashStatus: complianceItems.contentHashStatus,
          reviewStatus: complianceItems.reviewStatus,
          version: complianceItems.version,
          monitoringLeaseToken: complianceItems.monitoringLeaseToken,
          monitoringLeaseUntil: complianceItems.monitoringLeaseUntil,
          monitoringJobId: complianceItems.monitoringJobId,
        })
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.id, id),
            eq(complianceItems.orgId, request.auth.orgId),
            isNull(complianceItems.archivedAt),
          ),
        )
        .limit(1);
      if (!source) throw new DomainError("NOT_FOUND", "Compliance source not found", 404);
      const auditContext = requestAuditContext(request);
      await appendAuditEvent(dependencies.db, auditContext, {
        action: "monitor_request",
        resourceType: "compliance-item",
        resourceId: source.id,
        before: {
          contentHashStatus: source.contentHashStatus,
          reviewStatus: source.reviewStatus,
        },
        metadata: { reason: input.reason ?? null, sourceHost: new URL(source.sourceUrl).hostname },
      });

      if (!dependencies.queue) {
        await appendAuditEvent(dependencies.db, auditContext, {
          action: "monitor_dispatch_fail",
          resourceType: "compliance-item",
          resourceId: source.id,
          metadata: { error: "Background queue is unavailable" },
        });
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
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
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, request.auth.orgId),
            eq(complianceItems.version, source.version),
            or(
              isNull(complianceItems.monitoringLeaseUntil),
              lte(complianceItems.monitoringLeaseUntil, now),
            ),
            isNull(complianceItems.archivedAt),
          ),
        )
        .returning({ id: complianceItems.id });
      if (!claimed) {
        const [inFlight] = await dependencies.db
          .select({
            monitoringJobId: complianceItems.monitoringJobId,
            monitoringLeaseToken: complianceItems.monitoringLeaseToken,
          })
          .from(complianceItems)
          .where(
            and(
              eq(complianceItems.id, source.id),
              eq(complianceItems.orgId, request.auth.orgId),
              isNull(complianceItems.archivedAt),
            ),
          )
          .limit(1);
        const existingJobId = inFlight?.monitoringJobId ?? inFlight?.monitoringLeaseToken;
        if (!existingJobId) {
          throw new DomainError("CONFLICT", "Compliance source changed concurrently", 409);
        }
        await appendAuditEvent(dependencies.db, auditContext, {
          action: "monitor_deduplicated",
          resourceType: "compliance-item",
          resourceId: source.id,
          after: { jobId: existingJobId, status: "queued" },
          metadata: { reason: input.reason ?? null },
        });
        return reply.status(202).send({
          data: { sourceId: source.id, jobId: existingJobId, status: "queued" as const },
        });
      }
      let jobId: string;
      try {
        jobId = await dependencies.queue.send("compliance-source.monitor", {
          orgId: request.auth.orgId,
          sourceId: source.id,
          requestedBy: request.auth.userId,
          claimToken,
        });
      } catch (error) {
        await dependencies.db
          .update(complianceItems)
          .set({
            monitoringLeaseToken: null,
            monitoringLeaseUntil: null,
            monitoringJobId: null,
            updatedAt: new Date(),
            version: sql`${complianceItems.version} + 1`,
          })
          .where(
            and(
              eq(complianceItems.id, source.id),
              eq(complianceItems.orgId, request.auth.orgId),
              eq(complianceItems.monitoringLeaseToken, claimToken),
            ),
          );
        await appendAuditEvent(dependencies.db, auditContext, {
          action: "monitor_dispatch_fail",
          resourceType: "compliance-item",
          resourceId: source.id,
          metadata: { error: safeQueueError(error) },
        });
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      }
      await dependencies.db
        .update(complianceItems)
        .set({ monitoringJobId: jobId, updatedAt: new Date() })
        .where(
          and(
            eq(complianceItems.id, source.id),
            eq(complianceItems.orgId, request.auth.orgId),
            eq(complianceItems.monitoringLeaseToken, claimToken),
          ),
        );
      await appendAuditEvent(dependencies.db, auditContext, {
        action: "monitor_dispatch",
        resourceType: "compliance-item",
        resourceId: source.id,
        after: { jobId, status: "queued" },
        metadata: { reason: input.reason ?? null },
      });
      return reply.status(202).send({
        data: { sourceId: source.id, jobId, status: "queued" as const },
      });
    },
  );
}
