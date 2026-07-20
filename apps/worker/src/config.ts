import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const optionalRepository = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/)
    .refine((value) => !value.endsWith("/.") && !value.endsWith("/.."))
    .optional(),
);
const providerId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{2,119}$/)
  .refine((value) => !/(?:mock|simulat|disabled)/i.test(value));
const modelName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value));

export const workerConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    COMPLIANCE_MONITOR_SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).max(250).default(12),
    LLM_DRIVER: z.enum(["mock", "compatible", "disabled"]).default("disabled"),
    LLM_BASE_URL: optionalUrl,
    LLM_API_KEY: optionalSecret,
    LLM_PROVIDER_ID: providerId.default("openai-compatible"),
    LLM_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      modelName.default("gpt-5-mini"),
    ),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(32_768).default(2_048),
    GITHUB_INTEGRATION_MODE: z.enum(["manual", "read_only"]).default("manual"),
    GITHUB_TOKEN: optionalSecret,
    GITHUB_PROBE_REPOSITORY: optionalRepository,
    BACKUP_COMMAND: optionalSecret,
    BACKUP_DIR: z.string().min(1).default("/var/lib/fiatlux/backups"),
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
    if (config.LLM_DRIVER !== "compatible" && config.LLM_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LLM_API_KEY must be absent unless LLM_DRIVER=compatible",
        path: ["LLM_API_KEY"],
      });
    }
    if (
      config.GITHUB_INTEGRATION_MODE === "read_only" &&
      (!config.GITHUB_TOKEN || !config.GITHUB_PROBE_REPOSITORY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GITHUB_INTEGRATION_MODE=read_only requires GITHUB_TOKEN and GITHUB_PROBE_REPOSITORY",
        path: ["GITHUB_INTEGRATION_MODE"],
      });
    }
    if (
      config.GITHUB_INTEGRATION_MODE === "manual" &&
      (config.GITHUB_TOKEN || config.GITHUB_PROBE_REPOSITORY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "GITHUB_TOKEN and GITHUB_PROBE_REPOSITORY must be absent when GITHUB_INTEGRATION_MODE=manual",
        path: ["GITHUB_INTEGRATION_MODE"],
      });
    }
  });

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerConfigSchema.parse(env);
}
