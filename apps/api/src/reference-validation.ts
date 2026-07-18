import type { ResourceName } from "@fiatlux/contracts";
import type { Database } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { sql } from "drizzle-orm";

interface ReferenceRule {
  field: string;
  table?: string;
  userMembership?: boolean;
}

const referenceRules: Partial<Record<ResourceName, readonly ReferenceRule[]>> = {
  objectives: [{ field: "ownerId", userMembership: true }],
  projects: [
    { field: "objectiveId", table: "objectives" },
    { field: "ownerId", userMembership: true },
  ],
  tasks: [
    { field: "projectId", table: "projects" },
    { field: "assigneeId", userMembership: true },
  ],
  obligations: [
    { field: "ownerId", userMembership: true },
    { field: "sourceId", table: "compliance_items" },
  ],
  "compliance-events": [
    { field: "sourceId", table: "compliance_items" },
    { field: "ownerId", userMembership: true },
  ],
  risks: [{ field: "ownerId", userMembership: true }],
  contracts: [
    { field: "fileId", table: "files" },
    { field: "ownerId", userMembership: true },
  ],
  "financial-entries": [{ field: "externalActionId", table: "external_actions" }],
  invoices: [{ field: "fileId", table: "files" }],
  products: [{ field: "ownerId", userMembership: true }],
  opportunities: [{ field: "ownerId", userMembership: true }],
  notifications: [{ field: "recipientId", userMembership: true }],
  "workflow-runs": [
    { field: "definitionId", table: "workflow_definitions" },
    { field: "requestedBy", userMembership: true },
  ],
};

function isMissing(result: Iterable<unknown>) {
  return !Array.from(result).length;
}

export async function assertResourceReferences(
  db: Database,
  orgId: string,
  resource: ResourceName,
  input: Record<string, unknown>,
) {
  for (const rule of referenceRules[resource] ?? []) {
    const referenceId = input[rule.field];
    if (referenceId === undefined || referenceId === null) continue;
    if (typeof referenceId !== "string") {
      throw new DomainError("VALIDATION_FAILED", `${rule.field} must be a UUID`, 400);
    }

    let result: Iterable<unknown>;
    if (rule.userMembership) {
      result = await db.execute(sql`
        SELECT 1 FROM memberships
        WHERE org_id = ${orgId} AND user_id = ${referenceId}
          AND status = 'active' AND archived_at IS NULL
        LIMIT 1
      `);
    } else {
      if (!rule.table) throw new Error(`Reference rule ${rule.field} has no target table`);
      result = await db.execute(sql`
        SELECT 1 FROM ${sql.identifier(rule.table)}
        WHERE org_id = ${orgId} AND id = ${referenceId} AND archived_at IS NULL
        LIMIT 1
      `);
    }
    if (isMissing(result)) {
      throw new DomainError(
        "VALIDATION_FAILED",
        `${rule.field} does not belong to the active organization`,
        400,
      );
    }
  }
}
