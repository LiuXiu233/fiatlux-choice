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
    expect(config.LLM_PROVIDER_ID).toBe("openai-compatible");
    expect(config.LLM_MAX_OUTPUT_TOKENS).toBe(2_048);
    expect(config.LLM_API_KEY).toBeUndefined();
    expect(config.GITHUB_TOKEN).toBeUndefined();
    expect(config.GITHUB_INTEGRATION_MODE).toBe("manual");
    expect(config.BACKUP_COMMAND).toBeUndefined();
    expect(config.DATABASE_POOL_SIZE).toBe(5);
    expect(config.DATABASE_CONNECT_TIMEOUT_SECONDS).toBe(10);
    expect(config.COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE).toBe(12);
  });

  it("bounds each organization's scheduled compliance monitoring batch", () => {
    const base = { DATABASE_URL: "postgresql://user:password@localhost:5432/database" };
    expect(() =>
      workerConfigSchema.parse({ ...base, COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE: 0 }),
    ).toThrow();
    expect(() =>
      workerConfigSchema.parse({ ...base, COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE: 251 }),
    ).toThrow();
    expect(
      workerConfigSchema.parse({ ...base, COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE: "24" })
        .COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE,
    ).toBe(24);
  });

  it("validates worker database pool settings", () => {
    const base = { DATABASE_URL: "postgresql://user:password@localhost:5432/database" };
    expect(() => workerConfigSchema.parse({ ...base, DATABASE_POOL_SIZE: 0 })).toThrow();
    expect(() =>
      workerConfigSchema.parse({ ...base, DATABASE_CONNECT_TIMEOUT_SECONDS: 0 }),
    ).toThrow();
    expect(
      workerConfigSchema.parse({
        ...base,
        DATABASE_POOL_SIZE: 4,
        DATABASE_CONNECT_TIMEOUT_SECONDS: 12,
      }),
    ).toMatchObject({ DATABASE_POOL_SIZE: 4, DATABASE_CONNECT_TIMEOUT_SECONDS: 12 });
  });

  it("enables network-backed GitHub reads only when explicitly configured", () => {
    const config = workerConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      GITHUB_INTEGRATION_MODE: "read_only",
      GITHUB_TOKEN: "test-read-only-token",
      GITHUB_PROBE_REPOSITORY: "owner/repository",
    });
    expect(config.GITHUB_INTEGRATION_MODE).toBe("read_only");
    expect(config.GITHUB_PROBE_REPOSITORY).toBe("owner/repository");

    expect(() =>
      workerConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        GITHUB_INTEGRATION_MODE: "read_only",
      }),
    ).toThrow(/GITHUB_TOKEN and GITHUB_PROBE_REPOSITORY/);
  });

  it("rejects an unconfigured compatible LLM driver", () => {
    expect(() =>
      workerConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        LLM_DRIVER: "compatible",
      }),
    ).toThrow(/LLM_DRIVER=compatible/);
  });

  it("requires HTTPS for a compatible LLM endpoint", () => {
    const compatibleConfig = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      LLM_DRIVER: "compatible",
      LLM_API_KEY: "test-provider-key",
    } as const;

    expect(() =>
      workerConfigSchema.parse({
        ...compatibleConfig,
        LLM_BASE_URL: "http://llm.example.test",
      }),
    ).toThrow(/LLM_BASE_URL must use HTTPS/);
    expect(
      workerConfigSchema.parse({
        ...compatibleConfig,
        LLM_BASE_URL: "https://llm.example.test",
        LLM_PROVIDER_ID: "approved-provider",
        LLM_MAX_OUTPUT_TOKENS: 4_096,
      }).LLM_BASE_URL,
    ).toBe("https://llm.example.test");
  });

  it("rejects unused integration secrets and bounds the model output budget", () => {
    const base = { DATABASE_URL: "postgresql://user:password@localhost:5432/database" };
    expect(() => workerConfigSchema.parse({ ...base, LLM_API_KEY: "unused" })).toThrow(
      /must be absent/,
    );
    expect(() => workerConfigSchema.parse({ ...base, GITHUB_TOKEN: "unused" })).toThrow(
      /must be absent/,
    );
    expect(() => workerConfigSchema.parse({ ...base, LLM_MAX_OUTPUT_TOKENS: 32_769 })).toThrow();
  });
});
