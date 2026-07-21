import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildOtpAuthUri,
  createTotpCode,
  decodeBase32,
  decryptMfaSecret,
  encodeBase32,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode,
} from "../../src/mfa.js";

const testConfig = {
  NODE_ENV: "test" as const,
  JWT_SECRET: "mfa-unit-test-session-secret-longer-than-32-characters",
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
  MFA_ENCRYPTION_KEY_ID: "test-v1",
};

describe("MFA cryptographic boundaries", () => {
  it("round-trips unpadded Base32 without accepting malformed input", () => {
    const bytes = Buffer.from("12345678901234567890123456789012", "ascii");
    const encoded = encodeBase32(bytes);
    expect(decodeBase32(encoded)).toEqual(bytes);
    expect(() => decodeBase32("not*base32")).toThrow(/Base32/);
  });

  it("matches the RFC 6238 SHA-256 vector reduced to six digits", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890123456789012", "ascii"));
    expect(createTotpCode(secret, 59_000)).toBe("119246");
  });

  it("accepts bounded clock skew and rejects a replayed counter", () => {
    const secret = encodeBase32(randomBytes(20));
    const now = 1_784_563_200_000;
    const priorCode = createTotpCode(secret, now - 30_000);
    const counter = verifyTotpCode({ secret, code: priorCode, lastUsedCounter: null, now });
    expect(counter).toBe(Math.floor((now - 30_000) / 30_000));
    expect(verifyTotpCode({ secret, code: priorCode, lastUsedCounter: counter, now })).toBeNull();
    expect(verifyTotpCode({ secret, code: "000000", lastUsedCounter: null, now })).toBeNull();
  });

  it("encrypts secrets with authenticated context and rejects tampering or the wrong key id", () => {
    const secret = encodeBase32(randomBytes(20));
    const encrypted = encryptMfaSecret(secret, testConfig);
    expect(encrypted.secretCiphertext).not.toContain(secret);
    expect(decryptMfaSecret(encrypted, testConfig)).toBe(secret);
    expect(() =>
      decryptMfaSecret(
        { ...encrypted, secretCiphertext: `${encrypted.secretCiphertext.slice(0, -1)}A` },
        testConfig,
      ),
    ).toThrow();
    expect(() =>
      decryptMfaSecret(encrypted, { ...testConfig, MFA_ENCRYPTION_KEY_ID: "test-v2" }),
    ).toThrow(/key id/);
  });

  it("generates one-time recovery codes with stable normalization and high entropy", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^FLX(?:-[A-Z2-7]{4}){4}$/u);
      expect(normalizeRecoveryCode(code.toLowerCase())).toBe(code.replaceAll("-", ""));
      expect(hashRecoveryCode(code)).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(hashRecoveryCode("FLX-invalid")).toBeNull();
  });

  it("builds a standards-based issuer-bound provisioning URI without credentials", () => {
    const uri = new URL(buildOtpAuthUri("owner@example.test", "JBSWY3DPEHPK3PXP"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.pathname).toContain("FIAT%20LUX%20CHOICE%3Aowner%40example.test");
    expect(uri.searchParams.get("issuer")).toBe("FIAT LUX CHOICE");
    expect(uri.searchParams.get("algorithm")).toBe("SHA256");
    expect(uri.username).toBe("");
    expect(uri.password).toBe("");
  });
});
