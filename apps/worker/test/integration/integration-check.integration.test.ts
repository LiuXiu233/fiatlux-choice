import { randomUUID } from "node:crypto";

import { auditEvents, createDatabase, integrationChecks } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import type { GitHubReader, JobQueue, LlmProvider } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import { handleIntegrationTest, type WorkerDependencies } from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

class FixedLlmProvider implements LlmProvider {
  calls = 0;

  async completeAdvisor() {
    this.calls += 1;
    const output = {
      facts: [],
      inferences: [{ claim: "Connectivity only.", basis: ["Acceptance probe"], confidence: 0 }],
      recommendations: [
        {
          action: "Perform separate quality review.",
          rationale: "Connectivity does not prove business quality.",
          risk: "A healthy probe may still produce poor advice.",
          priority: "high" as const,
        },
      ],
      risks: [
        {
          description: "Connectivity can be mistaken for quality.",
          severity: "high" as const,
          mitigation: "Run the seven-advisor quality rubric.",
        },
      ],
      missingInformation: ["Human quality review"],
      confidence: 0,
      disclaimer: "Connectivity validation only; no company analysis was performed.",
    };
    return {
      output,
      rawResponse: { choices: [{ message: { content: JSON.stringify(output) } }] },
      usage: { inputTokens: 51, outputTokens: 73 },
      provider: "approved-provider",
      model: "approved-model",
      latencyMs: 320,
    };
  }
}

class ThrowingLlmProvider implements LlmProvider {
  constructor(private readonly message: string) {}

  async completeAdvisor(): Promise<never> {
    throw new Error(this.message);
  }
}

