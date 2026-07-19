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
    WEB_ORIGIN: originUrl.default("http://localhost:3000"),
    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(28_800),
    COOKIE_SECURE: booleanString.default("false"),
    TRUST_PROXY: booleanString.default("false"),
    LLM_DRIVER: z.enum(["mock", "compatible", "disabled"]).default("disabled"),
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("fiatlux-files"),
    S3_ACCESS_KEY_ID: optionalSecret,
    S3_SECRET_ACCESS_KEY: optionalSecret,
    LLM_BASE_URL: optionalUrl,
    LLM_API_KEY: optionalSecret,
    LLM_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).default("gpt-5-mini"),
    ),
    GITHUB_INTEGRATION_MODE: z.enum(["manual", "read_only"]).default("manual"),
    GITHUB_TOKEN: optionalSecret,
  })
  .superRefine((config, context) => {
    if (config.LLM_DRIVER === "compatible" && (!config.LLM_BASE_URL || !config.LLM_API_KEY)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LLM_DRIVER=compatible requires LLM_BASE_URL and LLM_API_KEY",
        path: ["LLM_DRIVER"],
      });
    }
    if (
      config.LLM_DRIVER === "compatible" &&
      config.LLM_BASE_URL &&
      new URL(config.LLM_BASE_URL).protocol !== "https:"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LLM_BASE_URL must use HTTPS when LLM_DRIVER=compatible",
        path: ["LLM_BASE_URL"],
      });
    }
  });

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
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
