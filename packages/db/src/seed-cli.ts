import { createDatabase } from "./index.js";
import { seedDatabase } from "./seed.js";
import { readSeedConfig } from "./seed-config.js";

const env = readSeedConfig();

const { db, client } = createDatabase();

try {
  const result = await seedDatabase(db, {
    organizationName: env.BOOTSTRAP_ORG_NAME,
    organizationSlug: env.BOOTSTRAP_ORG_SLUG,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminDisplayName: env.BOOTSTRAP_ADMIN_NAME,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  console.log(
    `Seeded organization ${result.organization.slug} and administrator ${result.user.email}`,
  );
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
