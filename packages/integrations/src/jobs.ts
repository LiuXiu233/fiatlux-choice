import PgBoss from "pg-boss";

export const JOB_NAMES = {
  advisorRun: "advisor.run",
  workflowRun: "workflow.run",
  notificationDeliver: "notification.deliver",
  githubRefresh: "github.refresh",
  obligationSweep: "obligation.sweep",
  backupCreate: "backup.create",
} as const;

export interface JobPayloads {
  "advisor.run": { orgId: string; runId: string };
  "workflow.run": { orgId: string; runId: string };
  "notification.deliver": { orgId: string; notificationId: string };
  "github.refresh": { orgId: string; insightId: string };
  "obligation.sweep": { orgId: string };
  "backup.create": { orgId: string; backupId: string };
}

export type JobName = keyof JobPayloads;

export class JobQueue {
  readonly boss: PgBoss;

  constructor(databaseUrl: string) {
    this.boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
  }

  async start() {
    await this.boss.start();
    for (const name of Object.values(JOB_NAMES)) {
      await this.boss.createQueue(name);
    }
  }

  async stop() {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async healthCheck() {
    await this.boss.getQueueSize(JOB_NAMES.advisorRun);
  }

  async send<Name extends JobName>(name: Name, data: JobPayloads[Name]) {
    const id = await this.boss.send(name, data, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 600,
    });
    if (!id) throw new Error(`Failed to enqueue ${name}`);
    return id;
  }
}
