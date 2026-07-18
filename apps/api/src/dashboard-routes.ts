import { idSchema, listQuerySchema } from "@fiatlux/contracts";
import {
  approvals,
  auditEvents,
  cashFlowEntries,
  contracts,
  objectives,
  obligations,
  risks,
  tasks,
} from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { and, asc, count, desc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });

async function scalarCount(query: Promise<Array<{ value: number }>>) {
  return (await query)[0]?.value ?? 0;
}

export function registerDashboardRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/dashboard",
    {
      preHandler: [authenticate, requirePermission("dashboard:read")],
      schema: { tags: ["dashboard"], summary: "Read operational company dashboard" },
    },
    async (request) => {
      const orgId = request.auth.orgId;
      const now = new Date();
      const [
        activeObjectives,
        openTasks,
        overdueObligations,
        openRisks,
        pendingApprovals,
        activeContracts,
        cashRows,
        urgentTasks,
        upcomingObligations,
      ] = await Promise.all([
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(objectives)
            .where(
              and(
                eq(objectives.orgId, orgId),
                inArray(objectives.status, ["active", "at_risk"]),
                isNull(objectives.archivedAt),
              ),
            ),
        ),
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(tasks)
            .where(
              and(
                eq(tasks.orgId, orgId),
                notInArray(tasks.status, ["done", "cancelled"]),
                isNull(tasks.archivedAt),
              ),
            ),
        ),
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(obligations)
            .where(
              and(
                eq(obligations.orgId, orgId),
                inArray(obligations.status, ["open", "in_progress", "overdue"]),
                lt(obligations.dueAt, now),
                isNull(obligations.archivedAt),
              ),
            ),
        ),
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(risks)
            .where(
              and(
                eq(risks.orgId, orgId),
                inArray(risks.status, ["open", "mitigating"]),
                isNull(risks.archivedAt),
              ),
            ),
        ),
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(approvals)
            .where(
              and(
                eq(approvals.orgId, orgId),
                eq(approvals.status, "pending"),
                isNull(approvals.archivedAt),
              ),
            ),
        ),
        scalarCount(
          dependencies.db
            .select({ value: count() })
            .from(contracts)
            .where(
              and(
                eq(contracts.orgId, orgId),
                eq(contracts.status, "active"),
                isNull(contracts.archivedAt),
              ),
            ),
        ),
        dependencies.db
          .select({
            direction: cashFlowEntries.direction,
            amountCents: sql<number>`COALESCE(SUM(${cashFlowEntries.amountCents}), 0)::bigint`,
          })
          .from(cashFlowEntries)
          .where(
            and(
              eq(cashFlowEntries.orgId, orgId),
              eq(cashFlowEntries.status, "actual"),
              isNull(cashFlowEntries.archivedAt),
            ),
          )
          .groupBy(cashFlowEntries.direction),
        dependencies.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, orgId),
              notInArray(tasks.status, ["done", "cancelled"]),
              inArray(tasks.priority, ["high", "urgent"]),
              isNull(tasks.archivedAt),
            ),
          )
          .orderBy(asc(tasks.dueAt))
          .limit(8),
        dependencies.db
          .select()
          .from(obligations)
          .where(
            and(
              eq(obligations.orgId, orgId),
              inArray(obligations.status, ["open", "in_progress", "overdue"]),
              isNull(obligations.archivedAt),
            ),
          )
          .orderBy(asc(obligations.dueAt))
          .limit(8),
      ]);

      const cashIn = Number(cashRows.find((row) => row.direction === "in")?.amountCents ?? 0);
      const cashOut = Number(cashRows.find((row) => row.direction === "out")?.amountCents ?? 0);
      return {
        data: {
          summary: {
            activeObjectives,
            openTasks,
            overdueObligations,
            openRisks,
            pendingApprovals,
            activeContracts,
          },
          cashFlow: {
            inCents: cashIn,
            outCents: cashOut,
            netCents: cashIn - cashOut,
            currency: "CNY",
          },
          urgentTasks,
          upcomingObligations,
          generatedAt: now,
        },
      };
    },
  );

  app.get(
    "/api/v1/audit-events",
    {
      preHandler: [authenticate, requirePermission("audit-events:read")],
      schema: { tags: ["audit"], summary: "List append-only audit events" },
    },
    async (request) => {
      const query = listQuerySchema
        .extend({
          resourceType: z.string().trim().max(100).optional(),
          action: z.string().trim().max(100).optional(),
        })
        .parse(request.query);
      const clauses = [eq(auditEvents.orgId, request.auth.orgId)];
      if (query.resourceType) clauses.push(eq(auditEvents.resourceType, query.resourceType));
      if (query.action) clauses.push(eq(auditEvents.action, query.action));
      const where = and(...clauses);
      const [data, totals] = await Promise.all([
        dependencies.db
          .select()
          .from(auditEvents)
          .where(where)
          .orderBy(desc(auditEvents.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(auditEvents).where(where),
      ]);
      const total = totals[0]?.total ?? 0;
      return { data, meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) } };
    },
  );

  app.get(
    "/api/v1/audit-events/:id",
    {
      preHandler: [authenticate, requirePermission("audit-events:read")],
      schema: { tags: ["audit"], summary: "Read one immutable audit event" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [event] = await dependencies.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.id, id), eq(auditEvents.orgId, request.auth.orgId)))
        .limit(1);
      if (!event) throw new DomainError("NOT_FOUND", "Audit event not found", 404);
      return { data: event };
    },
  );
}
