import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { resourceTables } from "../src/schema.js";
import { SYSTEM_ROLE_PERMISSIONS } from "../src/seed.js";

describe("database schema invariants", () => {
  it("scopes every generic business resource to an organization", () => {
    for (const [resource, table] of Object.entries(resourceTables)) {
      expect(getTableColumns(table), `${resource} must have org_id`).toHaveProperty("orgId");
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
