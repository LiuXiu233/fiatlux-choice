import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  OWNER_RECOVERY_MFA_RESET_CONFIRMATION,
  OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
} from "../src/owner-recovery.js";
import { readOwnerRecoveryConfig } from "../src/owner-recovery-config.js";
import { readSingleLineSecret } from "../src/stdin-secret.js";

const validEnvironment = {
  OWNER_RECOVERY_ORG_SLUG: "fiat-lux",
  OWNER_RECOVERY_EMAIL: "owner@example.test",
  OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
  OWNER_RECOVERY_MFA_RESET_CONFIRMATION,
  OWNER_RECOVERY_REASON: "Recover the sole owner after documented identity verification",
  OWNER_RECOVERY_APPROVAL_REFERENCE: "CHANGE-2026-0043",
  OWNER_RECOVERY_REQUEST_ID: "owner-recovery-2026-0043",
};

describe("offline owner recovery input boundaries", () => {
  it("requires production confirmation, reason, approval reference and request ID", () => {
    expect(readOwnerRecoveryConfig(validEnvironment)).toEqual(validEnvironment);
    expect(() =>
      readOwnerRecoveryConfig({
        ...validEnvironment,
        OWNER_RECOVERY_PRODUCTION_CONFIRMATION: "yes",
      }),
    ).toThrow();
    expect(() =>
      readOwnerRecoveryConfig({
        ...validEnvironment,
        OWNER_RECOVERY_MFA_RESET_CONFIRMATION: "yes",
      }),
    ).toThrow();
    expect(() =>
      readOwnerRecoveryConfig({
        ...validEnvironment,
        OWNER_RECOVERY_APPROVAL_REFERENCE: "",
      }),
    ).toThrow();
  });

  it("rejects password environment variables and non-normalized owner email", () => {
    expect(() =>
      readOwnerRecoveryConfig({
        ...validEnvironment,
        OWNER_RECOVERY_PASSWORD: "must-never-be-read-from-env",
      }),
    ).toThrow(/forbidden in environment variables/);
    expect(() =>
      readOwnerRecoveryConfig({
        ...validEnvironment,
        OWNER_RECOVERY_EMAIL: "Owner@example.test",
      }),
    ).toThrow(/normalized to lowercase/);
  });

  it("reads exactly one secret line from stdin without trimming password characters", async () => {
    await expect(
      readSingleLineSecret(Readable.from(["  temporary-owner-password  \n"])),
    ).resolves.toBe("  temporary-owner-password  ");
    await expect(readSingleLineSecret(Readable.from(["first\nsecond\n"]))).rejects.toThrow(
      /exactly one/,
    );
    await expect(readSingleLineSecret(Readable.from(["\n"]))).rejects.toThrow(/empty/);
  });
});
