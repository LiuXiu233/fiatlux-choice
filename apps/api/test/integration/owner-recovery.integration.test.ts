import { randomUUID } from "node:crypto";
import {
  auditEvents,
  createDatabase,
  membershipRoles,
  memberships,
  OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
  recoverOwnerPassword,
  roles,
  users,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

type JsonObject = Record<string, unknown>;

function body(response: { body: string }) {
  return JSON.parse(response.body) as JsonObject;
}

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  const cookieValue = first?.split(";", 1)[0];
  if (!cookieValue) throw new Error("Login did not set a cookie");
  return cookieValue;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

describe.skipIf(!databaseUrl)("offline active-owner password recovery", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("rotates to an Argon2id temporary password, revokes old sessions and forces first-login change", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const email = `recovery-owner-${suffix}@example.test`;
    const originalPassword = "owner-recovery-original-password-long-enough";
    const temporaryPassword = "owner-recovery-temporary-password-2026";
    const finalPassword = "owner-recovery-final-password-2026";
    const requestId = `owner-recovery-success-${suffix}`;
    try {
      const seeded = await seedDatabase(dbHandle.db, {
        organizationName: "Owner Recovery Success Company",
        organizationSlug: `owner-recovery-success-${suffix}`,
        adminEmail: email,
        adminDisplayName: "Recovery Owner",
        adminPassword: originalPassword,
        adminMustChangePassword: false,
        complianceSourcesFile: `/nonexistent/owner-recovery-success-${suffix}.json`,
      });
      const crossOrganization = await seedDatabase(dbHandle.db, {
        organizationName: "Owner Recovery Cross Session Company",
        organizationSlug: `owner-recovery-cross-session-${suffix}`,
        adminEmail: `cross-session-owner-${suffix}@example.test`,
        adminDisplayName: "Cross Session Owner",
        adminPassword: "cross-session-owner-password-long-enough",
        adminMustChangePassword: false,
        complianceSourcesFile: `/nonexistent/owner-recovery-cross-session-${suffix}.json`,
      });
      const crossMemberRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(
              and(
                eq(roles.orgId, crossOrganization.organization.id),
                eq(roles.systemKey, "member"),
              ),
            )
            .limit(1)
        )[0],
        "Cross-organization session member role was not found",
      );
      const crossMembership = required(
        (
          await dbHandle.db
            .insert(memberships)
            .values({ orgId: crossOrganization.organization.id, userId: seeded.user.id })
            .returning()
        )[0],
        "Cross-organization session membership was not created",
      );
      await dbHandle.db.insert(membershipRoles).values({
        orgId: crossOrganization.organization.id,
        membershipId: crossMembership.id,
        roleId: crossMemberRole.id,
      });
      app = await buildApp({
        config: apiConfigSchema.parse({
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
          JWT_SECRET: "owner-recovery-test-secret-longer-than-32-characters",
          WEB_ORIGIN: "http://localhost:3000",
          LLM_DRIVER: "mock",
        }),
        db: dbHandle.db,
        storage: new MemoryObjectStorage(),
        queue: { send: async () => randomUUID() } as unknown as JobQueue,
      });

      const firstLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: originalPassword, orgId: seeded.organization.id },
      });
      const secondLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: originalPassword, orgId: seeded.organization.id },
      });
      const crossOrganizationLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email,
          password: originalPassword,
          orgId: crossOrganization.organization.id,
        },
      });
      expect(firstLogin.statusCode).toBe(200);
      expect(secondLogin.statusCode).toBe(200);
      expect(crossOrganizationLogin.statusCode).toBe(200);
      const firstCookie = cookie(firstLogin);
      const secondCookie = cookie(secondLogin);
      const crossOrganizationCookie = cookie(crossOrganizationLogin);

      const recovered = await recoverOwnerPassword(dbHandle.db, {
        organizationSlug: seeded.organization.slug,
        ownerEmail: email,
        newTemporaryPassword: temporaryPassword,
        productionConfirmation: OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
        reason: "Sole owner completed offline identity verification",
        approvalReference: `CHANGE-RECOVERY-${suffix}`,
        requestId,
      });
      expect(recovered).toMatchObject({
        organizationId: seeded.organization.id,
        userId: seeded.user.id,
        requestId,
        revokedSessionCount: 3,
        mustChangePassword: true,
      });
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          organizationSlug: seeded.organization.slug,
          ownerEmail: email,
          newTemporaryPassword: "owner-recovery-unused-second-temporary-password",
          productionConfirmation: OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
          reason: "Duplicate recovery request must not execute twice",
          approvalReference: `CHANGE-RECOVERY-${suffix}`,
          requestId,
        }),
      ).rejects.toThrow(/requestId was already used/);

      const [ownerAfterRecovery] = await dbHandle.db
        .select()
        .from(users)
        .where(eq(users.id, seeded.user.id))
        .limit(1);
      expect(ownerAfterRecovery).toMatchObject({ mustChangePassword: true });
      expect(ownerAfterRecovery?.passwordHash.startsWith("$argon2id$")).toBe(true);

      const [oldPasswordLogin, firstOldSession, secondOldSession, crossOrganizationOldSession] =
        await Promise.all([
          app.inject({
            method: "POST",
            url: "/api/v1/auth/login",
            payload: { email, password: originalPassword },
          }),
          app.inject({
            method: "GET",
            url: "/api/v1/auth/me",
            headers: { cookie: firstCookie },
          }),
          app.inject({
            method: "GET",
            url: "/api/v1/auth/me",
            headers: { cookie: secondCookie },
          }),
          app.inject({
            method: "GET",
            url: "/api/v1/auth/me",
            headers: { cookie: crossOrganizationCookie },
          }),
        ]);
      expect(oldPasswordLogin.statusCode).toBe(401);
      expect(firstOldSession.statusCode).toBe(401);
      expect(secondOldSession.statusCode).toBe(401);
      expect(crossOrganizationOldSession.statusCode).toBe(401);

      const temporaryLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: temporaryPassword, orgId: seeded.organization.id },
      });
      expect(temporaryLogin.statusCode, temporaryLogin.body).toBe(200);
      expect(body(temporaryLogin).data).toMatchObject({ mustChangePassword: true });
      const temporaryCookie = cookie(temporaryLogin);
      const [meBeforeChange, blockedDashboard] = await Promise.all([
        app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: temporaryCookie },
        }),
        app.inject({
          method: "GET",
          url: "/api/v1/dashboard",
          headers: { cookie: temporaryCookie },
        }),
      ]);
      expect(meBeforeChange.statusCode).toBe(200);
      expect(body(meBeforeChange).data).toMatchObject({ mustChangePassword: true });
      expect(blockedDashboard.statusCode).toBe(403);
      expect(body(blockedDashboard).error).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });

      const changed = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: temporaryCookie },
        payload: { currentPassword: temporaryPassword, newPassword: finalPassword },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const dashboardAfterChange = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard",
        headers: { cookie: temporaryCookie },
      });
      expect(dashboardAfterChange.statusCode).toBe(200);

      const [recoveryAudit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, seeded.organization.id),
            eq(auditEvents.requestId, requestId),
            eq(auditEvents.action, "offline_owner_password_recovery"),
          ),
        );
      expect(recoveryAudit).toMatchObject({
        actorUserId: null,
        resourceType: "user",
        resourceId: seeded.user.id,
        before: {
          mustChangePassword: false,
          passwordChanged: false,
          nonRevokedSessionCount: 3,
        },
        after: {
          mustChangePassword: true,
          passwordChanged: true,
          nonRevokedSessionCount: 0,
          revokedSessionCount: 3,
        },
        metadata: {
          source: "offline-owner-recovery-cli",
          organizationSlug: seeded.organization.slug,
          ownerEmail: email,
          approvalReference: `CHANGE-RECOVERY-${suffix}`,
        },
      });
      expect(JSON.stringify(recoveryAudit)).not.toContain(temporaryPassword);
      expect(JSON.stringify(recoveryAudit)).not.toContain(originalPassword);
    } finally {
      await app?.close();
      app = undefined;
      await dbHandle.client.end();
    }
  }, 120_000);

  it("fails closed for wrong organization, non-owner, reused password or missing approval controls", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    try {
      const owner = await seedDatabase(dbHandle.db, {
        organizationName: "Owner Recovery Boundary Company",
        organizationSlug: `owner-recovery-boundary-${suffix}`,
        adminEmail: `recovery-boundary-owner-${suffix}@example.test`,
        adminDisplayName: "Boundary Owner",
        adminPassword: "owner-recovery-boundary-original-password",
        adminMustChangePassword: false,
        complianceSourcesFile: `/nonexistent/owner-recovery-boundary-${suffix}.json`,
      });
      const other = await seedDatabase(dbHandle.db, {
        organizationName: "Owner Recovery Other Company",
        organizationSlug: `owner-recovery-other-${suffix}`,
        adminEmail: `recovery-other-owner-${suffix}@example.test`,
        adminDisplayName: "Other Owner",
        adminPassword: "owner-recovery-other-original-password",
        adminMustChangePassword: false,
        complianceSourcesFile: `/nonexistent/owner-recovery-other-${suffix}.json`,
      });
      const memberRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, owner.organization.id), eq(roles.systemKey, "member")))
            .limit(1)
        )[0],
        "Owner recovery boundary member role was not found",
      );
      const ownerRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, owner.organization.id), eq(roles.systemKey, "owner")))
            .limit(1)
        )[0],
        "Owner recovery boundary owner role was not found",
      );
      const memberEmail = `recovery-member-${suffix}@example.test`;
      const member = required(
        (
          await dbHandle.db
            .insert(users)
            .values({
              email: memberEmail,
              displayName: "Recovery Non Owner",
              passwordHash: owner.user.passwordHash,
              mustChangePassword: false,
            })
            .returning()
        )[0],
        "Owner recovery boundary member was not created",
      );
      const memberMembership = required(
        (
          await dbHandle.db
            .insert(memberships)
            .values({ orgId: owner.organization.id, userId: member.id })
            .returning()
        )[0],
        "Owner recovery boundary membership was not created",
      );
      await dbHandle.db.insert(membershipRoles).values({
        orgId: owner.organization.id,
        membershipId: memberMembership.id,
        roleId: memberRole.id,
      });

      const originalOwnerHash = owner.user.passwordHash;
      const originalMemberHash = member.passwordHash;
      const base = {
        organizationSlug: owner.organization.slug,
        ownerEmail: owner.user.email,
        newTemporaryPassword: "owner-recovery-boundary-new-password",
        productionConfirmation: OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
        reason: "Boundary recovery must fail without exact authorization",
        approvalReference: `CHANGE-BOUNDARY-${suffix}`,
      };
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          organizationSlug: other.organization.slug,
          requestId: `owner-recovery-wrong-org-${suffix}`,
        }),
      ).rejects.toThrow(/Eligible active owner/);
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          ownerEmail: memberEmail,
          requestId: `owner-recovery-non-owner-${suffix}`,
        }),
      ).rejects.toThrow(/Eligible active owner/);
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          newTemporaryPassword: "owner-recovery-boundary-original-password",
          requestId: `owner-recovery-reused-password-${suffix}`,
        }),
      ).rejects.toThrow(/must differ/);
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          approvalReference: "",
          requestId: `owner-recovery-no-approval-${suffix}`,
        }),
      ).rejects.toThrow(/approval or change reference/);
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          productionConfirmation: "yes",
          requestId: `owner-recovery-no-confirmation-${suffix}`,
        }),
      ).rejects.toThrow(/confirmation is invalid/);
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          newTemporaryPassword: "too-short",
          requestId: `owner-recovery-short-password-${suffix}`,
        }),
      ).rejects.toThrow(/between 14 and 256/);

      await dbHandle.db
        .update(memberships)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(eq(memberships.id, owner.membership.id));
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          requestId: `owner-recovery-inactive-${suffix}`,
        }),
      ).rejects.toThrow(/Eligible active owner/);
      await dbHandle.db
        .update(memberships)
        .set({ status: "active", archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(memberships.id, owner.membership.id));
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          requestId: `owner-recovery-archived-membership-${suffix}`,
        }),
      ).rejects.toThrow(/Eligible active owner/);
      await dbHandle.db
        .update(memberships)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(memberships.id, owner.membership.id));
      await dbHandle.db
        .update(roles)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(roles.id, ownerRole.id));
      await expect(
        recoverOwnerPassword(dbHandle.db, {
          ...base,
          requestId: `owner-recovery-archived-role-${suffix}`,
        }),
      ).rejects.toThrow(/Eligible active owner/);

      const [ownerAfter, memberAfter] = await Promise.all([
        dbHandle.db.select().from(users).where(eq(users.id, owner.user.id)).limit(1),
        dbHandle.db.select().from(users).where(eq(users.id, member.id)).limit(1),
      ]);
      expect(ownerAfter[0]).toMatchObject({
        passwordHash: originalOwnerHash,
        mustChangePassword: false,
      });
      expect(memberAfter[0]).toMatchObject({
        passwordHash: originalMemberHash,
        mustChangePassword: false,
      });
      const recoveryAudits = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "offline_owner_password_recovery"));
      expect(
        recoveryAudits.filter(
          (event) => event.orgId === owner.organization.id || event.orgId === other.organization.id,
        ),
      ).toHaveLength(0);
    } finally {
      await dbHandle.client.end();
    }
  }, 120_000);
});
