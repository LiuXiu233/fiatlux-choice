import { randomUUID } from "node:crypto";
import {
  idSchema,
  listQuerySchema,
  membershipLifecycleApprovalPayloadSchema,
  membershipLifecycleRequestSchema,
  roleAssignmentApprovalPayloadSchema,
  roleAssignmentRequestSchema,
} from "@fiatlux/contracts";
import {
  approvals,
  auditEvents,
  backups,
  githubInsights,
  integrationChecks,
  membershipRoles,
  memberships,
  rolePermissions,
  roles,
  users,
} from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { sanitizeIntegrationError } from "@fiatlux/integrations";
import argon2 from "argon2";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies, RequestAuditContext } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(14).max(256),
  roleId: idSchema,
});
export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  expectedVersion: z.number().int().min(1),
});
export const roleAssignmentSchema = roleAssignmentRequestSchema;

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

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/users",
    {
      preHandler: [authenticate, requirePermission("users:read")],
      schema: { tags: ["users"], summary: "List organization members" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const where = and(
        eq(memberships.orgId, request.auth.orgId),
        isNull(memberships.archivedAt),
        query.search
          ? or(
              ilike(users.displayName, `%${query.search}%`),
              ilike(users.email, `%${query.search}%`),
            )
          : undefined,
        query.status ? eq(memberships.status, query.status) : undefined,
      );
      const memberRows = await dependencies.db
        .select({
          id: users.id,
          membershipId: memberships.id,
          email: users.email,
          displayName: users.displayName,
          userStatus: users.status,
          membershipStatus: memberships.status,
          version: memberships.version,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where)
        .orderBy(desc(memberships.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const pendingLifecycleRows =
        memberRows.length === 0
          ? []
          : await dependencies.db
              .select({
                id: approvals.id,
                resourceId: approvals.resourceId,
                payload: approvals.payload,
              })
              .from(approvals)
              .where(
                and(
                  eq(approvals.orgId, request.auth.orgId),
                  eq(approvals.resourceType, "membership-lifecycle"),
                  eq(approvals.status, "pending"),
                  inArray(
                    approvals.resourceId,
                    memberRows.map((member) => member.membershipId),
                  ),
                  isNull(approvals.archivedAt),
                ),
              )
              .orderBy(desc(approvals.createdAt));
      const memberRoleRows =
        memberRows.length === 0
          ? []
          : await dependencies.db
              .select({
                membershipId: membershipRoles.membershipId,
                id: roles.id,
                name: roles.name,
                systemKey: roles.systemKey,
              })
              .from(membershipRoles)
              .innerJoin(
                roles,
                and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, membershipRoles.orgId)),
              )
              .where(
                and(
                  eq(membershipRoles.orgId, request.auth.orgId),
                  inArray(
                    membershipRoles.membershipId,
                    memberRows.map((member) => member.membershipId),
                  ),
                  isNull(roles.archivedAt),
                ),
              );
      const pendingLifecycleByMembership = new Map<
        string,
        { approvalId: string; action: "deactivate" | "offboard" | "reactivate" }
      >();
      for (const pending of pendingLifecycleRows) {
        const parsed = membershipLifecycleApprovalPayloadSchema.safeParse(pending.payload);
        if (!parsed.success || pendingLifecycleByMembership.has(pending.resourceId)) continue;
        pendingLifecycleByMembership.set(pending.resourceId, {
          approvalId: pending.id,
          action: parsed.data.action,
        });
      }
      const data = memberRows.map((member) => {
        const pending = pendingLifecycleByMembership.get(member.membershipId);
        return {
          ...member,
          pendingLifecycleAction: pending?.action ?? null,
          pendingLifecycleApprovalId: pending?.approvalId ?? null,
          roles: memberRoleRows
            .filter((role) => role.membershipId === member.membershipId)
            .map(({ membershipId: _membershipId, ...role }) => role),
        };
      });
      const totals = await dependencies.db
        .select({ total: count() })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(where);
      const total = totals[0]?.total ?? 0;
      return { data, meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) } };
    },
  );

  app.post(
    "/api/v1/users",
    {
      preHandler: [authenticate, requirePermission("users:create")],
      schema: { tags: ["users"], summary: "Create a member and request role assignment approval" },
    },
    async (request, reply) => {
      const input = userCreateSchema.parse(request.body);
      const [existing] = await dependencies.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing) throw new DomainError("CONFLICT", "A user with this email already exists", 409);
      const [role] = await dependencies.db
        .select({ id: roles.id })
        .from(roles)
        .where(
          and(
            eq(roles.id, input.roleId),
            eq(roles.orgId, request.auth.orgId),
            isNull(roles.archivedAt),
          ),
        )
        .limit(1);
      if (!role) throw new DomainError("NOT_FOUND", "Role not found", 404);

      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const context = requestAuditContext(request);
      const created = await dependencies.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            mustChangePassword: true,
          })
          .returning();
        if (!user) throw new Error("Failed to create user");
        const [membership] = await tx
          .insert(memberships)
          .values({
            orgId: request.auth.orgId,
            userId: user.id,
            status: "pending",
          })
          .returning();
        if (!membership) throw new Error("Failed to create membership");
        const [approval] = await tx
          .insert(approvals)
          .values({
            orgId: request.auth.orgId,
            resourceType: "role-assignment",
            resourceId: membership.id,
            operation: "permission_change",
            reason: `Initial role assignment for ${input.email}`,
            riskLevel: "critical",
            requestedBy: request.auth.userId,
            payload: {
              membershipId: membership.id,
              roleId: input.roleId,
              mode: "assign",
              expectedVersion: membership.version,
              idempotencyKey: `initial-role-${randomUUID()}`,
              activateMembership: true,
            },
          })
          .returning();
        if (!approval) throw new Error("Failed to create role approval");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "user",
            resourceId: user.id,
            after: {
              user: { ...user, passwordHash: "[REDACTED]" },
              membership,
              approvalId: approval.id,
            },
          }),
        );
        return {
          user: { id: user.id, email: user.email, displayName: user.displayName },
          membership,
          approval,
        };
      });
      return reply.status(201).send({ data: created });
    },
  );

  app.post(
    "/api/v1/users/:id/lifecycle",
    {
      preHandler: [authenticate, requirePermission("users:update")],
      schema: {
        tags: ["users"],
        summary:
          "Request human-approved organization membership deactivation, offboarding, or reactivation",
      },
    },
    async (request, reply) => {
      const { id: userId } = idParamsSchema.parse(request.params);
      const input = membershipLifecycleRequestSchema.parse(request.body);
      const context = requestAuditContext(request);
      const result = await dependencies.db.transaction(async (tx) => {
        const [membership] = await tx
          .select({
            id: memberships.id,
            userId: memberships.userId,
            status: memberships.status,
            version: memberships.version,
            archivedAt: memberships.archivedAt,
          })
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, request.auth.orgId),
              eq(memberships.userId, userId),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!membership) {
          throw new DomainError("NOT_FOUND", "Organization member not found", 404);
        }

        const lifecycleApprovals = await tx
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.orgId, request.auth.orgId),
              eq(approvals.resourceType, "membership-lifecycle"),
              eq(approvals.resourceId, membership.id),
              isNull(approvals.archivedAt),
            ),
          )
          .orderBy(desc(approvals.createdAt));
        const sameKey = lifecycleApprovals.find((approval) => {
          const parsed = membershipLifecycleApprovalPayloadSchema.safeParse(approval.payload);
          return parsed.success && parsed.data.idempotencyKey === input.idempotencyKey;
        });
        if (sameKey) {
          const parsed = membershipLifecycleApprovalPayloadSchema.parse(sameKey.payload);
          if (
            parsed.action !== input.action ||
            parsed.expectedVersion !== input.expectedVersion ||
            parsed.membershipId !== membership.id ||
            parsed.userId !== userId ||
            sameKey.reason !== input.reason
          ) {
            throw new DomainError(
              "CONFLICT",
              "Idempotency key was already used for a different membership lifecycle request",
              409,
            );
          }
          return { approval: sameKey, replay: true };
        }

        const requiredStatus = input.action === "reactivate" ? "inactive" : "active";
        if (membership.status !== requiredStatus) {
          throw new DomainError(
            "CONFLICT",
            input.action === "reactivate"
              ? "Only an inactive membership can be reactivated; offboarded members require a new onboarding process"
              : `Only an active membership can be ${input.action === "deactivate" ? "deactivated" : "offboarded"}`,
            409,
          );
        }
        if (membership.version !== input.expectedVersion) {
          throw new DomainError("CONFLICT", "Member changed concurrently", 409);
        }
        if (lifecycleApprovals.some((approval) => approval.status === "pending")) {
          throw new DomainError(
            "CONFLICT",
            "A membership lifecycle request is already pending approval",
            409,
          );
        }

        const payload = membershipLifecycleApprovalPayloadSchema.parse({
          membershipId: membership.id,
          userId,
          action: input.action,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
        });
        const [approval] = await tx
          .insert(approvals)
          .values({
            orgId: request.auth.orgId,
            resourceType: "membership-lifecycle",
            resourceId: membership.id,
            operation:
              input.action === "deactivate"
                ? "membership_deactivate"
                : input.action === "offboard"
                  ? "membership_offboard"
                  : "membership_reactivate",
            reason: input.reason,
            riskLevel: "critical",
            requestedBy: request.auth.userId,
            payload,
          })
          .returning();
        if (!approval) throw new Error("Failed to create membership lifecycle approval");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "request",
            resourceType: "membership-lifecycle",
            resourceId: membership.id,
            before: {
              membershipId: membership.id,
              userId: membership.userId,
              status: membership.status,
              version: membership.version,
            },
            after: {
              approvalId: approval.id,
              action: input.action,
              approvalStatus: approval.status,
              expectedVersion: input.expectedVersion,
            },
          }),
        );
        return { approval, replay: false };
      });
      return reply.status(result.replay ? 200 : 201).send({
        data: result.approval,
        meta: { replay: result.replay },
      });
    },
  );

  app.patch(
    "/api/v1/users/:id",
    {
      preHandler: [authenticate, requirePermission("users:update")],
      schema: { tags: ["users"], summary: "Update non-disciplinary user profile fields" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = userUpdateSchema.parse(request.body);
      const [current] = await dependencies.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "User not found", 404);
      const [membership] = await dependencies.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, id),
            eq(memberships.orgId, request.auth.orgId),
            isNull(memberships.archivedAt),
          ),
        )
        .limit(1);
      if (!membership) throw new DomainError("NOT_FOUND", "Organization member not found", 404);
      if (membership.version !== input.expectedVersion)
        throw new DomainError("CONFLICT", "Member changed concurrently", 409);
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const now = new Date();
        const [updatedMembership] = await tx
          .update(memberships)
          .set({
            updatedAt: now,
            version: sql`${memberships.version} + 1`,
          })
          .where(
            and(
              eq(memberships.id, membership.id),
              eq(memberships.orgId, request.auth.orgId),
              eq(memberships.version, input.expectedVersion),
            ),
          )
          .returning({ version: memberships.version });
        if (!updatedMembership) {
          throw new DomainError("CONFLICT", "Member changed concurrently", 409);
        }
        const [changed] = await tx
          .update(users)
          .set({ displayName: input.displayName, updatedAt: now })
          .where(eq(users.id, id))
          .returning({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            status: users.status,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          });
        if (!changed) throw new DomainError("CONFLICT", "User changed concurrently", 409);
        const response = { ...changed, version: updatedMembership.version };
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "update",
            resourceType: "user",
            resourceId: id,
            before: {
              id: current.id,
              displayName: current.displayName,
              version: membership.version,
            },
            after: {
              id: changed.id,
              displayName: changed.displayName,
              version: updatedMembership.version,
            },
          }),
        );
        return [response];
      });
      return { data: updated };
    },
  );

  app.get(
    "/api/v1/roles",
    {
      preHandler: [authenticate, requirePermission("roles:read")],
      schema: { tags: ["roles"], summary: "List organization roles and permissions" },
    },
    async (request) => {
      const roleRows = await dependencies.db
        .select()
        .from(roles)
        .where(and(eq(roles.orgId, request.auth.orgId), isNull(roles.archivedAt)))
        .orderBy(roles.name);
      const permissions =
        roleRows.length === 0
          ? []
          : await dependencies.db
              .select()
              .from(rolePermissions)
              .where(
                and(
                  eq(rolePermissions.orgId, request.auth.orgId),
                  inArray(
                    rolePermissions.roleId,
                    roleRows.map((role) => role.id),
                  ),
                ),
              );
      return {
        data: roleRows.map((role) => ({
          ...role,
          permissions: permissions
            .filter((permission) => permission.roleId === role.id)
            .map((permission) => permission.permission),
        })),
      };
    },
  );

  app.post(
    "/api/v1/role-assignments",
    {
      preHandler: [authenticate, requirePermission("role-assignments:create")],
      schema: { tags: ["roles"], summary: "Request a human-approved role assignment change" },
    },
    async (request, reply) => {
      const input = roleAssignmentSchema.parse(request.body);
      const context = requestAuditContext(request);
      const result = await dependencies.db.transaction(async (tx) => {
        const [membership] = await tx
          .select({ id: memberships.id, version: memberships.version })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, input.membershipId),
              eq(memberships.orgId, request.auth.orgId),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        const [role] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(
            and(
              eq(roles.id, input.roleId),
              eq(roles.orgId, request.auth.orgId),
              isNull(roles.archivedAt),
            ),
          )
          .limit(1);
        if (!membership || !role)
          throw new DomainError("NOT_FOUND", "Role or membership not found", 404);
        const existingApprovals = await tx
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.orgId, request.auth.orgId),
              eq(approvals.resourceType, "role-assignment"),
              eq(approvals.resourceId, input.membershipId),
              isNull(approvals.archivedAt),
            ),
          )
          .orderBy(desc(approvals.createdAt));
        const sameKey = existingApprovals.find((approval) => {
          const parsed = roleAssignmentApprovalPayloadSchema.safeParse(approval.payload);
          return parsed.success && parsed.data.idempotencyKey === input.idempotencyKey;
        });
        if (sameKey) {
          const parsed = roleAssignmentApprovalPayloadSchema.parse(sameKey.payload);
          if (
            parsed.membershipId !== input.membershipId ||
            parsed.roleId !== input.roleId ||
            parsed.mode !== input.mode ||
            parsed.expectedVersion !== input.expectedVersion ||
            sameKey.reason !== input.reason
          ) {
            throw new DomainError(
              "CONFLICT",
              "Idempotency key was already used for a different role assignment request",
              409,
            );
          }
          return { approval: sameKey, replay: true } as const;
        }
        if (membership.version !== input.expectedVersion) {
          throw new DomainError("CONFLICT", "Member changed concurrently", 409);
        }
        if (existingApprovals.some((approval) => approval.status === "pending")) {
          throw new DomainError(
            "CONFLICT",
            "A role assignment request is already pending for this member",
            409,
          );
        }
        const [existingAssignment] = await tx
          .select({ roleId: membershipRoles.roleId })
          .from(membershipRoles)
          .where(
            and(
              eq(membershipRoles.orgId, request.auth.orgId),
              eq(membershipRoles.membershipId, input.membershipId),
              eq(membershipRoles.roleId, input.roleId),
            ),
          )
          .limit(1);
        if (input.mode === "assign" ? existingAssignment : !existingAssignment) {
          throw new DomainError(
            "CONFLICT",
            input.mode === "assign"
              ? "The member already has this role"
              : "The member does not have this role",
            409,
          );
        }
        const payload = roleAssignmentApprovalPayloadSchema.parse({
          membershipId: input.membershipId,
          roleId: input.roleId,
          mode: input.mode,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
        });
        const [created] = await tx
          .insert(approvals)
          .values({
            orgId: request.auth.orgId,
            resourceType: "role-assignment",
            resourceId: input.membershipId,
            operation: "permission_change",
            reason: input.reason,
            riskLevel: "critical",
            requestedBy: request.auth.userId,
            payload,
          })
          .returning();
        if (!created) throw new Error("Failed to create role assignment approval");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceType: "role-assignment",
            resourceId: input.membershipId,
            after: created,
          }),
        );
        return { approval: created, replay: false } as const;
      });
      return reply.status(result.replay ? 200 : 201).send({
        data: result.approval,
        meta: { replay: result.replay },
      });
    },
  );
}

