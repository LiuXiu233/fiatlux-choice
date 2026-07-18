import { randomUUID } from "node:crypto";
import {
  approvalDecisionSchema,
  approvalRequestSchema,
  externalActionCreateSchema,
  externalActionTransitionSchema,
  idSchema,
  listQuerySchema,
} from "@fiatlux/contracts";
import {
  approvals,
  auditEvents,
  contracts,
  externalActions,
  invoices,
  membershipRoles,
  memberships,
  roles,
} from "@fiatlux/db";
import {
  assertApprovalDecision,
  assertExternalActionTransition,
  DomainError,
  type ExternalActionStatus,
  type ExternalAdapter,
  requiresHumanApproval,
} from "@fiatlux/domain";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies, RequestAuditContext } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });

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

/**
 * Idempotency compares request semantics rather than JSON object insertion order.
 * Payloads are already validated as JSON objects, so recursively sorting object keys
 * gives stable equality while preserving array order.
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
}

function sameExternalActionRequest(
  existing: { kind: string; adapter: string; payload: unknown; reason: string },
  input: { kind: string; adapter: string; payload: unknown; reason: string },
) {
  return (
    existing.kind === input.kind &&
    existing.adapter === input.adapter &&
    existing.reason === input.reason &&
    JSON.stringify(canonicalJson(existing.payload)) === JSON.stringify(canonicalJson(input.payload))
  );
}

async function decideApproval(input: {
  dependencies: AppDependencies;
  request: FastifyRequest;
  approvalId: string;
  decision: "approved" | "rejected";
  comment: string;
  acknowledgement?: string;
}) {
  const [approval] = await input.dependencies.db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.id, input.approvalId),
        eq(approvals.orgId, input.request.auth.orgId),
        isNull(approvals.archivedAt),
      ),
    )
    .limit(1);
  if (!approval) throw new DomainError("NOT_FOUND", "Approval not found", 404);

  assertApprovalDecision({
    currentStatus: approval.status,
    requesterId: approval.requestedBy,
    decisionMakerId: input.request.auth.userId,
    ...(input.acknowledgement ? { acknowledgement: input.acknowledgement } : {}),
  });

  const context = requestAuditContext(input.request);
  const [updated] = await input.dependencies.db.transaction(async (tx) => {
    const [changed] = await tx
      .update(approvals)
      .set({
        status: input.decision,
        decidedBy: input.request.auth.userId,
        decidedAt: new Date(),
        decisionComment: input.comment,
        updatedAt: new Date(),
        version: approval.version + 1,
      })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "pending")))
      .returning();
    if (!changed) throw new DomainError("CONFLICT", "Approval was already decided", 409);

    const [action] = await tx
      .select()
      .from(externalActions)
      .where(
        and(eq(externalActions.approvalId, approval.id), eq(externalActions.orgId, approval.orgId)),
      )
      .limit(1);
    if (action) {
      await tx
        .update(externalActions)
        .set({
          status: input.decision === "approved" ? "approved" : "cancelled",
          updatedAt: new Date(),
          version: action.version + 1,
        })
        .where(eq(externalActions.id, action.id));
    }

    if (input.decision === "approved" && approval.resourceType === "role-assignment") {
      const parsed = z
        .object({
          membershipId: idSchema,
          roleId: idSchema,
          mode: z.enum(["assign", "remove"]),
          activateMembership: z.boolean().optional().default(false),
        })
        .parse(approval.payload);
      const [membership, role] = await Promise.all([
        tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, parsed.membershipId),
              eq(memberships.orgId, approval.orgId),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1),
        tx
          .select({ id: roles.id, systemKey: roles.systemKey })
          .from(roles)
          .where(
            and(
              eq(roles.id, parsed.roleId),
              eq(roles.orgId, approval.orgId),
              isNull(roles.archivedAt),
            ),
          )
          .limit(1),
      ]);
      if (!membership[0] || !role[0])
        throw new DomainError("NOT_FOUND", "Role or membership not found", 404);
      if (parsed.mode === "remove" && role[0].systemKey === "owner") {
        const ownerRows = await tx
          .select({ total: count() })
          .from(membershipRoles)
          .innerJoin(
            roles,
            and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
          )
          .where(and(eq(membershipRoles.orgId, approval.orgId), eq(roles.systemKey, "owner")));
        if ((ownerRows[0]?.total ?? 0) <= 1) {
          throw new DomainError("CONFLICT", "The final owner role cannot be removed", 409);
        }
      }
      if (parsed.mode === "assign") {
        await tx
          .insert(membershipRoles)
          .values({
            orgId: approval.orgId,
            membershipId: parsed.membershipId,
            roleId: parsed.roleId,
          })
          .onConflictDoNothing();
        if (parsed.activateMembership) {
          const [activated] = await tx
            .update(memberships)
            .set({
              status: "active",
              updatedAt: new Date(),
              version: sql`${memberships.version} + 1`,
            })
            .where(
              and(
                eq(memberships.id, parsed.membershipId),
                eq(memberships.orgId, approval.orgId),
                eq(memberships.status, "pending"),
              ),
            )
            .returning({ id: memberships.id });
          if (!activated) {
            throw new DomainError(
              "CONFLICT",
              "Membership is no longer pending; approval cannot activate it",
              409,
            );
          }
        }
      } else {
        await tx
          .delete(membershipRoles)
          .where(
            and(
              eq(membershipRoles.orgId, approval.orgId),
              eq(membershipRoles.membershipId, parsed.membershipId),
              eq(membershipRoles.roleId, parsed.roleId),
            ),
          );
      }
      await tx.insert(auditEvents).values(
        auditValue(context, {
          action: parsed.mode,
          resourceType: "role-assignment",
          resourceId: parsed.membershipId,
          after: parsed,
          metadata: { approvalId: approval.id },
        }),
      );
    }

    await tx.insert(auditEvents).values(
      auditValue(context, {
        action: input.decision === "approved" ? "approve" : "reject",
        resourceType: "approval",
        resourceId: approval.id,
        before: approval,
        after: changed,
        metadata: { selfApproval: approval.requestedBy === input.request.auth.userId },
      }),
    );
    return [changed];
  });

  return updated;
}

export function registerApprovalRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/approvals",
    {
      preHandler: [authenticate, requirePermission("approvals:read")],
      schema: { tags: ["approvals"], summary: "List approval requests" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const where = query.status
        ? and(
            eq(approvals.orgId, request.auth.orgId),
            eq(approvals.status, query.status as "pending" | "approved" | "rejected" | "cancelled"),
            isNull(approvals.archivedAt),
          )
        : and(eq(approvals.orgId, request.auth.orgId), isNull(approvals.archivedAt));
      const [items, totalRows] = await Promise.all([
        dependencies.db
          .select()
          .from(approvals)
          .where(where)
          .orderBy(desc(approvals.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(approvals).where(where),
      ]);
      const total = totalRows[0]?.total ?? 0;
      return {
        data: items,
        meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) },
      };
    },
  );

  app.post(
    "/api/v1/approvals",
    {
      preHandler: [authenticate, requirePermission("approvals:create")],
      schema: { tags: ["approvals"], summary: "Request a human approval" },
    },
    async (request, reply) => {
      const input = approvalRequestSchema.parse(request.body);
      const context = requestAuditContext(request);
      const [created] = await dependencies.db.transaction(async (tx) => {
        const [record] = await tx
          .insert(approvals)
          .values({
            orgId: request.auth.orgId,
            ...input,
            requestedBy: request.auth.userId,
          })
          .returning();
        if (!record) throw new Error("Failed to create approval");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "approval",
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
    "/api/v1/approvals/:id",
    {
      preHandler: [authenticate, requirePermission("approvals:read")],
      schema: { tags: ["approvals"], summary: "Read one approval" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [record] = await dependencies.db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.id, id),
            eq(approvals.orgId, request.auth.orgId),
            isNull(approvals.archivedAt),
          ),
        )
        .limit(1);
      if (!record) throw new DomainError("NOT_FOUND", "Approval not found", 404);
      return { data: record };
    },
  );

  for (const decision of ["approve", "reject"] as const) {
    app.post(
      `/api/v1/approvals/:id/${decision}`,
      {
        preHandler: [authenticate, requirePermission("approvals:approve")],
        schema: { tags: ["approvals"], summary: `${decision} a pending approval` },
      },
      async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const body = approvalDecisionSchema.parse(request.body);
        const data = await decideApproval({
          dependencies,
          request,
          approvalId: id,
          decision: decision === "approve" ? "approved" : "rejected",
          comment: body.comment,
          ...(body.acknowledgement ? { acknowledgement: body.acknowledgement } : {}),
        });
        return { data };
      },
    );
  }

  app.get(
    "/api/v1/external-actions",
    {
      preHandler: [authenticate, requirePermission("external-actions:read")],
      schema: { tags: ["external-actions"], summary: "List external action records" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const where = query.status
        ? and(
            eq(externalActions.orgId, request.auth.orgId),
            eq(externalActions.status, query.status as ExternalActionStatus),
            isNull(externalActions.archivedAt),
          )
        : and(eq(externalActions.orgId, request.auth.orgId), isNull(externalActions.archivedAt));
      const [items, totals] = await Promise.all([
        dependencies.db
          .select()
          .from(externalActions)
          .where(where)
          .orderBy(desc(externalActions.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(externalActions).where(where),
      ]);
      const total = totals[0]?.total ?? 0;
      return {
        data: items,
        meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) },
      };
    },
  );

  app.post(
    "/api/v1/external-actions",
    {
      preHandler: [authenticate, requirePermission("external-actions:create")],
      schema: {
        tags: ["external-actions"],
        summary: "Create an auditable external action request",
      },
    },
    async (request, reply) => {
      const input = externalActionCreateSchema.parse(request.body);
      const context = requestAuditContext(request);
      const result = await dependencies.db.transaction(async (tx) => {
        const actionId = randomUUID();
        const requiresApproval = requiresHumanApproval(input.kind);
        const [action] = await tx
          .insert(externalActions)
          .values({
            id: actionId,
            orgId: request.auth.orgId,
            kind: input.kind,
            adapter: input.adapter,
            status: requiresApproval ? "pending_approval" : "approved",
            payload: input.payload,
            idempotencyKey: input.idempotencyKey,
            reason: input.reason,
            approvalId: null,
            requestedBy: request.auth.userId,
          })
          .onConflictDoNothing({
            target: [externalActions.orgId, externalActions.idempotencyKey],
          })
          .returning();

        // The unique index is the serialization point for concurrent requests. The
        // losing transaction re-reads the winner and either replays it or reports a
        // deterministic idempotency conflict; it never leaks a database 500.
        if (!action) {
          const [existing] = await tx
            .select()
            .from(externalActions)
            .where(
              and(
                eq(externalActions.orgId, request.auth.orgId),
                eq(externalActions.idempotencyKey, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (!existing) {
            throw new DomainError(
              "CONFLICT",
              "Idempotency key is being used concurrently; retry the request",
              409,
            );
          }
          if (!sameExternalActionRequest(existing, input)) {
            throw new DomainError(
              "CONFLICT",
              "Idempotency key is already used for a different external action",
              409,
              { existingActionId: existing.id },
            );
          }
          await tx.insert(auditEvents).values(
            auditValue(context, {
              action: "replay",
              resourceType: "external-action",
              resourceId: existing.id,
              after: existing,
              metadata: { replay: true, idempotencyKey: input.idempotencyKey },
            }),
          );
          return { action: existing, replay: true } as const;
        }

        let completedAction = action;
        let approvalId: string | null = null;
        if (requiresApproval) {
          approvalId = randomUUID();
          const [approval] = await tx
            .insert(approvals)
            .values({
              id: approvalId,
              orgId: request.auth.orgId,
              resourceType: "external-action",
              resourceId: actionId,
              operation: input.kind,
              reason: input.reason,
              riskLevel: "critical",
              requestedBy: request.auth.userId,
              payload: input.payload,
            })
            .returning();
          if (!approval) throw new Error("Failed to create external action approval");
          const [linked] = await tx
            .update(externalActions)
            .set({
              approvalId,
              updatedAt: new Date(),
              version: sql`${externalActions.version} + 1`,
            })
            .where(eq(externalActions.id, action.id))
            .returning();
          if (!linked) throw new Error("Failed to link external action approval");
          completedAction = linked;
        }
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "external-action",
            resourceId: completedAction.id,
            after: completedAction,
            metadata: { humanApprovalRequired: Boolean(approvalId) },
          }),
        );
        return { action: completedAction, replay: false } as const;
      });
      return reply.status(result.replay ? 200 : 201).send({
        data: result.action,
        ...(result.replay ? { meta: { replay: true } } : {}),
      });
    },
  );

  app.get(
    "/api/v1/external-actions/:id",
    {
      preHandler: [authenticate, requirePermission("external-actions:read")],
      schema: { tags: ["external-actions"], summary: "Read one external action" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [record] = await dependencies.db
        .select()
        .from(externalActions)
        .where(
          and(
            eq(externalActions.id, id),
            eq(externalActions.orgId, request.auth.orgId),
            isNull(externalActions.archivedAt),
          ),
        )
        .limit(1);
      if (!record) throw new DomainError("NOT_FOUND", "External action not found", 404);
      return { data: record };
    },
  );

  app.post(
    "/api/v1/external-actions/:id/transition",
    {
      preHandler: [authenticate, requirePermission("external-actions:update")],
      schema: {
        tags: ["external-actions"],
        summary: "Record a truthful external action state transition",
      },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = externalActionTransitionSchema.parse(request.body);
      const [current] = await dependencies.db
        .select()
        .from(externalActions)
        .where(
          and(
            eq(externalActions.id, id),
            eq(externalActions.orgId, request.auth.orgId),
            isNull(externalActions.archivedAt),
          ),
        )
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "External action not found", 404);
      if (input.targetStatus === "submitted" && !input.evidence?.externalReference) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Submitted actions require an externalReference",
          400,
        );
      }
      assertExternalActionTransition({
        adapter: current.adapter as ExternalAdapter,
        from: current.status,
        to: input.targetStatus,
        ...(input.evidence ? { evidence: input.evidence } : {}),
      });

      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(externalActions)
          .set({
            status: input.targetStatus,
            evidence: input.evidence,
            failureReason: input.targetStatus === "failed" ? input.note : null,
            submittedAt: input.targetStatus === "submitted" ? new Date() : current.submittedAt,
            confirmedAt: input.targetStatus === "confirmed" ? new Date() : null,
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(
            and(eq(externalActions.id, current.id), eq(externalActions.version, current.version)),
          )
          .returning();
        if (!changed)
          throw new DomainError("CONFLICT", "External action changed concurrently", 409);

        if (
          input.targetStatus === "confirmed" &&
          typeof current.payload === "object" &&
          current.payload !== null
        ) {
          const payload = current.payload as Record<string, unknown>;
          if (current.kind === "contract_sign" && typeof payload.contractId === "string") {
            await tx
              .update(contracts)
              .set({
                status: "active",
                updatedAt: new Date(),
                version: sql`${contracts.version} + 1`,
              })
              .where(and(eq(contracts.id, payload.contractId), eq(contracts.orgId, current.orgId)));
          }
          if (current.kind === "invoice_red" && typeof payload.invoiceId === "string") {
            await tx
              .update(invoices)
              .set({
                status: "red_confirmed",
                updatedAt: new Date(),
                version: sql`${invoices.version} + 1`,
              })
              .where(and(eq(invoices.id, payload.invoiceId), eq(invoices.orgId, current.orgId)));
          }
        }

        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "transition",
            resourceType: "external-action",
            resourceId: current.id,
            before: current,
            after: changed,
            metadata: { note: input.note ?? null },
          }),
        );
        return [changed];
      });
      return { data: updated };
    },
  );
}
