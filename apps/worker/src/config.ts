import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const workerConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50).default(5),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),
    LLM_DRIVER: z.enum(["mock", "compatible", "disabled"]).default("disabled"),
    LLM_BASE_URL: optionalUrl,
    LLM_API_KEY: optionalSecret,
    LLM_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).default("gpt-5-mini"),
    ),
    GITHUB_INTEGRATION_MODE: z.enum(["manual", "read_only"]).default("manual"),
    GITHUB_TOKEN: optionalSecret,
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
      new URL(config.LLM_BASE_URL).protocol !== "https:"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LLM_BASE_URL must use HTTPS when LLM_DRIVER=compatible",
        path: ["LLM_BASE_URL"],
      });
    }
  });

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return workerConfigSchema.parse(env);
}
