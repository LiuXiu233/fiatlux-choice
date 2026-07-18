import { z } from "zod";

export const seedConfigSchema = z.object({
  BOOTSTRAP_ORG_NAME: z.string().min(1).default("FIAT LUX"),
  BOOTSTRAP_ORG_SLUG: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("fiat-lux"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).default("Administrator"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(14),
  COMPLIANCE_SOURCES_REQUIRED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type SeedConfig = z.infer<typeof seedConfigSchema>;

export function readSeedConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  return seedConfigSchema.parse({
    ...env,
    BOOTSTRAP_ADMIN_EMAIL: env.BOOTSTRAP_ADMIN_EMAIL ?? env.INITIAL_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: env.BOOTSTRAP_ADMIN_PASSWORD ?? env.INITIAL_ADMIN_PASSWORD,
  });
}
