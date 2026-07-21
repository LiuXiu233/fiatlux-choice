import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalMfaEncryptionKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/u, "MFA_ENCRYPTION_KEY must be an unpadded 32-byte Base64url key")
    .optional(),
);
const mfaRequiredRoles = z
  .string()
  .default("")
  .transform((value) => [
    ...new Set(
      value
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u)).max(16));
const originUrl = z
  .string()
  .url()
  .transform((value) => new URL(value).origin);

export const apiConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().default("0.0.0.0"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(3_000),
    WEB_ORIGIN: originUrl.default("http://localhost:3000"),
    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(28_800),
    COOKIE_SECURE: booleanString.default("false"),
    TRUST_PROXY: booleanString.default("false"),
    MFA_ENCRYPTION_KEY: optionalMfaEncryptionKey,
    MFA_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u)
      .default("v1"),
    MFA_REQUIRED_ROLES: mfaRequiredRoles,
    MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(180),
    MFA_SETUP_TTL_SECONDS: z.coerce.number().int().min(300).max(3_600).default(900),
    LLM_DRIVER: z.enum(["mock", "compatible", "disabled"]).default("disabled"),
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("fiatlux-files"),
    S3_ACCESS_KEY_ID: optionalSecret,
    S3_SECRET_ACCESS_KEY: optionalSecret,
    LLM_BASE_URL: optionalUrl,
    LLM_PROVIDER_ID: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._:-]{2,119}$/)
      .refine((value) => !/(?:mock|simulat|disabled)/i.test(value))
      .default("openai-compatible"),
    LLM_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value))
        .default("gpt-5-mini"),
    ),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(32_768).default(2_048),
    GITHUB_INTEGRATION_MODE: z.enum(["manual", "read_only"]).default("manual"),
  })
  .superRefine((config, context) => {
    if (config.MFA_REQUIRED_ROLES.length > 0 && !config.MFA_ENCRYPTION_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "MFA_REQUIRED_ROLES requires MFA_ENCRYPTION_KEY",
        path: ["MFA_ENCRYPTION_KEY"],
      });
    }
    if (config.LLM_DRIVER === "compatible" && !config.LLM_BASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LLM_DRIVER=compatible requires LLM_BASE_URL; the API never receives LLM_API_KEY",
        path: ["LLM_DRIVER"],
      });
    }
    if (
      config.LLM_DRIVER === "compatible" &&
      config.LLM_BASE_URL &&
      (() => {
        const url = new URL(config.LLM_BASE_URL);
        return (
          url.protocol !== "https:" ||
          Boolean(url.username) ||
          Boolean(url.password) ||
          Boolean(url.search) ||
          Boolean(url.hash)
        );
      })()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "LLM_BASE_URL must use HTTPS without credentials, query or fragment when LLM_DRIVER=compatible",
        path: ["LLM_BASE_URL"],
      });
    }
  });

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  if (env.LLM_API_KEY || env.GITHUB_TOKEN) {
    throw new Error(
      "API process must not receive LLM_API_KEY or GITHUB_TOKEN; inject integration credentials into the worker only",
    );
  }
  const sessionTtlSeconds = env.SESSION_TTL_HOURS
    ? String(Number(env.SESSION_TTL_HOURS) * 60 * 60)
    : undefined;
  return apiConfigSchema.parse({
    ...env,
    WEB_ORIGIN: env.WEB_ORIGIN ?? env.APP_ORIGIN,
    JWT_SECRET: env.JWT_SECRET ?? env.SESSION_SECRET,
    JWT_TTL_SECONDS: env.JWT_TTL_SECONDS ?? sessionTtlSeconds,
  });
}
