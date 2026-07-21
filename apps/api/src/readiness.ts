export type ReadinessStatus = "ready" | "unavailable";

/**
 * Bounds a dependency probe without abandoning its underlying operation. A timed-out probe stays
 * single-flight until it actually settles, so repeated health requests cannot pile up additional
 * database, queue or object-storage operations while that dependency is degraded.
 */
export function createBoundedReadinessProbe(
  probe: () => Promise<unknown>,
  timeoutMs: number,
): () => Promise<ReadinessStatus> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Readiness timeout must be a positive integer");
  }

  let inFlight: Promise<unknown> | undefined;
  const startProbe = () => {
    const operation = Promise.resolve().then(probe);
    const tracked = operation.finally(() => {
      if (inFlight === tracked) inFlight = undefined;
    });
    inFlight = tracked;
    return tracked;
  };

  return async () => {
    const operation = inFlight ?? startProbe();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation.then<ReadinessStatus, ReadinessStatus>(
          () => "ready",
          () => "unavailable",
        ),
        new Promise<ReadinessStatus>((resolve) => {
          timer = setTimeout(() => resolve("unavailable"), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
