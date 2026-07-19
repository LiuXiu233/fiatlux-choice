import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@fiatlux/db";
import {
  auditEvents,
  complianceItems,
  createDatabase,
  membershipRoles,
  memberships,
  organizations,
  promptVersions,
  rolePermissions,
  roles,
  users,
} from "@fiatlux/db";
import { SYSTEM_ROLE_PERMISSIONS, seedDatabase } from "@fiatlux/db/seed";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

async function complianceFixture(suffix: string, title: string) {
  const directory = await mkdtemp(join(tmpdir(), "fiatlux-seed-hardening-"));
  const file = join(directory, "official-sources.json");
  const sourceUrl = `https://example.test/official-source/${suffix}`;
  const record = (nextTitle: string, index = 0) => ({
    title: nextTitle,
    category: "company_governance",
    authority: "Seed Hardening Official Test Authority",
    sourceUrl: index ? `${sourceUrl}/${index}` : sourceUrl,
    status: "official_guidance",
    summary: "Controlled metadata fixture for seed reconciliation tests.",
    applicability: "Integration-test organization only.",
    reviewStatus: "pending",
    lastVerifiedAt: "2026-07-19",
    nextReviewAt: "2026-10-19",
  });
  const write = async (nextTitle: string) => {
    await writeFile(file, JSON.stringify({ sources: [record(nextTitle)] }), "utf8");
  };
  await write(title);
  return { directory, file, sourceUrl, record, write };
}

function seedOptions(suffix: string, complianceSourcesFile: string) {
  return {
    organizationName: `Seed Hardening ${suffix}`,
    organizationSlug: `seed-hardening-${suffix}`,
    adminEmail: `seed-hardening-${suffix}@example.test`,
    adminDisplayName: `Seed Owner ${suffix}`,
    adminPassword: "seed-hardening-original-password-long-enough",
    complianceSourcesFile,
  };
}

async function expectNoBootstrapMutation(
  db: Database,
  organizationSlug: string,
  adminEmail: string,
) {
  const [organizationRows, userRows, roleRows, auditRows, promptRows, sourceRows] =
    await Promise.all([
      db.select().from(organizations).where(eq(organizations.slug, organizationSlug)),
      db.select().from(users).where(eq(users.email, adminEmail)),
      db
        .select({ id: roles.id })
        .from(roles)
        .innerJoin(organizations, eq(organizations.id, roles.orgId))
        .where(eq(organizations.slug, organizationSlug)),
      db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .innerJoin(organizations, eq(organizations.id, auditEvents.orgId))
        .where(eq(organizations.slug, organizationSlug)),
      db
        .select({ id: promptVersions.id })
        .from(promptVersions)
        .innerJoin(organizations, eq(organizations.id, promptVersions.orgId))
        .where(eq(organizations.slug, organizationSlug)),
      db
        .select({ id: complianceItems.id })
        .from(complianceItems)
        .innerJoin(organizations, eq(organizations.id, complianceItems.orgId))
        .where(eq(organizations.slug, organizationSlug)),
    ]);
  expect(organizationRows).toHaveLength(0);
  expect(userRows).toHaveLength(0);
  expect(roleRows).toHaveLength(0);
  expect(auditRows).toHaveLength(0);
  expect(promptRows).toHaveLength(0);
  expect(sourceRows).toHaveLength(0);
}

interface SeedCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runSeedCli(env: NodeJS.ProcessEnv): Promise<SeedCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--filter", "@fiatlux/db", "exec", "tsx", "src/seed-cli.ts"], {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

