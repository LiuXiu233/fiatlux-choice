import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { complianceItemCreateSchema } from "@fiatlux/contracts";
import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { ADVISOR_PROMPTS, renderAdvisorSystemPrompt } from "./advisor-prompts.js";
import type { Database } from "./index.js";
import {
  auditEvents,
  complianceItems,
  membershipRoles,
  memberships,
  organizations,
  promptVersions,
  rolePermissions,
  roles,
  users,
} from "./schema.js";

export const SYSTEM_ROLE_PERMISSIONS = {
  owner: ["*"],
  admin: [
    "dashboard:read",
    "files:*",
    "objectives:*",
    "projects:*",
    "tasks:*",
    "decisions:*",
    "obligations:*",
    "compliance:read",
    "compliance-items:*",
    "compliance-events:*",
    "risks:*",
    "contracts:*",
    "financial-entries:*",
    "invoices:*",
    "cash-flow:*",
    "products:*",
    "opportunities:*",
    "github-insights:*",
    "notifications:manage",
    "notifications:create",
    "notifications:read",
    "notifications:delete",
    "workflow-definitions:*",
    "workflow-runs:*",
    "approvals:*",
    "external-actions:*",
    "advisors:*",
    "advisor-runs:*",
    "advisor-runs:read-all",
    "audit-events:read",
    "users:*",
    "roles:read",
    "role-assignments:create",
    "settings:read",
    "settings:test",
    "backups:*",
  ],
  member: [
    "dashboard:read",
    "files:read",
    "files:create",
    "objectives:read",
    "objectives:update",
    "projects:*",
    "tasks:*",
    "decisions:*",
    "obligations:read",
    "obligations:update",
    "compliance:read",
    "compliance-items:read",
    "compliance-events:read",
    "risks:*",
    "contracts:read",
    "financial-entries:read",
    "invoices:read",
    "cash-flow:read",
    "products:*",
    "opportunities:*",
    "github-insights:read",
    "notifications:read",
    "workflow-definitions:read",
    "workflow-runs:read",
    "approvals:read",
    "external-actions:read",
    "advisors:read",
    "advisor-runs:create",
    "advisor-runs:read",
    "advisor-runs:update",
  ],
  viewer: [
    "dashboard:read",
    "objectives:read",
    "projects:read",
    "tasks:read",
    "decisions:read",
    "obligations:read",
    "compliance:read",
    "compliance-items:read",
    "compliance-events:read",
    "risks:read",
    "contracts:read",
    "products:read",
    "opportunities:read",
    "github-insights:read",
    "notifications:read",
    "advisors:read",
    "advisor-runs:read",
  ],
} as const;

interface SeedCommonOptions {
  organizationSlug: string;
  complianceSourcesFile?: string;
  complianceSourcesRequired?: boolean;
}

export interface BootstrapSeedOptions extends SeedCommonOptions {
  mode?: "bootstrap";
  organizationName: string;
  adminEmail: string;
  adminDisplayName: string;
  adminPassword: string;
  /** Defaults to true for production bootstrap; test fixtures may explicitly opt out. */
  adminMustChangePassword?: boolean;
}

export interface MetadataOnlySeedOptions extends SeedCommonOptions {
  mode: "metadata-only";
}

export interface SystemRoleMaintenanceInput {
  operatorEmail: string;
  reason: string;
  approvalReference: string;
  requestId: string;
}

export interface SystemRoleMaintenanceSeedOptions extends SeedCommonOptions {
  mode: "system-role-maintenance";
  systemRoleMaintenance: SystemRoleMaintenanceInput;
}

export type SeedOptions =
  | BootstrapSeedOptions
  | MetadataOnlySeedOptions
  | SystemRoleMaintenanceSeedOptions;

interface NormalizedSystemRoleMaintenance {
  operatorEmail: string;
  reason: string;
  approvalReference: string;
  requestId: string;
}

