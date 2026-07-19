import PgBoss from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  BACKUP_CLAIM_LEASE_SECONDS,
  BACKUP_JOB_EXPIRE_SECONDS,
  CompatibleLlmProvider,
  createLlmProvider,
  GitHubApiReader,
  JOB_NAMES,
  JobQueue,
  ManualExternalActionAdapter,
  ManualGitHubReader,
  MemoryObjectStorage,
  MockExternalActionAdapter,
  MockLlmProvider,
  sanitizeIntegrationError,
} from "../src/index.js";

describe("job queue execution leases", () => {
  it("validates queue database pool settings before opening a connection", () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    expect(() => new JobQueue(databaseUrl, { maxConnections: 0 })).toThrow(/max connections/);
    expect(() => new JobQueue(databaseUrl, { connectTimeoutSeconds: 61 })).toThrow(
      /connect timeout/,
    );
    expect(() => new JobQueue(databaseUrl, { applicationName: "queue with spaces" })).toThrow(
      /application name/,
    );
  });

  it("expires backup jobs only after the worker stale-claim threshold", async () => {
    expect(BACKUP_JOB_EXPIRE_SECONDS).toBeGreaterThan(BACKUP_CLAIM_LEASE_SECONDS);
    expect(BACKUP_CLAIM_LEASE_SECONDS).toBeGreaterThan(60 * 60);

    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    const queue = new JobQueue(databaseUrl, { boss });
    const send = vi.spyOn(boss, "send").mockResolvedValue("00000000-0000-4000-8000-000000000001");
    await queue.send("backup.create", { orgId: "org", backupId: "backup" });
    expect(send).toHaveBeenLastCalledWith(
      "backup.create",
      { orgId: "org", backupId: "backup" },
      expect.objectContaining({ expireInSeconds: BACKUP_JOB_EXPIRE_SECONDS }),
    );

    await queue.send("notification.deliver", { orgId: "org", notificationId: "notice" });
    expect(send).toHaveBeenLastCalledWith(
      "notification.deliver",
      { orgId: "org", notificationId: "notice" },
      expect.objectContaining({ expireInSeconds: 10 * 60 }),
    );
  });

  it("proves declared worker registration and pg-boss queue visibility without probe jobs", async () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    vi.spyOn(boss, "start").mockResolvedValue(boss);
    vi.spyOn(boss, "work").mockImplementation(async (name) => `worker-${name}`);
    const getQueues = vi
      .spyOn(boss, "getQueues")
      .mockResolvedValue(
        Object.values(JOB_NAMES).map((name) => ({ name })) as Awaited<
          ReturnType<PgBoss["getQueues"]>
        >,
      );
    vi.spyOn(boss, "offWork").mockResolvedValue();
    vi.spyOn(boss, "stop").mockResolvedValue();
    const queue = new JobQueue(databaseUrl, { boss, provisionQueues: false });
    expect("boss" in queue).toBe(false);
    const queueErrors = vi.fn();
    queue.onError(queueErrors);
    boss.emit("error", new Error("transient queue error"));
    expect(queueErrors).toHaveBeenCalledTimes(1);
    await queue.start();
    for (const name of Object.values(JOB_NAMES)) {
      await queue.work(name, async () => undefined);
    }

    await expect(queue.workerReadiness()).resolves.toBeUndefined();
    expect(getQueues).toHaveBeenCalledTimes(1);

    const invalidated = vi.fn();
    queue.onReadinessInvalidated(invalidated);
    await queue.offWork(JOB_NAMES.notificationDeliver);
    expect(invalidated).toHaveBeenCalled();
    await expect(queue.workerReadiness()).rejects.toThrow(/Not all declared workers/);
    const replacementId = await queue.work(JOB_NAMES.notificationDeliver, async () => undefined);
    await expect(queue.workerReadiness()).resolves.toBeUndefined();
    await queue.offWork({ id: replacementId });
    await expect(queue.workerReadiness()).rejects.toThrow(/Not all declared workers/);
    await queue.work(JOB_NAMES.notificationDeliver, async () => undefined);
    await expect(queue.workerReadiness()).resolves.toBeUndefined();

    await queue.stop();
    await expect(queue.workerReadiness()).rejects.toThrow(/not started/);
    await expect(queue.work(JOB_NAMES.advisorRun, async () => undefined)).rejects.toThrow(
      /not started/,
    );
  });

  it("fails worker readiness for missing queues, duplicate ids, and an in-progress stop", async () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    vi.spyOn(boss, "start").mockResolvedValue(boss);
    vi.spyOn(boss, "work").mockResolvedValue("duplicate-worker-id");
    vi.spyOn(boss, "offWork").mockResolvedValue();
    const getQueues = vi
      .spyOn(boss, "getQueues")
      .mockResolvedValue(
        Object.values(JOB_NAMES).map((name) => ({ name })) as Awaited<
          ReturnType<PgBoss["getQueues"]>
        >,
      );
    let finishStop: (() => void) | undefined;
    vi.spyOn(boss, "stop").mockImplementation(
      async () => new Promise<void>((resolve) => (finishStop = resolve)),
    );
    const queue = new JobQueue(databaseUrl, { boss, provisionQueues: false });
    await queue.start();
    for (const name of Object.values(JOB_NAMES)) {
      await queue.work(name, async () => undefined);
    }
    await expect(queue.workerReadiness()).rejects.toThrow(/Not all declared workers/);

    vi.spyOn(boss, "work").mockRestore();
    let sequence = 0;
    vi.spyOn(boss, "work").mockImplementation(async (name) => {
      sequence += 1;
      return `${name}-${sequence}`;
    });
    for (const name of Object.values(JOB_NAMES)) await queue.offWork(name);
    for (const name of Object.values(JOB_NAMES)) {
      await queue.work(name, async () => undefined);
    }
    getQueues.mockResolvedValueOnce(
      Object.values(JOB_NAMES)
        .slice(1)
        .map((name) => ({ name })) as Awaited<ReturnType<PgBoss["getQueues"]>>,
    );
    await expect(queue.workerReadiness()).rejects.toThrow(/Declared queue is unavailable/);
    getQueues.mockRejectedValueOnce(new Error("pg-boss connection unavailable"));
    await expect(queue.workerReadiness()).rejects.toThrow(/pg-boss connection unavailable/);

    const stopping = queue.stop();
    await expect(queue.workerReadiness()).rejects.toThrow(/not started/);
    finishStop?.();
    await stopping;
  });

  it("serializes same-name worker registration and rejects cancellation while pending", async () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    vi.spyOn(boss, "start").mockResolvedValue(boss);
    let finishRegistration: (() => void) | undefined;
    const registrationGate = new Promise<void>((resolve) => (finishRegistration = resolve));
    const work = vi.spyOn(boss, "work").mockImplementation(async (name) => {
      await registrationGate;
      return `worker-${name}`;
    });
    vi.spyOn(boss, "offWork").mockResolvedValue();
    const queue = new JobQueue(databaseUrl, { boss, provisionQueues: false });
    await queue.start();

    const first = queue.work(JOB_NAMES.advisorRun, async () => undefined);
    await expect(queue.work(JOB_NAMES.advisorRun, async () => undefined)).rejects.toThrow(
      /already registered or registering/,
    );
    await expect(queue.offWork(JOB_NAMES.advisorRun)).rejects.toThrow(/still in progress/);
    expect(work).toHaveBeenCalledTimes(1);
    finishRegistration?.();
    await expect(first).resolves.toBe("worker-advisor.run");
  });

  it("rechecks the worker registry after the asynchronous queue probe", async () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    vi.spyOn(boss, "start").mockResolvedValue(boss);
    vi.spyOn(boss, "work").mockImplementation(async (name) => `worker-${name}`);
    vi.spyOn(boss, "offWork").mockResolvedValue();
    vi.spyOn(boss, "stop").mockResolvedValue();
    let markProbeStarted: (() => void) | undefined;
    const probeStarted = new Promise<void>((resolve) => (markProbeStarted = resolve));
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
    vi.spyOn(boss, "getQueues").mockImplementation(async () => {
      markProbeStarted?.();
      await probeGate;
      return Object.values(JOB_NAMES).map((name) => ({ name })) as Awaited<
        ReturnType<PgBoss["getQueues"]>
      >;
    });
    const queue = new JobQueue(databaseUrl, { boss, provisionQueues: false });
    await queue.start();
    for (const name of Object.values(JOB_NAMES)) {
      await queue.work(name, async () => undefined);
    }

    const readiness = queue.workerReadiness();
    await probeStarted;
    await queue.offWork(JOB_NAMES.notificationDeliver);
    releaseProbe?.();
    await expect(readiness).rejects.toThrow(/Not all declared workers/);
    await queue.stop();
  });

  it("rechecks the queue lifecycle after the asynchronous queue probe", async () => {
    const databaseUrl = "postgresql://user:password@127.0.0.1:5432/unused";
    const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss", migrate: false });
    vi.spyOn(boss, "start").mockResolvedValue(boss);
    vi.spyOn(boss, "work").mockImplementation(async (name) => `worker-${name}`);
    vi.spyOn(boss, "stop").mockResolvedValue();
    let markProbeStarted: (() => void) | undefined;
    const probeStarted = new Promise<void>((resolve) => (markProbeStarted = resolve));
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
    vi.spyOn(boss, "getQueues").mockImplementation(async () => {
      markProbeStarted?.();
      await probeGate;
      return Object.values(JOB_NAMES).map((name) => ({ name })) as Awaited<
        ReturnType<PgBoss["getQueues"]>
      >;
    });
    const queue = new JobQueue(databaseUrl, { boss, provisionQueues: false });
    await queue.start();
    for (const name of Object.values(JOB_NAMES)) {
      await queue.work(name, async () => undefined);
    }

    const readiness = queue.workerReadiness();
    await probeStarted;
    await queue.stop();
    releaseProbe?.();
    await expect(readiness).rejects.toThrow(/not started/);
  });
});

