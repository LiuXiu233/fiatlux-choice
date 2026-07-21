import { describe, expect, it } from "vitest";

import { readSeedConfig } from "../src/seed-config.js";

describe("database seed config", () => {
  it("accepts the root environment initial-admin names for direct local seeding", () => {
    const config = readSeedConfig({
      SEED_MODE: "bootstrap",
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
      SEED_MODE: "bootstrap",
      BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test",
      BOOTSTRAP_ADMIN_PASSWORD: "bootstrap-password-long-enough",
      INITIAL_ADMIN_EMAIL: "initial@example.test",
      INITIAL_ADMIN_PASSWORD: "initial-password-long-enough",
    });
    expect(config.BOOTSTRAP_ADMIN_EMAIL).toBe("bootstrap@example.test");
    expect(config.BOOTSTRAP_ADMIN_PASSWORD).toBe("bootstrap-password-long-enough");
  });

  it("accepts an explicit compliance source path and treats a blank path as the default", () => {
    expect(
      readSeedConfig({
        SEED_MODE: "bootstrap",
        BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test",
        BOOTSTRAP_ADMIN_PASSWORD: "bootstrap-password-long-enough",
        COMPLIANCE_SOURCES_FILE: "/run/seed/official-sources.json",
      }).COMPLIANCE_SOURCES_FILE,
    ).toBe("/run/seed/official-sources.json");

    expect(
      readSeedConfig({
        SEED_MODE: "metadata-only",
        BOOTSTRAP_ORG_SLUG: "existing-company",
        COMPLIANCE_SOURCES_FILE: "   ",
      }).COMPLIANCE_SOURCES_FILE,
    ).toBeUndefined();
  });

  it("requires an explicit seed mode", () => {
    expect(() =>
      readSeedConfig({
        BOOTSTRAP_ADMIN_EMAIL: "bootstrap@example.test",
        BOOTSTRAP_ADMIN_PASSWORD: "bootstrap-password-long-enough",
      }),
    ).toThrow();
  });

  it("accepts metadata-only without reading bootstrap identity secrets", () => {
    expect(
      readSeedConfig({
        SEED_MODE: "metadata-only",
        BOOTSTRAP_ORG_SLUG: "existing-company",
      }),
    ).toEqual({
      SEED_MODE: "metadata-only",
      BOOTSTRAP_ORG_SLUG: "existing-company",
      COMPLIANCE_SOURCES_REQUIRED: false,
    });

    expect(() =>
      readSeedConfig({
        SEED_MODE: "metadata-only",
        BOOTSTRAP_ORG_SLUG: "existing-company",
        INITIAL_ADMIN_PASSWORD: "placeholder-password-must-not-be-accepted",
      }),
    ).toThrow();
  });

  it("requires complete traceability metadata and no bootstrap secret for system-role maintenance", () => {
    expect(() =>
      readSeedConfig({
        SEED_MODE: "system-role-maintenance",
        BOOTSTRAP_ORG_SLUG: "existing-company",
        SEED_MAINTENANCE_OPERATOR_EMAIL: "owner@example.test",
      }),
    ).toThrow();

    expect(
      readSeedConfig({
        SEED_MODE: "system-role-maintenance",
        BOOTSTRAP_ORG_SLUG: "existing-company",
        SEED_MAINTENANCE_OPERATOR_EMAIL: "owner@example.test",
        SEED_MAINTENANCE_REASON: "Apply approved permission baseline update",
        SEED_MAINTENANCE_APPROVAL_REFERENCE: "CHANGE-2026-0042",
        SEED_MAINTENANCE_REQUEST_ID: "seed-maintenance-2026-0042",
      }),
    ).toMatchObject({
      SEED_MODE: "system-role-maintenance",
      BOOTSTRAP_ORG_SLUG: "existing-company",
      SEED_MAINTENANCE_OPERATOR_EMAIL: "owner@example.test",
      SEED_MAINTENANCE_APPROVAL_REFERENCE: "CHANGE-2026-0042",
      SEED_MAINTENANCE_REQUEST_ID: "seed-maintenance-2026-0042",
    });

    expect(() =>
      readSeedConfig({
        SEED_MODE: "system-role-maintenance",
        BOOTSTRAP_ORG_SLUG: "existing-company",
        INITIAL_ADMIN_PASSWORD: "placeholder-password-must-not-be-accepted",
        SEED_MAINTENANCE_OPERATOR_EMAIL: "owner@example.test",
        SEED_MAINTENANCE_REASON: "Apply approved permission baseline update",
        SEED_MAINTENANCE_APPROVAL_REFERENCE: "CHANGE-2026-0042",
        SEED_MAINTENANCE_REQUEST_ID: "seed-maintenance-2026-0042",
      }),
    ).toThrow();
  });
});