function normalizeSystemRoleMaintenance(
  input: SystemRoleMaintenanceInput | undefined,
): NormalizedSystemRoleMaintenance | undefined {
  if (!input) return undefined;
  const normalized = {
    operatorEmail: input.operatorEmail.trim().toLowerCase(),
    reason: input.reason.trim(),
    approvalReference: input.approvalReference.trim(),
    requestId: input.requestId.trim(),
  };
  if (!normalized.operatorEmail?.includes("@")) {
    throw new Error("System-role maintenance requires a valid operator email");
  }
  if (normalized.reason.length < 8) {
    throw new Error("System-role maintenance requires a non-empty reason of at least 8 characters");
  }
  if (normalized.approvalReference.length < 3) {
    throw new Error("System-role maintenance requires an approval or change reference");
  }
  if (normalized.requestId.length < 3 || normalized.requestId.length > 200) {
    throw new Error("System-role maintenance requires a requestId between 3 and 200 characters");
  }
  return normalized;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function optionalDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function monitoringCadenceDays(category: string) {
  if (["tax_invoice", "ai_governance"].includes(category)) return 7;
  if (
    [
      "consumer_ecommerce",
      "data_security",
      "labor_employment",
      "network_product",
      "online_education_esports",
      "personal_information",
    ].includes(category)
  )
    return 30;
  if (category === "archives") return 180;
  return 90;
}

const defaultComplianceSourcesFile = () =>
  fileURLToPath(new URL("../../../content/compliance/official-sources.json", import.meta.url));

interface LoadedComplianceSourceDocument {
  missing: boolean;
  parsedDocument?: unknown;
}

async function loadComplianceSourceDocument(
  sourceFile: string,
): Promise<LoadedComplianceSourceDocument> {
  let raw: string;
  try {
    raw = await readFile(sourceFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    throw error;
  }
  return { missing: false, parsedDocument: JSON.parse(raw) as unknown };
}

function complianceSourceRecords(parsedDocument: unknown) {
  const root = objectValue(parsedDocument);
  return Array.isArray(parsedDocument)
    ? parsedDocument
    : Array.isArray(root?.sources)
      ? root.sources
      : Array.isArray(root?.items)
        ? root.items
        : [];
}

function complianceSourceCandidate(record: Record<string, unknown>) {
  return complianceItemCreateSchema.safeParse({
    title: stringValue(record, "title", "name"),
    category: stringValue(record, "category", "topic"),
    issuingAuthority: stringValue(record, "issuingAuthority", "authority", "issuer"),
    sourceUrl: stringValue(record, "sourceUrl", "officialUrl", "url"),
    effectiveDate: stringValue(record, "effectiveDate", "effectiveAt"),
    lastVerifiedAt: stringValue(record, "lastVerifiedAt", "verifiedAt", "updatedAt"),
    reviewStatus: stringValue(record, "reviewStatus", "humanReviewStatus") ?? "pending",
    applicability: stringValue(record, "applicability", "conditions"),
    summary: stringValue(record, "summary", "description"),
    jurisdiction: stringValue(record, "jurisdiction") ?? "中国/广东省/广州市",
    sourceTitle: stringValue(record, "sourceTitle") ?? stringValue(record, "title", "name"),
    sourcePublishedAt: stringValue(
      record,
      "sourcePublishedAt",
      "publishedAt",
      "published",
      "issuedAt",
    ),
    sourceStatus: stringValue(record, "status"),
    sourceMetadata: record,
    status: "draft",
    contentHash: stringValue(record, "contentHash"),
    metadataHash: stringValue(record, "metadataHash"),
    contentHashStatus: stringValue(record, "contentHashStatus") ?? "pending_fetch",
    nextReviewAt: stringValue(record, "nextReviewAt"),
    monitoringCadenceDays: monitoringCadenceDays(
      stringValue(record, "category", "topic") ?? "other",
    ),
  });
}

function assertRequiredComplianceSourceDocument(loaded: LoadedComplianceSourceDocument) {
  if (loaded.missing) {
    throw new Error("Required official compliance source file is missing; seed made no changes");
  }
  const records = complianceSourceRecords(loaded.parsedDocument);
  if (!records.length) {
    throw new Error("Required official compliance source document has no source records");
  }
  for (const [index, rawRecord] of records.entries()) {
    const record = objectValue(rawRecord);
    if (!record) {
      throw new Error(`Required official compliance source record ${index} is not an object`);
    }
    const candidate = complianceSourceCandidate(record);
    if (!candidate.success) {
      throw new Error(
        `Required official compliance source record ${index} failed schema validation: ${candidate.error.issues
          .map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
  }
}

export async function importOfficialComplianceSources(
  db: Database,
  orgId: string,
  sourceFile = defaultComplianceSourcesFile(),
  preloadedDocument?: LoadedComplianceSourceDocument,
) {
  const loaded = preloadedDocument ?? (await loadComplianceSourceDocument(sourceFile));
  if (loaded.missing) return { imported: 0, skipped: 0, missing: true };
  const records = complianceSourceRecords(loaded.parsedDocument);
  let imported = 0;
  let skipped = 0;

  for (const rawRecord of records) {
    const record = objectValue(rawRecord);
    if (!record) {
      skipped += 1;
      continue;
    }
    const candidate = complianceSourceCandidate(record);
    if (!candidate.success) {
      skipped += 1;
      continue;
    }

    const item = candidate.data;
    const metadataForHash = { ...record };
    delete metadataForHash.lastVerifiedAt;
    delete metadataForHash.nextReviewAt;
    delete metadataForHash.reviewStatus;
    delete metadataForHash.contentHashStatus;
    const metadataHash =
      item.metadataHash ??
      createHash("sha256").update(JSON.stringify(metadataForHash)).digest("hex");
    const [existing] = await db
      .select()
      .from(complianceItems)
      .where(and(eq(complianceItems.orgId, orgId), eq(complianceItems.sourceUrl, item.sourceUrl)))
      .limit(1);
    const contentChanged = Boolean(
      existing?.metadataHash && existing.metadataHash !== metadataHash,
    );
    const importedCanBeActive = item.reviewStatus === "reviewed" && Boolean(item.lastVerifiedAt);
    const reviewStatus = contentChanged ? "stale" : (existing?.reviewStatus ?? item.reviewStatus);
    const status = contentChanged
      ? "uncertain"
      : (existing?.status ?? (importedCanBeActive ? "active" : "draft"));
    const values = {
      title: item.title,
      category: item.category,
      issuingAuthority: item.issuingAuthority,
      sourceUrl: item.sourceUrl,
      sourceTitle: item.sourceTitle ?? item.title,
      sourcePublishedAt: optionalDate(item.sourcePublishedAt),
      sourceStatus: item.sourceStatus,
      sourceMetadata: item.sourceMetadata ?? record,
      effectiveDate: optionalDate(item.effectiveDate ?? stringValue(record, "effective")),
      jurisdiction: item.jurisdiction,
      applicability: item.applicability,
      summary: item.summary,
      reviewStatus,
      status,
      lastVerifiedAt: contentChanged
        ? (existing?.lastVerifiedAt ?? null)
        : (existing?.lastVerifiedAt ?? optionalDate(item.lastVerifiedAt)),
      contentHash: existing?.contentHash ?? item.contentHash,
      metadataHash,
      contentHashStatus: contentChanged
        ? ("changed" as const)
        : (existing?.contentHashStatus ?? item.contentHashStatus),
      nextReviewAt: existing?.nextReviewAt ?? optionalDate(item.nextReviewAt),
      monitoringCadenceDays: existing?.monitoringCadenceDays ?? item.monitoringCadenceDays,
      nextMonitorAt: existing?.nextMonitorAt ?? new Date(),
      updatedAt: new Date(),
    };
    await db
      .insert(complianceItems)
      .values({ orgId, ...values })
      .onConflictDoUpdate({
        target: [complianceItems.orgId, complianceItems.sourceUrl],
        set: values,
      });
    imported += 1;
  }

  return { imported, skipped, missing: false };
}

interface SystemRoleChanges {
  mode: "bootstrap" | "maintenance" | "none";
  rolesCreated: number;
  permissionsAdded: number;
  requestId: string | null;
}

type ComplianceImportResult = Awaited<ReturnType<typeof importOfficialComplianceSources>>;

export interface BootstrapSeedResult {
  organization: typeof organizations.$inferSelect;
  user: typeof users.$inferSelect;
  membership: typeof memberships.$inferSelect;
  bootstrapCreated: true;
  systemRoleChanges: SystemRoleChanges;
  metadataRequestId: string;
  complianceImport: ComplianceImportResult;
}

export interface ExistingSeedResult {
  organization: typeof organizations.$inferSelect;
  user: null;
  membership: null;
  bootstrapCreated: false;
  systemRoleChanges: SystemRoleChanges;
  metadataRequestId: string;
  complianceImport: ComplianceImportResult;
}

export function seedDatabase(
  db: Database,
  options: BootstrapSeedOptions,
): Promise<BootstrapSeedResult>;
export function seedDatabase(
  db: Database,
  options: MetadataOnlySeedOptions | SystemRoleMaintenanceSeedOptions,
): Promise<ExistingSeedResult>;
export async function seedDatabase(
  db: Database,
  options: SeedOptions,
): Promise<BootstrapSeedResult | ExistingSeedResult> {
  const mode = options.mode ?? "bootstrap";
  const bootstrapOptions = mode === "bootstrap" ? (options as BootstrapSeedOptions) : undefined;
  const roleMaintenanceOptions =
    mode === "system-role-maintenance" ? (options as SystemRoleMaintenanceSeedOptions) : undefined;
  const maintenance = normalizeSystemRoleMaintenance(roleMaintenanceOptions?.systemRoleMaintenance);
  const metadataRequestId = maintenance?.requestId ?? `seed-${mode}-${randomUUID()}`;
  const complianceSourcesFile = options.complianceSourcesFile ?? defaultComplianceSourcesFile();
  const preloadedCompliance = options.complianceSourcesRequired
    ? await loadComplianceSourceDocument(complianceSourcesFile)
    : undefined;
  if (options.complianceSourcesRequired && preloadedCompliance) {
    assertRequiredComplianceSourceDocument(preloadedCompliance);
  }

  const core = await db.transaction(async (tx) => {
    let organization: typeof organizations.$inferSelect;
    if (mode === "bootstrap") {
      if (!bootstrapOptions) throw new Error("Bootstrap seed options are missing");
      const [insertedOrganization] = await tx
        .insert(organizations)
        .values({
          name: bootstrapOptions.organizationName,
          slug: options.organizationSlug,
        })
        .onConflictDoNothing({ target: organizations.slug })
        .returning();
      if (!insertedOrganization) {
        throw new Error(
          "Organization slug already exists; bootstrap refuses existing organizations. Select metadata-only or approved system-role-maintenance explicitly",
        );
      }
      organization = insertedOrganization;
    } else {
      const [existingOrganization] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.slug, options.organizationSlug))
        .limit(1)
        .for("update");
      if (!existingOrganization) {
        throw new Error(`${mode} requires an existing organization with the exact slug`);
      }
      organization = existingOrganization;
    }

    let user: typeof users.$inferSelect | null = null;
    let membership: typeof memberships.$inferSelect | null = null;
    if (mode === "bootstrap") {
      if (!bootstrapOptions) throw new Error("Bootstrap seed options are missing");
      const normalizedEmail = bootstrapOptions.adminEmail.trim().toLowerCase();
      const passwordHash = await argon2.hash(bootstrapOptions.adminPassword, {
        type: argon2.argon2id,
      });
      const [insertedUser] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          displayName: bootstrapOptions.adminDisplayName,
          passwordHash,
          mustChangePassword: bootstrapOptions.adminMustChangePassword ?? true,
        })
        .onConflictDoNothing()
        .returning();
      if (!insertedUser) {
        throw new Error(
          "Bootstrap administrator email already exists; refusing to attach an existing identity",
        );
      }
      user = insertedUser;
      const [insertedMembership] = await tx
        .insert(memberships)
        .values({ orgId: organization.id, userId: user.id })
        .returning();
      if (!insertedMembership) throw new Error("Failed to seed administrator membership");
      membership = insertedMembership;
    }

    let maintenanceActor: typeof users.$inferSelect | undefined;
    if (maintenance) {
      const [operator] = await tx
        .select()
        .from(users)
        .where(eq(users.email, maintenance.operatorEmail))
        .limit(1);
      if (!operator) throw new Error("System-role maintenance operator was not found");
      const [operatorMembership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, organization.id),
            eq(memberships.userId, operator.id),
            eq(memberships.status, "active"),
            isNull(memberships.archivedAt),
          ),
        )
        .limit(1);
      if (!operatorMembership) {
        throw new Error("System-role maintenance operator must be an active organization owner");
      }
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
            eq(membershipRoles.membershipId, operatorMembership.id),
          ),
        )
        .limit(1);
      if (!ownerAssignment) {
        throw new Error("System-role maintenance operator must be an active organization owner");
      }
      const [existingMaintenanceAudit] = await tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, organization.id),
            eq(auditEvents.requestId, maintenance.requestId),
          ),
        )
        .limit(1);
      if (existingMaintenanceAudit) {
        throw new Error("System-role maintenance requestId was already used in this organization");
      }
      maintenanceActor = operator;
    }

    let rolesCreated = 0;
    let permissionsAdded = 0;
    if (mode === "bootstrap" || maintenance) {
      for (const [systemKey, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
        const [insertedRole] = await tx
          .insert(roles)
          .values({
            orgId: organization.id,
            name: systemKey.charAt(0).toUpperCase() + systemKey.slice(1),
            systemKey,
            description: `Built-in ${systemKey} role`,
          })
          .onConflictDoNothing()
          .returning();
        const [existingRole] = insertedRole
          ? [insertedRole]
          : await tx
              .select()
              .from(roles)
              .where(and(eq(roles.orgId, organization.id), eq(roles.systemKey, systemKey)))
              .limit(1);
        const role = insertedRole ?? existingRole;
        if (!role) throw new Error(`Failed to seed ${systemKey} role`);
        if (insertedRole) rolesCreated += 1;

        const insertedPermissions = await tx
          .insert(rolePermissions)
          .values(
            permissions.map((permission) => ({
              orgId: organization.id,
              roleId: role.id,
              permission,
            })),
          )
          .onConflictDoNothing()
          .returning({ permission: rolePermissions.permission });
        permissionsAdded += insertedPermissions.length;

        if (maintenance && maintenanceActor) {
          const auditMetadata = {
            mode: "explicit_system_role_maintenance",
            operatorEmail: maintenance.operatorEmail,
            reason: maintenance.reason,
            approvalReference: maintenance.approvalReference,
          };
          if (insertedRole) {
            await tx.insert(auditEvents).values({
              orgId: organization.id,
              actorUserId: maintenanceActor.id,
              action: "system_role_create",
              resourceType: "role",
              resourceId: role.id,
              requestId: maintenance.requestId,
              before: null,
              after: {
                id: role.id,
                name: role.name,
                systemKey: role.systemKey,
                description: role.description,
              },
              metadata: auditMetadata,
            });
          }
          for (const added of insertedPermissions) {
            const permissionState = {
              roleId: role.id,
              systemKey,
              permission: added.permission,
            };
            await tx.insert(auditEvents).values({
              orgId: organization.id,
              actorUserId: maintenanceActor.id,
              action: "system_role_permission_add",
              resourceType: "role-permission",
              resourceId: `${role.id}:${added.permission}`,
              requestId: maintenance.requestId,
              before: { ...permissionState, present: false },
              after: { ...permissionState, present: true },
              metadata: auditMetadata,
            });
          }
        }

        if (mode === "bootstrap" && systemKey === "owner") {
          if (!membership) throw new Error("Bootstrap owner membership is missing");
          await tx.insert(membershipRoles).values({
            orgId: organization.id,
            membershipId: membership.id,
            roleId: role.id,
          });
        }
      }
      if (maintenance && maintenanceActor) {
        await tx.insert(auditEvents).values({
          orgId: organization.id,
          actorUserId: maintenanceActor.id,
          action: "system_role_maintenance",
          resourceType: "organization",
          resourceId: organization.id,
          requestId: maintenance.requestId,
          before: { rolesCreated: 0, permissionsAdded: 0 },
          after: { rolesCreated, permissionsAdded },
          metadata: {
            mode: "explicit_system_role_maintenance",
            operatorEmail: maintenance.operatorEmail,
            reason: maintenance.reason,
            approvalReference: maintenance.approvalReference,
          },
        });
      }
    }

    for (const [advisorKey, definition] of Object.entries(ADVISOR_PROMPTS)) {
      const systemPrompt = renderAdvisorSystemPrompt(definition);
      const [insertedPrompt] = await tx
        .insert(promptVersions)
        .values({
          orgId: organization.id,
          advisorKey,
          versionNumber: 1,
          active: true,
          dataScopes: definition.scopes,
          toolPolicy: { readOnly: true, humanApprovalForSideEffects: true },
          createdBy: user?.id ?? maintenanceActor?.id ?? null,
          systemPrompt,
        })
        .onConflictDoNothing()
        .returning({
          id: promptVersions.id,
          advisorKey: promptVersions.advisorKey,
          versionNumber: promptVersions.versionNumber,
          active: promptVersions.active,
        });
      if (insertedPrompt) {
        await tx.insert(auditEvents).values({
          orgId: organization.id,
          actorUserId: user?.id ?? maintenanceActor?.id ?? null,
          action: "system_prompt_version_create",
          resourceType: "prompt-version",
          resourceId: insertedPrompt.id,
          requestId: metadataRequestId,
          before: null,
          after: {
            ...insertedPrompt,
            systemPromptSha256: createHash("sha256").update(systemPrompt).digest("hex"),
          },
          metadata: { source: "seed", seedMode: mode, systemManagedBaseline: true },
        });
      }
    }

    const complianceImport = await importOfficialComplianceSources(
      tx as unknown as Database,
      organization.id,
      complianceSourcesFile,
      preloadedCompliance,
    );

    return {
      organization,
      user,
      membership,
      bootstrapCreated: mode === "bootstrap",
      systemRoleChanges: {
        mode:
          mode === "bootstrap"
            ? ("bootstrap" as const)
            : maintenance
              ? ("maintenance" as const)
              : ("none" as const),
        rolesCreated,
        permissionsAdded,
        requestId: maintenance?.requestId ?? null,
      },
      metadataRequestId,
      complianceImport,
    };
  });

  const result = core;
  if (mode === "bootstrap") {
    if (!result.user || !result.membership) throw new Error("Bootstrap identity result is missing");
    return { ...result, user: result.user, membership: result.membership, bootstrapCreated: true };
  }
  return { ...result, user: null, membership: null, bootstrapCreated: false };
}
