import { randomUUID } from "node:crypto";
import {
  approvalDecisionSchema,
  approvalRequestSchema,
  externalActionCreateSchema,
  externalActionTransitionSchema,
  idSchema,
  listQuerySchema,
  membershipLifecycleApprovalPayloadSchema,
  roleAssignmentApprovalPayloadSchema,
} from "@fiatlux/contracts";
import {
  approvals,
  auditEvents,
  contracts,
  externalActions,
  files,
  financialEntries,
  invoices,
  membershipRoles,
  memberships,
  roles,
  sessions,
} from "@fiatlux/db";
import {
  assertApprovalDecision,
  assertExternalActionTransition,
  DomainError,
  type ExternalActionStatus,
  type ExternalAdapter,
  requiresHumanApproval,
} from "@fiatlux/domain";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  const requestedPayload = (value: unknown) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const {
      targetExpectedVersion: _serverVersionSnapshot,
      targetFileId: _serverFileSnapshot,
      targetFileChecksumSha256: _serverFileChecksumSnapshot,
      ...requestFields
    } = value as Record<string, unknown>;
    return requestFields;
  };
  return (
    existing.kind === input.kind &&
    existing.adapter === input.adapter &&
    existing.reason === input.reason &&
    JSON.stringify(canonicalJson(requestedPayload(existing.payload))) ===
      JSON.stringify(canonicalJson(requestedPayload(input.payload)))
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
  const context = requestAuditContext(input.request);
  const [updated] = await input.dependencies.db.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(
        and(
          eq(approvals.id, input.approvalId),
          eq(approvals.orgId, input.request.auth.orgId),
          isNull(approvals.archivedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!approval) throw new DomainError("NOT_FOUND", "Approval not found", 404);

    assertApprovalDecision({
      currentStatus: approval.status,
      requesterId: approval.requestedBy,
      decisionMakerId: input.request.auth.userId,
      ...(input.acknowledgement ? { acknowledgement: input.acknowledgement } : {}),
    });

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
      .limit(1)
      .for("update");
    if (action) {
      if (action.status !== "pending_approval") {
        throw new DomainError(
          "CONFLICT",
          "The linked external action is no longer awaiting this approval",
          409,
        );
      }
      const [changedAction] = await tx
        .update(externalActions)
        .set({
          status: input.decision === "approved" ? "approved" : "cancelled",
          updatedAt: new Date(),
          version: action.version + 1,
        })
        .where(
          and(
            eq(externalActions.id, action.id),
            eq(externalActions.orgId, approval.orgId),
            eq(externalActions.approvalId, approval.id),
            eq(externalActions.status, "pending_approval"),
            eq(externalActions.version, action.version),
          ),
        )
        .returning();
      if (!changedAction) {
        throw new DomainError("CONFLICT", "The linked external action changed concurrently", 409);
      }
      await tx.insert(auditEvents).values(
        auditValue(context, {
          action: "approval_decision_apply",
          resourceType: "external-action",
          resourceId: changedAction.id,
          before: action,
          after: changedAction,
          metadata: { approvalId: approval.id, decision: input.decision },
        }),
      );

      if (
        input.decision === "rejected" &&
        action.kind === "bank_payment" &&
        typeof action.payload === "object" &&
        action.payload !== null &&
        "financialEntryId" in action.payload
      ) {
        const financialEntryId = idSchema.safeParse(
          (action.payload as Record<string, unknown>).financialEntryId,
        );
        if (!financialEntryId.success) {
          throw new DomainError("CONFLICT", "Payment target reference is invalid", 409);
        }
        const [target] = await tx
          .select()
          .from(financialEntries)
          .where(
            and(
              eq(financialEntries.id, financialEntryId.data),
              eq(financialEntries.orgId, approval.orgId),
              isNull(financialEntries.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (target?.status !== "draft" || target?.externalActionId !== action.id) {
          throw new DomainError(
            "CONFLICT",
            "Payment target changed while rejecting the action",
            409,
          );
        }
        const [unlinked] = await tx
          .update(financialEntries)
          .set({
            externalActionId: null,
            updatedAt: new Date(),
            version: sql`${financialEntries.version} + 1`,
          })
          .where(
            and(
              eq(financialEntries.id, target.id),
              eq(financialEntries.orgId, approval.orgId),
              eq(financialEntries.status, "draft"),
              eq(financialEntries.externalActionId, action.id),
              eq(financialEntries.version, target.version),
              isNull(financialEntries.archivedAt),
            ),
          )
          .returning();
        if (!unlinked) {
          throw new DomainError(
            "CONFLICT",
            "Payment target changed while rejecting the action",
            409,
          );
        }
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "unlink_payment_reject",
            resourceType: "financial-entries",
            resourceId: target.id,
            before: target,
            after: unlinked,
            metadata: { externalActionId: action.id, approvalId: approval.id },
          }),
        );
      }
    }

    if (input.decision === "approved" && approval.resourceType === "role-assignment") {
      const parsed = roleAssignmentApprovalPayloadSchema.parse(approval.payload);
      if (!parsed.expectedVersion || !parsed.idempotencyKey) {
        throw new DomainError(
          "CONFLICT",
          "Legacy role approval lacks a version snapshot; reject it and create a new request",
          409,
        );
      }
      const [role] = await tx
        .select({ id: roles.id, systemKey: roles.systemKey })
        .from(roles)
        .where(
          and(
            eq(roles.id, parsed.roleId),
            eq(roles.orgId, approval.orgId),
            isNull(roles.archivedAt),
          ),
        )
        .limit(1);
      if (!role) throw new DomainError("NOT_FOUND", "Role not found", 404);
      // Owner-decreasing mutations must acquire the organization invariant lock before any
      // membership row lock. Lifecycle decisions use the same order; reversing it here would
      // deadlock an owner-role removal against a concurrent owner reactivation.
      if (parsed.mode === "remove" && role.systemKey === "owner") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('fiatlux-active-owner'), hashtext(${approval.orgId}))`,
        );
      }
      const [membership] = await tx
        .select({ id: memberships.id, status: memberships.status, version: memberships.version })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, parsed.membershipId),
            eq(memberships.orgId, approval.orgId),
            isNull(memberships.archivedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!membership) throw new DomainError("NOT_FOUND", "Membership not found", 404);
      if (membership.version !== parsed.expectedVersion) {
        throw new DomainError(
          "CONFLICT",
          "Member roles changed while awaiting approval; create a new request",
          409,
        );
      }
      const [existingAssignment] = await tx
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.orgId, approval.orgId),
            eq(membershipRoles.membershipId, parsed.membershipId),
            eq(membershipRoles.roleId, parsed.roleId),
          ),
        )
        .limit(1);
      if (parsed.mode === "assign" ? existingAssignment : !existingAssignment) {
        throw new DomainError(
          "CONFLICT",
          parsed.mode === "assign"
            ? "The member already has this role"
            : "The member no longer has this role",
          409,
        );
      }
      if (parsed.mode === "remove" && role.systemKey === "owner") {
        const [lockedMembership] = await tx
          .select({ id: memberships.id, status: memberships.status })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, parsed.membershipId),
              eq(memberships.orgId, approval.orgId),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        const [lockedRole] = await tx
          .select({ id: roles.id, systemKey: roles.systemKey })
          .from(roles)
          .where(
            and(
              eq(roles.id, parsed.roleId),
              eq(roles.orgId, approval.orgId),
              isNull(roles.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!lockedMembership || lockedRole?.systemKey !== "owner") {
          throw new DomainError(
            "CONFLICT",
            "Owner role removal changed while awaiting approval",
            409,
          );
        }
        if (lockedMembership.status === "active") {
          const ownerRows = await tx
            .select({ total: count() })
            .from(membershipRoles)
            .innerJoin(
              roles,
              and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
            )
            .innerJoin(
              memberships,
              and(
                eq(memberships.id, membershipRoles.membershipId),
                eq(memberships.orgId, membershipRoles.orgId),
              ),
            )
            .where(
              and(
                eq(membershipRoles.orgId, approval.orgId),
                eq(roles.systemKey, "owner"),
                isNull(roles.archivedAt),
                eq(memberships.status, "active"),
                isNull(memberships.archivedAt),
              ),
            );
          if ((ownerRows[0]?.total ?? 0) <= 1) {
            throw new DomainError("CONFLICT", "The final owner role cannot be removed", 409);
          }
        }
      }
      if (parsed.mode === "assign") {
        const [assigned] = await tx
          .insert(membershipRoles)
          .values({
            orgId: approval.orgId,
            membershipId: parsed.membershipId,
            roleId: parsed.roleId,
          })
          .returning({ roleId: membershipRoles.roleId });
        if (!assigned) throw new DomainError("CONFLICT", "Role assignment changed", 409);
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
                eq(memberships.version, parsed.expectedVersion),
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
        } else {
          const [versioned] = await tx
            .update(memberships)
            .set({ updatedAt: new Date(), version: sql`${memberships.version} + 1` })
            .where(
              and(
                eq(memberships.id, parsed.membershipId),
                eq(memberships.orgId, approval.orgId),
                eq(memberships.version, parsed.expectedVersion),
              ),
            )
            .returning({ id: memberships.id });
          if (!versioned) throw new DomainError("CONFLICT", "Member roles changed", 409);
        }
      } else {
        const [removed] = await tx
          .delete(membershipRoles)
          .where(
            and(
              eq(membershipRoles.orgId, approval.orgId),
              eq(membershipRoles.membershipId, parsed.membershipId),
              eq(membershipRoles.roleId, parsed.roleId),
            ),
          )
          .returning({ roleId: membershipRoles.roleId });
        if (!removed) throw new DomainError("CONFLICT", "Role assignment changed", 409);
        const [versioned] = await tx
          .update(memberships)
          .set({ updatedAt: new Date(), version: sql`${memberships.version} + 1` })
          .where(
            and(
              eq(memberships.id, parsed.membershipId),
              eq(memberships.orgId, approval.orgId),
              eq(memberships.version, parsed.expectedVersion),
            ),
          )
          .returning({ id: memberships.id });
        if (!versioned) throw new DomainError("CONFLICT", "Member roles changed", 409);
      }
      await tx.insert(auditEvents).values(
        auditValue(context, {
          action: parsed.mode,
          resourceType: "role-assignment",
          resourceId: parsed.membershipId,
          before: {
            assigned: Boolean(existingAssignment),
            membershipVersion: parsed.expectedVersion,
          },
          after: {
            ...parsed,
            assigned: parsed.mode === "assign",
            membershipVersion: parsed.expectedVersion + 1,
          },
          metadata: { approvalId: approval.id },
        }),
      );
    }

    if (approval.resourceType === "membership-lifecycle") {
      const parsed = membershipLifecycleApprovalPayloadSchema.parse(approval.payload);
      if (parsed.membershipId !== approval.resourceId) {
        throw new DomainError(
          "CONFLICT",
          "Membership lifecycle approval payload no longer matches its resource",
          409,
        );
      }
      if (input.decision === "approved") {
        // All membership lifecycle changes share the owner-invariant lock with owner-role removal.
        // Reactivation increases the active set, but serialization prevents its inactive owner role
        // from being removed between validation and activation.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('fiatlux-active-owner'), hashtext(${approval.orgId}))`,
        );
        const [membership] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, parsed.membershipId),
              eq(memberships.orgId, approval.orgId),
              eq(memberships.userId, parsed.userId),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!membership) {
          throw new DomainError("NOT_FOUND", "Organization member not found", 404);
        }
        const requiredStatus = parsed.action === "reactivate" ? "inactive" : "active";
        if (membership.status !== requiredStatus || membership.version !== parsed.expectedVersion) {
          throw new DomainError(
            "CONFLICT",
            "Membership changed after the lifecycle request; submit a new approval",
            409,
          );
        }
        if (parsed.action === "reactivate") {
          const [assignedRoles] = await tx
            .select({ total: count() })
            .from(membershipRoles)
            .innerJoin(
              roles,
              and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
            )
            .where(
              and(
                eq(membershipRoles.orgId, approval.orgId),
                eq(membershipRoles.membershipId, membership.id),
                isNull(roles.archivedAt),
              ),
            );
          if ((assignedRoles?.total ?? 0) < 1) {
            throw new DomainError(
              "CONFLICT",
              "An inactive membership requires at least one current role before reactivation",
              409,
            );
          }
        }

        const [targetOwnerRole] =
          parsed.action === "reactivate"
            ? []
            : await tx
                .select({ roleId: roles.id })
                .from(membershipRoles)
                .innerJoin(
                  roles,
                  and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
                )
                .where(
                  and(
                    eq(membershipRoles.orgId, approval.orgId),
                    eq(membershipRoles.membershipId, membership.id),
                    eq(roles.systemKey, "owner"),
                    isNull(roles.archivedAt),
                  ),
                )
                .limit(1);
        if (targetOwnerRole) {
          const ownerRows = await tx
            .select({ total: count() })
            .from(membershipRoles)
            .innerJoin(
              roles,
              and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
            )
            .innerJoin(
              memberships,
              and(
                eq(memberships.id, membershipRoles.membershipId),
                eq(memberships.orgId, membershipRoles.orgId),
              ),
            )
            .where(
              and(
                eq(membershipRoles.orgId, approval.orgId),
                eq(roles.systemKey, "owner"),
                isNull(roles.archivedAt),
                eq(memberships.status, "active"),
                isNull(memberships.archivedAt),
              ),
            );
          if ((ownerRows[0]?.total ?? 0) <= 1) {
            throw new DomainError(
              "CONFLICT",
              "The final active owner cannot be deactivated or offboarded",
              409,
            );
          }
        }

        const now = new Date();
        const nextStatus =
          parsed.action === "deactivate"
            ? "inactive"
            : parsed.action === "offboard"
              ? "offboarded"
              : "active";
        const [updatedMembership] = await tx
          .update(memberships)
          .set({
            status: nextStatus,
            updatedAt: now,
            version: sql`${memberships.version} + 1`,
          })
          .where(
            and(
              eq(memberships.id, membership.id),
              eq(memberships.orgId, approval.orgId),
              eq(memberships.userId, membership.userId),
              eq(memberships.status, requiredStatus),
              eq(memberships.version, parsed.expectedVersion),
              isNull(memberships.archivedAt),
            ),
          )
          .returning();
        if (!updatedMembership) {
          throw new DomainError(
            "CONFLICT",
            "Membership changed while applying the lifecycle approval",
            409,
          );
        }
        const revokedSessions = await tx
          .update(sessions)
          .set({
            revokedAt: now,
            updatedAt: now,
            version: sql`${sessions.version} + 1`,
          })
          .where(
            and(
              eq(sessions.orgId, approval.orgId),
              eq(sessions.userId, membership.userId),
              isNull(sessions.revokedAt),
            ),
          )
          .returning({ id: sessions.id });

        await tx.insert(auditEvents).values([
          auditValue(context, {
            action: parsed.action,
            resourceType: "membership",
            resourceId: membership.id,
            before: {
              id: membership.id,
              userId: membership.userId,
              status: membership.status,
              version: membership.version,
            },
            after: {
              id: updatedMembership.id,
              userId: updatedMembership.userId,
              status: updatedMembership.status,
              version: updatedMembership.version,
            },
            metadata: { approvalId: approval.id },
          }),
          auditValue(context, {
            action:
              parsed.action === "reactivate"
                ? "ensure_revoked_for_membership_reactivation"
                : "revoke_for_membership_lifecycle",
            resourceType: "session",
            resourceId: membership.id,
            metadata: {
              approvalId: approval.id,
              membershipId: membership.id,
              revokedSessionCount: revokedSessions.length,
              requiresNewLogin: parsed.action === "reactivate",
            },
          }),
        ]);
      } else {
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "reject",
            resourceType: "membership-lifecycle",
            resourceId: parsed.membershipId,
            before: {
              action: parsed.action,
              expectedVersion: parsed.expectedVersion,
              approvalStatus: approval.status,
            },
            after: {
              action: parsed.action,
              expectedVersion: parsed.expectedVersion,
              approvalStatus: changed.status,
            },
            metadata: { approvalId: approval.id, membershipChanged: false },
          }),
        );
      }
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

