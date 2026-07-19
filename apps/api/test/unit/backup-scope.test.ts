import { describe, expect, it } from "vitest";

import { backupCreateSchema } from "../../src/admin-routes.js";

describe("backup queue contract", () => {
  it("defaults the web queue to its executable database-only worker", () => {
    expect(backupCreateSchema.parse({})).toMatchObject({ scope: "database" });
    expect(backupCreateSchema.parse({ scope: "database" })).toMatchObject({ scope: "database" });
  });

  it("rejects scopes that require the administrator full-backup CLI", () => {
    expect(() => backupCreateSchema.parse({ scope: "files" })).toThrow();
    expect(() => backupCreateSchema.parse({ scope: "full" })).toThrow();
  });
});
