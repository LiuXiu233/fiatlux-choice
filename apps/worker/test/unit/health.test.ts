import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isWorkerHeartbeatFresh,
  startWorkerHeartbeat,
  writeWorkerHeartbeat,
} from "../../src/health.js";

const temporaryDirectories: string[] = [];

function temporaryHeartbeatPath() {
  const directory = mkdtempSync(join(tmpdir(), "fiatlux-worker-health-"));
  temporaryDirectories.push(directory);
  return join(directory, "heartbeat");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("worker heartbeat", () => {
  it("writes a private heartbeat only after a successful queue probe", async () => {
    const path = temporaryHeartbeatPath();
    const controller = await startWorkerHeartbeat({
      path,
      intervalMs: 60_000,
      probe: async () => undefined,
      probeTimeoutMs: 1_000,
    });
    try {
      expect(readFileSync(path, "utf8")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(isWorkerHeartbeatFresh(path)).toBe(true);
    } finally {
      controller.stop();
    }
  });

  it("stops refreshing on queue failure and recovers only after a successful probe", async () => {
    const path = temporaryHeartbeatPath();
    let available = true;
    const errors: unknown[] = [];
    const controller = await startWorkerHeartbeat({
      path,
      intervalMs: 60_000,
      probe: async () => {
        if (!available) throw new Error("queue unavailable");
      },
      onProbeError: (error) => errors.push(error),
      probeTimeoutMs: 1_000,
    });
    const previousMtime = statSync(path).mtimeMs;
    available = false;
    expect(await controller.checkNow()).toBe(false);
    expect(statSync(path).mtimeMs).toBe(previousMtime);
    expect(errors).toHaveLength(1);

    controller.markUnready();
    expect(isWorkerHeartbeatFresh(path)).toBe(false);
    available = true;
    expect(await controller.checkNow()).toBe(true);
    expect(isWorkerHeartbeatFresh(path)).toBe(true);
    controller.stop();
    expect(isWorkerHeartbeatFresh(path)).toBe(false);
  });

  it("keeps a timed-out queue probe single-flight until the underlying query settles", async () => {
    const path = temporaryHeartbeatPath();
    let calls = 0;
    let releaseHungProbe: (() => void) | undefined;
    let markHungProbeSettled: (() => void) | undefined;
    const hungProbeSettled = new Promise<void>((resolve) => (markHungProbeSettled = resolve));
    const controller = await startWorkerHeartbeat({
      path,
      intervalMs: 100,
      probeTimeoutMs: 10,
      probe: async () => {
        calls += 1;
        if (calls === 2) {
          await new Promise<void>((resolve) => (releaseHungProbe = resolve));
          markHungProbeSettled?.();
        }
      },
    });
    expect(await controller.checkNow()).toBe(false);
    expect(await controller.checkNow()).toBe(false);
    expect(calls).toBe(2);
    releaseHungProbe?.();
    await hungProbeSettled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await controller.checkNow()).toBe(true);
    expect(calls).toBe(3);
    controller.stop();
  });

  it("does not let an in-flight successful probe resurrect a heartbeat after invalidation", async () => {
    const path = temporaryHeartbeatPath();
    let calls = 0;
    let markProbeStarted: (() => void) | undefined;
    const probeStarted = new Promise<void>((resolve) => (markProbeStarted = resolve));
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
    const controller = await startWorkerHeartbeat({
      path,
      intervalMs: 60_000,
      probeTimeoutMs: 1_000,
      probe: async () => {
        calls += 1;
        if (calls === 2) {
          markProbeStarted?.();
          await probeGate;
        }
      },
    });
    try {
      const inFlight = controller.checkNow();
      await probeStarted;
      controller.markUnready();
      expect(isWorkerHeartbeatFresh(path)).toBe(false);
      releaseProbe?.();
      await expect(inFlight).resolves.toBe(false);
      expect(isWorkerHeartbeatFresh(path)).toBe(false);

      await expect(controller.checkNow()).resolves.toBe(true);
      expect(isWorkerHeartbeatFresh(path)).toBe(true);
    } finally {
      controller.stop();
    }
  });

  it("does not let an in-flight successful probe write after the controller stops", async () => {
    const path = temporaryHeartbeatPath();
    let calls = 0;
    let markProbeStarted: (() => void) | undefined;
    const probeStarted = new Promise<void>((resolve) => (markProbeStarted = resolve));
    let releaseProbe: (() => void) | undefined;
    const probeGate = new Promise<void>((resolve) => (releaseProbe = resolve));
    const controller = await startWorkerHeartbeat({
      path,
      intervalMs: 60_000,
      probeTimeoutMs: 1_000,
      probe: async () => {
        calls += 1;
        if (calls === 2) {
          markProbeStarted?.();
          await probeGate;
        }
      },
    });

    const inFlight = controller.checkNow();
    await probeStarted;
    controller.stop();
    releaseProbe?.();
    await expect(inFlight).resolves.toBe(false);
    expect(isWorkerHeartbeatFresh(path)).toBe(false);
  });

  it("fails closed for missing, future, stale, and non-file heartbeats", () => {
    const path = temporaryHeartbeatPath();
    expect(isWorkerHeartbeatFresh(path)).toBe(false);

    writeFileSync(path, "stale\n", { mode: 0o600 });
    const modifiedAt = statSync(path).mtimeMs;
    expect(isWorkerHeartbeatFresh(path, 30_000, modifiedAt + 30_000)).toBe(true);
    expect(isWorkerHeartbeatFresh(path, 30_000, modifiedAt + 30_001)).toBe(false);
    expect(isWorkerHeartbeatFresh(path, 30_000, modifiedAt - 1_001)).toBe(false);
    expect(isWorkerHeartbeatFresh(join(path, "missing"))).toBe(false);
  });

  it("validates interval configuration and supports deterministic timestamps", async () => {
    const path = temporaryHeartbeatPath();
    const timestamp = new Date("2026-07-19T01:23:45.000Z");
    writeWorkerHeartbeat(path, timestamp);
    expect(readFileSync(path, "utf8")).toBe("2026-07-19T01:23:45.000Z\n");
    await expect(
      startWorkerHeartbeat({ path, intervalMs: 0, probe: async () => undefined }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      startWorkerHeartbeat({
        path,
        intervalMs: 100,
        probe: async () => undefined,
        probeTimeoutMs: 100,
      }),
    ).rejects.toThrow(/shorter than the interval/);
    await expect(
      startWorkerHeartbeat({
        path,
        intervalMs: 100,
        probe: async () => {
          throw new Error("unavailable");
        },
        probeTimeoutMs: 10,
      }),
    ).rejects.toThrow(/Initial worker queue health probe failed/);
  });
});
