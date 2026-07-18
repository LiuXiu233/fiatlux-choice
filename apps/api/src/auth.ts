import { createHash, randomUUID } from "node:crypto";
import { changePasswordSchema, loginSchema } from "@fiatlux/contracts";
import {
  auditEvents,
  type Database,
  membershipRoles,
  memberships,
  rolePermissions,
  roles,
  sessions,
  users,
} from "@fiatlux/db";
import { DomainError, hasPermission } from "@fiatlux/domain";
import argon2 from "argon2";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AppDependencies, AuthContext, RequestAuditContext } from "./types.js";

export const SESSION_COOKIE = "fiatlux_session";

function hashSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

async function permissionsFor(db: Database, orgId: string, userId: string) {
  const result = await db
    .select({ permission: rolePermissions.permission })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      and(
        eq(membershipRoles.membershipId, memberships.id),
        eq(membershipRoles.orgId, memberships.orgId),
      ),
    )
    .innerJoin(roles, and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, memberships.orgId)))
    .innerJoin(
      rolePermissions,
      and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.orgId, memberships.orgId)),
    )
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(memberships.archivedAt),
      ),
    );
  return [...new Set(result.map((row) => row.permission))];
}

async function rolesFor(db: Database, orgId: string, userId: string) {
  const result = await db
    .select({ name: roles.name, systemKey: roles.systemKey })
    .from(memberships)
    .innerJoin(
      membershipRoles,
      and(
        eq(membershipRoles.membershipId, memberships.id),
        eq(membershipRoles.orgId, memberships.orgId),
      ),
    )
    .innerJoin(roles, and(eq(roles.id, membershipRoles.roleId), eq(roles.orgId, memberships.orgId)))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(memberships.archivedAt),
        isNull(roles.archivedAt),
      ),
    );
  return result.map((role) => role.systemKey ?? role.name);
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest) => {
    if (!hasPermission(request.auth.permissions, permission)) {
      throw new DomainError("FORBIDDEN", `Missing permission: ${permission}`, 403);
    }
  };
}

export function createAuthenticate(dependencies: AppDependencies) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      throw new DomainError("AUTHENTICATION_REQUIRED", "Authentication is required", 401);
    }
    const { sub, orgId, sid } = request.user;
    const [session] = await dependencies.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.orgId, orgId),
          eq(sessions.userId, sub),
          eq(sessions.tokenHash, hashSessionId(sid)),
          isNull(sessions.revokedAt),
          isNull(sessions.archivedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) {
      throw new DomainError("AUTHENTICATION_REQUIRED", "Session is expired or revoked", 401);
    }
    const permissions = await permissionsFor(dependencies.db, orgId, sub);
    if (permissions.length === 0) {
      throw new DomainError("FORBIDDEN", "No active organization role", 403);
    }
    request.auth = { userId: sub, orgId, sessionId: sid, permissions };
  };
}

