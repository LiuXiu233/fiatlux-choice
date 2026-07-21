import { randomUUID } from "node:crypto";
import type { AdvisorOutput } from "@fiatlux/contracts";
import {
  advisorModelCalls,
  advisorRuns,
  auditEvents,
  createDatabase,
  promptVersions,
} from "@fiatlux/db";
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
  calls = 0;

  constructor(output: AdvisorOutput) {
    this.output = output;
  }

  async completeAdvisor(_input: LlmCallInput): Promise<LlmCallResult> {
    this.calls += 1;
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

class DeferredLlmProvider implements LlmProvider {
  readonly output: AdvisorOutput;
  readonly entered: Promise<void>;
  calls = 0;
  private readonly gate: Promise<void>;
  private resolveEntered!: () => void;
  private releaseGate!: () => void;

  constructor(output: AdvisorOutput) {
    this.output = output;
    this.entered = new Promise((resolve) => {
      this.resolveEntered = resolve;
    });
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  resume() {
    this.releaseGate();
  }

  async completeAdvisor(_input: LlmCallInput): Promise<LlmCallResult> {
    this.calls += 1;
    this.resolveEntered();
    await this.gate;
    return {
      output: this.output,
      rawResponse: { id: "deferred-test-call", output: this.output },
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: "integration-test",
      model: "deterministic-test-model",
      latencyMs: 1,
    };
  }
}

class ThrowingLlmProvider implements LlmProvider {
  readonly message: string;
  calls = 0;

  constructor(message: string) {
    this.message = message;
  }

  async completeAdvisor(_input: LlmCallInput): Promise<LlmCallResult> {
    this.calls += 1;
    throw new Error(this.message);
  }
}

function validAdvisorOutput(): AdvisorOutput {
  return {
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
      adminMustChangePassword: false,
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
    const output = validAdvisorOutput();
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

  it("atomically claims a duplicate delivery and calls the model only once", async () => {
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "Exercise concurrent advisor delivery",
        contextRefs: [],
        contextSnapshot: [],
      })
      .returning();
    if (!run) throw new Error("Failed to create concurrent advisor run");

    const provider = new DeferredLlmProvider(validAdvisorOutput());
    const workerDependencies = dependencies(validAdvisorOutput());
    workerDependencies.llmProvider = provider;

    const first = handleAdvisorRun(workerDependencies, { orgId, runId: run.id });
    await provider.entered;
    await handleAdvisorRun(workerDependencies, { orgId, runId: run.id });
    provider.resume();
    await first;

    const [completed] = await dbHandle.db
      .select()
      .from(advisorRuns)
      .where(eq(advisorRuns.id, run.id));
    const calls = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id));
    expect(completed?.status).toBe("completed");
    expect(provider.calls).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("fails an expired running claim without replaying the model", async () => {
    const staleAt = new Date(Date.now() - 10 * 60 * 1_000);
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "Do not replay an expired advisor run",
        contextRefs: [],
        contextSnapshot: [],
        status: "running",
        startedAt: staleAt,
        updatedAt: staleAt,
        version: 7,
      })
      .returning();
    if (!run) throw new Error("Failed to create stale advisor run");
    await dbHandle.db.insert(advisorModelCalls).values({
      orgId,
      runId: run.id,
      provider: "integration-test",
      model: "never-replayed",
      promptVersionId,
      requestPayload: { question: run.question },
      status: "started",
    });
    const provider = new FixedLlmProvider(validAdvisorOutput());
    const workerDependencies = dependencies(validAdvisorOutput());
    workerDependencies.llmProvider = provider;

    await handleAdvisorRun(workerDependencies, { orgId, runId: run.id });

    const [failed] = await dbHandle.db.select().from(advisorRuns).where(eq(advisorRuns.id, run.id));
    const [modelCall] = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id));
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, run.id),
          eq(auditEvents.action, "lease_expired"),
        ),
      );
    expect(failed).toMatchObject({ status: "failed", version: 8 });
    expect(failed?.error).toContain("manual review");
    expect(modelCall).toMatchObject({ status: "failed" });
    expect(provider.calls).toBe(0);
    expect(audit?.metadata).toMatchObject({ actorType: "system" });
  });

  it("redacts provider failures in persistence, audit and the rethrown worker error", async () => {
    const leakedBasic = `basic-${Math.random().toString(36).slice(2)}-${"b".repeat(16)}`;
    const leakedUrlPassword = `url-${Math.random().toString(36).slice(2)}-${"u".repeat(16)}`;
    const [run] = await dbHandle.db
      .insert(advisorRuns)
      .values({
        orgId,
        advisorKey: "finance",
        promptVersionId,
        requestedBy: userId,
        question: "Exercise provider error sanitization",
        contextRefs: [],
        contextSnapshot: [],
      })
      .returning();
    if (!run) throw new Error("Failed to create provider failure advisor run");
    const provider = new ThrowingLlmProvider(
      `Authorization: Basic ${leakedBasic} redis://:${leakedUrlPassword}@cache.internal/0`,
    );
    const workerDependencies = dependencies(validAdvisorOutput());
    workerDependencies.llmProvider = provider;

    let thrown: unknown;
    try {
      await handleAdvisorRun(workerDependencies, { orgId, runId: run.id });
    } catch (error) {
      thrown = error;
    }

    const [failed] = await dbHandle.db.select().from(advisorRuns).where(eq(advisorRuns.id, run.id));
    const [modelCall] = await dbHandle.db
      .select()
      .from(advisorModelCalls)
      .where(eq(advisorModelCalls.runId, run.id));
    const [audit] = await dbHandle.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceId, run.id),
          eq(auditEvents.action, "fail"),
        ),
      );
    expect(provider.calls).toBe(1);
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("[REDACTED]");
    expect(failed?.status).toBe("failed");
    expect(modelCall?.status).toBe("failed");
    for (const secret of [leakedBasic, leakedUrlPassword]) {
      expect(String(thrown)).not.toContain(secret);
      expect(JSON.stringify(failed)).not.toContain(secret);
      expect(JSON.stringify(modelCall)).not.toContain(secret);
      expect(JSON.stringify(audit)).not.toContain(secret);
    }
  });
});
