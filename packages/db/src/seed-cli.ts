import { createDatabase } from "./index.js";
import { seedDatabase } from "./seed.js";
import { readSeedConfig } from "./seed-config.js";

const env = readSeedConfig();

const { db, client } = createDatabase();

try {
  const result =
    env.SEED_MODE === "bootstrap"
      ? await seedDatabase(db, {
          mode: "bootstrap",
          organizationName: env.BOOTSTRAP_ORG_NAME,
          organizationSlug: env.BOOTSTRAP_ORG_SLUG,
          adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
          adminDisplayName: env.BOOTSTRAP_ADMIN_NAME,
          adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
          ...(env.COMPLIANCE_SOURCES_FILE
            ? { complianceSourcesFile: env.COMPLIANCE_SOURCES_FILE }
            : {}),
          complianceSourcesRequired: env.COMPLIANCE_SOURCES_REQUIRED,
        })
      : env.SEED_MODE === "metadata-only"
        ? await seedDatabase(db, {
            mode: "metadata-only",
            organizationSlug: env.BOOTSTRAP_ORG_SLUG,
            ...(env.COMPLIANCE_SOURCES_FILE
              ? { complianceSourcesFile: env.COMPLIANCE_SOURCES_FILE }
              : {}),
            complianceSourcesRequired: env.COMPLIANCE_SOURCES_REQUIRED,
          })
        : await seedDatabase(db, {
            mode: "system-role-maintenance",
            organizationSlug: env.BOOTSTRAP_ORG_SLUG,
            ...(env.COMPLIANCE_SOURCES_FILE
              ? { complianceSourcesFile: env.COMPLIANCE_SOURCES_FILE }
              : {}),
            complianceSourcesRequired: env.COMPLIANCE_SOURCES_REQUIRED,
            systemRoleMaintenance: {
              operatorEmail: env.SEED_MAINTENANCE_OPERATOR_EMAIL,
              reason: env.SEED_MAINTENANCE_REASON,
              approvalReference: env.SEED_MAINTENANCE_APPROVAL_REFERENCE,
              requestId: env.SEED_MAINTENANCE_REQUEST_ID,
            },
          });
  if (result.bootstrapCreated) {
    console.log(`Initialized organization ${result.organization.slug} and bootstrap owner`);
  } else {
    console.log(
      `Reconciled seed-managed metadata for organization ${result.organization.slug}; business identity and role assignments were preserved`,
    );
  }
  if (result.systemRoleChanges.mode === "maintenance") {
    console.log(
      `System-role maintenance ${result.systemRoleChanges.requestId}: created ${result.systemRoleChanges.rolesCreated} roles and added ${result.systemRoleChanges.permissionsAdded} permissions with per-change audit events`,
    );
  }
  console.log(`Seed metadata audit request ${result.metadataRequestId}`);
  if (result.complianceImport.missing) {
    const message = "Official compliance source file is missing; imported 0 compliance records";
    if (env.COMPLIANCE_SOURCES_REQUIRED) throw new Error(message);
    console.warn(message);
  } else {
    console.log(
      `Imported ${result.complianceImport.imported} official compliance sources; skipped ${result.complianceImport.skipped}`,
    );
  }
} finally {
  await client.end();
}
