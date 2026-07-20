import { randomUUID } from "node:crypto";
import { auditEvents, createDatabase, githubInsights } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import type { GitHubReader, JobQueue, LlmProvider } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import { handleGitHubRefresh, type WorkerDependencies } from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

describe.skipIf(!databaseUrl)("GitHub read-only refresh PostgreSQL integration", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "GitHub Refresh Company",
      organizationSlug: `github-refresh-${randomUUID().slice(0, 8)}`,
      adminEmail: `github-refresh-${randomUUID().slice(0, 8)}@example.test`,
      adminDisplayName: "GitHub Refresh Owner",
      adminPassword: "correct-horse-battery-staple-github",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  const dependencies = (github: GitHubReader): WorkerDependencies => ({
    db: dbHandle.db,
    github,
    queue: {} as JobQueue,
    llmProvider: {} as LlmProvider,
    config: workerConfigSchema.parse({
      DATABASE_URL: testDatabaseUrl,
      GITHUB_INTEGRATION_MODE: "read_only",
      GITHUB_TOKEN: "integration-test-read-token",
      GITHUB_PROBE_REPOSITORY: "owner/probe-repository",
    }),
  });

  it("stores a successful snapshot and audits a sanitized, retryable failure", async () => {
    const [successfulInsight, failingInsight] = await dbHandle.db
      .insert(githubInsights)
      .values([
        {
          orgId,
          repository: "OpenAI/openai-node",
          kind: "repository",
          summary: "Awaiting refresh",
          url: "https://github.com/OpenAI/openai-node",
          capturedAt: new Date(0),
          payload: {},
        },
        {
          orgId,
          repository: "owner/private-repository",
          kind: "repository",
          summary: "Keep the last known snapshot",
          url: "https://github.com/owner/private-repository",
          capturedAt: new Date(0),
          payload: { lastKnown: true },
        },
      ])
      .returning();
    if (!successfulInsight || !failingInsight) throw new Error("Failed to seed GitHub insights");

    await handleGitHubRefresh(
      dependencies({
        async getRepository(repository) {
          return {
            repository,
            url: `https://github.com/${repository}`,
            description: "Contract-tested snapshot",
            stars: 42,
            forks: 7,
            openIssues: 2,
            defaultBranch: "main",
            pushedAt: "2026-07-18T00:00:00Z",
            archived: false,
            license: "Apache-2.0",
          };
        },
      }),
      { orgId, insightId: successfulInsight.id, expectedVersion: successfulInsight.version },
    );
    const [updated] = await dbHandle.db
      .select()
      .from(githubInsights)
      .where(eq(githubInsights.id, successfulInsight.id));
    expect(updated).toMatchObject({
      summary: "Contract-tested snapshot",
      payload: { repository: "OpenAI/openai-node", stars: 42 },
      version: successfulInsight.version + 1,
    });

    let refreshError: unknown;
    try {
      await handleGitHubRefresh(
        dependencies({
          async getRepository() {
            throw new Error(
              "GitHub returned HTTP 429; authorization=Bearer definitely-sensitive-placeholder",
            );
          },
        }),
        { orgId, insightId: failingInsight.id, expectedVersion: failingInsight.version },
      );
    } catch (error) {
      refreshError = error;
    }
    expect(refreshError).toBeInstanceOf(Error);
    expect(String(refreshError)).toContain("HTTP 429");
    expect(String(refreshError)).toContain("[REDACTED]");
    expect(String(refreshError)).not.toContain("definitely-sensitive-placeholder");

    const [unchanged] = await dbHandle.db
      .select()
      .from(githubInsights)
      .where(eq(githubInsights.id, failingInsight.id));
    expect(unchanged).toMatchObject({
      summary: "Keep the last known snapshot",
      payload: { lastKnown: true },
      version: failingInsight.version,
    });
    const [failureAudit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, failingInsight.id),
          eq(auditEvents.action, "refresh_fail"),
        ),
      );
    expect(failureAudit?.metadata).toMatchObject({
      actorType: "system",
      integrationMode: "read_only",
    });
    expect(JSON.stringify(failureAudit?.metadata)).toContain("[REDACTED]");
    expect(JSON.stringify(failureAudit?.metadata)).not.toContain(
      "definitely-sensitive-placeholder",
    );
  });

  it("drops stale and duplicate refresh jobs and preserves concurrent edits", async () => {
    const [duplicateInsight, concurrentInsight] = await dbHandle.db
      .insert(githubInsights)
      .values([
        {
          orgId,
          repository: "owner/duplicate-job",
          kind: "repository",
          summary: "Awaiting one refresh",
          url: "https://github.com/owner/duplicate-job",
          capturedAt: new Date(0),
          payload: {},
        },
        {
          orgId,
          repository: "owner/concurrent-edit",
          kind: "repository",
          summary: "Awaiting refresh with concurrent edit",
          url: "https://github.com/owner/concurrent-edit",
          capturedAt: new Date(0),
          payload: {},
        },
      ])
      .returning();
    if (!duplicateInsight || !concurrentInsight) throw new Error("Failed to seed CAS fixtures");

    let duplicateCalls = 0;
    const duplicateDependencies = dependencies({
      async getRepository(repository) {
        duplicateCalls += 1;
        return {
          repository,
          url: `https://github.com/${repository}`,
          description: "Applied once",
          stars: 1,
          forks: 0,
          openIssues: 0,
          defaultBranch: "main",
          pushedAt: null,
          archived: false,
          license: null,
        };
      },
    });
    const duplicatePayload = {
      orgId,
      insightId: duplicateInsight.id,
      expectedVersion: duplicateInsight.version,
    };
    await handleGitHubRefresh(duplicateDependencies, duplicatePayload);
    await handleGitHubRefresh(duplicateDependencies, duplicatePayload);
    expect(duplicateCalls).toBe(1);

    await handleGitHubRefresh(
      dependencies({
        async getRepository(repository) {
          await dbHandle.db
            .update(githubInsights)
            .set({
              summary: "Human edit wins",
              version: concurrentInsight.version + 1,
            })
            .where(eq(githubInsights.id, concurrentInsight.id));
          return {
            repository,
            url: `https://github.com/${repository}`,
            description: "Stale network snapshot",
            stars: 2,
            forks: 0,
            openIssues: 0,
            defaultBranch: "main",
            pushedAt: null,
            archived: false,
            license: null,
          };
        },
      }),
      {
        orgId,
        insightId: concurrentInsight.id,
        expectedVersion: concurrentInsight.version,
      },
    );
    const [preserved] = await dbHandle.db
      .select()
      .from(githubInsights)
      .where(eq(githubInsights.id, concurrentInsight.id));
    expect(preserved).toMatchObject({
      summary: "Human edit wins",
      version: concurrentInsight.version + 1,
    });
    const staleRefreshAudit = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, concurrentInsight.id),
          eq(auditEvents.action, "refresh"),
        ),
      );
    expect(staleRefreshAudit).toHaveLength(0);
  });
});
