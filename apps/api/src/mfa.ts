import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_BYTES = 10;
const MFA_AAD_PREFIX = "fiatlux-choice:mfa-secret:v1";

export interface MfaEncryptionConfig {
  JWT_SECRET: string;
  MFA_ENCRYPTION_KEY?: string | undefined;
  MFA_ENCRYPTION_KEY_ID: string;
  NODE_ENV: "development" | "test" | "production";
}

export interface EncryptedMfaSecret {
  secretCiphertext: string;
  secretIv: string;
  secretAuthTag: string;
  encryptionKeyId: string;
}

function mfaEncryptionKey(config: MfaEncryptionConfig) {
  if (config.MFA_ENCRYPTION_KEY) {
    const key = Buffer.from(config.MFA_ENCRYPTION_KEY, "base64url");
    if (key.length !== 32) throw new Error("MFA encryption key must decode to exactly 32 bytes");
    return key;
  }
  if (config.NODE_ENV === "production") {
    throw new Error("Production MFA operations require MFA_ENCRYPTION_KEY");
  }
  return createHash("sha256")
    .update("fiatlux-choice:non-production-mfa-key:v1\0")
    .update(config.JWT_SECRET)
    .digest();
}

function aad(keyId: string) {
  return Buffer.from(`${MFA_AAD_PREFIX}:${keyId}`, "utf8");
}

export function encryptMfaSecret(secret: string, config: MfaEncryptionConfig): EncryptedMfaSecret {
  const key = mfaEncryptionKey(config);
  const iv = randomBytes(12);
  const plaintext = Buffer.from(secret, "utf8");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(config.MFA_ENCRYPTION_KEY_ID));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      secretCiphertext: ciphertext.toString("base64url"),
      secretIv: iv.toString("base64url"),
      secretAuthTag: cipher.getAuthTag().toString("base64url"),
      encryptionKeyId: config.MFA_ENCRYPTION_KEY_ID,
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export function decryptMfaSecret(
  encrypted: EncryptedMfaSecret,
  config: MfaEncryptionConfig,
): string {
  if (encrypted.encryptionKeyId !== config.MFA_ENCRYPTION_KEY_ID) {
    throw new Error(`Unsupported MFA encryption key id: ${encrypted.encryptionKeyId}`);
  }
  const key = mfaEncryptionKey(config);
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encrypted.secretIv, "base64url"),
    );
    decipher.setAAD(aad(encrypted.encryptionKeyId));
    decipher.setAuthTag(Buffer.from(encrypted.secretAuthTag, "base64url"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.secretCiphertext, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

export function encodeBase32(input: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.trim().toUpperCase().replace(/=+$/u, "");
  if (!normalized || !/^[A-Z2-7]+$/u.test(normalized)) {
    throw new Error("MFA secret is not valid unpadded Base32");
  }
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

function totpCodeForCounter(secret: string, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("Invalid TOTP counter");
  const secretBytes = decodeBase32(secret);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  try {
    const digest = createHmac("sha256", secretBytes).update(counterBytes).digest();
    const offset = (digest.at(-1) ?? 0) & 0x0f;
    const binary =
      (((digest[offset] ?? 0) & 0x7f) << 24) |
      ((digest[offset + 1] ?? 0) << 16) |
      ((digest[offset + 2] ?? 0) << 8) |
      (digest[offset + 3] ?? 0);
    return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
  } finally {
    secretBytes.fill(0);
    counterBytes.fill(0);
  }
}

export function createTotpCode(secret: string, now = Date.now()): string {
  return totpCodeForCounter(secret, Math.floor(now / 1_000 / TOTP_PERIOD_SECONDS));
}

function equalCode(left: string, right: string) {
  const leftBytes = Buffer.from(left, "ascii");
  const rightBytes = Buffer.from(right, "ascii");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyTotpCode(options: {
  secret: string;
  code: string;
  lastUsedCounter: number | null;
  now?: number;
  window?: number;
}): number | null {
  const code = options.code.trim();
  if (!/^\d{6}$/u.test(code)) return null;
  const currentCounter = Math.floor((options.now ?? Date.now()) / 1_000 / TOTP_PERIOD_SECONDS);
  const window = options.window ?? 1;
  if (!Number.isInteger(window) || window < 0 || window > 2) throw new Error("Invalid TOTP window");
  const offsets = [
    0,
    ...Array.from({ length: window }, (_, index) => -(index + 1)),
    ...Array.from({ length: window }, (_, index) => index + 1),
  ];
  for (const offset of offsets) {
    const counter = currentCounter + offset;
    if (counter < 0 || (options.lastUsedCounter !== null && counter <= options.lastUsedCounter)) {
      continue;
    }
    if (equalCode(code, totpCodeForCounter(options.secret, counter))) return counter;
  }
  return null;
}

export function buildOtpAuthUri(email: string, secret: string): string {
  const issuer = "FIAT LUX CHOICE";
  const label = `${issuer}:${email}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA256",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 10): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("Recovery code count must be between 1 and 20");
  }
  const codes = new Set<string>();
  while (codes.size < count) {
    const encoded = encodeBase32(randomBytes(RECOVERY_CODE_BYTES));
    codes.add(`FLX-${encoded.match(/.{1,4}/gu)?.join("-")}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(value: string): string | null {
  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/gu, "");
  if (!/^FLX[A-Z2-7]{16}$/u.test(compact)) return null;
  return compact;
}

export function hashRecoveryCode(value: string): string | null {
  const normalized = normalizeRecoveryCode(value);
  return normalized ? createHash("sha256").update(normalized, "ascii").digest("hex") : null;
}