export const integrationDefinitions = [
  {
    id: "database",
    name: "PostgreSQL",
    category: "core",
    mode: "real",
    capabilities: ["read", "write", "transactions", "migrations"],
  },
  {
    id: "object-storage",
    name: "S3 Object Storage",
    category: "files",
    mode: "real",
    capabilities: ["authenticated_proxy_upload", "verify_sha256", "authenticated_proxy_download"],
  },
  {
    id: "llm",
    name: "LLM Provider",
    category: "ai",
    mode: "real",
    capabilities: ["structured_advisor_output"],
  },
  {
    id: "github",
    name: "GitHub",
    category: "intelligence",
    mode: "real",
    capabilities: ["repository_read"],
  },
  {
    id: "external-manual",
    name: "Manual External Operations",
    category: "operations",
    mode: "manual",
    capabilities: ["evidence_confirmation"],
  },
] as const;

export const integrationIdParamsSchema = z.object({
  id: z.enum(integrationDefinitions.map((item) => item.id) as [string, ...string[]]),
});

export const backupCreateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  // The queued worker intentionally produces a PostgreSQL dump only. Full
  // database+object-storage archives require the quiesced administrator CLI.
  scope: z.literal("database").default("database"),
});

export function registerOperationsRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.post(
    "/api/v1/github-insights/:id/refresh",
    {
      preHandler: [authenticate, requirePermission("github-insights:update")],
      schema: { tags: ["github-insights"], summary: "Queue a read-only GitHub refresh" },
    },
    async (request, reply) => {
      if (dependencies.config.GITHUB_INTEGRATION_MODE !== "read_only") {
        throw new DomainError(
          "CONFLICT",
          "GitHub refresh is disabled in manual mode; import a snapshot instead",
          409,
        );
      }
      if (!dependencies.queue) {
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      }
      const { id } = idParamsSchema.parse(request.params);
      const [insight] = await dependencies.db
        .select({
          id: githubInsights.id,
          repository: githubInsights.repository,
          version: githubInsights.version,
        })
        .from(githubInsights)
        .where(
          and(
            eq(githubInsights.id, id),
            eq(githubInsights.orgId, request.auth.orgId),
            isNull(githubInsights.archivedAt),
          ),
        )
        .limit(1);
      if (!insight) throw new DomainError("NOT_FOUND", "GitHub insight not found", 404);

      try {
        await dependencies.queue.send("github.refresh", {
          orgId: request.auth.orgId,
          insightId: insight.id,
          expectedVersion: insight.version,
        });
      } catch (error) {
        const message = sanitizeIntegrationError(error, "Background queue dispatch failed", {
          maxLength: 500,
        });
        await dependencies.db.insert(auditEvents).values(
          auditValue(requestAuditContext(request), {
            action: "queue_refresh_fail",
            resourceType: "github-insight",
            resourceId: insight.id,
            after: {
              repository: insight.repository,
              expectedVersion: insight.version,
              integrationMode: "read_only",
            },
            metadata: { error: message },
          }),
        );
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      }
      await dependencies.db.insert(auditEvents).values(
        auditValue(requestAuditContext(request), {
          action: "queue_refresh",
          resourceType: "github-insight",
          resourceId: insight.id,
          after: {
            repository: insight.repository,
            expectedVersion: insight.version,
            integrationMode: "read_only",
          },
        }),
      );
      return reply.status(202).send({
        data: {
          insightId: insight.id,
          repository: insight.repository,
          expectedVersion: insight.version,
          status: "queued",
        },
      });
    },
  );

  app.get(
    "/api/v1/settings/integrations",
    {
      preHandler: [authenticate, requirePermission("settings:read")],
      schema: { tags: ["settings"], summary: "List configured integration boundaries" },
    },
    async (request) => {
      const checks = await dependencies.db
        .select()
        .from(integrationChecks)
        .where(
          and(
            eq(integrationChecks.orgId, request.auth.orgId),
            isNull(integrationChecks.archivedAt),
          ),
        )
        .orderBy(desc(integrationChecks.checkedAt));
      const configured = {
        database: true,
        "object-storage": Boolean(
          dependencies.config.S3_ACCESS_KEY_ID && dependencies.config.S3_SECRET_ACCESS_KEY,
        ),
        llm: dependencies.config.LLM_DRIVER !== "disabled",
        github: true,
        "external-manual": true,
      } as const;
      return {
        data: integrationDefinitions.map((definition) => {
          const latest = checks.find((check) => check.integrationId === definition.id);
          const llmMode =
            dependencies.config.LLM_DRIVER === "compatible"
              ? "real"
              : dependencies.config.LLM_DRIVER;
          const llmStatus =
            dependencies.config.LLM_DRIVER === "mock"
              ? "simulated"
              : dependencies.config.LLM_DRIVER === "disabled"
                ? "disabled"
                : (latest?.status ?? "untested");
          const githubMode = dependencies.config.GITHUB_INTEGRATION_MODE;
          const githubStatus = githubMode === "manual" ? "manual" : (latest?.status ?? "untested");
          return {
            ...definition,
            mode:
              definition.id === "llm"
                ? llmMode
                : definition.id === "github"
                  ? githubMode
                  : definition.mode,
            status:
              definition.id === "llm"
                ? llmStatus
                : definition.id === "github"
                  ? githubStatus
                  : (latest?.status ?? (configured[definition.id] ? "untested" : "unavailable")),
            lastCheckedAt: latest?.checkedAt ?? null,
          };
        }),
      };
    },
  );

  app.post(
    "/api/v1/settings/integrations/:id/test",
    {
      preHandler: [authenticate, requirePermission("settings:test")],
      schema: {
        tags: ["settings"],
        summary: "Probe an integration without performing business actions",
      },
    },
    async (request) => {
      const { id } = integrationIdParamsSchema.parse(request.params);
      let status = "healthy";
      let detail = "Connectivity verified";
      try {
        if (id === "database") await dependencies.db.execute(sql`SELECT 1`);
        if (id === "object-storage") await dependencies.storage.healthCheck();
        if (id === "llm") {
          if (dependencies.config.LLM_DRIVER === "disabled") {
            status = "disabled";
            detail = "LLM driver is explicitly disabled";
          } else if (dependencies.config.LLM_DRIVER === "mock") {
            status = "simulated";
            detail = "Mock driver active; no external model call was performed";
          } else {
            if (!dependencies.config.LLM_BASE_URL || !dependencies.config.LLM_API_KEY) {
              throw new Error("Compatible LLM driver is not configured");
            }
            const response = await fetch(
              `${dependencies.config.LLM_BASE_URL.replace(/\/$/, "")}/v1/models`,
              {
                headers: { authorization: `Bearer ${dependencies.config.LLM_API_KEY}` },
                signal: AbortSignal.timeout(10_000),
              },
            );
            if (!response.ok) throw new Error(`LLM endpoint returned HTTP ${response.status}`);
          }
        }
        if (id === "github") {
          if (dependencies.config.GITHUB_INTEGRATION_MODE === "manual") {
            status = "manual";
            detail = "Manual import is available; no GitHub network request was performed";
          } else {
            const response = await fetch("https://api.github.com/rate_limit", {
              headers: {
                accept: "application/vnd.github+json",
                ...(dependencies.config.GITHUB_TOKEN
                  ? { authorization: `Bearer ${dependencies.config.GITHUB_TOKEN}` }
                  : {}),
              },
              signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
          }
        }
        if (id === "external-manual")
          detail = "Manual adapter available; no external action was performed";
      } catch (error) {
        status = "unhealthy";
        detail = sanitizeIntegrationError(error, "Unknown integration error", { maxLength: 500 });
      }
      const context = requestAuditContext(request);
      const [check] = await dependencies.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(integrationChecks)
          .values({
            orgId: request.auth.orgId,
            integrationId: id,
            status,
            detail,
            checkedBy: request.auth.userId,
          })
          .returning();
        if (!created) throw new Error("Failed to store integration check");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "test",
            resourceType: "integration",
            resourceId: id,
            after: { status, detail },
          }),
        );
        return [created];
      });
      return { data: check };
    },
  );

  app.get(
    "/api/v1/backups",
    {
      preHandler: [authenticate, requirePermission("backups:read")],
      schema: { tags: ["backups"], summary: "List backup jobs" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const where = query.status
        ? and(
            eq(backups.orgId, request.auth.orgId),
            eq(backups.status, query.status),
            isNull(backups.archivedAt),
          )
        : and(eq(backups.orgId, request.auth.orgId), isNull(backups.archivedAt));
      const [data, totals] = await Promise.all([
        dependencies.db
          .select()
          .from(backups)
          .where(where)
          .orderBy(desc(backups.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(backups).where(where),
      ]);
      const total = totals[0]?.total ?? 0;
      return { data, meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) } };
    },
  );

  app.post(
    "/api/v1/backups",
    {
      preHandler: [authenticate, requirePermission("backups:create")],
      schema: { tags: ["backups"], summary: "Queue a backup job" },
    },
    async (request, reply) => {
      if (!dependencies.queue)
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      const requested = backupCreateSchema.parse(request.body ?? {});
      const input = {
        ...requested,
        name: requested.name ?? `backup-${new Date().toISOString()}`,
      };
      const id = randomUUID();
      const context = requestAuditContext(request);
      const [created] = await dependencies.db.transaction(async (tx) => {
        const [record] = await tx
          .insert(backups)
          .values({
            id,
            orgId: request.auth.orgId,
            name: input.name,
            scope: input.scope,
            status: "queued",
            requestedBy: request.auth.userId,
          })
          .returning();
        if (!record) throw new Error("Failed to create backup job");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "queue",
            resourceType: "backup",
            resourceId: id,
            after: record,
          }),
        );
        return [record];
      });
      try {
        await dependencies.queue.send("backup.create", { orgId: request.auth.orgId, backupId: id });
      } catch (error) {
        const message = sanitizeIntegrationError(error, "Failed to enqueue backup", {
          maxLength: 500,
        });
        await dependencies.db.transaction(async (tx) => {
          const [failed] = await tx
            .update(backups)
            .set({
              status: "failed",
              error: message,
              updatedAt: new Date(),
              version: sql`${backups.version} + 1`,
            })
            .where(and(eq(backups.id, id), eq(backups.orgId, request.auth.orgId)))
            .returning();
          if (!failed) throw new Error("Failed to mark backup enqueue failure");
          await tx.insert(auditEvents).values(
            auditValue(context, {
              action: "fail",
              resourceType: "backup",
              resourceId: id,
              before: created,
              after: failed,
              metadata: { error: message },
            }),
          );
        });
        throw new DomainError("INTEGRATION_UNAVAILABLE", "Background queue is unavailable", 503);
      }
      return reply.status(202).send({ data: created });
    },
  );
}
