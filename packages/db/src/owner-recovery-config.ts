import { z } from "zod";

import { OWNER_RECOVERY_PRODUCTION_CONFIRMATION } from "./owner-recovery.js";

export const ownerRecoveryConfigSchema = z.object({
  OWNER_RECOVERY_ORG_SLUG: z.string().regex(/^[a-z0-9-]+$/),
  OWNER_RECOVERY_EMAIL: z
    .string()
    .email()
    .refine((value) => value === value.toLowerCase(), {
      message: "Owner recovery email must already be normalized to lowercase",
    }),
  OWNER_RECOVERY_PRODUCTION_CONFIRMATION: z.literal(OWNER_RECOVERY_PRODUCTION_CONFIRMATION),
  OWNER_RECOVERY_REASON: z.string().trim().min(8).max(5_000),
  OWNER_RECOVERY_APPROVAL_REFERENCE: z.string().trim().min(3).max(500),
  OWNER_RECOVERY_REQUEST_ID: z.string().trim().min(3).max(200),
});

export type OwnerRecoveryConfig = z.infer<typeof ownerRecoveryConfigSchema>;

export function readOwnerRecoveryConfig(env: NodeJS.ProcessEnv = process.env): OwnerRecoveryConfig {
  if (env.OWNER_RECOVERY_PASSWORD !== undefined || env.OWNER_RECOVERY_NEW_PASSWORD !== undefined) {
    throw new Error("Owner recovery passwords are forbidden in environment variables; use stdin");
  }
  return ownerRecoveryConfigSchema.parse({
    OWNER_RECOVERY_ORG_SLUG: env.OWNER_RECOVERY_ORG_SLUG,
    OWNER_RECOVERY_EMAIL: env.OWNER_RECOVERY_EMAIL,
    OWNER_RECOVERY_PRODUCTION_CONFIRMATION: env.OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
    OWNER_RECOVERY_REASON: env.OWNER_RECOVERY_REASON,
    OWNER_RECOVERY_APPROVAL_REFERENCE: env.OWNER_RECOVERY_APPROVAL_REFERENCE,
    OWNER_RECOVERY_REQUEST_ID: env.OWNER_RECOVERY_REQUEST_ID,
  });
}
