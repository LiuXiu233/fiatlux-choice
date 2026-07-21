import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  changePasswordSchema,
  loginSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaRegenerateRecoveryCodesSchema,
  mfaSetupSchema,
  mfaVerifySchema,
} from "@fiatlux/contracts";
import {
  auditEvents,
  type Database,
  membershipRoles,
  memberships,
  mfaLoginChallenges,
  rolePermissions,
  roles,
  sessions,
  userMfaCredentials,
  userMfaRecoveryCodes,
  users,
} from "@fiatlux/db";
import { DomainError, hasPermission } from "@fiatlux/domain";
import argon2 from "argon2";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  buildOtpAuthUri,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from "./mfa.js";
import type { AppDependencies, AuthContext, RequestAuditContext } from "./types.js";

export const SESSION_COOKIE = "fiatlux_session";
export const MFA_CHALLENGE_COOKIE = "fiatlux_mfa_challenge";

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  "/api/v1/auth/me",
  "/api/v1/auth/change-password",
  "/api/v1/auth/logout",
]);

const MFA_SETUP_ALLOWED_PATHS = new Set([
  "/api/v1/auth/me",
  "/api/v1/auth/change-password",
  "/api/v1/auth/logout",
  "/api/v1/auth/mfa/status",
  "/api/v1/auth/mfa/setup",
  "/api/v1/auth/mfa/confirm",
  "/api/v1/auth/mfa/recovery-codes",
  "/api/v1/auth/mfa/disable",
]);

function hashSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function mfaRequiredForRoles(requiredRoles: string[], userRoles: string[]) {
  return userRoles.some((role) => requiredRoles.includes(role));
}

function challengeCookieOptions(dependencies: AppDependencies, expiresAt: Date) {
  return {
    path: "/api/v1/auth/mfa/verify",
    httpOnly: true,
    secure: dependencies.config.COOKIE_SECURE,
    sameSite: "strict" as const,
    expires: expiresAt,
  };
}

