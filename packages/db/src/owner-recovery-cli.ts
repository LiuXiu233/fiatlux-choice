import { createDatabase } from "./index.js";
import { recoverOwnerPassword } from "./owner-recovery.js";
import { readOwnerRecoveryConfig } from "./owner-recovery-config.js";
import { readSingleLineSecret } from "./stdin-secret.js";

if (process.argv.length !== 2) {
  throw new Error("Owner recovery accepts no command-line arguments; provide the secret via stdin");
}

const config = readOwnerRecoveryConfig();
const newTemporaryPassword = await readSingleLineSecret();
const { db, client } = createDatabase();

try {
  const result = await recoverOwnerPassword(db, {
    organizationSlug: config.OWNER_RECOVERY_ORG_SLUG,
    ownerEmail: config.OWNER_RECOVERY_EMAIL,
    newTemporaryPassword,
    productionConfirmation: config.OWNER_RECOVERY_PRODUCTION_CONFIRMATION,
    mfaResetConfirmation: config.OWNER_RECOVERY_MFA_RESET_CONFIRMATION,
    reason: config.OWNER_RECOVERY_REASON,
    approvalReference: config.OWNER_RECOVERY_APPROVAL_REFERENCE,
    requestId: config.OWNER_RECOVERY_REQUEST_ID,
  });
  console.log(
    `Offline owner recovery ${result.requestId} completed; revoked ${result.revokedSessionCount} sessions, reset MFA, and forced first-login password change`,
  );
} finally {
  await client.end();
}
