import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const resetConfirmation = "RESET_DEDICATED_MIGRATION_TEST_DATABASE";
const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_TEST_DATABASE_URL is required");

const parsedUrl = new URL(databaseUrl);
const databaseName = parsedUrl.pathname.replace(/^\//, "");
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const dedicatedDatabase = databaseName.endsWith("_migration_test");
const explicitCiDatabase =
  process.env.CI === "true" && process.env.MIGRATION_TEST_ALLOW_CI_DATABASE === "true";
if (!loopbackHosts.has(parsedUrl.hostname)) {
  throw new Error("Migration verification refuses a non-loopback PostgreSQL host");
}
if (!dedicatedDatabase && !explicitCiDatabase) {
  throw new Error("Migration verification requires a database ending in _migration_test");
}
if (process.env.MIGRATION_TEST_RESET !== resetConfirmation) {
  throw new Error(`MIGRATION_TEST_RESET must equal ${resetConfirmation}`);
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const migrations = readMigrationFiles({ migrationsFolder });
if (migrations.length < 2) throw new Error("At least two migrations are required");
const previousReleaseMigrationCount = migrations.length - 1;
const client = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
const database = drizzle(client);

async function resetSchemas() {
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await client.unsafe("CREATE SCHEMA public");
}

async function applyPreviousRelease() {
  await client.unsafe("CREATE SCHEMA drizzle");
  await client.unsafe(`
    CREATE TABLE drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  for (const migration of migrations.slice(0, previousReleaseMigrationCount)) {
    await client.begin(async (transaction) => {
      for (const statement of migration.sql) {
        if (statement.trim()) await transaction.unsafe(statement);
      }
      await transaction`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})
      `;
    });
  }
}

const organizationId = "10000000-0000-4000-8000-000000000001";
const sourceId = "10000000-0000-4000-8000-000000000002";
const legacyFields = [
  "id",
  "org_id",
  "title",
  "category",
  "issuing_authority",
  "source_url",
  "status",
  "review_status",
  "applicability",
  "summary",
  "content_hash",
  "metadata_hash",
  "version",
] as const;

async function readLegacySource() {
  const rows = await client.unsafe(
    `SELECT ${legacyFields.join(", ")} FROM compliance_items WHERE id = $1`,
    [sourceId],
  );
  const source = rows[0];
  if (!source) throw new Error("Legacy compliance fixture disappeared");
  return source;
}

async function migrationCount() {
  const [row] = await client<{ value: string }[]>`
    SELECT count(*)::text AS value FROM drizzle.__drizzle_migrations
  `;
  return Number(row?.value ?? -1);
}

try {
  await resetSchemas();
  await applyPreviousRelease();
  await client`
    INSERT INTO organizations (id, name, slug)
    VALUES (${organizationId}, 'Legacy migration fixture', 'legacy-migration-fixture')
  `;
  await client`
    INSERT INTO compliance_items (
      id, org_id, title, category, issuing_authority, source_url,
      status, review_status, applicability, summary, content_hash, metadata_hash, version
    ) VALUES (
      ${sourceId}, ${organizationId}, 'Legacy reviewed source', 'company_governance',
      'Legacy official authority', 'https://example.test/legacy-reviewed-source',
      'active', 'reviewed', 'Legacy applicability', 'Legacy review summary',
      ${"a".repeat(64)}, ${"b".repeat(64)}, 7
    )
  `;
  const beforeUpgrade = await readLegacySource();
  if ((await migrationCount()) !== previousReleaseMigrationCount) {
    throw new Error("Previous-release migration journal is incomplete");
  }

  await migrate(database, { migrationsFolder });
  await migrate(database, { migrationsFolder });
  const afterUpgrade = await readLegacySource();
  if (JSON.stringify(afterUpgrade) !== JSON.stringify(beforeUpgrade)) {
    throw new Error("The current migration changed legacy compliance business data");
  }
  if ((await migrationCount()) !== migrations.length) {
    throw new Error("Current migration journal is incomplete or not idempotent");
  }

  const expectedProfessionalReviewColumns = [
    "review_outcome",
    "reviewer_name",
    "reviewer_role",
    "reviewer_organization",
    "reviewer_qualification",
    "review_missing_information",
    "review_evidence_file_id",
    "reviewed_by_user_id",
    "reviewed_at",
    "reviewed_source_version",
    "reviewed_content_hash",
    "reviewed_metadata_hash",
  ];
  const columnRows = await client<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compliance_items'
  `;
  const columns = new Set(columnRows.map((row) => row.column_name));
  const missingColumns = expectedProfessionalReviewColumns.filter((name) => !columns.has(name));
  if (missingColumns.length > 0) {
    throw new Error(
      `Professional review migration columns are missing: ${missingColumns.join(", ")}`,
    );
  }
  const [legacyProvenance] = await client<
    { review_outcome: string | null; reviewed_by_user_id: string | null }[]
  >`
    SELECT review_outcome, reviewed_by_user_id
    FROM compliance_items
    WHERE id = ${sourceId}
  `;
  if (legacyProvenance?.review_outcome !== null || legacyProvenance.reviewed_by_user_id !== null) {
    throw new Error("Upgrade invented professional provenance for a legacy reviewed record");
  }
  const [auditCount] = await client<{ value: string }[]>`
    SELECT count(*)::text AS value
    FROM audit_events
    WHERE action = 'professional_review' AND resource_id = ${sourceId}
  `;
  if (Number(auditCount?.value ?? -1) !== 0) {
    throw new Error("Upgrade invented a professional review audit event");
  }

  await resetSchemas();
  await migrate(database, { migrationsFolder });
  const [tableCount] = await client<{ value: string }[]>`
    SELECT count(*)::text AS value
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  if ((await migrationCount()) !== migrations.length || Number(tableCount?.value ?? -1) !== 38) {
    throw new Error("Fresh migration verification did not produce the expected schema");
  }

  process.stdout.write(
    `${JSON.stringify({
      previousReleaseMigrationCount,
      currentMigrationCount: migrations.length,
      publicTableCount: 38,
      legacyDataPreserved: true,
      inventedProfessionalProvenance: false,
      freshMigrationVerified: true,
    })}\n`,
  );
} finally {
  await client.end();
}