describe("integration error sanitization", () => {
  it("redacts URL userinfo, headers, query credentials and token-shaped values", () => {
    const secrets = {
      database: "database-secret-fixture",
      bearer: "bearer.secret.fixture",
      query: "query-secret-fixture",
      github: `ghp_${"x".repeat(24)}`,
      basic: "YmFzaWMtc2VjcmV0LWZpeHR1cmU=",
      redis: "redis-secret-fixture",
    };
    const sanitized = sanitizeIntegrationError(
      new Error(
        `postgresql://runtime:${secrets.database}@db.internal/app ` +
          `Authorization: Bearer ${secrets.bearer} ` +
          `Authorization: Basic ${secrets.basic} ` +
          `https://queue.test/send?token=${secrets.query} ${secrets.github}\nnext-line ` +
          `redis://:${secrets.redis}@cache.internal/0`,
      ),
      "safe fallback",
      { maxLength: 500 },
    );

    for (const secret of Object.values(secrets)) expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("postgresql://[REDACTED]@db.internal/app");
    expect(sanitized).not.toContain("\n");
    expect(sanitized.length).toBeLessThanOrEqual(500);
  });

  it("uses a non-empty fallback for non-errors and empty messages", () => {
    expect(sanitizeIntegrationError(null, "safe fallback")).toBe("safe fallback");
    expect(sanitizeIntegrationError(new Error("  \n"), "safe fallback")).toBe("safe fallback");
  });
});

