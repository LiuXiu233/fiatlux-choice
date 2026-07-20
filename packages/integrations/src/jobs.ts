import PgBoss from "pg-boss";

import { sanitizeIntegrationError } from "./safe-error.js";

export const JOB_NAMES = {
  advisorRun: "advisor.run",
  workflowRun: "workflow.run",
  notificationDeliver: "notification.deliver",
  githubRefresh: "github.refresh",
  integrationTest: "integration.test",
  obligationSweep: "obligation.sweep",
  complianceSourceMonitor: "compliance-source.monitor",
  backupCreate: "backup.create",
} as const;

// pg-boss expires an active job and schedules a retry when the lease elapses.
// Database backups have a one-hour command timeout, so keep the queue lease
// longer than the worker's two-hour database claim lease.  The retry then
// reaches the worker only after the row can be classified as stale and failed
// for manual review, never while a legitimate dump is still running.
export const BACKUP_CLAIM_LEASE_SECONDS = 2 * 60 * 60;
export const BACKUP_JOB_EXPIRE_SECONDS = BACKUP_CLAIM_LEASE_SECONDS + 10 * 60;

export interface JobPayloads {
  "advisor.run": { orgId: string; runId: string };
  "workflow.run": { orgId: string; runId: string };
  "notification.deliver": { orgId: string; notificationId: string };
  "github.refresh": { orgId: string; insightId: string; expectedVersion: number };
  "integration.test": {
    orgId: string;
    checkId: string;
    integrationId: "llm" | "github";
    requestedBy: string;
  };
  "obligation.sweep": { orgId: string };
  "compliance-source.monitor": {
    orgId: string;
    sourceId?: string;
    requestedBy?: string;
    claimToken?: string;
  };
  "backup.create": { orgId: string; backupId: string };
}

export type JobName = keyof JobPayloads;

export interface JobQueueOptions {
  applicationName?: string;
  migrate?: boolean;
  provisionQueues?: boolean;
  connectTimeoutSeconds?: number;
  maxConnections?: number;
  boss?: PgBoss;
}

