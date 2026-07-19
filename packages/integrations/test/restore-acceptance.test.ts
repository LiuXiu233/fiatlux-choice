import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pgBossEntry = require.resolve("pg-boss");
const pgBossVersion = JSON.parse(
  readFileSync(join(dirname(pgBossEntry), "..", "version.json"), "utf8"),
) as { schema: number };
const restoreAcceptance = JSON.parse(
  readFileSync(new URL("../../db/restore-acceptance.json", import.meta.url), "utf8"),
) as { pgBossSchemaVersion: number };

describe("restore acceptance contract", () => {
  it("tracks the pg-boss dependency schema version exactly", () => {
    expect(restoreAcceptance.pgBossSchemaVersion).toBe(pgBossVersion.schema);
    expect(restoreAcceptance.pgBossSchemaVersion).toBe(24);
  });
});
