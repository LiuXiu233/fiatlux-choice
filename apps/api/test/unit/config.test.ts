import { describe, expect, it } from "vitest";

import { apiConfigSchema, readApiConfig } from "../../src/config.js";

describe("API config", () => {
  it("treats blank optional integration values as absent", () => {
    const config = apiConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
      S3_ENDPOINT: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
      LLM_BASE_URL: "",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      LLM_DRIVER: "mock",
      GITHUB_TOKEN: "",
    });
    expect(config.S3_ENDPOINT).toBeUndefined();
    expect(config.S3_ACCESS_KEY_ID).toBeUndefined();
    expect(config.LLM_BASE_URL).toBeUndefined();
    expect(config.LLM_MODEL).toBe("gpt-5-mini");
    expect(config.LLM_DRIVER).toBe("mock");
    expect(config.GITHUB_TOKEN).toBeUndefined();
  });

  it("rejects short JWT secrets", () => {
    expect(() =>
      apiConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        JWT_SECRET: "short",
      }),
    ).toThrow();
  });

  it("accepts the root environment session aliases for direct local startup", () => {
    const config = readApiConfig({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      APP_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "a-secure-session-secret-that-is-long-enough",
      SESSION_TTL_HOURS: "12",
      TRUST_PROXY: "true",
    });
    expect(config.WEB_ORIGIN).toBe("http://localhost:5173");
    expect(config.JWT_SECRET).toBe("a-secure-session-secret-that-is-long-enough");
    expect(config.JWT_TTL_SECONDS).toBe(43_200);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it("normalizes default HTTPS ports to the browser Origin serialization", () => {
    const defaultHttps = apiConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
      WEB_ORIGIN: "https://choice.internal.example:443",
    });
    const nonDefaultHttps = apiConfigSchema.parse({
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
      WEB_ORIGIN: "https://choice.internal.example:8443",
    });
    expect(defaultHttps.WEB_ORIGIN).toBe("https://choice.internal.example");
    expect(nonDefaultHttps.WEB_ORIGIN).toBe("https://choice.internal.example:8443");
  });

  it("requires credentials only for the compatible LLM driver", () => {
    expect(() =>
      apiConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
        LLM_DRIVER: "compatible",
      }),
    ).toThrow(/LLM_DRIVER=compatible/);
    expect(
      apiConfigSchema.parse({
        DATABASE_URL: "postgresql://user:password@localhost:5432/database",
        JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
        LLM_DRIVER: "mock",
      }).LLM_DRIVER,
    ).toBe("mock");
  });

  it("requires HTTPS for a compatible LLM endpoint", () => {
    const compatibleConfig = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:password@localhost:5432/database",
      JWT_SECRET: "a-secure-test-secret-that-is-long-enough",
      LLM_DRIVER: "compatible",
      LLM_API_KEY: "test-provider-key",
    } as const;

    expect(() =>
      apiConfigSchema.parse({
        ...compatibleConfig,
        LLM_BASE_URL: "http://llm.example.test",
      }),
    ).toThrow(/LLM_BASE_URL must use HTTPS/);
    expect(
      apiConfigSchema.parse({
        ...compatibleConfig,
        LLM_BASE_URL: "https://llm.example.test",
      }).LLM_BASE_URL,
    ).toBe("https://llm.example.test");
  });
});