function bootstrapCliEnvironment(options: ReturnType<typeof seedOptions>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.INITIAL_ADMIN_EMAIL;
  delete env.INITIAL_ADMIN_PASSWORD;
  delete env.SEED_MAINTENANCE_OPERATOR_EMAIL;
  delete env.SEED_MAINTENANCE_REASON;
  delete env.SEED_MAINTENANCE_APPROVAL_REFERENCE;
  delete env.SEED_MAINTENANCE_REQUEST_ID;
  return Object.assign(env, {
    DATABASE_URL: testDatabaseUrl,
    SEED_MODE: "bootstrap",
    BOOTSTRAP_ORG_NAME: options.organizationName,
    BOOTSTRAP_ORG_SLUG: options.organizationSlug,
    BOOTSTRAP_ADMIN_EMAIL: options.adminEmail,
    BOOTSTRAP_ADMIN_NAME: options.adminDisplayName,
    BOOTSTRAP_ADMIN_PASSWORD: options.adminPassword,
    COMPLIANCE_SOURCES_REQUIRED: "true",
    COMPLIANCE_SOURCES_FILE: options.complianceSourcesFile,
  });
}

describe.skipIf(!databaseUrl)("database seed fail-closed boundaries", () => {
  it.each(["missing", "malformed", "schema-invalid"] as const)(
    "preflights a required %s compliance source before any mutation and remains retryable",
    async (failureKind) => {
      const dbHandle = createDatabase(testDatabaseUrl);
      const suffix = randomUUID().slice(0, 8);
      const fixture = await complianceFixture(suffix, "Required compliance retry source");
      const sourceFile =
        failureKind === "missing" ? join(fixture.directory, "missing-sources.json") : fixture.file;
      if (failureKind === "malformed") await writeFile(fixture.file, "{invalid-json", "utf8");
      if (failureKind === "schema-invalid") {
        await writeFile(
          fixture.file,
          JSON.stringify({ sources: [{ title: "", sourceUrl: "not-an-official-url" }] }),
          "utf8",
        );
      }
      const options = {
        ...seedOptions(suffix, sourceFile),
        complianceSourcesRequired: true,
      };
      try {
        if (failureKind === "missing") {
          await expect(seedDatabase(dbHandle.db, options)).rejects.toThrow(
            /Required official compliance source file is missing/,
          );
        } else {
          const expectation = expect(seedDatabase(dbHandle.db, options)).rejects;
          if (failureKind === "malformed") {
            await expectation.toBeInstanceOf(SyntaxError);
          } else {
            await expectation.toThrow(/failed schema validation/);
          }
        }
        await expectNoBootstrapMutation(dbHandle.db, options.organizationSlug, options.adminEmail);

        await fixture.write("Required compliance retry source");
        const retried = await seedDatabase(dbHandle.db, {
          ...options,
          complianceSourcesFile: fixture.file,
        });
        expect(retried).toMatchObject({
          bootstrapCreated: true,
          complianceImport: { imported: 1, skipped: 0, missing: false },
        });
      } finally {
        await dbHandle.client.end();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.each(["missing", "schema-invalid"] as const)(
    "fails the real seed CLI closed for a required %s source without leaking bootstrap secrets",
    async (failureKind) => {
      const dbHandle = createDatabase(testDatabaseUrl);
      const suffix = randomUUID().slice(0, 8);
      const fixture = await complianceFixture(suffix, "CLI required source");
      const sourceFile =
        failureKind === "missing" ? join(fixture.directory, "cli-required.json") : fixture.file;
      if (failureKind === "schema-invalid") {
        await writeFile(
          sourceFile,
          JSON.stringify({ sources: [{ title: "Schema-invalid CLI source" }] }),
          "utf8",
        );
      }
      const options = seedOptions(`cli-${suffix}`, sourceFile);
      const env = bootstrapCliEnvironment(options);
      try {
        const failed = await runSeedCli(env);
        expect(failed.exitCode).not.toBe(0);
        const failureOutput = `${failed.stdout}\n${failed.stderr}`;
        expect(failureOutput).not.toContain(options.adminPassword);
        expect(failureOutput).not.toContain(options.adminEmail);
        await expectNoBootstrapMutation(dbHandle.db, options.organizationSlug, options.adminEmail);

        await writeFile(
          sourceFile,
          JSON.stringify({ sources: [fixture.record("CLI repaired required source")] }),
          "utf8",
        );
        const retried = await runSeedCli(env);
        expect(retried.exitCode, retried.stderr).toBe(0);
        const retryOutput = `${retried.stdout}\n${retried.stderr}`;
        expect(retryOutput).not.toContain(options.adminPassword);
        expect(retryOutput).not.toContain(options.adminEmail);
        expect(
          await dbHandle.db
            .select()
            .from(organizations)
            .where(eq(organizations.slug, options.organizationSlug)),
        ).toHaveLength(1);
      } finally {
        await dbHandle.client.end();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("creates the complete identity, role, prompt and compliance baseline only for a fresh organization", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const fixture = await complianceFixture(suffix, "Fresh bootstrap official source");
    try {
      const seeded = await seedDatabase(dbHandle.db, seedOptions(suffix, fixture.file));
      expect(seeded).toMatchObject({
        bootstrapCreated: true,
        membership: { status: "active", archivedAt: null },
        systemRoleChanges: {
          mode: "bootstrap",
          rolesCreated: 4,
          permissionsAdded: Object.values(SYSTEM_ROLE_PERMISSIONS).reduce(
            (total, permissions) => total + permissions.length,
            0,
          ),
          requestId: null,
        },
        complianceImport: { imported: 1, skipped: 0, missing: false },
      });
      expect(seeded.user).toMatchObject({
        email: `seed-hardening-${suffix}@example.test`,
        displayName: `Seed Owner ${suffix}`,
        mustChangePassword: true,
      });

      const systemRoles = await dbHandle.db
        .select()
        .from(roles)
        .where(eq(roles.orgId, seeded.organization.id));
      expect(systemRoles.map((role) => role.systemKey).sort()).toEqual([
        "admin",
        "member",
        "owner",
        "viewer",
      ]);
      for (const role of systemRoles) {
        const expected = SYSTEM_ROLE_PERMISSIONS[
          role.systemKey as keyof typeof SYSTEM_ROLE_PERMISSIONS
        ] as readonly string[];
        const actual = await dbHandle.db
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, seeded.organization.id),
              eq(rolePermissions.roleId, role.id),
            ),
          );
        expect(actual.map((item) => item.permission).sort()).toEqual([...expected].sort());
      }

      const ownerRole = required(
        systemRoles.find((role) => role.systemKey === "owner"),
        "Fresh bootstrap owner role was not created",
      );
      const assignments = await dbHandle.db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.orgId, seeded.organization.id),
            eq(membershipRoles.membershipId, seeded.membership.id),
            eq(membershipRoles.roleId, ownerRole.id),
          ),
        );
      expect(assignments).toHaveLength(1);

      const prompts = await dbHandle.db
        .select({ advisorKey: promptVersions.advisorKey })
        .from(promptVersions)
        .where(eq(promptVersions.orgId, seeded.organization.id));
      expect(new Set(prompts.map((prompt) => prompt.advisorKey)).size).toBe(7);
      const promptAudits = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, seeded.organization.id),
            eq(auditEvents.requestId, seeded.metadataRequestId),
            eq(auditEvents.action, "system_prompt_version_create"),
          ),
        );
      expect(promptAudits).toHaveLength(7);
      expect(promptAudits.every((event) => event.actorUserId === seeded.user.id)).toBe(true);
      const [source] = await dbHandle.db
        .select()
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.orgId, seeded.organization.id),
            eq(complianceItems.sourceUrl, fixture.sourceUrl),
          ),
        );
      expect(source?.title).toBe("Fresh bootstrap official source");
    } finally {
      await dbHandle.client.end();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps business identity and permissions unchanged on a normal rerun while reconciling prompt and compliance metadata", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const fixture = await complianceFixture(suffix, "Original official source title");
    try {
      const initial = await seedDatabase(dbHandle.db, seedOptions(suffix, fixture.file));
      const originalPasswordHash = initial.user.passwordHash;
      const memberRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "member")))
            .limit(1)
        )[0],
        "Normal rerun member role was not found",
      );
      await Promise.all([
        dbHandle.db
          .update(organizations)
          .set({ name: "Approved Organization Name", updatedAt: new Date() })
          .where(eq(organizations.id, initial.organization.id)),
        dbHandle.db
          .update(users)
          .set({ displayName: "Approved Owner Display Name", updatedAt: new Date() })
          .where(eq(users.id, initial.user.id)),
        dbHandle.db
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "tasks:*"),
            ),
          ),
        dbHandle.db
          .delete(promptVersions)
          .where(
            and(
              eq(promptVersions.orgId, initial.organization.id),
              eq(promptVersions.advisorKey, "finance"),
              eq(promptVersions.versionNumber, 1),
            ),
          ),
      ]);
      await fixture.write("Updated official source title");

      await expect(
        seedDatabase(dbHandle.db, {
          ...seedOptions(suffix, fixture.file),
          organizationName: "Stale Environment Organization Name",
          adminDisplayName: "Stale Environment Owner Name",
          adminPassword: "seed-hardening-reseed-password-must-be-ignored",
        }),
      ).rejects.toThrow(/bootstrap refuses existing organizations/);
      const rerun = await seedDatabase(dbHandle.db, {
        mode: "metadata-only",
        organizationSlug: initial.organization.slug,
        complianceSourcesFile: fixture.file,
      });
      expect(rerun).toMatchObject({
        bootstrapCreated: false,
        systemRoleChanges: { mode: "none", rolesCreated: 0, permissionsAdded: 0 },
      });
      expect(rerun.organization.name).toBe("Approved Organization Name");
      expect(rerun.user).toBeNull();
      expect(rerun.membership).toBeNull();
      const [preservedUser] = await dbHandle.db
        .select()
        .from(users)
        .where(eq(users.id, initial.user.id))
        .limit(1);
      expect(preservedUser).toMatchObject({
        displayName: "Approved Owner Display Name",
        passwordHash: originalPasswordHash,
      });
      const [preservedMembership] = await dbHandle.db
        .select()
        .from(memberships)
        .where(eq(memberships.id, initial.membership.id))
        .limit(1);
      expect(preservedMembership).toMatchObject({
        id: initial.membership.id,
        status: initial.membership.status,
        archivedAt: initial.membership.archivedAt,
      });

      const missingPermission = await dbHandle.db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.orgId, initial.organization.id),
            eq(rolePermissions.roleId, memberRole.id),
            eq(rolePermissions.permission, "tasks:*"),
          ),
        );
      expect(missingPermission).toHaveLength(0);
      const financePrompt = await dbHandle.db
        .select()
        .from(promptVersions)
        .where(
          and(
            eq(promptVersions.orgId, initial.organization.id),
            eq(promptVersions.advisorKey, "finance"),
            eq(promptVersions.versionNumber, 1),
          ),
        );
      expect(financePrompt).toHaveLength(1);
      const [financePromptAudit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, initial.organization.id),
            eq(auditEvents.requestId, rerun.metadataRequestId),
            eq(auditEvents.action, "system_prompt_version_create"),
          ),
        );
      expect(financePromptAudit).toMatchObject({
        actorUserId: null,
        before: null,
        metadata: {
          source: "seed",
          seedMode: "metadata-only",
          systemManagedBaseline: true,
        },
      });
      expect(financePromptAudit?.after).toEqual(
        expect.objectContaining({
          advisorKey: "finance",
          versionNumber: 1,
          active: true,
          systemPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      );
      const [updatedSource] = await dbHandle.db
        .select()
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.orgId, initial.organization.id),
            eq(complianceItems.sourceUrl, fixture.sourceUrl),
          ),
        );
      expect(updatedSource).toMatchObject({
        title: "Updated official source title",
        reviewStatus: "stale",
        status: "uncertain",
        contentHashStatus: "changed",
      });
    } finally {
      await dbHandle.client.end();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("rolls back approved role and audit changes when required compliance import fails mid-transaction", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const originalTitle = "Maintenance transaction original source";
    const fixture = await complianceFixture(suffix, originalTitle);
    try {
      const initial = await seedDatabase(dbHandle.db, seedOptions(suffix, fixture.file));
      const memberRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "member")))
            .limit(1)
        )[0],
        "Maintenance transaction member role was not found",
      );
      await dbHandle.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.orgId, initial.organization.id),
            eq(rolePermissions.roleId, memberRole.id),
            eq(rolePermissions.permission, "notifications:read"),
          ),
        );
      await writeFile(
        fixture.file,
        JSON.stringify({
          sources: [
            fixture.record("This metadata update must roll back"),
            fixture.record("PostgreSQL text failure \u0000 after first import write", 1),
          ],
        }),
        "utf8",
      );

      const requestId = `seed-maintenance-atomic-${suffix}`;
      const maintenanceOptions = {
        mode: "system-role-maintenance" as const,
        organizationSlug: initial.organization.slug,
        complianceSourcesFile: fixture.file,
        complianceSourcesRequired: true,
        systemRoleMaintenance: {
          operatorEmail: initial.user.email,
          reason: "Verify approved role maintenance and compliance import atomicity",
          approvalReference: `CHANGE-ATOMIC-${suffix}`,
          requestId,
        },
      };
      await expect(seedDatabase(dbHandle.db, maintenanceOptions)).rejects.toThrow();

      expect(
        await dbHandle.db
          .select()
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "notifications:read"),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await dbHandle.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.orgId, initial.organization.id),
              eq(auditEvents.requestId, requestId),
            ),
          ),
      ).toHaveLength(0);
      const [rolledBackSource] = await dbHandle.db
        .select()
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.orgId, initial.organization.id),
            eq(complianceItems.sourceUrl, fixture.sourceUrl),
          ),
        );
      expect(rolledBackSource?.title).toBe(originalTitle);
      expect(
        await dbHandle.db
          .select()
          .from(complianceItems)
          .where(
            and(
              eq(complianceItems.orgId, initial.organization.id),
              eq(complianceItems.sourceUrl, fixture.record("ignored", 1).sourceUrl),
            ),
          ),
      ).toHaveLength(0);

      await fixture.write("Maintenance transaction retry source");
      const retried = await seedDatabase(dbHandle.db, maintenanceOptions);
      expect(retried.systemRoleChanges).toEqual({
        mode: "maintenance",
        rolesCreated: 0,
        permissionsAdded: 1,
        requestId,
      });
      expect(
        await dbHandle.db
          .select()
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "notifications:read"),
            ),
          ),
      ).toHaveLength(1);
      expect(
        await dbHandle.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.orgId, initial.organization.id),
              eq(auditEvents.requestId, requestId),
            ),
          ),
      ).toHaveLength(2);
    } finally {
      await dbHandle.client.end();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it("never restores a removed owner assignment and audits each explicitly approved permission addition", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const fixture = await complianceFixture(suffix, "Owner removal official source");
    try {
      const options = seedOptions(suffix, fixture.file);
      const initial = await seedDatabase(dbHandle.db, options);
      const ownerRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "owner")))
            .limit(1)
        )[0],
        "Owner-removal test owner role was not found",
      );
      const memberRole = required(
        (
          await dbHandle.db
            .select()
            .from(roles)
            .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "member")))
            .limit(1)
        )[0],
        "Owner-removal test member role was not found",
      );

      const secondOwnerEmail = `approved-owner-${suffix}@example.test`;
      const secondOwner = required(
        (
          await dbHandle.db
            .insert(users)
            .values({
              email: secondOwnerEmail,
              displayName: "Approved Maintenance Owner",
              passwordHash: initial.user.passwordHash,
              mustChangePassword: false,
            })
            .returning()
        )[0],
        "Approved maintenance owner was not created",
      );
      const secondOwnerMembership = required(
        (
          await dbHandle.db
            .insert(memberships)
            .values({ orgId: initial.organization.id, userId: secondOwner.id })
            .returning()
        )[0],
        "Approved maintenance owner membership was not created",
      );
      await dbHandle.db.insert(membershipRoles).values({
        orgId: initial.organization.id,
        membershipId: secondOwnerMembership.id,
        roleId: ownerRole.id,
      });
      await Promise.all([
        dbHandle.db
          .delete(membershipRoles)
          .where(
            and(
              eq(membershipRoles.orgId, initial.organization.id),
              eq(membershipRoles.membershipId, initial.membership.id),
              eq(membershipRoles.roleId, ownerRole.id),
            ),
          ),
        dbHandle.db
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "notifications:read"),
            ),
          ),
      ]);

      const normalRerun = await seedDatabase(dbHandle.db, {
        mode: "metadata-only",
        organizationSlug: initial.organization.slug,
        complianceSourcesFile: fixture.file,
      });
      expect(normalRerun.systemRoleChanges).toMatchObject({
        mode: "none",
        rolesCreated: 0,
        permissionsAdded: 0,
      });
      const removedAssignmentAfterRerun = await dbHandle.db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.orgId, initial.organization.id),
            eq(membershipRoles.membershipId, initial.membership.id),
            eq(membershipRoles.roleId, ownerRole.id),
          ),
        );
      expect(removedAssignmentAfterRerun).toHaveLength(0);

      const rejectedRequestId = `seed-maintenance-rejected-${suffix}`;
      await expect(
        seedDatabase(dbHandle.db, {
          mode: "system-role-maintenance",
          organizationSlug: initial.organization.slug,
          complianceSourcesFile: fixture.file,
          systemRoleMaintenance: {
            operatorEmail: initial.user.email,
            reason: "Attempt maintenance without an active owner role",
            approvalReference: `CHANGE-REJECTED-${suffix}`,
            requestId: rejectedRequestId,
          },
        }),
      ).rejects.toThrow(/active organization owner/);
      expect(
        await dbHandle.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.orgId, initial.organization.id),
              eq(auditEvents.requestId, rejectedRequestId),
            ),
          ),
      ).toHaveLength(0);

      const requestId = `seed-maintenance-approved-${suffix}`;
      const approvalReference = `CHANGE-APPROVED-${suffix}`;
      const reason = "Apply the reviewed built-in member permission baseline";
      const maintenance = await seedDatabase(dbHandle.db, {
        mode: "system-role-maintenance",
        organizationSlug: initial.organization.slug,
        complianceSourcesFile: fixture.file,
        systemRoleMaintenance: {
          operatorEmail: secondOwnerEmail,
          reason,
          approvalReference,
          requestId,
        },
      });
      expect(maintenance.systemRoleChanges).toEqual({
        mode: "maintenance",
        rolesCreated: 0,
        permissionsAdded: 1,
        requestId,
      });

      const [restoredPermission] = await dbHandle.db
        .select()
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.orgId, initial.organization.id),
            eq(rolePermissions.roleId, memberRole.id),
            eq(rolePermissions.permission, "notifications:read"),
          ),
        );
      expect(restoredPermission).toBeDefined();
      const originalOwnerAssignment = await dbHandle.db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.orgId, initial.organization.id),
            eq(membershipRoles.membershipId, initial.membership.id),
            eq(membershipRoles.roleId, ownerRole.id),
          ),
        );
      expect(originalOwnerAssignment).toHaveLength(0);

      const [permissionAudit] = await dbHandle.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, initial.organization.id),
            eq(auditEvents.requestId, requestId),
            eq(auditEvents.action, "system_role_permission_add"),
          ),
        );
      expect(permissionAudit).toMatchObject({
        actorUserId: secondOwner.id,
        resourceType: "role-permission",
        before: {
          roleId: memberRole.id,
          systemKey: "member",
          permission: "notifications:read",
          present: false,
        },
        after: {
          roleId: memberRole.id,
          systemKey: "member",
          permission: "notifications:read",
          present: true,
        },
        metadata: {
          mode: "explicit_system_role_maintenance",
          operatorEmail: secondOwnerEmail,
          reason,
          approvalReference,
        },
      });

      await dbHandle.db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.orgId, initial.organization.id),
            eq(rolePermissions.roleId, memberRole.id),
            eq(rolePermissions.permission, "projects:*"),
          ),
        );
      await expect(
        seedDatabase(dbHandle.db, {
          mode: "system-role-maintenance",
          organizationSlug: initial.organization.slug,
          complianceSourcesFile: fixture.file,
          systemRoleMaintenance: {
            operatorEmail: secondOwnerEmail,
            reason,
            approvalReference,
            requestId,
          },
        }),
      ).rejects.toThrow(/requestId was already used/);
      expect(
        await dbHandle.db
          .select()
          .from(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "projects:*"),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      await dbHandle.client.end();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it.each([
    "cross-organization",
    "non-owner",
    "inactive-membership",
    "archived-membership",
    "archived-owner-role",
  ] as const)(
    "rejects %s system-role maintenance with zero permission or audit mutation",
    async (operatorState) => {
      const dbHandle = createDatabase(testDatabaseUrl);
      const suffix = randomUUID().slice(0, 8);
      const fixture = await complianceFixture(suffix, `Rejected ${operatorState} source`);
      try {
        const initial = await seedDatabase(dbHandle.db, seedOptions(suffix, fixture.file));
        const ownerRole = required(
          (
            await dbHandle.db
              .select()
              .from(roles)
              .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "owner")))
              .limit(1)
          )[0],
          "Rejected maintenance owner role was not found",
        );
        const memberRole = required(
          (
            await dbHandle.db
              .select()
              .from(roles)
              .where(and(eq(roles.orgId, initial.organization.id), eq(roles.systemKey, "member")))
              .limit(1)
          )[0],
          "Rejected maintenance member role was not found",
        );
        await dbHandle.db
          .delete(rolePermissions)
          .where(
            and(
              eq(rolePermissions.orgId, initial.organization.id),
              eq(rolePermissions.roleId, memberRole.id),
              eq(rolePermissions.permission, "notifications:read"),
            ),
          );

        let operatorEmail: string;
        if (operatorState === "cross-organization") {
          const otherSuffix = randomUUID().slice(0, 8);
          const other = await seedDatabase(dbHandle.db, {
            ...seedOptions(otherSuffix, fixture.file),
            organizationName: "Cross Organization Maintenance Operator",
          });
          operatorEmail = other.user.email;
        } else {
          operatorEmail = `${operatorState}-${suffix}@example.test`;
          const operator = required(
            (
              await dbHandle.db
                .insert(users)
                .values({
                  email: operatorEmail,
                  displayName: `Rejected ${operatorState} operator`,
                  passwordHash: initial.user.passwordHash,
                  mustChangePassword: false,
                })
                .returning()
            )[0],
            "Rejected maintenance operator was not created",
          );
          const operatorMembership = required(
            (
              await dbHandle.db
                .insert(memberships)
                .values({
                  orgId: initial.organization.id,
                  userId: operator.id,
                  status: operatorState === "inactive-membership" ? "inactive" : "active",
                  archivedAt: operatorState === "archived-membership" ? new Date() : null,
                })
                .returning()
            )[0],
            "Rejected maintenance membership was not created",
          );
          if (operatorState !== "non-owner") {
            await dbHandle.db.insert(membershipRoles).values({
              orgId: initial.organization.id,
              membershipId: operatorMembership.id,
              roleId: ownerRole.id,
            });
          }
          if (operatorState === "archived-owner-role") {
            await dbHandle.db
              .update(roles)
              .set({ archivedAt: new Date(), updatedAt: new Date() })
              .where(eq(roles.id, ownerRole.id));
          }
        }

        const requestId = `seed-maintenance-${operatorState}-${suffix}`;
        await expect(
          seedDatabase(dbHandle.db, {
            mode: "system-role-maintenance",
            organizationSlug: initial.organization.slug,
            complianceSourcesFile: fixture.file,
            systemRoleMaintenance: {
              operatorEmail,
              reason: `Reject ${operatorState} operator without an active owner boundary`,
              approvalReference: `CHANGE-REJECT-${operatorState}-${suffix}`,
              requestId,
            },
          }),
        ).rejects.toThrow(/active organization owner/);

        expect(
          await dbHandle.db
            .select()
            .from(rolePermissions)
            .where(
              and(
                eq(rolePermissions.orgId, initial.organization.id),
                eq(rolePermissions.roleId, memberRole.id),
                eq(rolePermissions.permission, "notifications:read"),
              ),
            ),
        ).toHaveLength(0);
        expect(
          await dbHandle.db
            .select()
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.orgId, initial.organization.id),
                eq(auditEvents.requestId, requestId),
              ),
            ),
        ).toHaveLength(0);
      } finally {
        await dbHandle.client.end();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