describe("external integration truth boundaries", () => {
  it("manual actions never claim external success", async () => {
    const result = await new ManualExternalActionAdapter().submit({
      actionId: "a",
      actionKind: "bank_payment",
      payload: {},
    });
    expect(result.state).toBe("awaiting_manual_action");
  });

  it("mock actions are explicitly simulated", async () => {
    const result = await new MockExternalActionAdapter().submit({
      actionId: "a",
      actionKind: "bank_payment",
      payload: {},
    });
    expect(result.state).toBe("simulated");
  });
});

describe("GitHub integration truth boundary", () => {
  it("never performs repository reads in manual mode", async () => {
    await expect(new ManualGitHubReader().getRepository("owner/repository")).rejects.toThrow(
      /manual mode/,
    );
  });

  it("performs only a validated read-only repository request and parses the snapshot", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            full_name: "OpenAI/openai-node",
            html_url: "https://github.com/OpenAI/openai-node",
            description: "Official client",
            stargazers_count: 100,
            forks_count: 20,
            open_issues_count: 3,
            default_branch: "master",
            pushed_at: "2026-07-18T00:00:00Z",
            archived: false,
            license: { spdx_id: "Apache-2.0" },
          }),
          { status: 200 },
        ),
    );
    const reader = new GitHubApiReader("read-only-test-token", {
      baseUrl: "https://api.github.test/gateway///",
      fetchImpl,
    });

    await expect(reader.getRepository("OpenAI/openai-node")).resolves.toMatchObject({
      repository: "OpenAI/openai-node",
      stars: 100,
      forks: 20,
      openIssues: 3,
      archived: false,
      license: "Apache-2.0",
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.github.test/gateway/repos/OpenAI/openai-node");
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer read-only-test-token");
  });

  it("rejects insecure, credential-bearing and ambiguous API base URLs before the network", () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    for (const baseUrl of [
      "http://169.254.169.254/latest/meta-data",
      "https://user:secret@api.github.test",
      "https://api.github.test?target=http://127.0.0.1",
      "https://api.github.test/#internal",
      "https://api.github.test?",
      "https://api.github.test/#",
      "not-a-url",
    ]) {
      expect(() => new GitHubApiReader("token", { baseUrl, fetchImpl })).toThrow(
        /GitHub API base URL/,
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses redirects instead of forwarding the repository token", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    });
    const reader = new GitHubApiReader("redirect-secret-token", { fetchImpl });

    await expect(reader.getRepository("owner/repository")).rejects.toThrow(/HTTP 302/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("binds response identity and GitHub URL to the requested repository", async () => {
    const response = (fullName: string, htmlUrl: string) =>
      new Response(
        JSON.stringify({
          full_name: fullName,
          html_url: htmlUrl,
          description: null,
          stargazers_count: 1,
          forks_count: 2,
          open_issues_count: 3,
          default_branch: "main",
          pushed_at: null,
          archived: false,
          license: null,
        }),
      );
    const read = (fullName: string, htmlUrl: string) =>
      new GitHubApiReader(undefined, {
        fetchImpl: async () => response(fullName, htmlUrl),
      }).getRepository("OpenAI/openai-node");

    await expect(read("attacker/other", "https://github.com/attacker/other")).rejects.toThrow(
      /invalid repository response/,
    );
    await expect(read("OpenAI/openai-node", "https://github.com/attacker/other")).rejects.toThrow(
      /invalid repository response/,
    );
    await expect(
      read("openai/OPENAI-NODE", "https://github.com/openai/OPENAI-node///"),
    ).resolves.toMatchObject({ repository: "openai/OPENAI-NODE" });
  });

  it("rejects repository path and query injection before the network", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const reader = new GitHubApiReader(undefined, { fetchImpl });
    await expect(reader.getRepository("owner/repo?visibility=private")).rejects.toThrow(
      /Invalid GitHub repository name/,
    );
    await expect(reader.getRepository("owner/repo/name")).rejects.toThrow(
      /Invalid GitHub repository name/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces rate-limit metadata without copying response bodies or tokens", async () => {
    const reader = new GitHubApiReader("secret-token-never-log", {
      fetchImpl: async () =>
        new Response("untrusted sensitive response", {
          status: 429,
          headers: {
            "retry-after": "60",
            "x-github-request-id": "GH-REQUEST-1",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1784390400",
          },
        }),
    });

    const failure = reader.getRepository("owner/repository");
    await expect(failure).rejects.toThrow(
      /HTTP 429, request GH-REQUEST-1, rate-remaining 0, rate-reset 1784390400, retry-after 60/,
    );
    await expect(failure).rejects.not.toThrow(
      /untrusted sensitive response|secret-token-never-log/,
    );
  });

  it("fails closed on malformed snapshots, oversized responses, and timeouts", async () => {
    const read = (fetchImpl: typeof fetch) =>
      new GitHubApiReader(undefined, { fetchImpl }).getRepository("owner/repository");
    await expect(
      read(async () => new Response(JSON.stringify({ full_name: "owner/repository" }))),
    ).rejects.toThrow(/invalid repository response/);
    await expect(read(async () => new Response("x".repeat(1_000_001)))).rejects.toThrow(
      /1 MB safety limit/,
    );
    await expect(
      read(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    ).rejects.toThrow(/timed out/);
  });

  it("does not retain a sensitive transport error as a serializable cause", async () => {
    const secret = `github-transport-${Math.random().toString(36).slice(2)}-${"x".repeat(16)}`;
    const reader = new GitHubApiReader(undefined, {
      fetchImpl: async () => {
        throw new Error(`Authorization: Bearer ${secret}`);
      },
    });
    let thrown: unknown;
    try {
      await reader.getRepository("owner/repository");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("GitHub read-only request failed");
    expect(String(thrown)).not.toContain(secret);
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("mock LLM truth boundary", () => {
  it("returns explicit simulated structured output", async () => {
    const provider = createLlmProvider({ driver: "mock", model: "ignored" });
    expect(provider).toBeInstanceOf(MockLlmProvider);
    const result = await provider.completeAdvisor({
      system: "test",
      user: { question: "Should we sign?", companyContext: [] },
    });
    expect(result).toMatchObject({ provider: "mock", model: "simulated-advisor-v1" });
    expect(result.rawResponse).toMatchObject({ simulated: true });
    expect(result.output.facts).toEqual([]);
    expect(result.output.confidence).toBe(0);
    expect(result.output.disclaimer).toContain("SIMULATED OUTPUT");
  });
});

const compatibleOutput = {
  facts: [
    {
      claim: "The supplied task is open.",
      evidence: [{ sourceType: "tasks", sourceId: "00000000-0000-4000-8000-000000000001" }],
    },
  ],
  inferences: [{ claim: "Delivery may slip.", basis: ["Open task"], confidence: 0.6 }],
  recommendations: [
    {
      action: "Ask the owner for an updated date.",
      rationale: "The current context has no completion evidence.",
      risk: "The estimate may remain uncertain.",
      priority: "medium",
    },
  ],
  risks: [
    {
      description: "Schedule uncertainty",
      severity: "medium",
      mitigation: "Confirm the dependency and owner.",
    },
  ],
  missingInformation: ["Updated owner estimate"],
  confidence: 0.6,
  disclaimer: "Decision support only.",
};

describe("compatible LLM provider contract", () => {
  it("sends a structured, bounded request and parses the audited output contract", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(compatibleOutput) } }],
            usage: { prompt_tokens: 123, completion_tokens: 45 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const provider = new CompatibleLlmProvider({
      baseUrl: "https://llm.example.test/gateway/",
      apiKey: "test-api-key-never-log",
      model: "approved-model",
      providerName: "contract-test",
      fetchImpl,
    });

    const result = await provider.completeAdvisor({
      system: "System boundary",
      user: { question: "What is the delivery risk?", companyContext: [] },
    });

    expect(result).toMatchObject({
      output: compatibleOutput,
      provider: "contract-test",
      model: "approved-model",
      usage: { inputTokens: 123, outputTokens: 45 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://llm.example.test/gateway/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: "approved-model",
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(request)).not.toContain("test-api-key-never-log");
    expect(JSON.stringify(result.rawResponse)).not.toContain("test-api-key-never-log");
  });

  it("rejects an insecure base URL before making a request", () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));

    expect(
      () =>
        new CompatibleLlmProvider({
          baseUrl: "http://llm.example.test",
          apiKey: "test-key",
          model: "approved-model",
          fetchImpl,
        }),
    ).toThrow(/must use HTTPS/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports rate limits without copying an untrusted response body", async () => {
    const provider = new CompatibleLlmProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "test-key",
      model: "approved-model",
      fetchImpl: async () =>
        new Response("sensitive upstream body", {
          status: 429,
          headers: { "retry-after": "12", "x-request-id": "req-safe-id" },
        }),
    });

    await expect(
      provider.completeAdvisor({ system: "system", user: { question: "question" } }),
    ).rejects.toThrow(/HTTP 429, request req-safe-id, retry-after 12/);
    await expect(
      provider.completeAdvisor({ system: "system", user: { question: "question" } }),
    ).rejects.not.toThrow(/sensitive upstream body/);
  });

  it("fails closed on invalid envelopes, invalid output JSON, and oversized responses", async () => {
    const call = async (response: Response) =>
      new CompatibleLlmProvider({
        baseUrl: "https://llm.example.test",
        apiKey: "test-key",
        model: "approved-model",
        fetchImpl: async () => response,
      }).completeAdvisor({ system: "system", user: { question: "question" } });

    await expect(call(new Response("not-json"))).rejects.toThrow(/invalid response envelope/);
    await expect(
      call(new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }))),
    ).rejects.toThrow(/invalid JSON/);
    await expect(call(new Response("x".repeat(2_000_001)))).rejects.toThrow(/2 MB safety limit/);
    await expect(call(new Response("你".repeat(700_000)))).rejects.toThrow(/2 MB safety limit/);
  });

  it("converts transport aborts into a stable timeout error", async () => {
    const provider = new CompatibleLlmProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "test-key",
      model: "approved-model",
      fetchImpl: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });

    await expect(
      provider.completeAdvisor({ system: "system", user: { question: "question" } }),
    ).rejects.toThrow("LLM provider request timed out");
  });

  it("does not retain a sensitive provider transport error as a serializable cause", async () => {
    const secret = `llm-transport-${Math.random().toString(36).slice(2)}-${"y".repeat(16)}`;
    const provider = new CompatibleLlmProvider({
      baseUrl: "https://llm.example.test",
      apiKey: "test-key",
      model: "approved-model",
      fetchImpl: async () => {
        throw new Error(`Authorization: Basic ${secret}`);
      },
    });
    let thrown: unknown;
    try {
      await provider.completeAdvisor({ system: "system", user: { question: "question" } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).toContain("LLM provider request failed");
    expect(String(thrown)).not.toContain(secret);
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("object storage", () => {
  it("uses opaque organization-scoped keys", async () => {
    const storage = new MemoryObjectStorage();
    const ticket = await storage.createUploadTicket({
      orgId: "org",
      fileId: "file",
      contentType: "application/pdf",
      checksumSha256: "a".repeat(64),
    });
    expect(ticket.storageKey).toBe("org/file");
    expect(ticket.storageKey).not.toContain(".pdf");
  });
});
