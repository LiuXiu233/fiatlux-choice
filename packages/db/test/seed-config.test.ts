import { describe, expect, it } from "vitest";

import { readSeedConfig } from "../src/seed-config.js";

describe("database seed config", () => {
  it("accepts the root environment initial-admin names for direct local seeding", () => {
    const config = readSeedConfig({
      INITIAL_ADMIN_EMAIL: "admin@example.test",
      INITIAL_ADMIN_PASSWORD: "initial-password-long-enough",
    });
    expect(config).toMatchObject({
      BOOTSTRAP_ORG_NAME: "FIAT LUX",
      BOOTSTRAP_ORG_SLUG: "fiat-lux",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
      BOOTSTRAP_ADMIN_NAME: "Administrator",
      BOOTSTRAP_ADMIN_PASSWORD: "initial-password-long-enough",
    });
  });

  it("prefers explicit bootstrap values over compatibility aliases", () => {
    const config = readSeedConfig({
      BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test",
      BOOTSTRAP_ADMIN_PASSWORD: "bootstrap-password-long-enough",
      INITIAL_ADMIN_EMAIL: "initial@example.test",
      INITIAL_ADMIN_PASSWORD: "initial-password-long-enough",
    });
    expect(config.BOOTSTRAP_ADMIN_EMAIL).toBe("bootstrap@example.test");
    expect(config.BOOTSTRAP_ADMIN_PASSWORD).toBe("bootstrap-password-long-enough");
  });
});