type ApprovalRow = typeof approvals.$inferSelect;

interface LinkedExternalAction {
  id: string;
  status: string;
  adapter: string;
  evidence: Record<string, unknown> | null;
  externalReference: string | null;
}

type ApprovalWithLinkedExternalAction = ApprovalRow & {
  linkedExternalAction?: LinkedExternalAction | null;
};

function evidenceRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function evidenceExternalReference(evidence: Record<string, unknown> | null): string | null {
  for (const key of ["receiptReference", "externalReference"] as const) {
    const value = evidence?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function attachLinkedExternalActions(
  db: AppDependencies["db"],
  orgId: string,
  approvalRows: ApprovalRow[],
): Promise<ApprovalWithLinkedExternalAction[]> {
  const externalApprovalRows = approvalRows.filter(
    (approval) => approval.resourceType === "external-action",
  );
  if (externalApprovalRows.length === 0) return approvalRows;

  const actionIds = [...new Set(externalApprovalRows.map((approval) => approval.resourceId))];
  const approvalIds = [...new Set(externalApprovalRows.map((approval) => approval.id))];
  const actionRows = await db
    .select({
      id: externalActions.id,
      approvalId: externalActions.approvalId,
      status: externalActions.status,
      adapter: externalActions.adapter,
      evidence: externalActions.evidence,
    })
    .from(externalActions)
    .where(
      and(
        eq(externalActions.orgId, orgId),
        inArray(externalActions.id, actionIds),
        inArray(externalActions.approvalId, approvalIds),
        isNull(externalActions.archivedAt),
      ),
    );
  const actionsByApprovalLink = new Map(
    actionRows.map((action) => [`${action.id}:${action.approvalId ?? ""}`, action] as const),
  );

  return approvalRows.map((approval) => {
    if (approval.resourceType !== "external-action") return approval;
    const action = actionsByApprovalLink.get(`${approval.resourceId}:${approval.id}`);
    if (!action) return { ...approval, linkedExternalAction: null };
    const evidence = evidenceRecord(action.evidence);
    return {
      ...approval,
      linkedExternalAction: {
        id: action.id,
        status: action.status,
        adapter: action.adapter,
        evidence,
        externalReference: evidenceExternalReference(evidence),
      },
    };
  });
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
      const data = await attachLinkedExternalActions(dependencies.db, request.auth.orgId, items);
      return {
        data,
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
      const [data] = await attachLinkedExternalActions(dependencies.db, request.auth.orgId, [
        record,
      ]);
      return { data };
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

        if (!requiresApproval) {
          throw new DomainError(
            "APPROVAL_REQUIRED",
            "The external-action API only accepts registered human-approval workflows",
            409,
          );
        }

        let targetExpectedVersion: number | undefined;
        let targetFileId: string | undefined;
        let targetFileChecksumSha256: string | undefined;
        if (input.kind === "contract_sign") {
          const [target] = await tx
            .select({
              id: contracts.id,
              status: contracts.status,
              version: contracts.version,
              fileId: contracts.fileId,
            })
            .from(contracts)
            .where(
              and(
                eq(contracts.id, input.payload.contractId),
                eq(contracts.orgId, request.auth.orgId),
                isNull(contracts.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) {
            throw new DomainError("NOT_FOUND", "Contract target not found", 404);
          }
          if (target.status !== "pending_signature") {
            throw new DomainError(
              "CONFLICT",
              "Only a pending-signature contract can enter the signature workflow",
              409,
            );
          }
          if (input.payload.fileId && input.payload.fileId !== target.fileId) {
            throw new DomainError(
              "CONFLICT",
              "The signature request file no longer matches the contract record",
              409,
            );
          }
          if (!target.fileId) {
            throw new DomainError(
              "CONFLICT",
              "Contract signature requires a verified contract file",
              409,
            );
          }
          const [targetFile] = await tx
            .select({ id: files.id, checksumSha256: files.checksumSha256 })
            .from(files)
            .where(
              and(
                eq(files.id, target.fileId),
                eq(files.orgId, request.auth.orgId),
                eq(files.uploadStatus, "uploaded"),
                isNull(files.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!targetFile) {
            throw new DomainError(
              "CONFLICT",
              "Contract file is not available as a verified upload",
              409,
            );
          }
          targetExpectedVersion = target.version;
          targetFileId = targetFile.id;
          targetFileChecksumSha256 = targetFile.checksumSha256;
        } else if (input.kind === "contract_terminate") {
          const [target] = await tx
            .select({
              id: contracts.id,
              status: contracts.status,
              version: contracts.version,
            })
            .from(contracts)
            .where(
              and(
                eq(contracts.id, input.payload.contractId),
                eq(contracts.orgId, request.auth.orgId),
                isNull(contracts.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) {
            throw new DomainError("NOT_FOUND", "Contract target not found", 404);
          }
          if (target.status !== "active") {
            throw new DomainError(
              "CONFLICT",
              "Only an active contract can enter the termination workflow",
              409,
            );
          }
          targetExpectedVersion = target.version;
        } else if (input.kind === "invoice_red") {
          const [target] = await tx
            .select({
              id: invoices.id,
              status: invoices.status,
              version: invoices.version,
              fileId: invoices.fileId,
            })
            .from(invoices)
            .where(
              and(
                eq(invoices.id, input.payload.invoiceId),
                eq(invoices.orgId, request.auth.orgId),
                isNull(invoices.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) {
            throw new DomainError("NOT_FOUND", "Invoice target not found", 404);
          }
          if (!["issued", "received", "paid"].includes(target.status)) {
            throw new DomainError(
              "CONFLICT",
              "Only an issued, received, or paid invoice can enter the red-letter workflow",
              409,
            );
          }
          if (!target.fileId) {
            throw new DomainError(
              "CONFLICT",
              "Invoice red-letter workflow requires a verified invoice file",
              409,
            );
          }
          const [targetFile] = await tx
            .select({ id: files.id, checksumSha256: files.checksumSha256 })
            .from(files)
            .where(
              and(
                eq(files.id, target.fileId),
                eq(files.orgId, request.auth.orgId),
                eq(files.uploadStatus, "uploaded"),
                isNull(files.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!targetFile) {
            throw new DomainError(
              "CONFLICT",
              "Invoice file is not available as a verified upload",
              409,
            );
          }
          targetExpectedVersion = target.version;
          targetFileId = targetFile.id;
          targetFileChecksumSha256 = targetFile.checksumSha256;
        } else if (input.kind === "bank_payment" && input.payload.financialEntryId) {
          const [target] = await tx
            .select({
              id: financialEntries.id,
              type: financialEntries.type,
              status: financialEntries.status,
              amountCents: financialEntries.amountCents,
              version: financialEntries.version,
              externalActionId: financialEntries.externalActionId,
            })
            .from(financialEntries)
            .where(
              and(
                eq(financialEntries.id, input.payload.financialEntryId),
                eq(financialEntries.orgId, request.auth.orgId),
                isNull(financialEntries.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) {
            throw new DomainError("NOT_FOUND", "Financial-entry target not found", 404);
          }
          if (
            target.type !== "expense" ||
            target.status !== "draft" ||
            target.amountCents !== input.payload.amountCents ||
            target.externalActionId !== null
          ) {
            throw new DomainError(
              "CONFLICT",
              "Payment target must be a matching draft expense",
              409,
            );
          }
          const [linked] = await tx
            .update(financialEntries)
            .set({
              externalActionId: action.id,
              updatedAt: new Date(),
              version: sql`${financialEntries.version} + 1`,
            })
            .where(
              and(
                eq(financialEntries.id, target.id),
                eq(financialEntries.orgId, request.auth.orgId),
                eq(financialEntries.version, target.version),
                eq(financialEntries.type, "expense"),
                eq(financialEntries.status, "draft"),
                eq(financialEntries.amountCents, input.payload.amountCents),
                isNull(financialEntries.externalActionId),
                isNull(financialEntries.archivedAt),
              ),
            )
            .returning();
          if (!linked) {
            throw new DomainError(
              "CONFLICT",
              "Payment target changed while the action was being linked",
              409,
            );
          }
          await tx.insert(auditEvents).values(
            auditValue(context, {
              action: "link_payment_request",
              resourceType: "financial-entries",
              resourceId: target.id,
              before: target,
              after: linked,
              metadata: { externalActionId: action.id },
            }),
          );
          targetExpectedVersion = linked.version;
        } else if (input.kind === "hr_discipline") {
          const [target] = await tx
            .select({
              id: memberships.id,
              status: memberships.status,
              version: memberships.version,
            })
            .from(memberships)
            .where(
              and(
                eq(memberships.orgId, request.auth.orgId),
                eq(memberships.userId, input.payload.userId),
                isNull(memberships.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) throw new DomainError("NOT_FOUND", "Member target not found", 404);
          if (target.status !== "active") {
            throw new DomainError("CONFLICT", "HR discipline requires an active member", 409);
          }
          targetExpectedVersion = target.version;
        } else if (input.kind === "permission_change") {
          const [target] = await tx
            .select({
              id: memberships.id,
              status: memberships.status,
              version: memberships.version,
            })
            .from(memberships)
            .where(
              and(
                eq(memberships.id, input.payload.membershipId),
                eq(memberships.orgId, request.auth.orgId),
                isNull(memberships.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) throw new DomainError("NOT_FOUND", "Membership target not found", 404);
          if (target.status !== "active") {
            throw new DomainError(
              "CONFLICT",
              "Permission changes require an active membership",
              409,
            );
          }
          targetExpectedVersion = target.version;
        }

        let validatedAction = action;
        if (targetExpectedVersion !== undefined) {
          const [snapshotted] = await tx
            .update(externalActions)
            .set({
              payload: {
                ...input.payload,
                targetExpectedVersion,
                ...(targetFileId ? { targetFileId } : {}),
                ...(targetFileChecksumSha256 ? { targetFileChecksumSha256 } : {}),
              },
              updatedAt: new Date(),
              version: sql`${externalActions.version} + 1`,
            })
            .where(
              and(
                eq(externalActions.id, action.id),
                eq(externalActions.orgId, request.auth.orgId),
                eq(externalActions.version, action.version),
              ),
            )
            .returning();
          if (!snapshotted) {
            throw new DomainError("CONFLICT", "External action changed while validating", 409);
          }
          validatedAction = snapshotted;
        }

        let completedAction = validatedAction;
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
              payload: validatedAction.payload,
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
            .where(
              and(
                eq(externalActions.id, validatedAction.id),
                eq(externalActions.orgId, request.auth.orgId),
                eq(externalActions.version, validatedAction.version),
              ),
            )
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
      if (
        input.targetStatus === "submitted" &&
        (typeof input.evidence?.externalReference !== "string" ||
          !input.evidence.externalReference.trim())
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Submitted actions require an externalReference",
          400,
        );
      }
      if (
        input.targetStatus === "confirmed" &&
        (typeof input.evidence?.receiptReference !== "string" ||
          !input.evidence.receiptReference.trim())
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Confirmed actions require a receiptReference from the external system or manual evidence record",
          400,
        );
      }

      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const now = new Date();
        const [linkedApproval] =
          input.targetStatus === "cancelled" && current.approvalId
            ? await tx
                .select()
                .from(approvals)
                .where(
                  and(
                    eq(approvals.id, current.approvalId),
                    eq(approvals.orgId, request.auth.orgId),
                    isNull(approvals.archivedAt),
                  ),
                )
                .limit(1)
                .for("update")
            : [];
        const [lockedCurrent] = await tx
          .select()
          .from(externalActions)
          .where(
            and(
              eq(externalActions.id, id),
              eq(externalActions.orgId, request.auth.orgId),
              isNull(externalActions.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!lockedCurrent) throw new DomainError("NOT_FOUND", "External action not found", 404);
        if (lockedCurrent.approvalId !== current.approvalId) {
          throw new DomainError("CONFLICT", "External action approval link changed", 409);
        }

        assertExternalActionTransition({
          adapter: lockedCurrent.adapter as ExternalAdapter,
          from: lockedCurrent.status,
          to: input.targetStatus,
          ...(input.evidence ? { evidence: input.evidence } : {}),
        });

        let cancelledApproval: typeof approvals.$inferSelect | undefined;
        if (input.targetStatus === "cancelled" && lockedCurrent.status === "pending_approval") {
          if (!linkedApproval) {
            throw new DomainError(
              "CONFLICT",
              "Pending external action has no linked approval to cancel",
              409,
            );
          }
          if (linkedApproval.status === "pending") {
            [cancelledApproval] = await tx
              .update(approvals)
              .set({
                status: "cancelled",
                decidedBy: request.auth.userId,
                decidedAt: now,
                decisionComment:
                  input.note?.trim() || "External action was cancelled before approval",
                updatedAt: now,
                version: linkedApproval.version + 1,
              })
              .where(
                and(
                  eq(approvals.id, linkedApproval.id),
                  eq(approvals.orgId, request.auth.orgId),
                  eq(approvals.status, "pending"),
                  eq(approvals.version, linkedApproval.version),
                ),
              )
              .returning();
            if (!cancelledApproval) {
              throw new DomainError("CONFLICT", "Approval changed while cancelling", 409);
            }
          } else if (linkedApproval.status !== "cancelled") {
            throw new DomainError(
              "CONFLICT",
              "The linked approval was already decided; reload the action before cancelling",
              409,
            );
          }
        }

        if (
          input.targetStatus === "cancelled" &&
          ["pending_approval", "approved", "failed"].includes(lockedCurrent.status) &&
          lockedCurrent.kind === "bank_payment" &&
          typeof lockedCurrent.payload === "object" &&
          lockedCurrent.payload !== null &&
          "financialEntryId" in lockedCurrent.payload
        ) {
          const payload = lockedCurrent.payload as Record<string, unknown>;
          const financialEntryId = idSchema.safeParse(payload.financialEntryId);
          if (!financialEntryId.success) {
            throw new DomainError("CONFLICT", "Payment target reference is invalid", 409);
          }
          const [target] = await tx
            .select()
            .from(financialEntries)
            .where(
              and(
                eq(financialEntries.id, financialEntryId.data),
                eq(financialEntries.orgId, request.auth.orgId),
                isNull(financialEntries.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!target) {
            throw new DomainError("CONFLICT", "Payment target is no longer available", 409);
          }
          if (target.status !== "draft") {
            throw new DomainError(
              "CONFLICT",
              "Payment target changed while cancelling the action",
              409,
            );
          }
          if (target.externalActionId === lockedCurrent.id) {
            const [unlinked] = await tx
              .update(financialEntries)
              .set({
                externalActionId: null,
                updatedAt: now,
                version: sql`${financialEntries.version} + 1`,
              })
              .where(
                and(
                  eq(financialEntries.id, target.id),
                  eq(financialEntries.orgId, request.auth.orgId),
                  eq(financialEntries.status, "draft"),
                  eq(financialEntries.externalActionId, lockedCurrent.id),
                  eq(financialEntries.version, target.version),
                  isNull(financialEntries.archivedAt),
                ),
              )
              .returning();
            if (!unlinked) {
              throw new DomainError("CONFLICT", "Payment target changed while cancelling", 409);
            }
            await tx.insert(auditEvents).values(
              auditValue(context, {
                action: "unlink_payment_cancel",
                resourceType: "financial-entries",
                resourceId: target.id,
                before: target,
                after: unlinked,
                metadata: { externalActionId: lockedCurrent.id },
              }),
            );
          } else if (target.externalActionId !== null) {
            throw new DomainError(
              "CONFLICT",
              "Payment target is linked to another external action",
              409,
            );
          }
        }

        const currentEvidence =
          typeof lockedCurrent.evidence === "object" && lockedCurrent.evidence !== null
            ? (lockedCurrent.evidence as Record<string, unknown>)
            : {};
        const combinedEvidence = input.evidence
          ? { ...currentEvidence, ...input.evidence }
          : lockedCurrent.evidence;
        let targetTransitionAudit:
          | {
              resourceType: "contracts" | "invoices" | "financial-entries";
              resourceId: string;
              before: Record<string, unknown>;
              after: Record<string, unknown>;
            }
          | undefined;

        if (
          input.targetStatus === "confirmed" &&
          lockedCurrent.kind === "bank_payment" &&
          typeof lockedCurrent.payload === "object" &&
          lockedCurrent.payload !== null &&
          "financialEntryId" in lockedCurrent.payload
        ) {
          const payload = lockedCurrent.payload as Record<string, unknown>;
          const financialEntryId = idSchema.safeParse(payload.financialEntryId);
          const targetExpectedVersion = payload.targetExpectedVersion;
          const amountCents = payload.amountCents;
          if (
            !financialEntryId.success ||
            !Number.isInteger(targetExpectedVersion) ||
            Number(targetExpectedVersion) < 1 ||
            !Number.isSafeInteger(amountCents) ||
            Number(amountCents) < 1
          ) {
            throw new DomainError("CONFLICT", "Payment target snapshot is invalid", 409);
          }
          const [posted] = await tx
            .update(financialEntries)
            .set({
              status: "posted",
              updatedAt: now,
              version: sql`${financialEntries.version} + 1`,
            })
            .where(
              and(
                eq(financialEntries.id, financialEntryId.data),
                eq(financialEntries.orgId, lockedCurrent.orgId),
                eq(financialEntries.type, "expense"),
                eq(financialEntries.status, "draft"),
                eq(financialEntries.amountCents, Number(amountCents)),
                eq(financialEntries.externalActionId, lockedCurrent.id),
                eq(financialEntries.version, Number(targetExpectedVersion)),
                isNull(financialEntries.archivedAt),
              ),
            )
            .returning({ id: financialEntries.id });
          if (!posted) {
            throw new DomainError(
              "CONFLICT",
              "Payment ledger entry changed after approval; create and approve a new action",
              409,
            );
          }
          targetTransitionAudit = {
            resourceType: "financial-entries",
            resourceId: financialEntryId.data,
            before: {
              status: "draft",
              version: Number(targetExpectedVersion),
              externalActionId: lockedCurrent.id,
            },
            after: {
              status: "posted",
              version: Number(targetExpectedVersion) + 1,
              externalActionId: lockedCurrent.id,
            },
          };
        }

        if (
          input.targetStatus === "confirmed" &&
          (lockedCurrent.kind === "contract_sign" || lockedCurrent.kind === "invoice_red")
        ) {
          if (typeof lockedCurrent.payload !== "object" || lockedCurrent.payload === null) {
            throw new DomainError("CONFLICT", "External action target snapshot is invalid", 409);
          }
          const payload = lockedCurrent.payload as Record<string, unknown>;
          const targetExpectedVersion = payload.targetExpectedVersion;
          if (!Number.isInteger(targetExpectedVersion) || Number(targetExpectedVersion) < 1) {
            throw new DomainError(
              "CONFLICT",
              "External action is missing its validated target version",
              409,
            );
          }
          const targetFileId = idSchema.safeParse(payload.targetFileId);
          const targetFileChecksumSha256 = z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .safeParse(payload.targetFileChecksumSha256);
          if (!targetFileId.success || !targetFileChecksumSha256.success) {
            throw new DomainError("CONFLICT", "External action file snapshot is invalid", 409);
          }
          const [verifiedFile] = await tx
            .select({ id: files.id })
            .from(files)
            .where(
              and(
                eq(files.id, targetFileId.data),
                eq(files.orgId, lockedCurrent.orgId),
                eq(files.uploadStatus, "uploaded"),
                eq(files.checksumSha256, targetFileChecksumSha256.data),
                isNull(files.archivedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!verifiedFile) {
            throw new DomainError(
              "CONFLICT",
              "Verified target file changed or was archived after approval",
              409,
            );
          }
          if (lockedCurrent.kind === "contract_sign") {
            const contractId = idSchema.safeParse(payload.contractId);
            if (!contractId.success) {
              throw new DomainError("CONFLICT", "Contract target snapshot is invalid", 409);
            }
            const [activated] = await tx
              .update(contracts)
              .set({
                status: "active",
                updatedAt: now,
                version: sql`${contracts.version} + 1`,
              })
              .where(
                and(
                  eq(contracts.id, contractId.data),
                  eq(contracts.orgId, lockedCurrent.orgId),
                  eq(contracts.status, "pending_signature"),
                  eq(contracts.version, Number(targetExpectedVersion)),
                  isNull(contracts.archivedAt),
                ),
              )
              .returning({ id: contracts.id });
            if (!activated) {
              throw new DomainError(
                "CONFLICT",
                "Contract changed after approval; create and approve a new signature action",
                409,
              );
            }
            targetTransitionAudit = {
              resourceType: "contracts",
              resourceId: contractId.data,
              before: { status: "pending_signature", version: Number(targetExpectedVersion) },
              after: {
                status: "active",
                version: Number(targetExpectedVersion) + 1,
                externalActionId: lockedCurrent.id,
              },
            };
          } else if (lockedCurrent.kind === "invoice_red") {
            const invoiceId = idSchema.safeParse(payload.invoiceId);
            if (!invoiceId.success) {
              throw new DomainError("CONFLICT", "Invoice target snapshot is invalid", 409);
            }
            const [redConfirmed] = await tx
              .update(invoices)
              .set({
                status: "red_confirmed",
                updatedAt: now,
                version: sql`${invoices.version} + 1`,
              })
              .where(
                and(
                  eq(invoices.id, invoiceId.data),
                  eq(invoices.orgId, lockedCurrent.orgId),
                  inArray(invoices.status, ["issued", "received", "paid"]),
                  eq(invoices.version, Number(targetExpectedVersion)),
                  isNull(invoices.archivedAt),
                ),
              )
              .returning({ id: invoices.id });
            if (!redConfirmed) {
              throw new DomainError(
                "CONFLICT",
                "Invoice changed after approval; create and approve a new red-letter action",
                409,
              );
            }
            targetTransitionAudit = {
              resourceType: "invoices",
              resourceId: invoiceId.data,
              before: {
                status: "issued_or_received_or_paid",
                version: Number(targetExpectedVersion),
              },
              after: {
                status: "red_confirmed",
                version: Number(targetExpectedVersion) + 1,
                externalActionId: lockedCurrent.id,
              },
            };
          }
        }

        if (input.targetStatus === "confirmed" && lockedCurrent.kind === "contract_terminate") {
          if (typeof lockedCurrent.payload !== "object" || lockedCurrent.payload === null) {
            throw new DomainError("CONFLICT", "External action target snapshot is invalid", 409);
          }
          const payload = lockedCurrent.payload as Record<string, unknown>;
          const contractId = idSchema.safeParse(payload.contractId);
          const targetExpectedVersion = payload.targetExpectedVersion;
          if (
            !contractId.success ||
            !Number.isInteger(targetExpectedVersion) ||
            Number(targetExpectedVersion) < 1
          ) {
            throw new DomainError("CONFLICT", "Contract target snapshot is invalid", 409);
          }
          const [terminated] = await tx
            .update(contracts)
            .set({
              status: "terminated",
              updatedAt: now,
              version: sql`${contracts.version} + 1`,
            })
            .where(
              and(
                eq(contracts.id, contractId.data),
                eq(contracts.orgId, lockedCurrent.orgId),
                eq(contracts.status, "active"),
                eq(contracts.version, Number(targetExpectedVersion)),
                isNull(contracts.archivedAt),
              ),
            )
            .returning({ id: contracts.id });
          if (!terminated) {
            throw new DomainError(
              "CONFLICT",
              "Contract changed after approval; create and approve a new termination action",
              409,
            );
          }
          targetTransitionAudit = {
            resourceType: "contracts",
            resourceId: contractId.data,
            before: { status: "active", version: Number(targetExpectedVersion) },
            after: {
              status: "terminated",
              version: Number(targetExpectedVersion) + 1,
              externalActionId: lockedCurrent.id,
            },
          };
        }

        const [changed] = await tx
          .update(externalActions)
          .set({
            status: input.targetStatus,
            evidence: combinedEvidence,
            failureReason: input.targetStatus === "failed" ? input.note : null,
            submittedAt: input.targetStatus === "submitted" ? now : lockedCurrent.submittedAt,
            confirmedAt: input.targetStatus === "confirmed" ? now : null,
            updatedAt: now,
            version: lockedCurrent.version + 1,
          })
          .where(
            and(
              eq(externalActions.id, lockedCurrent.id),
              eq(externalActions.orgId, request.auth.orgId),
              eq(externalActions.version, lockedCurrent.version),
              eq(externalActions.status, lockedCurrent.status),
            ),
          )
          .returning();
        if (!changed)
          throw new DomainError("CONFLICT", "External action changed concurrently", 409);

        const auditValues = [
          auditValue(context, {
            action: "transition",
            resourceType: "external-action",
            resourceId: lockedCurrent.id,
            before: lockedCurrent,
            after: changed,
            metadata: { note: input.note ?? null },
          }),
        ];
        if (targetTransitionAudit) {
          auditValues.push(
            auditValue(context, {
              action: "external_action_apply",
              resourceType: targetTransitionAudit.resourceType,
              resourceId: targetTransitionAudit.resourceId,
              before: targetTransitionAudit.before,
              after: targetTransitionAudit.after,
              metadata: { externalActionId: lockedCurrent.id },
            }),
          );
        }
        if (cancelledApproval) {
          auditValues.push(
            auditValue(context, {
              action: "cancel",
              resourceType: "approval",
              resourceId: cancelledApproval.id,
              before: linkedApproval,
              after: cancelledApproval,
              metadata: { externalActionId: lockedCurrent.id },
            }),
          );
        }
        await tx.insert(auditEvents).values(auditValues);
        return [changed];
      });
      return { data: updated };
    },
  );
}
