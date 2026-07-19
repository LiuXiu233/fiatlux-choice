import type { ResourceName } from "@fiatlux/contracts";
import type { Database } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { sql } from "drizzle-orm";

export type ReferenceValidationExecutor = Pick<Database, "execute">;

interface ReferenceRule {
  field: string;
  table?: string;
  userMembership?: boolean;
  uploadedFile?: boolean;
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
  decisions: [
    { field: "objectiveId", table: "objectives" },
    { field: "projectId", table: "projects" },
    { field: "taskId", table: "tasks" },
  ],
  obligations: [
    { field: "ownerId", userMembership: true },
    { field: "sourceId", table: "compliance_items" },
    { field: "evidenceFileId", table: "files", uploadedFile: true },
  ],
  "compliance-events": [
    { field: "sourceId", table: "compliance_items" },
    { field: "evidenceFileId", table: "files", uploadedFile: true },
    { field: "ownerId", userMembership: true },
  ],
  risks: [{ field: "ownerId", userMembership: true }],
  contracts: [
    { field: "fileId", table: "files", uploadedFile: true },
    { field: "ownerId", userMembership: true },
  ],
  // externalActionId is a system-managed relationship.  It is intentionally
  // not accepted as a normal resource reference: only the bank-payment
  // approval workflow may bind/unbind it after validating its target snapshot.
  invoices: [{ field: "fileId", table: "files", uploadedFile: true }],
  products: [
    { field: "projectId", table: "projects" },
    { field: "ownerId", userMembership: true },
  ],
  opportunities: [
    { field: "productId", table: "products" },
    { field: "projectId", table: "projects" },
    { field: "ownerId", userMembership: true },
  ],
  notifications: [{ field: "recipientId", userMembership: true }],
  "workflow-runs": [
    { field: "definitionId", table: "workflow_definitions" },
    { field: "requestedBy", userMembership: true },
  ],
};

function isMissing(result: Iterable<unknown>) {
  return !Array.from(result).length;
}

function effectiveReferenceId(
  input: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | undefined,
  field: string,
) {
  const value = Object.hasOwn(input, field) ? input[field] : current?.[field];
  return typeof value === "string" ? value : undefined;
}

async function assertRelation(
  db: ReferenceValidationExecutor,
  query: ReturnType<typeof sql>,
  message: string,
) {
  if (!isMissing(await db.execute(query))) return;
  throw new DomainError("VALIDATION_FAILED", message, 400);
}

async function assertDecisionChain(
  db: ReferenceValidationExecutor,
  orgId: string,
  input: Readonly<Record<string, unknown>>,
  current?: Readonly<Record<string, unknown>>,
) {
  const objectiveId = effectiveReferenceId(input, current, "objectiveId");
  const projectId = effectiveReferenceId(input, current, "projectId");
  const taskId = effectiveReferenceId(input, current, "taskId");

  if (objectiveId && projectId && taskId) {
    await assertRelation(
      db,
      sql`
        SELECT 1
        FROM tasks t
        JOIN projects p
          ON p.id = t.project_id AND p.org_id = t.org_id AND p.archived_at IS NULL
        JOIN objectives o
          ON o.id = p.objective_id AND o.org_id = p.org_id AND o.archived_at IS NULL
        WHERE t.org_id = ${orgId}
          AND t.id = ${taskId}
          AND t.project_id = ${projectId}
          AND p.objective_id = ${objectiveId}
          AND t.archived_at IS NULL
        LIMIT 1
        FOR SHARE OF t, p, o
      `,
      "objectiveId, projectId, and taskId must form one active objective-project-task chain",
    );
    return;
  }

  if (objectiveId && projectId) {
    await assertRelation(
      db,
      sql`
        SELECT 1
        FROM projects p
        JOIN objectives o
          ON o.id = p.objective_id AND o.org_id = p.org_id AND o.archived_at IS NULL
        WHERE p.org_id = ${orgId}
          AND p.id = ${projectId}
          AND p.objective_id = ${objectiveId}
          AND p.archived_at IS NULL
        LIMIT 1
        FOR SHARE OF p, o
      `,
      "projectId must reference a project in objectiveId",
    );
  }

  if (projectId && taskId) {
    await assertRelation(
      db,
      sql`
        SELECT 1
        FROM tasks t
        JOIN projects p
          ON p.id = t.project_id AND p.org_id = t.org_id AND p.archived_at IS NULL
        WHERE t.org_id = ${orgId}
          AND t.id = ${taskId}
          AND t.project_id = ${projectId}
          AND t.archived_at IS NULL
        LIMIT 1
        FOR SHARE OF t, p
      `,
      "taskId must reference a task in projectId",
    );
  }

  if (objectiveId && taskId) {
    await assertRelation(
      db,
      sql`
        SELECT 1
        FROM tasks t
        JOIN projects p
          ON p.id = t.project_id AND p.org_id = t.org_id AND p.archived_at IS NULL
        JOIN objectives o
          ON o.id = p.objective_id AND o.org_id = p.org_id AND o.archived_at IS NULL
        WHERE t.org_id = ${orgId}
          AND t.id = ${taskId}
          AND p.objective_id = ${objectiveId}
          AND t.archived_at IS NULL
        LIMIT 1
        FOR SHARE OF t, p, o
      `,
      "taskId must reference a task whose project belongs to objectiveId",
    );
  }
}

