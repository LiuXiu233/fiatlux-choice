import { existsSync, readFileSync } from "node:fs";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../src/schema.js";
import {
  complianceItems,
  decisions,
  opportunities,
  products,
  resourceTables,
} from "../src/schema.js";
import { SYSTEM_ROLE_PERMISSIONS } from "../src/seed.js";

const restoreAcceptance = JSON.parse(
  readFileSync(new URL("../restore-acceptance.json", import.meta.url), "utf8"),
) as {
  formatVersion: number;
  publicTables: string[];
  pgBossSchemaVersion: number;
};
const migrationJournal = JSON.parse(
  readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

describe("database schema invariants", () => {
  it("keeps the versioned restore table contract synchronized with exported Drizzle tables", () => {
    const actualTables = [
      ...new Set(
        Object.values(schema)
          .filter((value) => is(value, PgTable))
          .map((table) => getTableName(table as PgTable)),
      ),
    ].sort();

    expect(restoreAcceptance.formatVersion).toBe(1);
    expect(restoreAcceptance.publicTables).toEqual([...restoreAcceptance.publicTables].sort());
    expect(new Set(restoreAcceptance.publicTables).size).toBe(
      restoreAcceptance.publicTables.length,
    );
    expect(restoreAcceptance.publicTables).toEqual(actualTables);
    expect(restoreAcceptance.publicTables).toHaveLength(38);
  });

  it("keeps the restore journal contiguous and backed by every 0000-0010 SQL file", () => {
    expect(migrationJournal.entries).toHaveLength(11);
    expect(migrationJournal.entries.map((entry) => entry.idx)).toEqual(
      Array.from({ length: 11 }, (_, index) => index),
    );
    for (const entry of migrationJournal.entries) {
      const prefix = entry.idx.toString().padStart(4, "0");
      expect(entry.tag).toMatch(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
      expect(entry.when).toBeGreaterThan(0);
      expect(existsSync(new URL(`../migrations/${entry.tag}.sql`, import.meta.url))).toBe(true);
    }
  });

  it("keeps professional review evidence and recorder provenance first-class", () => {
    const config = getTableConfig(complianceItems);
    expect(getTableColumns(complianceItems)).toMatchObject({
      reviewOutcome: expect.anything(),
      reviewerName: expect.anything(),
      reviewerQualification: expect.anything(),
      reviewMissingInformation: expect.anything(),
      reviewEvidenceFileId: expect.anything(),
      reviewedByUserId: expect.anything(),
      reviewedSourceVersion: expect.anything(),
      reviewedContentHash: expect.anything(),
    });
    expect(
      config.foreignKeys.find(
        (candidate) => candidate.reference().columns[0]?.name === "review_evidence_file_id",
      )?.onDelete,
    ).toBe("restrict");
    expect(
      config.foreignKeys.find(
        (candidate) => candidate.reference().columns[0]?.name === "reviewed_by_user_id",
      )?.onDelete,
    ).toBe("set null");
    expect(
      config.indexes.some((candidate) =>
        candidate.config.columns.some(
          (column) => "name" in column && column.name === "review_evidence_file_id",
        ),
      ),
    ).toBe(true);
  });

  it("scopes every generic business resource to an organization", () => {
    for (const [resource, table] of Object.entries(resourceTables)) {
      expect(getTableColumns(table), `${resource} must have org_id`).toHaveProperty("orgId");
    }
  });

  it("keeps typed business references nullable, set-null, and organization-indexed", () => {
    const expectedReferences = [
      [decisions, ["objective_id", "project_id", "task_id"]],
      [products, ["project_id"]],
      [opportunities, ["product_id", "project_id"]],
    ] as const;

    for (const [table, referenceColumns] of expectedReferences) {
      const config = getTableConfig(table);
      for (const columnName of referenceColumns) {
        const column = config.columns.find((candidate) => candidate.name === columnName);
        expect(column, `${config.name}.${columnName} must exist`).toBeDefined();
        expect(column?.notNull, `${config.name}.${columnName} must remain nullable`).toBe(false);

        const foreignKey = config.foreignKeys.find(
          (candidate) => candidate.reference().columns[0]?.name === columnName,
        );
        expect(foreignKey, `${config.name}.${columnName} must have a foreign key`).toBeDefined();
        expect(foreignKey?.onDelete).toBe("set null");

        const hasScopedIndex = config.indexes.some((candidate) => {
          const indexedColumnNames = candidate.config.columns.map((indexedColumn) =>
            "name" in indexedColumn ? indexedColumn.name : undefined,
          );
          return indexedColumnNames[0] === "org_id" && indexedColumnNames[1] === columnName;
        });
        expect(hasScopedIndex, `${config.name}.${columnName} must have an org-scoped index`).toBe(
          true,
        );
      }
    }
  });

  it("gives only the owner global wildcard permission", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner).toEqual(["*"]);
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain("*");
    expect(SYSTEM_ROLE_PERMISSIONS.member).not.toContain("*");
    expect(SYSTEM_ROLE_PERMISSIONS.viewer).not.toContain("*");
  });

  it("keeps critical operational domains explicit in the admin role", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toEqual(
      expect.arrayContaining([
        "approvals:*",
        "external-actions:*",
        "audit-events:read",
        "backups:*",
      ]),
    );
  });

  it("lets members create files without granting global metadata updates", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member).toEqual(
      expect.arrayContaining(["files:read", "files:create"]),
    );
    expect(SYSTEM_ROLE_PERMISSIONS.member).not.toContain("files:update");
  });
});
