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
import { DomainError, hasPermission } from "@fiatlux/domain";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  AUDIT_EXPORT_MAX_BYTES,
  AUDIT_EXPORT_MAX_ROWS,
  auditExportDateBounds,
  auditExportRequestSchema,
  renderAuditExport,
} from "./audit-export.js";
import { type AuthenticateHook, requirePermission } from "./auth.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
export const auditEventListQuerySchema = listQuerySchema.extend({
  resourceType: z.string().trim().max(100).optional(),
  action: z.string().trim().max(100).optional(),
});

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
      const canRead = (permission: string) => hasPermission(request.auth.permissions, permission);
      const canReadObjectives = canRead("objectives:read");
      const canReadTasks = canRead("tasks:read");
      const canReadObligations = canRead("obligations:read");
      const canReadRisks = canRead("risks:read");
      const canReadApprovals = canRead("approvals:read");
      const canReadContracts = canRead("contracts:read");
      const canReadCashFlow = canRead("cash-flow:read");
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
        canReadObjectives
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadTasks
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadObligations
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadRisks
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadApprovals
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadContracts
          ? scalarCount(
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
            )
          : Promise.resolve(null),
        canReadCashFlow
          ? dependencies.db
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
              .groupBy(cashFlowEntries.direction)
          : Promise.resolve([]),
        canReadTasks
          ? dependencies.db
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
              .limit(8)
          : Promise.resolve([]),
        canReadObligations
          ? dependencies.db
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
              .limit(8)
          : Promise.resolve([]),
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
          cashFlow: canReadCashFlow
            ? {
                inCents: cashIn,
                outCents: cashOut,
                netCents: cashIn - cashOut,
                currency: "CNY",
              }
            : null,
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
      const query = auditEventListQuerySchema.parse(request.query);
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

  app.post(
    "/api/v1/audit-events/export",
    {
      preHandler: [
        authenticate,
        requirePermission("audit-events:read"),
        requirePermission("audit-events:export"),
      ],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["audit"],
        summary: "Export a bounded, auditable organization audit snapshot",
      },
    },
    async (request, reply) => {
      const input = auditExportRequestSchema.parse(request.body);
      const { startAt, endExclusive } = auditExportDateBounds(input);
      const userAgent = request.headers["user-agent"];
      const result = await dependencies.db.transaction(async (tx) => {
        const clauses = [
          eq(auditEvents.orgId, request.auth.orgId),
          gte(auditEvents.createdAt, startAt),
          lt(auditEvents.createdAt, endExclusive),
        ];
        if (input.resourceType) clauses.push(eq(auditEvents.resourceType, input.resourceType));
        if (input.action) clauses.push(eq(auditEvents.action, input.action));

        const rows = await tx
          .select()
          .from(auditEvents)
          .where(and(...clauses))
          .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
          .limit(AUDIT_EXPORT_MAX_ROWS + 1);
        if (rows.length > AUDIT_EXPORT_MAX_ROWS) {
          throw new DomainError(
            "PAYLOAD_TOO_LARGE",
            `Audit export exceeds ${AUDIT_EXPORT_MAX_ROWS} events; narrow the date range or filters`,
            413,
            { maxRows: AUDIT_EXPORT_MAX_ROWS },
          );
        }

        const artifact = renderAuditExport(rows, input.format);
        if (artifact.body.byteLength > AUDIT_EXPORT_MAX_BYTES) {
          throw new DomainError(
            "PAYLOAD_TOO_LARGE",
            `Audit export exceeds ${AUDIT_EXPORT_MAX_BYTES} bytes; narrow the date range or filters`,
            413,
            { maxBytes: AUDIT_EXPORT_MAX_BYTES },
          );
        }
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "export_generated",
          resourceType: "audit-events",
          resourceId: artifact.sha256,
          requestId: request.id,
          metadata: {
            schemaVersion: 1,
            format: input.format,
            from: input.from,
            to: input.to,
            timeZone: "Asia/Shanghai",
            rowCount: rows.length,
            contentSha256: artifact.sha256,
            filters: {
              resourceType: input.resourceType ?? null,
              action: input.action ?? null,
            },
            containsPersonalData: true,
            acknowledgement: input.acknowledgement,
            semantics:
              "authorized snapshot generated; client receipt and onward handling are not asserted",
          },
          ipAddress: request.ip,
          ...(typeof userAgent === "string" ? { userAgent } : {}),
        });
        return { artifact, rowCount: rows.length };
      });

      const filename = `fiatlux-audit-${input.from}_to_${input.to}.${result.artifact.extension}`;
      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .header("X-Audit-Event-Count", String(result.rowCount))
        .header("X-Content-SHA256", result.artifact.sha256)
        .type(result.artifact.contentType)
        .send(result.artifact.body);
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