describe.skipIf(!databaseUrl)("worker-only integration checks", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Integration Probe Company",
      organizationSlug: `integration-probe-${randomUUID().slice(0, 8)}`,
      adminEmail: `integration-probe-${randomUUID().slice(0, 8)}@example.test`,
      adminDisplayName: "Integration Probe Owner",
      adminPassword: "correct-horse-battery-staple-probe",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  function dependencies(
    llmProvider: LlmProvider,
    github: GitHubReader = {
      async getRepository(repository) {
        return {
          repository,
          url: `https://github.com/${repository}`,
          description: "Authenticated repository probe",
          stars: 1,
          forks: 0,
          openIssues: 0,
          defaultBranch: "main",
          pushedAt: "2026-07-20T00:00:00Z",
          archived: false,
          license: null,
        };
      },
    },
  ): WorkerDependencies {
    return {
      db: dbHandle.db,
      queue: {} as JobQueue,
      llmProvider,
      github,
      config: workerConfigSchema.parse({
        DATABASE_URL: testDatabaseUrl,
        LLM_DRIVER: "compatible",
        LLM_BASE_URL: "https://llm.example.test/gateway",
        LLM_API_KEY: "worker-only-test-key",
        LLM_PROVIDER_ID: "approved-provider",
        LLM_MODEL: "approved-model",
        LLM_MAX_OUTPUT_TOKENS: 2_048,
        GITHUB_INTEGRATION_MODE: "read_only",
        GITHUB_TOKEN: "worker-only-github-token",
        GITHUB_PROBE_REPOSITORY: "LiuXiu233/fiatlux-choice",
      }),
    };
  }

  async function createCheck(integrationId: "llm" | "github") {
    const [check] = await dbHandle.db
      .insert(integrationChecks)
      .values({
        orgId,
        integrationId,
        status: "queued",
        detail: "Worker-only authenticated probe queued",
        checkedBy: userId,
      })
      .returning();
    if (!check) throw new Error("Failed to create integration check fixture");
    return check;
  }

  it("runs one authenticated structured LLM call and one repository-bound GitHub GET", async () => {
    const provider = new FixedLlmProvider();
    const workerDependencies = dependencies(provider);
    const llmCheck = await createCheck("llm");
    const githubCheck = await createCheck("github");

    const llmPayload = {
      orgId,
      checkId: llmCheck.id,
      integrationId: "llm" as const,
      requestedBy: userId,
    };
    await handleIntegrationTest(workerDependencies, llmPayload);
    await handleIntegrationTest(workerDependencies, llmPayload);
    await handleIntegrationTest(workerDependencies, {
      orgId,
      checkId: githubCheck.id,
      integrationId: "github",
      requestedBy: userId,
    });

    expect(provider.calls).toBe(1);
    const [storedLlm] = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(eq(integrationChecks.id, llmCheck.id));
    const [storedGitHub] = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(eq(integrationChecks.id, githubCheck.id));
    expect(storedLlm).toMatchObject({
      status: "healthy",
      detail: expect.stringContaining("provider=approved-provider"),
    });
    expect(storedLlm?.detail).toContain("inputTokens=51");
    expect(storedGitHub).toMatchObject({
      status: "healthy",
      detail: "Authenticated read-only repository identity verified: LiuXiu233/fiatlux-choice",
    });

    const audits = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "integration"),
          eq(auditEvents.action, "test"),
        ),
      );
    expect(
      audits.some(
        (audit) => audit.metadata && JSON.stringify(audit.metadata).includes(llmCheck.id),
      ),
    ).toBe(true);
    expect(
      audits.some(
        (audit) => audit.metadata && JSON.stringify(audit.metadata).includes(githubCheck.id),
      ),
    ).toBe(true);
  });

  it("stores a sanitized unhealthy result without retrying or leaking provider errors", async () => {
    const secret = `provider-secret-${Math.random().toString(36).slice(2)}-${"x".repeat(20)}`;
    const check = await createCheck("llm");
    await expect(
      handleIntegrationTest(
        dependencies(new ThrowingLlmProvider(`Authorization: Bearer ${secret}`)),
        {
          orgId,
          checkId: check.id,
          integrationId: "llm",
          requestedBy: userId,
        },
      ),
    ).resolves.toBeUndefined();

    const [stored] = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(eq(integrationChecks.id, check.id));
    expect(stored?.status).toBe("unhealthy");
    expect(stored?.detail).toContain("[REDACTED]");
    expect(stored?.detail).not.toContain(secret);
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "integration"),
          eq(auditEvents.resourceId, "llm"),
          eq(auditEvents.action, "test_fail"),
        ),
      );
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("rejects a forged requester before any provider call", async () => {
    const provider = new FixedLlmProvider();
    const check = await createCheck("llm");
    await handleIntegrationTest(dependencies(provider), {
      orgId,
      checkId: check.id,
      integrationId: "llm",
      requestedBy: randomUUID(),
    });
    expect(provider.calls).toBe(0);
    const [stored] = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(eq(integrationChecks.id, check.id));
    expect(stored?.status).toBe("queued");
  });

  it("fails an expired running probe for manual review without calling the provider again", async () => {
    const provider = new FixedLlmProvider();
    const check = await createCheck("llm");
    const staleAt = new Date(Date.now() - 11 * 60 * 1_000);
    await dbHandle.db
      .update(integrationChecks)
      .set({ status: "running", detail: "stale probe", updatedAt: staleAt })
      .where(eq(integrationChecks.id, check.id));

    await handleIntegrationTest(dependencies(provider), {
      orgId,
      checkId: check.id,
      integrationId: "llm",
      requestedBy: userId,
    });
    expect(provider.calls).toBe(0);
    const [stored] = await dbHandle.db
      .select()
      .from(integrationChecks)
      .where(eq(integrationChecks.id, check.id));
    expect(stored).toMatchObject({
      status: "unhealthy",
      detail: expect.stringContaining("lease expired"),
    });
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "integration"),
          eq(auditEvents.action, "test_lease_expired"),
        ),
      );
    expect(audit?.metadata).toMatchObject({ checkId: check.id });
  });
});