function clearChallengeCookie(reply: FastifyReply) {
  reply.clearCookie(MFA_CHALLENGE_COOKIE, { path: "/api/v1/auth/mfa/verify" });
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
        isNull(roles.archivedAt),
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
      .select({
        id: sessions.id,
        userStatus: users.status,
        mustChangePassword: users.mustChangePassword,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
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
    if (session.userStatus !== "active") {
      throw new DomainError("AUTHENTICATION_REQUIRED", "User account is not active", 401);
    }
    const [permissions, userRoles, mfaCredential] = await Promise.all([
      permissionsFor(dependencies.db, orgId, sub),
      rolesFor(dependencies.db, orgId, sub),
      dependencies.db
        .select({ enabledAt: userMfaCredentials.enabledAt })
        .from(userMfaCredentials)
        .where(eq(userMfaCredentials.userId, sub))
        .limit(1),
    ]);
    if (permissions.length === 0) {
      throw new DomainError("FORBIDDEN", "No active organization role", 403);
    }
    const mfaEnabled = Boolean(mfaCredential[0]?.enabledAt);
    const mfaRequired = mfaRequiredForRoles(dependencies.config.MFA_REQUIRED_ROLES, userRoles);
    const mustSetupMfa = mfaRequired && !mfaEnabled;
    request.auth = {
      userId: sub,
      orgId,
      sessionId: sid,
      permissions,
      roles: userRoles,
      mfaEnabled,
      mfaRequired,
      mustSetupMfa,
    };
    const requestPath = request.url.split("?", 1)[0] ?? request.url;
    if (session.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.has(requestPath)) {
      throw new DomainError(
        "PASSWORD_CHANGE_REQUIRED",
        "Password must be changed before using the workspace",
        403,
      );
    }
    if (!session.mustChangePassword && mustSetupMfa && !MFA_SETUP_ALLOWED_PATHS.has(requestPath)) {
      throw new DomainError(
        "MFA_SETUP_REQUIRED",
        "Multi-factor authentication must be configured before using the workspace",
        403,
      );
    }
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

      const now = new Date();
      const sessionId = randomUUID();
      const challengeToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + dependencies.config.JWT_TTL_SECONDS * 1_000);
      const challengeExpiresAt = new Date(
        now.getTime() + dependencies.config.MFA_CHALLENGE_TTL_SECONDS * 1_000,
      );
      const loginResult = await dependencies.db.transaction(async (tx) => {
        const [lockedUser] = await tx
          .select()
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
          .for("update");
        if (lockedUser?.status !== "active" || lockedUser.passwordHash !== user.passwordHash) {
          throw new DomainError("AUTHENTICATION_REQUIRED", "Invalid email or password", 401);
        }
        const [lockedMembership] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.id, membership.id),
              eq(memberships.orgId, membership.orgId),
              eq(memberships.userId, user.id),
              eq(memberships.status, "active"),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!lockedMembership) {
          throw new DomainError("FORBIDDEN", "No active membership for this organization", 403);
        }
        const [activePermission] = await tx
          .select({ permission: rolePermissions.permission })
          .from(membershipRoles)
          .innerJoin(
            roles,
            and(
              eq(roles.id, membershipRoles.roleId),
              eq(roles.orgId, membershipRoles.orgId),
              isNull(roles.archivedAt),
            ),
          )
          .innerJoin(
            rolePermissions,
            and(
              eq(rolePermissions.roleId, roles.id),
              eq(rolePermissions.orgId, membershipRoles.orgId),
            ),
          )
          .where(
            and(
              eq(membershipRoles.orgId, lockedMembership.orgId),
              eq(membershipRoles.membershipId, lockedMembership.id),
            ),
          )
          .limit(1)
          .for("share");
        if (!activePermission) {
          throw new DomainError("FORBIDDEN", "No active organization role", 403);
        }

        const [mfaCredential] = await tx
          .select({ enabledAt: userMfaCredentials.enabledAt })
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, lockedUser.id))
          .limit(1)
          .for("update");
        if (mfaCredential?.enabledAt) {
          await tx
            .update(mfaLoginChallenges)
            .set({ consumedAt: now, updatedAt: now })
            .where(
              and(
                eq(mfaLoginChallenges.orgId, lockedMembership.orgId),
                eq(mfaLoginChallenges.userId, lockedUser.id),
                isNull(mfaLoginChallenges.consumedAt),
              ),
            );
          const [challenge] = await tx
            .insert(mfaLoginChallenges)
            .values({
              orgId: lockedMembership.orgId,
              userId: lockedUser.id,
              tokenHash: hashSessionId(challengeToken),
              expiresAt: challengeExpiresAt,
              ipAddress: request.ip,
              userAgent: request.headers["user-agent"],
            })
            .returning({ id: mfaLoginChallenges.id });
          if (!challenge) throw new Error("Failed to persist the MFA login challenge");
          const audit = loginAuditContext(request, lockedMembership.orgId, lockedUser.id);
          await tx.insert(auditEvents).values({
            orgId: audit.orgId,
            actorUserId: audit.actorUserId,
            action: "mfa_login_challenge_created",
            resourceType: "mfa_login_challenge",
            resourceId: challenge.id,
            requestId: audit.requestId,
            metadata: { expiresAt: challengeExpiresAt.toISOString() },
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent,
          });
          return {
            kind: "mfa_challenge" as const,
            user: lockedUser,
            membership: lockedMembership,
          };
        }

        const [storedSession] = await tx
          .insert(sessions)
          .values({
            orgId: lockedMembership.orgId,
            userId: lockedUser.id,
            tokenHash: hashSessionId(sessionId),
            expiresAt,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          })
          .returning({ id: sessions.id });
        if (!storedSession) throw new Error("Failed to persist the authenticated session");
        await tx
          .update(users)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(users.id, lockedUser.id));
        const audit = loginAuditContext(request, lockedMembership.orgId, lockedUser.id);
        await tx.insert(auditEvents).values({
          orgId: audit.orgId,
          actorUserId: audit.actorUserId,
          action: "login",
          resourceType: "session",
          resourceId: storedSession.id,
          requestId: audit.requestId,
          metadata: { mfaMethod: "not_enabled" },
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
        });
        return {
          kind: "session" as const,
          user: lockedUser,
          membership: lockedMembership,
        };
      });

      if (loginResult.kind === "mfa_challenge") {
        reply.clearCookie(SESSION_COOKIE, { path: "/api/v1" });
        reply.setCookie(
          MFA_CHALLENGE_COOKIE,
          challengeToken,
          challengeCookieOptions(dependencies, challengeExpiresAt),
        );
        return reply.status(202).send({
          data: {
            mfaRequired: true,
            challengeExpiresAt,
          },
        });
      }

      const token = await reply.jwtSign(
        {
          sub: loginResult.user.id,
          orgId: loginResult.membership.orgId,
          sid: sessionId,
        },
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
        permissionsFor(dependencies.db, loginResult.membership.orgId, loginResult.user.id),
        rolesFor(dependencies.db, loginResult.membership.orgId, loginResult.user.id),
      ]);
      const mfaRequired = mfaRequiredForRoles(dependencies.config.MFA_REQUIRED_ROLES, userRoles);
      return reply.send({
        data: {
          user: {
            id: loginResult.user.id,
            email: loginResult.user.email,
            displayName: loginResult.user.displayName,
          },
          orgId: loginResult.membership.orgId,
          permissions,
          roles: userRoles,
          role: userRoles[0] ?? null,
          mustChangePassword: loginResult.user.mustChangePassword,
          mfaEnabled: false,
          mfaRequired,
          mustSetupMfa: mfaRequired,
          expiresAt,
        },
      });
    },
  );

  app.post(
    "/api/v1/auth/mfa/verify",
    {
      config: { rateLimit: { max: 8, timeWindow: "5 minutes" } },
      schema: { tags: ["auth"], summary: "Complete an MFA login challenge" },
    },
    async (request, reply) => {
      const input = mfaVerifySchema.parse(request.body);
      const challengeToken = request.cookies[MFA_CHALLENGE_COOKIE];
      if (!challengeToken) {
        throw new DomainError(
          "AUTHENTICATION_REQUIRED",
          "MFA login challenge is missing or expired",
          401,
        );
      }

      const now = new Date();
      const sessionId = randomUUID();
      const expiresAt = new Date(now.getTime() + dependencies.config.JWT_TTL_SECONDS * 1_000);
      const verification = await dependencies.db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(mfaLoginChallenges)
          .where(eq(mfaLoginChallenges.tokenHash, hashSessionId(challengeToken)))
          .limit(1)
          .for("update");
        if (!challenge) return { kind: "invalid_challenge" as const };

        const rejectChallenge = async (reason: string) => {
          await tx
            .update(mfaLoginChallenges)
            .set({ consumedAt: now, updatedAt: now })
            .where(eq(mfaLoginChallenges.id, challenge.id));
          await tx.insert(auditEvents).values({
            orgId: challenge.orgId,
            actorUserId: challenge.userId,
            action: "mfa_login_verification_rejected",
            resourceType: "mfa_login_challenge",
            resourceId: challenge.id,
            requestId: request.id,
            metadata: { reason },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
          return { kind: "invalid_challenge" as const };
        };

        if (
          challenge.consumedAt ||
          challenge.expiresAt <= now ||
          challenge.attemptsRemaining <= 0
        ) {
          return rejectChallenge("expired_consumed_or_exhausted");
        }

        const [lockedUser] = await tx
          .select()
          .from(users)
          .where(eq(users.id, challenge.userId))
          .limit(1)
          .for("update");
        const [lockedMembership] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.orgId, challenge.orgId),
              eq(memberships.userId, challenge.userId),
              eq(memberships.status, "active"),
              isNull(memberships.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (lockedUser?.status !== "active" || !lockedMembership) {
          return rejectChallenge("inactive_user_or_membership");
        }
        const [activePermission] = await tx
          .select({ permission: rolePermissions.permission })
          .from(membershipRoles)
          .innerJoin(
            roles,
            and(
              eq(roles.id, membershipRoles.roleId),
              eq(roles.orgId, membershipRoles.orgId),
              isNull(roles.archivedAt),
            ),
          )
          .innerJoin(
            rolePermissions,
            and(
              eq(rolePermissions.roleId, roles.id),
              eq(rolePermissions.orgId, membershipRoles.orgId),
            ),
          )
          .where(
            and(
              eq(membershipRoles.orgId, lockedMembership.orgId),
              eq(membershipRoles.membershipId, lockedMembership.id),
            ),
          )
          .limit(1)
          .for("share");
        if (!activePermission) return rejectChallenge("no_active_role");

        const [credential] = await tx
          .select()
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, lockedUser.id))
          .limit(1)
          .for("update");
        if (!credential?.enabledAt) return rejectChallenge("mfa_not_enabled");

        let verificationMethod: "totp" | "recovery_code" | undefined;
        if (/^\d{6}$/u.test(input.code)) {
          const secret = decryptMfaSecret(credential, dependencies.config);
          const counter = verifyTotpCode({
            secret,
            code: input.code,
            lastUsedCounter: credential.lastUsedCounter,
          });
          if (counter !== null) {
            const [advanced] = await tx
              .update(userMfaCredentials)
              .set({ lastUsedCounter: counter, updatedAt: now })
              .where(
                and(
                  eq(userMfaCredentials.userId, credential.userId),
                  or(
                    isNull(userMfaCredentials.lastUsedCounter),
                    lt(userMfaCredentials.lastUsedCounter, counter),
                  ),
                ),
              )
              .returning({ userId: userMfaCredentials.userId });
            if (advanced) verificationMethod = "totp";
          }
        } else {
          const codeHash = hashRecoveryCode(input.code);
          if (codeHash) {
            const [recoveryCode] = await tx
              .select({ id: userMfaRecoveryCodes.id })
              .from(userMfaRecoveryCodes)
              .where(
                and(
                  eq(userMfaRecoveryCodes.userId, lockedUser.id),
                  eq(userMfaRecoveryCodes.codeHash, codeHash),
                  isNull(userMfaRecoveryCodes.usedAt),
                ),
              )
              .limit(1)
              .for("update");
            if (recoveryCode) {
              const [consumed] = await tx
                .update(userMfaRecoveryCodes)
                .set({ usedAt: now })
                .where(
                  and(
                    eq(userMfaRecoveryCodes.id, recoveryCode.id),
                    isNull(userMfaRecoveryCodes.usedAt),
                  ),
                )
                .returning({ id: userMfaRecoveryCodes.id });
              if (consumed) verificationMethod = "recovery_code";
            }
          }
        }

        if (!verificationMethod) {
          const attemptsRemaining = Math.max(0, challenge.attemptsRemaining - 1);
          await tx
            .update(mfaLoginChallenges)
            .set({
              attemptsRemaining,
              ...(attemptsRemaining === 0 ? { consumedAt: now } : {}),
              updatedAt: now,
            })
            .where(eq(mfaLoginChallenges.id, challenge.id));
          await tx.insert(auditEvents).values({
            orgId: challenge.orgId,
            actorUserId: challenge.userId,
            action: "mfa_login_verification_failed",
            resourceType: "mfa_login_challenge",
            resourceId: challenge.id,
            requestId: request.id,
            metadata: {
              attemptsRemaining,
              ipChanged: Boolean(challenge.ipAddress && challenge.ipAddress !== request.ip),
            },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
          return { kind: "invalid_code" as const, attemptsRemaining };
        }

        await tx
          .update(mfaLoginChallenges)
          .set({ consumedAt: now, updatedAt: now })
          .where(eq(mfaLoginChallenges.id, challenge.id));
        const [storedSession] = await tx
          .insert(sessions)
          .values({
            orgId: lockedMembership.orgId,
            userId: lockedUser.id,
            tokenHash: hashSessionId(sessionId),
            expiresAt,
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          })
          .returning({ id: sessions.id });
        if (!storedSession) throw new Error("Failed to persist the authenticated MFA session");
        await tx
          .update(users)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(users.id, lockedUser.id));
        await tx.insert(auditEvents).values([
          {
            orgId: lockedMembership.orgId,
            actorUserId: lockedUser.id,
            action: "mfa_login_verified",
            resourceType: "mfa_login_challenge",
            resourceId: challenge.id,
            requestId: request.id,
            metadata: { verificationMethod },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          },
          {
            orgId: lockedMembership.orgId,
            actorUserId: lockedUser.id,
            action: "login",
            resourceType: "session",
            resourceId: storedSession.id,
            requestId: request.id,
            metadata: { mfaMethod: verificationMethod },
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          },
        ]);
        return {
          kind: "session" as const,
          user: lockedUser,
          membership: lockedMembership,
        };
      });

      if (verification.kind === "invalid_challenge") {
        clearChallengeCookie(reply);
        throw new DomainError(
          "AUTHENTICATION_REQUIRED",
          "MFA login challenge is missing, expired, or no longer valid",
          401,
        );
      }
      if (verification.kind === "invalid_code") {
        if (verification.attemptsRemaining === 0) clearChallengeCookie(reply);
        throw new DomainError("MFA_CODE_INVALID", "MFA verification code is invalid", 401, {
          attemptsRemaining: verification.attemptsRemaining,
        });
      }

      const token = await reply.jwtSign(
        {
          sub: verification.user.id,
          orgId: verification.membership.orgId,
          sid: sessionId,
        },
        { expiresIn: dependencies.config.JWT_TTL_SECONDS },
      );
      reply.setCookie(SESSION_COOKIE, token, {
        path: "/api/v1",
        httpOnly: true,
        secure: dependencies.config.COOKIE_SECURE,
        sameSite: "strict",
        expires: expiresAt,
      });
      clearChallengeCookie(reply);
      const [permissions, userRoles] = await Promise.all([
        permissionsFor(dependencies.db, verification.membership.orgId, verification.user.id),
        rolesFor(dependencies.db, verification.membership.orgId, verification.user.id),
      ]);
      return reply.send({
        data: {
          user: {
            id: verification.user.id,
            email: verification.user.email,
            displayName: verification.user.displayName,
          },
          orgId: verification.membership.orgId,
          permissions,
          roles: userRoles,
          role: userRoles[0] ?? null,
          mustChangePassword: verification.user.mustChangePassword,
          mfaEnabled: true,
          mfaRequired: mfaRequiredForRoles(dependencies.config.MFA_REQUIRED_ROLES, userRoles),
          mustSetupMfa: false,
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
        const [currentSession] = await tx
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.orgId, request.auth.orgId),
              eq(sessions.userId, request.auth.userId),
              eq(sessions.tokenHash, hashSessionId(request.auth.sessionId)),
            ),
          )
          .limit(1)
          .for("update");
        if (!currentSession) {
          throw new DomainError("AUTHENTICATION_REQUIRED", "Session is already revoked", 401);
        }
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
          resourceId: currentSession.id,
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
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          status: users.status,
          mustChangePassword: users.mustChangePassword,
        })
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
          .set({ passwordHash, mustChangePassword: false, updatedAt: now })
          .where(
            and(
              eq(users.id, user.id),
              eq(users.passwordHash, user.passwordHash),
              eq(users.status, "active"),
            ),
          )
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
        const consumedChallenges = await tx
          .update(mfaLoginChallenges)
          .set({ consumedAt: now, updatedAt: now })
          .where(and(eq(mfaLoginChallenges.userId, user.id), isNull(mfaLoginChallenges.consumedAt)))
          .returning({ id: mfaLoginChallenges.id });
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "password_change",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          before: { mustChangePassword: user.mustChangePassword },
          after: {
            passwordChanged: true,
            mustChangePassword: false,
            revokedOtherSessionCount: revoked.length,
            consumedMfaChallengeCount: consumedChallenges.length,
          },
          metadata: {
            revokedOtherSessionCount: revoked.length,
            consumedMfaChallengeCount: consumedChallenges.length,
          },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return revoked.length;
      });

      return { data: { changed: true, revokedOtherSessions } };
    },
  );

  app.get(
    "/api/v1/auth/mfa/status",
    {
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Read the current user's MFA policy and status" },
    },
    async (request) => {
      const [credential, availableRecoveryCodes] = await Promise.all([
        dependencies.db
          .select({
            enabledAt: userMfaCredentials.enabledAt,
            setupExpiresAt: userMfaCredentials.setupExpiresAt,
          })
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId))
          .limit(1),
        dependencies.db
          .select({ id: userMfaRecoveryCodes.id })
          .from(userMfaRecoveryCodes)
          .where(
            and(
              eq(userMfaRecoveryCodes.userId, request.auth.userId),
              isNull(userMfaRecoveryCodes.usedAt),
            ),
          ),
      ]);
      const currentCredential = credential[0];
      const setupPending = Boolean(
        !currentCredential?.enabledAt &&
          currentCredential?.setupExpiresAt &&
          currentCredential.setupExpiresAt > new Date(),
      );
      return {
        data: {
          enabled: Boolean(currentCredential?.enabledAt),
          required: request.auth.mfaRequired,
          mustSetup: request.auth.mustSetupMfa,
          setupPending,
          setupExpiresAt: setupPending ? currentCredential?.setupExpiresAt : null,
          recoveryCodesRemaining: availableRecoveryCodes.length,
          canDisable: Boolean(currentCredential?.enabledAt) && !request.auth.mfaRequired,
        },
      };
    },
  );

  app.post(
    "/api/v1/auth/mfa/setup",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Start or restart TOTP MFA enrollment" },
    },
    async (request) => {
      mfaSetupSchema.parse(request.body);
      const secret = generateTotpSecret();
      const encrypted = encryptMfaSecret(secret, dependencies.config);
      const now = new Date();
      const setupExpiresAt = new Date(
        now.getTime() + dependencies.config.MFA_SETUP_TTL_SECONDS * 1_000,
      );
      const [user] = await dependencies.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, request.auth.userId))
        .limit(1);
      if (!user) throw new DomainError("NOT_FOUND", "User not found", 404);

      await dependencies.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ enabledAt: userMfaCredentials.enabledAt })
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId))
          .limit(1)
          .for("update");
        if (existing?.enabledAt) {
          throw new DomainError("CONFLICT", "MFA is already enabled", 409);
        }
        await tx
          .insert(userMfaCredentials)
          .values({
            userId: request.auth.userId,
            ...encrypted,
            enabledAt: null,
            setupExpiresAt,
            lastUsedCounter: null,
          })
          .onConflictDoUpdate({
            target: userMfaCredentials.userId,
            set: {
              ...encrypted,
              enabledAt: null,
              setupExpiresAt,
              lastUsedCounter: null,
              updatedAt: now,
            },
          });
        await tx
          .delete(userMfaRecoveryCodes)
          .where(eq(userMfaRecoveryCodes.userId, request.auth.userId));
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "mfa_setup_started",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          before: { enabled: false, setupPending: Boolean(existing) },
          after: { enabled: false, setupPending: true, setupExpiresAt },
          metadata: { encryptionKeyId: encrypted.encryptionKeyId },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
      });

      return {
        data: {
          secret,
          otpAuthUri: buildOtpAuthUri(user.email, secret),
          algorithm: "SHA256",
          digits: 6,
          periodSeconds: 30,
          setupExpiresAt,
        },
      };
    },
  );

  app.post(
    "/api/v1/auth/mfa/confirm",
    {
      config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Confirm TOTP enrollment and issue recovery codes" },
    },
    async (request) => {
      const input = mfaConfirmSchema.parse(request.body);
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeRows = recoveryCodes.map((code) => {
        const codeHash = hashRecoveryCode(code);
        if (!codeHash) throw new Error("Generated an invalid MFA recovery code");
        return { userId: request.auth.userId, codeHash };
      });
      const now = new Date();
      const currentTokenHash = hashSessionId(request.auth.sessionId);
      const confirmation = await dependencies.db.transaction(async (tx) => {
        const [credential] = await tx
          .select()
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId))
          .limit(1)
          .for("update");
        if (
          !credential ||
          credential.enabledAt ||
          !credential.setupExpiresAt ||
          credential.setupExpiresAt <= now
        ) {
          return { kind: "expired" as const };
        }
        const secret = decryptMfaSecret(credential, dependencies.config);
        const counter = verifyTotpCode({
          secret,
          code: input.code,
          lastUsedCounter: credential.lastUsedCounter,
        });
        if (counter === null) {
          await tx.insert(auditEvents).values({
            orgId: request.auth.orgId,
            actorUserId: request.auth.userId,
            action: "mfa_setup_confirmation_failed",
            resourceType: "user",
            resourceId: request.auth.userId,
            requestId: request.id,
            metadata: {},
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
          return { kind: "invalid_code" as const };
        }
        const [enabled] = await tx
          .update(userMfaCredentials)
          .set({
            enabledAt: now,
            setupExpiresAt: null,
            lastUsedCounter: counter,
            updatedAt: now,
          })
          .where(
            and(
              eq(userMfaCredentials.userId, request.auth.userId),
              isNull(userMfaCredentials.enabledAt),
            ),
          )
          .returning({ userId: userMfaCredentials.userId });
        if (!enabled) return { kind: "conflict" as const };
        await tx
          .delete(userMfaRecoveryCodes)
          .where(eq(userMfaRecoveryCodes.userId, request.auth.userId));
        await tx.insert(userMfaRecoveryCodes).values(recoveryCodeRows);
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(sessions.userId, request.auth.userId),
              ne(sessions.tokenHash, currentTokenHash),
              isNull(sessions.revokedAt),
            ),
          )
          .returning({ id: sessions.id });
        await tx
          .update(mfaLoginChallenges)
          .set({ consumedAt: now, updatedAt: now })
          .where(
            and(
              eq(mfaLoginChallenges.userId, request.auth.userId),
              isNull(mfaLoginChallenges.consumedAt),
            ),
          );
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "mfa_enabled",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          before: { enabled: false },
          after: {
            enabled: true,
            recoveryCodeCount: recoveryCodeRows.length,
            revokedOtherSessionCount: revoked.length,
          },
          metadata: {
            recoveryCodeCount: recoveryCodeRows.length,
            revokedOtherSessionCount: revoked.length,
          },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return { kind: "enabled" as const, revokedOtherSessions: revoked.length };
      });

      if (confirmation.kind === "expired") {
        throw new DomainError("CONFLICT", "MFA setup is missing or expired; start again", 409);
      }
      if (confirmation.kind === "conflict") {
        throw new DomainError("CONFLICT", "MFA setup changed concurrently; check status", 409);
      }
      if (confirmation.kind === "invalid_code") {
        throw new DomainError("MFA_CODE_INVALID", "TOTP verification code is invalid", 401);
      }
      return {
        data: {
          enabled: true,
          recoveryCodes,
          revokedOtherSessions: confirmation.revokedOtherSessions,
        },
      };
    },
  );

  app.post(
    "/api/v1/auth/mfa/recovery-codes",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Replace all MFA recovery codes" },
    },
    async (request) => {
      const input = mfaRegenerateRecoveryCodesSchema.parse(request.body);
      const recoveryCodes = generateRecoveryCodes();
      const recoveryCodeRows = recoveryCodes.map((code) => {
        const codeHash = hashRecoveryCode(code);
        if (!codeHash) throw new Error("Generated an invalid MFA recovery code");
        return { userId: request.auth.userId, codeHash };
      });
      const now = new Date();
      const currentTokenHash = hashSessionId(request.auth.sessionId);
      const result = await dependencies.db.transaction(async (tx) => {
        const [credential] = await tx
          .select()
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId))
          .limit(1)
          .for("update");
        if (!credential?.enabledAt) return { kind: "not_enabled" as const };

        let verificationMethod: "totp" | "recovery_code" | undefined;
        if (/^\d{6}$/u.test(input.code)) {
          const secret = decryptMfaSecret(credential, dependencies.config);
          const counter = verifyTotpCode({
            secret,
            code: input.code,
            lastUsedCounter: credential.lastUsedCounter,
          });
          if (counter !== null) {
            const [advanced] = await tx
              .update(userMfaCredentials)
              .set({ lastUsedCounter: counter, updatedAt: now })
              .where(
                and(
                  eq(userMfaCredentials.userId, credential.userId),
                  or(
                    isNull(userMfaCredentials.lastUsedCounter),
                    lt(userMfaCredentials.lastUsedCounter, counter),
                  ),
                ),
              )
              .returning({ userId: userMfaCredentials.userId });
            if (advanced) verificationMethod = "totp";
          }
        } else {
          const codeHash = hashRecoveryCode(input.code);
          if (codeHash) {
            const [existingCode] = await tx
              .select({ id: userMfaRecoveryCodes.id })
              .from(userMfaRecoveryCodes)
              .where(
                and(
                  eq(userMfaRecoveryCodes.userId, request.auth.userId),
                  eq(userMfaRecoveryCodes.codeHash, codeHash),
                  isNull(userMfaRecoveryCodes.usedAt),
                ),
              )
              .limit(1)
              .for("update");
            if (existingCode) {
              const [consumed] = await tx
                .update(userMfaRecoveryCodes)
                .set({ usedAt: now })
                .where(
                  and(
                    eq(userMfaRecoveryCodes.id, existingCode.id),
                    isNull(userMfaRecoveryCodes.usedAt),
                  ),
                )
                .returning({ id: userMfaRecoveryCodes.id });
              if (consumed) verificationMethod = "recovery_code";
            }
          }
        }

        if (!verificationMethod) {
          await tx.insert(auditEvents).values({
            orgId: request.auth.orgId,
            actorUserId: request.auth.userId,
            action: "mfa_recovery_codes_regeneration_failed",
            resourceType: "user",
            resourceId: request.auth.userId,
            requestId: request.id,
            metadata: {},
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
          return { kind: "invalid_code" as const };
        }

        await tx
          .delete(userMfaRecoveryCodes)
          .where(eq(userMfaRecoveryCodes.userId, request.auth.userId));
        await tx.insert(userMfaRecoveryCodes).values(recoveryCodeRows);
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(sessions.userId, request.auth.userId),
              ne(sessions.tokenHash, currentTokenHash),
              isNull(sessions.revokedAt),
            ),
          )
          .returning({ id: sessions.id });
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "mfa_recovery_codes_regenerated",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          before: { priorCodesInvalidated: true },
          after: {
            recoveryCodeCount: recoveryCodeRows.length,
            revokedOtherSessionCount: revoked.length,
          },
          metadata: {
            verificationMethod,
            recoveryCodeCount: recoveryCodeRows.length,
            revokedOtherSessionCount: revoked.length,
          },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return { kind: "regenerated" as const, revokedOtherSessions: revoked.length };
      });

      if (result.kind === "not_enabled") {
        throw new DomainError("CONFLICT", "MFA is not enabled", 409);
      }
      if (result.kind === "invalid_code") {
        throw new DomainError("MFA_CODE_INVALID", "MFA verification code is invalid", 401);
      }
      return {
        data: {
          recoveryCodes,
          revokedOtherSessions: result.revokedOtherSessions,
        },
      };
    },
  );

  app.post(
    "/api/v1/auth/mfa/disable",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      preHandler: [authenticate],
      schema: { tags: ["auth"], summary: "Disable optional MFA after step-up verification" },
    },
    async (request) => {
      const input = mfaDisableSchema.parse(request.body);
      if (request.auth.mfaRequired) {
        throw new DomainError(
          "FORBIDDEN",
          "MFA cannot be disabled while an assigned role requires it",
          403,
        );
      }
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

      const now = new Date();
      const currentTokenHash = hashSessionId(request.auth.sessionId);
      const result = await dependencies.db.transaction(async (tx) => {
        const [lockedUser] = await tx
          .select({ passwordHash: users.passwordHash, status: users.status })
          .from(users)
          .where(eq(users.id, request.auth.userId))
          .limit(1)
          .for("update");
        if (lockedUser?.status !== "active" || lockedUser.passwordHash !== user.passwordHash) {
          return { kind: "credentials_changed" as const };
        }
        const [credential] = await tx
          .select()
          .from(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId))
          .limit(1)
          .for("update");
        if (!credential?.enabledAt) return { kind: "not_enabled" as const };

        let verificationMethod: "totp" | "recovery_code" | undefined;
        if (/^\d{6}$/u.test(input.code)) {
          const secret = decryptMfaSecret(credential, dependencies.config);
          const counter = verifyTotpCode({
            secret,
            code: input.code,
            lastUsedCounter: credential.lastUsedCounter,
          });
          if (counter !== null) verificationMethod = "totp";
        } else {
          const codeHash = hashRecoveryCode(input.code);
          if (codeHash) {
            const [existingCode] = await tx
              .select({ id: userMfaRecoveryCodes.id })
              .from(userMfaRecoveryCodes)
              .where(
                and(
                  eq(userMfaRecoveryCodes.userId, request.auth.userId),
                  eq(userMfaRecoveryCodes.codeHash, codeHash),
                  isNull(userMfaRecoveryCodes.usedAt),
                ),
              )
              .limit(1)
              .for("update");
            if (existingCode) verificationMethod = "recovery_code";
          }
        }
        if (!verificationMethod) {
          await tx.insert(auditEvents).values({
            orgId: request.auth.orgId,
            actorUserId: request.auth.userId,
            action: "mfa_disable_verification_failed",
            resourceType: "user",
            resourceId: request.auth.userId,
            requestId: request.id,
            metadata: {},
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
          });
          return { kind: "invalid_code" as const };
        }

        await tx
          .delete(userMfaRecoveryCodes)
          .where(eq(userMfaRecoveryCodes.userId, request.auth.userId));
        await tx
          .delete(userMfaCredentials)
          .where(eq(userMfaCredentials.userId, request.auth.userId));
        await tx
          .update(mfaLoginChallenges)
          .set({ consumedAt: now, updatedAt: now })
          .where(
            and(
              eq(mfaLoginChallenges.userId, request.auth.userId),
              isNull(mfaLoginChallenges.consumedAt),
            ),
          );
        const revoked = await tx
          .update(sessions)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(sessions.userId, request.auth.userId),
              ne(sessions.tokenHash, currentTokenHash),
              isNull(sessions.revokedAt),
            ),
          )
          .returning({ id: sessions.id });
        await tx.insert(auditEvents).values({
          orgId: request.auth.orgId,
          actorUserId: request.auth.userId,
          action: "mfa_disabled",
          resourceType: "user",
          resourceId: request.auth.userId,
          requestId: request.id,
          before: { enabled: true },
          after: { enabled: false, revokedOtherSessionCount: revoked.length },
          metadata: { verificationMethod, revokedOtherSessionCount: revoked.length },
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        });
        return { kind: "disabled" as const, revokedOtherSessions: revoked.length };
      });

      if (result.kind === "credentials_changed") {
        throw new DomainError(
          "CONFLICT",
          "Password changed concurrently; MFA was not disabled",
          409,
        );
      }
      if (result.kind === "not_enabled") {
        throw new DomainError("CONFLICT", "MFA is not enabled", 409);
      }
      if (result.kind === "invalid_code") {
        throw new DomainError("MFA_CODE_INVALID", "MFA verification code is invalid", 401);
      }
      return {
        data: { disabled: true, revokedOtherSessions: result.revokedOtherSessions },
      };
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
          mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.id, request.auth.userId))
        .limit(1);
      if (!user) throw new DomainError("NOT_FOUND", "User not found", 404);
      return {
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            status: user.status,
          },
          orgId: request.auth.orgId,
          permissions: request.auth.permissions,
          roles: request.auth.roles,
          role: request.auth.roles[0] ?? null,
          mustChangePassword: user.mustChangePassword,
          mfaEnabled: request.auth.mfaEnabled,
          mfaRequired: request.auth.mfaRequired,
          mustSetupMfa: request.auth.mustSetupMfa,
        },
      };
    },
  );

  return authenticate;
}

export type AuthenticateHook = ReturnType<typeof createAuthenticate>;
export type RequestAuth = AuthContext;
