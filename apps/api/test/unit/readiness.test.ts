import type { Database } from "@fiatlux/db";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";
import { createBoundedReadinessProbe } from "../../src/readiness.js";

describe("bounded readiness probes", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("keeps a timed-out dependency single-flight until the underlying operation settles", async () => {
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const firstOperation = new Promise<void>((resolve) => (releaseFirst = resolve));
    const probe = createBoundedReadinessProbe(async () => {
      calls += 1;
      if (calls === 1) await firstOperation;
    }, 10);

    await expect(probe()).resolves.toBe("unavailable");
    await expect(probe()).resolves.toBe("unavailable");
    expect(calls).toBe(1);

    releaseFirst?.();
    await firstOperation;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(probe()).resolves.toBe("ready");
    expect(calls).toBe(2);
  });

  it("clears a rejected probe so the dependency can recover", async () => {
    let available = false;
    let calls = 0;
    const probe = createBoundedReadinessProbe(async () => {
      calls += 1;
      if (!available) throw new Error("database unavailable");
    }, 100);

    await expect(probe()).resolves.toBe("unavailable");
    available = true;
    await expect(probe()).resolves.toBe("ready");
    expect(calls).toBe(2);
  });

  it("returns a bounded 503 and does not duplicate a hung database query", async () => {
    let databaseCalls = 0;
    const database = {
      execute: () => {
        databaseCalls += 1;
        return new Promise<never>(() => undefined);
      },
    } as unknown as Database;
    const queue = {
      healthCheck: async () => undefined,
    } as unknown as JobQueue;
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
      JWT_SECRET: "readiness-test-secret-longer-than-32-characters",
      LLM_DRIVER: "mock",
      READINESS_TIMEOUT_MS: 100,
    });
    app = await buildApp({
      config,
      db: database,
      queue,
      storage: new MemoryObjectStorage(),
    });

    const startedAt = performance.now();
    const first = await app.inject({ method: "GET", url: "/health/ready" });
    const elapsedMs = performance.now() - startedAt;
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({
      data: {
        status: "not_ready",
        checks: { database: "unavailable", queue: "ready", objectStorage: "ready" },
      },
    });
    expect(elapsedMs).toBeLessThan(1_000);

    const second = await app.inject({ method: "GET", url: "/health/ready" });
    expect(second.statusCode).toBe(503);
    expect(databaseCalls).toBe(1);
  });

  it("rejects an invalid timeout", () => {
    expect(() => createBoundedReadinessProbe(async () => undefined, 0)).toThrow(/positive integer/);
  });
});
