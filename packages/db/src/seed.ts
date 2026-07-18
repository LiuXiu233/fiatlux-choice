import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { complianceItemCreateSchema } from "@fiatlux/contracts";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";

import type { Database } from "./index.js";
import {
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
    "notifications:*",
    "workflow-definitions:*",
    "workflow-runs:*",
    "approvals:*",
    "external-actions:*",
    "advisors:*",
    "advisor-runs:*",
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
    "notifications:*",
    "workflow-definitions:read",
    "workflow-runs:read",
    "approvals:read",
    "external-actions:read",
    "advisors:read",
    "advisor-runs:*",
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

const advisorPrompts = {
  general_manager: {
    scopes: ["objectives", "projects", "tasks", "decisions", "risks", "financial-entries"],
    title: "general manager",
  },
  finance: {
    scopes: ["financial-entries", "invoices", "cash-flow", "contracts"],
    title: "finance",
  },
  legal_compliance: {
    scopes: ["compliance-items", "obligations", "risks", "contracts"],
    title: "legal and compliance",
  },
  product_rnd: {
    scopes: ["products", "projects", "tasks", "github-insights"],
    title: "product and engineering",
  },
  market_opportunity: {
    scopes: ["opportunities", "products", "contracts"],
    title: "market opportunity",
  },
  hr_admin: { scopes: ["tasks", "objectives", "obligations"], title: "people and administration" },
  information_security: {
    scopes: ["risks", "compliance-items", "github-insights", "audit-events"],
    title: "information security",
  },
} as const;

export interface SeedOptions {
  organizationName: string;
  organizationSlug: string;
  adminEmail: string;
  adminDisplayName: string;
  adminPassword: string;
  complianceSourcesFile?: string;
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

export async function importOfficialComplianceSources(
  db: Database,
  orgId: string,
  sourceFile = fileURLToPath(
    new URL("../../../content/compliance/official-sources.json", import.meta.url),
  ),
) {
  let raw: string;
  try {
    raw = await readFile(sourceFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { imported: 0, skipped: 0, missing: true };
    throw error;
  }

  const parsedDocument = JSON.parse(raw) as unknown;
  const root = objectValue(parsedDocument);
  const records = Array.isArray(parsedDocument)
    ? parsedDocument
    : Array.isArray(root?.sources)
      ? root.sources
      : Array.isArray(root?.items)
        ? root.items
        : [];
  let imported = 0;
  let skipped = 0;

  for (const rawRecord of records) {
    const record = objectValue(rawRecord);
    if (!record) {
      skipped += 1;
      continue;
    }
    const candidate = complianceItemCreateSchema.safeParse({
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
    });
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
      contentHash: item.contentHash,
      metadataHash,
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

export async function seedDatabase(db: Database, options: SeedOptions) {
  const passwordHash = await argon2.hash(options.adminPassword, { type: argon2.argon2id });

  const [org] = await db
    .insert(organizations)
    .values({
      name: options.organizationName,
      slug: options.organizationSlug,
    })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: { name: options.organizationName, updatedAt: new Date() },
    })
    .returning();

  const normalizedEmail = options.adminEmail.trim().toLowerCase();
  const [user] = await db
    .insert(users)
    .values({
      email: normalizedEmail,
      displayName: options.adminDisplayName,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { displayName: options.adminDisplayName, passwordHash, updatedAt: new Date() },
    })
    .returning();
  if (!org || !user) throw new Error("Failed to seed organization or administrator");

  const [membership] = await db
    .insert(memberships)
    .values({ orgId: org.id, userId: user.id })
    .onConflictDoNothing()
    .returning();
  const activeMembership =
    membership ??
    (
      await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.orgId, org.id), eq(memberships.userId, user.id)))
        .limit(1)
    )[0];
  if (!activeMembership) throw new Error("Failed to seed administrator membership");

  for (const [systemKey, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
    const [insertedRole] = await db
      .insert(roles)
      .values({
        orgId: org.id,
        name: systemKey.charAt(0).toUpperCase() + systemKey.slice(1),
        systemKey,
        description: `Built-in ${systemKey} role`,
      })
      .onConflictDoNothing()
      .returning();
    const role =
      insertedRole ??
      (
        await db
          .select()
          .from(roles)
          .where(and(eq(roles.orgId, org.id), eq(roles.systemKey, systemKey)))
          .limit(1)
      )[0];
    if (!role) throw new Error(`Failed to seed ${systemKey} role`);

    await db
      .insert(rolePermissions)
      .values(
        permissions.map((permission) => ({
          orgId: org.id,
          roleId: role.id,
          permission,
        })),
      )
      .onConflictDoNothing();

    if (systemKey === "owner") {
      await db
        .insert(membershipRoles)
        .values({
          orgId: org.id,
          membershipId: activeMembership.id,
          roleId: role.id,
        })
        .onConflictDoNothing();
    }
  }

  for (const [advisorKey, definition] of Object.entries(advisorPrompts)) {
    await db
      .insert(promptVersions)
      .values({
        orgId: org.id,
        advisorKey,
        versionNumber: 1,
        active: true,
        dataScopes: definition.scopes,
        toolPolicy: { readOnly: true, humanApprovalForSideEffects: true },
        createdBy: user.id,
        systemPrompt: [
          `You are the FIAT LUX CHOICE ${definition.title} advisor.`,
          "Use only supplied, permission-filtered company context.",
          "Separate facts, inferences, and recommendations. Every fact needs evidence.",
          "State risks, missing information, suggested actions, confidence, and a decision-support disclaimer.",
          "Never claim an external action succeeded and never bypass human approval.",
        ].join(" "),
      })
      .onConflictDoNothing();
  }

  const complianceImport = await importOfficialComplianceSources(
    db,
    org.id,
    options.complianceSourcesFile,
  );

  return { organization: org, user, membership: activeMembership, complianceImport };
}