function loginAuditContext(
  request: FastifyRequest,
  orgId: string,
  userId: string,
): RequestAuditContext {
  const userAgent = request.headers["user-agent"];
  return {
    orgId,
    actorUserId: userId,
    requestId: request.id,
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}

export function registerAuthRoutes(app: FastifyInstance, dependencies: AppDependencies) {
  const authenticate = createAuthenticate(dependencies);

  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
      schema: { tags: ["auth"], summary: "Create an authenticated organization session" },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const [user] = await dependencies.db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (user?.status !== "active") {
        throw new DomainError("AUTHENTICATION_REQUIRED", "Invalid email or password", 401);
      }
      if (!(await argon2.verify(user.passwordHash, input.password))) {
        throw new DomainError("AUTHENTICATION_REQUIRED", "Invalid email or password", 401);
      }

      const availableMemberships = await dependencies.db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, user.id),
            eq(memberships.status, "active"),
            isNull(memberships.archivedAt),
          ),
        );
      const membership = input.orgId
        ? availableMemberships.find((candidate) => candidate.orgId === input.orgId)
        : availableMemberships[0];
      if (!membership)
        throw new DomainError("FORBIDDEN", "No active membership for this organization", 403);

      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + dependencies.config.JWT_TTL_SECONDS * 1_000);
      await dependencies.db.transaction(async (tx) => {
        await tx.insert(sessions).values({
          orgId: membership.orgId,
          userId: user.id,
          tokenHash: hashSessionId(sessionId),
          expiresAt,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        await tx
          .update(users)
          .set({ lastLoginAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, user.id));
        const audit = loginAuditContext(request, membership.orgId, user.id);
        await tx.insert(auditEvents).values({
          orgId: audit.orgId,
          actorUserId: audit.actorUserId,
          action: "login",
          resourceType: "session",
          resourceId: sessionId,
          requestId: audit.requestId,
          metadata: {},
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
        });
      });

      const token = await reply.jwtSign(
        { sub: user.id, orgId: membership.orgId, sid: sessionId },
        {
          expiresIn: dependencies.config.JWT_TTL_SECONDS,
        },
      );
      reply.setCookie(SESSION_COOKIE, token, {
        path: "/api/v1",
        httpOnly: true,
        secure: dependencies.config.COOKIE_SECURE,
        sameSite: "strict",
        expires: expiresAt,
      });
      const [permissions, userRoles] = await Promise.all([
        permissionsFor(dependencies.db, membership.orgId, user.id),
        rolesFor(dependencies.db, membership.orgId, user.id),
      ]);
      return reply.send({
        data: {
          user: { id: user.id, email: user.email, displayName: user.displayName },
          orgId: membership.orgId,
          permissions,
          roles: userRoles,
          role: userRoles[0] ?? null,
          expiresAt,
        },
      });
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Revoke the current session" },
    },
    async (request, reply) => {
      await dependencies.db.transaction(async (tx) => {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(sessions.orgId, request.auth.orgId),
              eq(sessions.userId, request.auth.userId),
              eq(sessions.tokenHash, hashSessionId(request.auth.sessionId)),
            ),
          );
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "logout",
          resourceType: "session",
          resourceId: request.auth.sessionId,
          requestId: request.id,
          metadata: {},
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
      });
      reply.clearCookie(SESSION_COOKIE, { path: "/api/v1" });
      return reply.send({ data: { loggedOut: true } });
    },
  );

  app.post(
    "/api/v1/auth/change-password",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      preHandler: [authenticate],
      schema: {
        tags: ["auth"],
        summary: "Change the current user's password and revoke other sessions",
      },
    },
    async (request) => {
      const input = changePasswordSchema.parse(request.body);
      const [user] = await dependencies.db
        .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
        .from(users)
        .where(eq(users.id, request.auth.userId))
        .limit(1);
      if (user?.status !== "active") {
        throw new DomainError("AUTHENTICATION_REQUIRED", "User account is not active", 401);
      }
      if (!(await argon2.verify(user.passwordHash, input.currentPassword))) {
        throw new DomainError("AUTHENTICATION_REQUIRED", "Current password is incorrect", 401);
      }

      const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
      const now = new Date();
      const currentTokenHash = hashSessionId(request.auth.sessionId);
      const revokedOtherSessions = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(users)
          .set({ passwordHash, updatedAt: now })
          .where(and(eq(users.id, user.id), eq(users.passwordHash, user.passwordHash)))
          .returning({ id: users.id });
        if (!changed) {
          throw new DomainError("CONFLICT", "Password changed concurrently; try again", 409);
        }
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(sessions.userId, user.id),
              ne(sessions.tokenHash, currentTokenHash),
              gt(sessions.expiresAt, now),
              isNull(sessions.revokedAt),
              isNull(sessions.archivedAt),
            ),
          )
          .returning({ id: sessions.id });
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "password_change",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          after: { passwordChanged: true, revokedOtherSessionCount: revoked.length },
          metadata: { revokedOtherSessionCount: revoked.length },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return revoked.length;
      });

      return { data: { changed: true, revokedOtherSessions } };
    },
  );

  app.get(
    "/api/v1/auth/me",
    {
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Read the authenticated user and permissions" },
    },
    async (request) => {
      const [user] = await dependencies.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, request.auth.userId))
        .limit(1);
      if (!user) throw new DomainError("NOT_FOUND", "User not found", 404);
      const userRoles = await rolesFor(dependencies.db, request.auth.orgId, request.auth.userId);
      return {
        data: {
          user,
          orgId: request.auth.orgId,
          permissions: request.auth.permissions,
          roles: userRoles,
          role: userRoles[0] ?? null,
        },
      };
    },
  );

  return authenticate;
}

export type AuthenticateHook = ReturnType<typeof createAuthenticate>;
export type RequestAuth = AuthContext;
