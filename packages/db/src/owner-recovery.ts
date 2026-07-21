import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "./index.js";
import {
  auditEvents,
  membershipRoles,
  memberships,
  mfaLoginChallenges,
  organizations,
  roles,
  sessions,
  userMfaCredentials,
  userMfaRecoveryCodes,
  users,
} from "./schema.js";

export const OWNER_RECOVERY_PRODUCTION_CONFIRMATION =
  "RESET_ACTIVE_OWNER_PASSWORD_AND_REVOKE_ALL_SESSIONS";
export const OWNER_RECOVERY_MFA_RESET_CONFIRMATION = "RESET_ACTIVE_OWNER_MFA_AND_RECOVERY_CODES";

export interface OwnerRecoveryInput {
  organizationSlug: string;
  ownerEmail: string;
  newTemporaryPassword: string;
  productionConfirmation: string;
  mfaResetConfirmation: string;
  reason: string;
  approvalReference: string;
  requestId: string;
}

function validateOwnerRecoveryInput(input: OwnerRecoveryInput) {
  if (!/^[a-z0-9-]+$/.test(input.organizationSlug)) {
    throw new Error("Owner recovery requires the exact organization slug");
  }
  const normalizedEmail = input.ownerEmail.trim().toLowerCase();
  if (!normalizedEmail.includes("@") || normalizedEmail !== input.ownerEmail) {
    throw new Error("Owner recovery requires the exact normalized owner email");
  }
  if (input.productionConfirmation !== OWNER_RECOVERY_PRODUCTION_CONFIRMATION) {
    throw new Error("Owner recovery production confirmation is invalid");
  }
  if (input.mfaResetConfirmation !== OWNER_RECOVERY_MFA_RESET_CONFIRMATION) {
    throw new Error("Owner recovery MFA reset confirmation is invalid");
  }
  if (input.reason.trim().length < 8) {
    throw new Error("Owner recovery requires a non-empty reason of at least 8 characters");
  }
  if (input.approvalReference.trim().length < 3) {
    throw new Error("Owner recovery requires an approval or change reference");
  }
  if (input.requestId.trim().length < 3 || input.requestId.trim().length > 200) {
    throw new Error("Owner recovery requires a requestId between 3 and 200 characters");
  }
  if (
    input.reason !== input.reason.trim() ||
    input.approvalReference !== input.approvalReference.trim() ||
    input.requestId !== input.requestId.trim()
  ) {
    throw new Error("Owner recovery traceability fields must not contain surrounding whitespace");
  }
  if (input.newTemporaryPassword.length < 14 || input.newTemporaryPassword.length > 256) {
    throw new Error("Owner recovery temporary password must be between 14 and 256 characters");
  }
  if (input.newTemporaryPassword.includes("\u0000")) {
    throw new Error("Owner recovery temporary password must not contain NUL bytes");
  }
}

export async function recoverOwnerPassword(db: Database, input: OwnerRecoveryInput) {
  validateOwnerRecoveryInput(input);

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.slug, input.organizationSlug))
      .limit(1)
      .for("update");
    if (!organization) throw new Error("Eligible active owner was not found for recovery");

    const [owner] = await tx
      .select()
      .from(users)
      .where(and(eq(users.email, input.ownerEmail), eq(users.status, "active")))
      .limit(1)
      .for("update");
    if (!owner) throw new Error("Eligible active owner was not found for recovery");

    const [membership] = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, organization.id),
          eq(memberships.userId, owner.id),
          eq(memberships.status, "active"),
          isNull(memberships.archivedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!membership) throw new Error("Eligible active owner was not found for recovery");

    const [ownerAssignment] = await tx
      .select({ roleId: roles.id })
      .from(membershipRoles)
      .innerJoin(
        roles,
        and(
          eq(roles.id, membershipRoles.roleId),
          eq(roles.orgId, membershipRoles.orgId),
          eq(roles.systemKey, "owner"),
          isNull(roles.archivedAt),
        ),
      )
      .where(
        and(
          eq(membershipRoles.orgId, organization.id),
          eq(membershipRoles.membershipId, membership.id),
        ),
      )
      .limit(1)
      .for("share");
    if (!ownerAssignment) throw new Error("Eligible active owner was not found for recovery");

    const mfaCredential = await tx
      .select({ enabledAt: userMfaCredentials.enabledAt })
      .from(userMfaCredentials)
      .where(eq(userMfaCredentials.userId, owner.id))
      .limit(1)
      .for("update");
    const recoveryCodes = await tx
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(eq(userMfaRecoveryCodes.userId, owner.id))
      .for("update");
    const activeMfaChallenges = await tx
      .select({ id: mfaLoginChallenges.id })
      .from(mfaLoginChallenges)
      .where(and(eq(mfaLoginChallenges.userId, owner.id), isNull(mfaLoginChallenges.consumedAt)))
      .for("update");

    const [existingAudit] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.orgId, organization.id), eq(auditEvents.requestId, input.requestId)),
      )
      .limit(1);
    if (existingAudit)
      throw new Error("Owner recovery requestId was already used in this organization");

    if (await argon2.verify(owner.passwordHash, input.newTemporaryPassword)) {
      throw new Error("Owner recovery temporary password must differ from the current password");
    }
    const passwordHash = await argon2.hash(input.newTemporaryPassword, {
      type: argon2.argon2id,
    });
    const now = new Date();
    const [changed] = await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: now })
      .where(
        and(
          eq(users.id, owner.id),
          eq(users.status, "active"),
          eq(users.passwordHash, owner.passwordHash),
        ),
      )
      .returning({ id: users.id });
    if (!changed) throw new Error("Owner password changed concurrently; recovery was cancelled");

    const revokedSessions = await tx
      .update(sessions)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(sessions.userId, owner.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, owner.id));
    await tx.delete(userMfaCredentials).where(eq(userMfaCredentials.userId, owner.id));
    await tx
      .update(mfaLoginChallenges)
      .set({ consumedAt: now, updatedAt: now })
      .where(and(eq(mfaLoginChallenges.userId, owner.id), isNull(mfaLoginChallenges.consumedAt)));

    await tx.insert(auditEvents).values({
      orgId: organization.id,
      actorUserId: null,
      action: "offline_owner_password_recovery",
      resourceType: "user",
      resourceId: owner.id,
      requestId: input.requestId,
      before: {
        mustChangePassword: owner.mustChangePassword,
        passwordChanged: false,
        nonRevokedSessionCount: revokedSessions.length,
        mfaConfigured: Boolean(mfaCredential[0]),
        mfaEnabled: Boolean(mfaCredential[0]?.enabledAt),
        recoveryCodeCount: recoveryCodes.length,
        activeMfaChallengeCount: activeMfaChallenges.length,
      },
      after: {
        mustChangePassword: true,
        passwordChanged: true,
        nonRevokedSessionCount: 0,
        revokedSessionCount: revokedSessions.length,
        mfaConfigured: false,
        mfaEnabled: false,
        recoveryCodeCount: 0,
        activeMfaChallengeCount: 0,
      },
      metadata: {
        source: "offline-owner-recovery-cli",
        organizationSlug: organization.slug,
        ownerEmail: owner.email,
        reason: input.reason,
        approvalReference: input.approvalReference,
        mfaResetApproved: true,
      },
    });

    return {
      organizationId: organization.id,
      userId: owner.id,
      requestId: input.requestId,
      revokedSessionCount: revokedSessions.length,
      mustChangePassword: true as const,
      mfaReset: true as const,
      deletedRecoveryCodeCount: recoveryCodes.length,
      consumedMfaChallengeCount: activeMfaChallenges.length,
    };
  });
}
