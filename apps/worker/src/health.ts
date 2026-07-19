import { rmSync, statSync, writeFileSync } from "node:fs";

export const WORKER_HEARTBEAT_PATH = "/tmp/fiatlux-worker-heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const WORKER_HEARTBEAT_MAX_AGE_MS = 30_000;
export const WORKER_HEARTBEAT_MAX_FUTURE_SKEW_MS = 1_000;
export const WORKER_HEARTBEAT_PROBE_TIMEOUT_MS = 5_000;

export interface WorkerHeartbeatController {
  checkNow(): Promise<boolean>;
  markUnready(): void;
  stop(): void;
}

export function writeWorkerHeartbeat(path = WORKER_HEARTBEAT_PATH, now = new Date()): void {
  writeFileSync(path, `${now.toISOString()}\n`, {
    encoding: "utf8",
    flag: "w",
    mode: 0o600,
  });
}

export function isWorkerHeartbeatFresh(
  path = WORKER_HEARTBEAT_PATH,
  maxAgeMs = WORKER_HEARTBEAT_MAX_AGE_MS,
  nowMs = Date.now(),
): boolean {
  try {
    const stat = statSync(path);
    const ageMs = nowMs - stat.mtimeMs;
    return stat.isFile() && ageMs >= -WORKER_HEARTBEAT_MAX_FUTURE_SKEW_MS && ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

interface ProbeOutcome {
  error?: unknown;
  ok: boolean;
  probePromise: Promise<void>;
  timedOut: boolean;
}

async function probeWithTimeout(
  probe: () => Promise<void>,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const probePromise = Promise.resolve().then(probe);
  try {
    return await Promise.race([
      probePromise.then<ProbeOutcome, ProbeOutcome>(
        () => ({ ok: true, probePromise, timedOut: false }),
        (error: unknown) => ({ error, ok: false, probePromise, timedOut: false }),
      ),
      new Promise<ProbeOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              error: new Error("Worker health probe timed out"),
              ok: false,
              probePromise,
              timedOut: true,
            }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function startWorkerHeartbeat(input: {
  probe: () => Promise<void>;
  onProbeError?: (error: unknown) => void;
  path?: string;
  intervalMs?: number;
  probeTimeoutMs?: number;
}): Promise<WorkerHeartbeatController> {
  const path = input.path ?? WORKER_HEARTBEAT_PATH;
  const intervalMs = input.intervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const probeTimeoutMs = input.probeTimeoutMs ?? WORKER_HEARTBEAT_PROBE_TIMEOUT_MS;
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error("Worker heartbeat interval must be a positive integer");
  }
  if (!Number.isInteger(probeTimeoutMs) || probeTimeoutMs < 1 || probeTimeoutMs >= intervalMs) {
    throw new Error("Worker health probe timeout must be positive and shorter than the interval");
  }

  rmSync(path, { force: true });
  let stopped = false;
  let checking = false;
  let invalidationGeneration = 0;
  const checkNow = async () => {
    if (stopped || checking) return false;
    checking = true;
    const probeGeneration = invalidationGeneration;
    const outcome = await probeWithTimeout(input.probe, probeTimeoutMs);
    if (outcome.timedOut) {
      void outcome.probePromise
        .finally(() => {
          checking = false;
        })
        .catch(() => undefined);
    } else {
      checking = false;
    }
    if (!outcome.ok) {
      input.onProbeError?.(outcome.error);
      return false;
    }
    if (stopped || probeGeneration !== invalidationGeneration) return false;
    writeWorkerHeartbeat(path);
    return true;
  };

  if (!(await checkNow())) {
    throw new Error("Initial worker queue health probe failed");
  }
  const timer = setInterval(() => void checkNow(), intervalMs);
  timer.unref();
  return {
    checkNow,
    markUnready: () => {
      invalidationGeneration += 1;
      rmSync(path, { force: true });
    },
    stop: () => {
      stopped = true;
      invalidationGeneration += 1;
      clearInterval(timer);
      rmSync(path, { force: true });
    },
  };
}
