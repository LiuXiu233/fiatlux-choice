import { describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";

describe("worker config", () => {
  it("treats empty optional credentials as unconfigured", () => {
    const config = workerConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      LLM_BASE_URL: "",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      GITHUB_TOKEN: "",
      BACKUP_COMMAND: "",
    });
    expect(config.LLM_BASE_URL).toBeUndefined();
    expect(config.LLM_MODEL).toBe("gpt-5-mini");
    expect(config.LLM_API_KEY).toBeUndefined();
    expect(config.GITHUB_TOKEN).toBeUndefined();
    expect(config.GITHUB_INTEGRATION_MODE).toBe("manual");
    expect(config.BACKUP_COMMAND).toBeUndefined();
  });

  it("enables network-backed GitHub reads only when explicitly configured", () => {
    const config = workerConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      GITHUB_INTEGRATION_MODE: "read_only",
    });
    expect(config.GITHUB_INTEGRATION_MODE).toBe("read_only");
  });

  it("rejects an unconfigured compatible LLM driver", () => {
    expect(() =>
      workerConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        LLM_DRIVER: "compatible",
      }),
    ).toThrow(/LLM_DRIVER=compatible/);
  });
});