function integerOption(name: string, value: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function databaseApplicationName(value: string) {
  if (!/^[A-Za-z0-9._-]{1,63}$/.test(value)) {
    throw new Error(
      "Queue database application name must contain 1-63 ASCII letters, numbers, dots, underscores or hyphens",
    );
  }
  return value;
}

type JobQueueLifecycle = "created" | "started" | "stopping" | "stopped";
type QueueErrorHandler = (error: unknown) => void;
type ReadinessInvalidatedHandler = () => void;

export class JobQueue {
  readonly #boss: PgBoss;
  private readonly provisionQueues: boolean;
  readonly #subscriptions = new Map<JobName, string>();
  readonly #pendingSubscriptions = new Set<JobName>();
  readonly #queueErrorHandlers = new Set<QueueErrorHandler>();
  readonly #readinessInvalidatedHandlers = new Set<ReadinessInvalidatedHandler>();
  #lifecycle: JobQueueLifecycle = "created";

  constructor(databaseUrl: string, options: JobQueueOptions = {}) {
    this.provisionQueues = options.provisionQueues ?? true;
    const maxConnections = integerOption(
      "Queue database max connections",
      options.maxConnections ?? 5,
      1,
      50,
    );
    const connectTimeoutSeconds = integerOption(
      "Queue database connect timeout",
      options.connectTimeoutSeconds ?? 10,
      1,
      60,
    );
    const applicationName = databaseApplicationName(options.applicationName ?? "fiatlux-queue");
    this.#boss =
      options.boss ??
      new PgBoss({
        application_name: applicationName,
        connectionString: databaseUrl,
        // pg-boss forwards its database config to node-postgres. Its current public type omits
        // this supported pg.Pool option, so keep the local intersection until upstream exposes it.
        connectionTimeoutMillis: connectTimeoutSeconds * 1_000,
        max: maxConnections,
        schema: "pgboss",
        migrate: options.migrate ?? true,
      } as PgBoss.ConstructorOptions & { connectionTimeoutMillis: number });
    this.#boss.on("error", (error) => {
      if (this.#queueErrorHandlers.size === 0) {
        console.error(
          `FIAT LUX job queue error: ${sanitizeIntegrationError(error, "Queue failure", { maxLength: 500 })}`,
        );
      } else {
        for (const handler of this.#queueErrorHandlers) handler(error);
      }
    });
    this.#boss.on("stopped", () => {
      this.#lifecycle = "stopped";
      this.#subscriptions.clear();
      this.#pendingSubscriptions.clear();
      this.#invalidateReadiness();
    });
  }

  async start() {
    if (this.#lifecycle === "started") return;
    if (this.#lifecycle === "stopping") throw new Error("Job queue is stopping");
    await this.#boss.start();
    this.#lifecycle = "started";
    if (this.provisionQueues) {
      for (const name of Object.values(JOB_NAMES)) {
        await this.#boss.createQueue(name);
      }
    }
  }

  async stop() {
    if (this.#lifecycle === "stopping" || this.#lifecycle === "stopped") return;
    this.#lifecycle = "stopping";
    this.#subscriptions.clear();
    this.#pendingSubscriptions.clear();
    this.#invalidateReadiness();
    try {
      await this.#boss.stop({ graceful: true, timeout: 10_000 });
    } finally {
      this.#lifecycle = "stopped";
      this.#subscriptions.clear();
      this.#pendingSubscriptions.clear();
      this.#invalidateReadiness();
    }
  }

  async healthCheck() {
    const queueNames = new Set((await this.#boss.getQueues()).map((queue) => queue.name));
    for (const name of Object.values(JOB_NAMES)) {
      if (!queueNames.has(name)) throw new Error(`Declared queue is unavailable: ${name}`);
    }
  }

  async workerReadiness() {
    this.#assertWorkerRegistryReady();
    await this.healthCheck();
    this.#assertWorkerRegistryReady();
  }

  #assertWorkerRegistryReady() {
    if (this.#lifecycle !== "started") throw new Error("Job queue is not started");
    const expected = [...Object.values(JOB_NAMES)].sort();
    const registered = [...this.#subscriptions.keys()].sort();
    if (
      registered.length !== expected.length ||
      registered.some((name, index) => name !== expected[index]) ||
      new Set(this.#subscriptions.values()).size !== expected.length ||
      this.#pendingSubscriptions.size !== 0
    ) {
      throw new Error("Not all declared workers are registered");
    }
  }

  async work<Name extends JobName>(
    name: Name,
    handler: PgBoss.WorkHandler<JobPayloads[Name]>,
  ): Promise<string> {
    if (this.#lifecycle !== "started") throw new Error("Job queue is not started");
    if (this.#subscriptions.has(name) || this.#pendingSubscriptions.has(name)) {
      throw new Error(`Worker is already registered or registering: ${name}`);
    }
    this.#pendingSubscriptions.add(name);
    this.#invalidateReadiness();
    try {
      const id = await this.#boss.work<JobPayloads[Name]>(name, handler);
      if (!id) throw new Error(`Worker registration returned no id: ${name}`);
      if (this.#lifecycle !== "started") {
        await this.#boss.offWork({ id });
        throw new Error("Job queue stopped while a worker was being registered");
      }
      this.#subscriptions.set(name, id);
      this.#invalidateReadiness();
      return id;
    } finally {
      this.#pendingSubscriptions.delete(name);
    }
  }

  async offWork(nameOrId: JobName | { id: string }): Promise<void> {
    if (typeof nameOrId === "string") {
      if (this.#pendingSubscriptions.has(nameOrId)) {
        throw new Error(`Worker registration is still in progress: ${nameOrId}`);
      }
      this.#subscriptions.delete(nameOrId);
      this.#invalidateReadiness();
      await this.#boss.offWork(nameOrId);
      return;
    } else {
      for (const [name, id] of this.#subscriptions) {
        if (id === nameOrId.id) this.#subscriptions.delete(name);
      }
    }
    this.#invalidateReadiness();
    await this.#boss.offWork(nameOrId);
  }

  async schedule<Name extends JobName>(
    name: Name,
    cron: string,
    data: JobPayloads[Name],
    options?: PgBoss.ScheduleOptions,
  ) {
    if (this.#lifecycle !== "started") throw new Error("Job queue is not started");
    await this.#boss.schedule(name, cron, data, options);
  }

  async getQueueSize(name: JobName) {
    return this.#boss.getQueueSize(name);
  }

  onError(handler: QueueErrorHandler): () => void {
    this.#queueErrorHandlers.add(handler);
    return () => this.#queueErrorHandlers.delete(handler);
  }

  onReadinessInvalidated(handler: ReadinessInvalidatedHandler): () => void {
    this.#readinessInvalidatedHandlers.add(handler);
    return () => this.#readinessInvalidatedHandlers.delete(handler);
  }

  #invalidateReadiness() {
    for (const handler of this.#readinessInvalidatedHandlers) handler();
  }

  async send<Name extends JobName>(name: Name, data: JobPayloads[Name]) {
    const expireInSeconds = name === JOB_NAMES.backupCreate ? BACKUP_JOB_EXPIRE_SECONDS : 10 * 60;
    const id = await this.#boss.send(name, data, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds,
    });
    if (!id) throw new Error(`Failed to enqueue ${name}`);
    return id;
  }
}
