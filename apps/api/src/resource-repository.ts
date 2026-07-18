import { randomUUID } from "node:crypto";
import type { ResourceName } from "@fiatlux/contracts";
import { auditEvents, type Database } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { sql } from "drizzle-orm";

import type { RequestAuditContext } from "./types.js";

const resourceTableNames: Record<ResourceName, string> = {
  objectives: "objectives",
  projects: "projects",
  tasks: "tasks",
  decisions: "decisions",
  obligations: "obligations",
  "compliance-items": "compliance_items",
  "compliance-events": "compliance_events",
  risks: "risks",
  contracts: "contracts",
  "financial-entries": "financial_entries",
  invoices: "invoices",
  "cash-flow": "cash_flow_entries",
  products: "products",
  opportunities: "opportunities",
  "github-insights": "github_insights",
  notifications: "notifications",
  "workflow-definitions": "workflow_definitions",
  "workflow-runs": "workflow_runs",
};

const resourceSearchColumns: Record<ResourceName, string> = {
  objectives: "title",
  projects: "name",
  tasks: "title",
  decisions: "title",
  obligations: "title",
  "compliance-items": "title",
  "compliance-events": "title",
  risks: "title",
  contracts: "name",
  "financial-entries": "description",
  invoices: "counterparty",
  "cash-flow": "description",
  products: "name",
  opportunities: "title",
  "github-insights": "summary",
  notifications: "title",
  "workflow-definitions": "name",
  "workflow-runs": "status",
};

const jsonColumns = new Set(["payload", "steps", "input", "output"]);

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelCase(key), value]));
}

function rows(result: Iterable<Record<string, unknown>>) {
  return Array.from(result, normalizeRow);
}

function valueExpression(column: string, value: unknown) {
  if (jsonColumns.has(column)) return sql`${JSON.stringify(value)}::jsonb`;
  return sql`${value}`;
}

function tableIdentifier(resource: ResourceName) {
  return sql.identifier(resourceTableNames[resource]);
}

function auditValues(
  context: RequestAuditContext,
  event: {
    action: string;
    resourceType: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
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
    metadata: {},
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}

export class ResourceRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async list(
    resource: ResourceName,
    input: {
      orgId: string;
      page: number;
      pageSize: number;
      search?: string;
      status?: string;
      category?: string;
    },
  ) {
    const table = tableIdentifier(resource);
    const searchColumn = sql.identifier(resourceSearchColumns[resource]);
    const searchFilter = input.search
      ? sql` AND COALESCE(${searchColumn}::text, '') ILIKE ${`%${input.search}%`}`
      : sql``;
    const statusFilter = input.status ? sql` AND status = ${input.status}` : sql``;
    const categoryFilter = input.category ? sql` AND category = ${input.category}` : sql``;
    const offset = (input.page - 1) * input.pageSize;
    const result = await this.#db.execute(sql`
      SELECT * FROM ${table}
      WHERE org_id = ${input.orgId} AND archived_at IS NULL${searchFilter}${statusFilter}${categoryFilter}
      ORDER BY created_at DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `);
    const countResult = await this.#db.execute(sql`
      SELECT COUNT(*)::integer AS total FROM ${table}
      WHERE org_id = ${input.orgId} AND archived_at IS NULL${searchFilter}${statusFilter}${categoryFilter}
    `);
    const countRows = rows(countResult);
    return { items: rows(result), total: Number(countRows[0]?.total ?? 0) };
  }

  async get(resource: ResourceName, orgId: string, id: string) {
    const result = await this.#db.execute(sql`
      SELECT * FROM ${tableIdentifier(resource)}
      WHERE org_id = ${orgId} AND id = ${id} AND archived_at IS NULL
      LIMIT 1
    `);
    const record = rows(result)[0];
    if (!record) {
      throw new DomainError("NOT_FOUND", `${resource} record not found`, 404);
    }
    return record;
  }

  async create(
    resource: ResourceName,
    orgId: string,
    input: Record<string, unknown>,
    context: RequestAuditContext,
  ) {
    const id = randomUUID();
    const entries = Object.entries(input).filter(([, value]) => value !== undefined);
    const columns = [
      sql.identifier("id"),
      sql.identifier("org_id"),
      ...entries.map(([key]) => sql.identifier(snakeCase(key))),
    ];
    const values = [
      sql`${id}`,
      sql`${orgId}`,
      ...entries.map(([key, value]) => valueExpression(snakeCase(key), value)),
    ];

    return this.#db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO ${tableIdentifier(resource)} (${sql.join(columns, sql`, `)})
        VALUES (${sql.join(values, sql`, `)})
        RETURNING *
      `);
      const record = rows(result)[0];
      if (!record) throw new Error(`Failed to create ${resource}`);
      await tx.insert(auditEvents).values(
        auditValues(context, {
          action: "create",
          resourceType: resource,
          resourceId: id,
          after: record,
        }),
      );
      return record;
    });
  }

  async update(
    resource: ResourceName,
    orgId: string,
    id: string,
    patch: Record<string, unknown>,
    expectedVersion: number,
    context: RequestAuditContext,
  ) {
    const previous = await this.get(resource, orgId, id);
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return previous;
    const assignments = entries.map(([key, value]) => {
      const column = snakeCase(key);
      return sql`${sql.identifier(column)} = ${valueExpression(column, value)}`;
    });

    return this.#db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE ${tableIdentifier(resource)}
        SET ${sql.join(assignments, sql`, `)}, updated_at = NOW(), version = version + 1
        WHERE org_id = ${orgId} AND id = ${id} AND archived_at IS NULL AND version = ${expectedVersion}
        RETURNING *
      `);
      const record = rows(result)[0];
      if (!record) {
        throw new DomainError("CONFLICT", "The record changed since it was loaded", 409, {
          expectedVersion,
        });
      }
      await tx.insert(auditEvents).values(
        auditValues(context, {
          action: "update",
          resourceType: resource,
          resourceId: id,
          before: previous,
          after: record,
        }),
      );
      return record;
    });
  }

  async archive(
    resource: ResourceName,
    orgId: string,
    id: string,
    expectedVersion: number,
    context: RequestAuditContext,
  ) {
    const previous = await this.get(resource, orgId, id);
    return this.#db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE ${tableIdentifier(resource)}
        SET archived_at = NOW(), updated_at = NOW(), version = version + 1
        WHERE org_id = ${orgId} AND id = ${id} AND archived_at IS NULL AND version = ${expectedVersion}
        RETURNING *
      `);
      const record = rows(result)[0];
      if (!record) throw new DomainError("CONFLICT", "The record changed since it was loaded", 409);
      await tx.insert(auditEvents).values(
        auditValues(context, {
          action: "archive",
          resourceType: resource,
          resourceId: id,
          before: previous,
          after: record,
        }),
      );
      return record;
    });
  }
}

export function requestAuditContext(request: {
  id: string;
  ip: string;
  headers: { [key: string]: string | string[] | undefined };
  auth: { orgId: string; userId: string };
}): RequestAuditContext {
  const userAgent = request.headers["user-agent"];
  return {
    orgId: request.auth.orgId,
    actorUserId: request.auth.userId,
    requestId: request.id,
    ipAddress: request.ip,
    ...(typeof userAgent === "string" ? { userAgent } : {}),
  };
}
