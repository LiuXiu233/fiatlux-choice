import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && !value.trim() ? undefined : value;
const optionalNever = z.preprocess(emptyToUndefined, z.never().optional());
const complianceRequired = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const complianceSourcesFile = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const organizationSlug = z.string().regex(/^[a-z0-9-]+$/);

const bootstrapConfigSchema = z.object({
  SEED_MODE: z.literal("bootstrap"),
  BOOTSTRAP_ORG_NAME: z.preprocess(emptyToUndefined, z.string().min(1).default("FIAT LUX")),
  BOOTSTRAP_ORG_SLUG: z.preprocess(emptyToUndefined, organizationSlug.default("fiat-lux")),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_NAME: z.preprocess(emptyToUndefined, z.string().min(1).default("Administrator")),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(14),
  COMPLIANCE_SOURCES_REQUIRED: complianceRequired,
  COMPLIANCE_SOURCES_FILE: complianceSourcesFile,
  SEED_MAINTENANCE_OPERATOR_EMAIL: optionalNever,
  SEED_MAINTENANCE_REASON: optionalNever,
  SEED_MAINTENANCE_APPROVAL_REFERENCE: optionalNever,
  SEED_MAINTENANCE_REQUEST_ID: optionalNever,
});

const metadataOnlyConfigSchema = z.object({
  SEED_MODE: z.literal("metadata-only"),
  BOOTSTRAP_ORG_NAME: optionalNever,
  BOOTSTRAP_ORG_SLUG: organizationSlug,
  BOOTSTRAP_ADMIN_EMAIL: optionalNever,
  BOOTSTRAP_ADMIN_NAME: optionalNever,
  BOOTSTRAP_ADMIN_PASSWORD: optionalNever,
  COMPLIANCE_SOURCES_REQUIRED: complianceRequired,
  COMPLIANCE_SOURCES_FILE: complianceSourcesFile,
  SEED_MAINTENANCE_OPERATOR_EMAIL: optionalNever,
  SEED_MAINTENANCE_REASON: optionalNever,
  SEED_MAINTENANCE_APPROVAL_REFERENCE: optionalNever,
  SEED_MAINTENANCE_REQUEST_ID: optionalNever,
});

const systemRoleMaintenanceConfigSchema = z.object({
  SEED_MODE: z.literal("system-role-maintenance"),
  BOOTSTRAP_ORG_NAME: optionalNever,
  BOOTSTRAP_ORG_SLUG: organizationSlug,
  BOOTSTRAP_ADMIN_EMAIL: optionalNever,
  BOOTSTRAP_ADMIN_NAME: optionalNever,
  BOOTSTRAP_ADMIN_PASSWORD: optionalNever,
  COMPLIANCE_SOURCES_REQUIRED: complianceRequired,
  COMPLIANCE_SOURCES_FILE: complianceSourcesFile,
  SEED_MAINTENANCE_OPERATOR_EMAIL: z.string().trim().email(),
  SEED_MAINTENANCE_REASON: z.string().trim().min(8).max(5_000),
  SEED_MAINTENANCE_APPROVAL_REFERENCE: z.string().trim().min(3).max(500),
  SEED_MAINTENANCE_REQUEST_ID: z.string().trim().min(3).max(200),
});

export const seedConfigSchema = z.discriminatedUnion("SEED_MODE", [
  bootstrapConfigSchema,
  metadataOnlyConfigSchema,
  systemRoleMaintenanceConfigSchema,
]);

export type SeedConfig = z.infer<typeof seedConfigSchema>;

export function readSeedConfig(env: NodeJS.ProcessEnv = process.env): SeedConfig {
  return seedConfigSchema.parse({
    SEED_MODE: env.SEED_MODE,
    BOOTSTRAP_ORG_NAME: env.BOOTSTRAP_ORG_NAME,
    BOOTSTRAP_ORG_SLUG: env.BOOTSTRAP_ORG_SLUG,
    BOOTSTRAP_ADMIN_EMAIL: env.BOOTSTRAP_ADMIN_EMAIL ?? env.INITIAL_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_NAME: env.BOOTSTRAP_ADMIN_NAME,
    BOOTSTRAP_ADMIN_PASSWORD: env.BOOTSTRAP_ADMIN_PASSWORD ?? env.INITIAL_ADMIN_PASSWORD,
    COMPLIANCE_SOURCES_REQUIRED: env.COMPLIANCE_SOURCES_REQUIRED,
    COMPLIANCE_SOURCES_FILE: env.COMPLIANCE_SOURCES_FILE,
    SEED_MAINTENANCE_OPERATOR_EMAIL: env.SEED_MAINTENANCE_OPERATOR_EMAIL,
    SEED_MAINTENANCE_REASON: env.SEED_MAINTENANCE_REASON,
    SEED_MAINTENANCE_APPROVAL_REFERENCE: env.SEED_MAINTENANCE_APPROVAL_REFERENCE,
    SEED_MAINTENANCE_REQUEST_ID: env.SEED_MAINTENANCE_REQUEST_ID,
  });
}
