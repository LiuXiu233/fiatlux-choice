import { randomUUID } from "node:crypto";
import type { AdvisorOutput } from "@fiatlux/contracts";
import { advisorModelCalls, advisorRuns, createDatabase, promptVersions } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import type { GitHubReader, LlmCallInput, LlmCallResult, LlmProvider } from "@fiatlux/integrations";
import { JobQueue, MockLlmProvider } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { workerConfigSchema } from "../../src/config.js";
import { handleAdvisorRun, type WorkerDependencies } from "../../src/handlers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

class FixedLlmProvider implements LlmProvider {
  readonly output: AdvisorOutput;

  constructor(output: AdvisorOutput) {
    this.output = output;
  }

  async completeAdvisor(_input: LlmCallInput): Promise<LlmCallResult> {
    return {
      output: this.output,
      rawResponse: { id: "test-call", output: this.output },
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: "integration-test",
      model: "deterministic-test-model",
      latencyMs: 1,
    };
  }
}

const github: GitHubReader = {
  async getRepository(repository) {
    return {
      repository,
      url: `https://github.com/${repository}`,
      description: null,
      stars: 0,
      forks: 0,
      openIssues: 0,
      defaultBranch: "main",
      pushedAt: null,
      archived: false,
      license: null,
    };
  },
};

describe.skipIf(!databaseUrl)("advisor worker PostgreSQL audit", () => {
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let userId: string;
  let promptVersionId: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Worker Test Company",
      organizationSlug: `worker-${suffix}`,
      adminEmail: `worker-${suffix}@example.test`,
      adminDisplayName: "Worker Owner",
      adminPassword: "correct-horse-battery-staple-worker",
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
    const [prompt] = await dbHandle.db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.orgId, orgId),
          eq(promptVersions.advisorKey, "finance"),
          eq(promptVersions.active, true),
        ),
      )
      .limit(1);
    if (!prompt) throw new Error("Seed did not create finance prompt");
    promptVersionId = prompt.id;
  }, 60_000);

  afterAll(async () => {
    await dbHandle?.client.end();
  });

  function dependencies(output: AdvisorOutput): WorkerDependencies {
    return {
      db: dbHandle.db,
      queue: new JobQueue(testDatabaseUrl),
      llmProvider: new FixedLlmProvider(output),
      github,
      config: workerConfigSchema.parse({
        DATABASE_URL: databaseUrl,
        LLM_MODEL: "deterministic-test-model",
      }),
    };
  }

  it("stores prompt-bound model call, structured output and token usage", async () => {
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "What information is missing?",
        contextRefs: [],
        contextSnapshot: [],
      })
      .returning();
    if (!run) throw new Error("Failed to create advisor run");
    const output: AdvisorOutput = {
      facts: [],
      inferences: [],
      recommendations: [
        {
          action: "Collect a cash-flow forecast",
          rationale: "No context was supplied",
          risk: "Decisions may use incomplete data",
          priority: "high",
        },
      ],
      risks: [
        {
          description: "Missing financial context",
          severity: "high",
          mitigation: "Provide current ledgers",
        },
      ],
      missingInformation: ["Current cash-flow forecast"],
      confidence: 0.2,
      disclaimer: "Decision support only; human review is required.",
    };
    await handleAdvisorRun(dependencies(output), { orgId, runId: run.id });

    const [completed] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(eq(advisorRuns.id, run.id))
      .limit(1);
    const [call] = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id))
      .limit(1);
    expect(completed).toMatchObject({ status: "completed", confidence: 2_000 });
    expect(call).toMatchObject({
      status: "completed",
      provider: "integration-test",
      model: "deterministic-test-model",
      promptVersionId,
      inputTokens: 10,
      outputTokens: 20,
    });
  });

  it("fails and audits a model that cites withheld compliance evidence", async () => {
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "State a compliance fact",
        contextRefs: [{ resourceType: "compliance-items", resourceId: randomUUID() }],
        contextSnapshot: [{ resourceType: "compliance-review-gaps", withheldCount: 1 }],
      })
      .returning();
    if (!run) throw new Error("Failed to create advisor run");
    const output: AdvisorOutput = {
      facts: [
        {
          claim: "Unsafe claim",
          evidence: [{ sourceType: "compliance-items", sourceId: "withheld" }],
        },
      ],
      inferences: [],
      recommendations: [],
      risks: [],
      missingInformation: [],
      confidence: 0.9,
      disclaimer: "Decision support only.",
    };
    await expect(handleAdvisorRun(dependencies(output), { orgId, runId: run.id })).rejects.toThrow(
      /outside/,
    );
    const [failed] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(eq(advisorRuns.id, run.id))
      .limit(1);
    const [call] = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id))
      .limit(1);
    expect(failed?.status).toBe("failed");
    expect(call?.status).toBe("failed");
  });

  it("marks mock executions as simulated in the complete model-call audit", async () => {
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "Run the configured mock advisor",
        contextRefs: [],
        contextSnapshot: [],
      })
      .returning();
    if (!run) throw new Error("Failed to create advisor run");
    const mockDependencies: WorkerDependencies = {
      db: dbHandle.db,
      queue: new JobQueue(testDatabaseUrl),
      llmProvider: new MockLlmProvider(),
      github,
      config: workerConfigSchema.parse({
        DATABASE_URL: databaseUrl,
        LLM_DRIVER: "mock",
        LLM_MODEL: "",
      }),
    };
    await handleAdvisorRun(mockDependencies, { orgId, runId: run.id });
    const [completed] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(eq(advisorRuns.id, run.id))
      .limit(1);
    const [call] = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id))
      .limit(1);
    expect(call).toMatchObject({
      provider: "mock",
      model: "simulated-advisor-v1",
      status: "completed",
    });
    expect(JSON.stringify(completed?.output)).toContain("SIMULATED OUTPUT");
  });
});