async function assertOpportunityChain(
  db: ReferenceValidationExecutor,
  orgId: string,
  input: Readonly<Record<string, unknown>>,
  current?: Readonly<Record<string, unknown>>,
) {
  const productId = effectiveReferenceId(input, current, "productId");
  const projectId = effectiveReferenceId(input, current, "projectId");
  if (!productId || !projectId) return;

  await assertRelation(
    db,
    sql`
      SELECT 1
      FROM products product
      JOIN projects project
        ON project.id = product.project_id
          AND project.org_id = product.org_id
          AND project.archived_at IS NULL
      WHERE product.org_id = ${orgId}
        AND product.id = ${productId}
        AND product.project_id = ${projectId}
        AND product.archived_at IS NULL
      LIMIT 1
      FOR SHARE OF product, project
    `,
    "productId and projectId must reference the same active project chain",
  );
}

function referenceChanged(
  input: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  field: string,
) {
  return Object.hasOwn(input, field) && input[field] !== current[field];
}

function nullableReferenceId(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function assertReferenceChainMutationSafe(
  db: ReferenceValidationExecutor,
  orgId: string,
  resource: ResourceName,
  resourceId: string,
  patch: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
) {
  if (resource === "projects" && referenceChanged(patch, current, "objectiveId")) {
    const nextObjectiveId = nullableReferenceId(patch.objectiveId);
    const conflict = await db.execute(sql`
      SELECT 1
      FROM decisions d
      LEFT JOIN tasks t
        ON t.id = d.task_id AND t.org_id = d.org_id AND t.archived_at IS NULL
      WHERE d.org_id = ${orgId}
        AND d.archived_at IS NULL
        AND d.objective_id IS NOT NULL
        AND (d.project_id = ${resourceId} OR t.project_id = ${resourceId})
        AND d.objective_id IS DISTINCT FROM ${nextObjectiveId}
      LIMIT 1
    `);
    if (!isMissing(conflict)) {
      throw new DomainError(
        "CONFLICT",
        "Project objective cannot change while active decisions depend on the existing chain",
        409,
      );
    }
  }

  if (resource === "tasks" && referenceChanged(patch, current, "projectId")) {
    const nextProjectId = nullableReferenceId(patch.projectId);
    let nextObjectiveId: string | null = null;
    if (nextProjectId) {
      const rows = Array.from(
        await db.execute(sql`
          SELECT objective_id
          FROM projects
          WHERE org_id = ${orgId} AND id = ${nextProjectId} AND archived_at IS NULL
          LIMIT 1
          FOR SHARE
        `),
      ) as Array<Record<string, unknown>>;
      nextObjectiveId = nullableReferenceId(rows[0]?.objective_id);
    }
    const conflict = await db.execute(sql`
      SELECT 1
      FROM decisions
      WHERE org_id = ${orgId}
        AND archived_at IS NULL
        AND task_id = ${resourceId}
        AND (
          (project_id IS NOT NULL AND project_id IS DISTINCT FROM ${nextProjectId})
          OR (objective_id IS NOT NULL AND objective_id IS DISTINCT FROM ${nextObjectiveId})
        )
      LIMIT 1
    `);
    if (!isMissing(conflict)) {
      throw new DomainError(
        "CONFLICT",
        "Task project cannot change while active decisions depend on the existing chain",
        409,
      );
    }
  }

  if (resource === "products" && referenceChanged(patch, current, "projectId")) {
    const nextProjectId = nullableReferenceId(patch.projectId);
    const conflict = await db.execute(sql`
      SELECT 1
      FROM opportunities
      WHERE org_id = ${orgId}
        AND archived_at IS NULL
        AND product_id = ${resourceId}
        AND project_id IS NOT NULL
        AND project_id IS DISTINCT FROM ${nextProjectId}
      LIMIT 1
    `);
    if (!isMissing(conflict)) {
      throw new DomainError(
        "CONFLICT",
        "Product project cannot change while active opportunities depend on the existing chain",
        409,
      );
    }
  }
}

interface ActiveDependentRule {
  table: string;
  field: string;
  label: string;
}

const activeDependentRules: Partial<Record<ResourceName, readonly ActiveDependentRule[]>> = {
  objectives: [
    { table: "projects", field: "objective_id", label: "projects" },
    { table: "decisions", field: "objective_id", label: "decisions" },
  ],
  projects: [
    { table: "tasks", field: "project_id", label: "tasks" },
    { table: "decisions", field: "project_id", label: "decisions" },
    { table: "products", field: "project_id", label: "products" },
    { table: "opportunities", field: "project_id", label: "opportunities" },
  ],
  tasks: [{ table: "decisions", field: "task_id", label: "decisions" }],
  products: [{ table: "opportunities", field: "product_id", label: "opportunities" }],
};

export async function assertNoActiveResourceDependents(
  db: ReferenceValidationExecutor,
  orgId: string,
  resource: ResourceName,
  resourceId: string,
) {
  for (const rule of activeDependentRules[resource] ?? []) {
    const result = await db.execute(sql`
      SELECT 1
      FROM ${sql.identifier(rule.table)}
      WHERE org_id = ${orgId}
        AND ${sql.identifier(rule.field)} = ${resourceId}
        AND archived_at IS NULL
      LIMIT 1
      FOR SHARE
    `);
    if (!isMissing(result)) {
      throw new DomainError(
        "CONFLICT",
        `Cannot archive ${resource} while active ${rule.label} reference it`,
        409,
      );
    }
  }
}

export async function assertResourceReferences(
  db: ReferenceValidationExecutor,
  orgId: string,
  resource: ResourceName,
  input: Record<string, unknown>,
  current?: Readonly<Record<string, unknown>>,
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
        FOR SHARE
      `);
    } else {
      if (!rule.table) throw new Error(`Reference rule ${rule.field} has no target table`);
      const uploadedFilter = rule.uploadedFile ? sql` AND upload_status = 'uploaded'` : sql``;
      result = await db.execute(sql`
        SELECT 1 FROM ${sql.identifier(rule.table)}
        WHERE org_id = ${orgId} AND id = ${referenceId} AND archived_at IS NULL${uploadedFilter}
        LIMIT 1
        FOR SHARE
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

  if (resource === "decisions") {
    await assertDecisionChain(db, orgId, input, current);
  } else if (resource === "opportunities") {
    await assertOpportunityChain(db, orgId, input, current);
  }
}
