import { createDatabase } from "@fiatlux/db";
import {
  createLlmProvider,
  GitHubApiReader,
  JOB_NAMES,
  type JobPayloads,
  JobQueue,
  ManualGitHubReader,
} from "@fiatlux/integrations";

import { readWorkerConfig } from "./config.js";
import {
  handleAdvisorRun,
  handleBackup,
  handleGitHubRefresh,
  handleNotification,
  handleObligationSweep,
  handleWorkflowRun,
  type WorkerDependencies,
} from "./handlers.js";

const config = readWorkerConfig();
const { db, client } = createDatabase(config.DATABASE_URL);
const queue = new JobQueue(config.DATABASE_URL);
const llmProvider = createLlmProvider({
  driver: config.LLM_DRIVER,
  ...(config.LLM_BASE_URL ? { baseUrl: config.LLM_BASE_URL } : {}),
  ...(config.LLM_API_KEY ? { apiKey: config.LLM_API_KEY } : {}),
  model: config.LLM_MODEL,
});
const dependencies: WorkerDependencies = {
  db,
  queue,
  llmProvider,
  github:
    config.GITHUB_INTEGRATION_MODE === "read_only"
      ? new GitHubApiReader(config.GITHUB_TOKEN)
      : new ManualGitHubReader(),
  config,
};

await queue.start();

await queue.boss.work<JobPayloads["advisor.run"]>(JOB_NAMES.advisorRun, async ([job]) => {
  if (job) await handleAdvisorRun(dependencies, job.data);
});
await queue.boss.work<JobPayloads["workflow.run"]>(JOB_NAMES.workflowRun, async ([job]) => {
  if (job) await handleWorkflowRun(dependencies, job.data);
});
await queue.boss.work<JobPayloads["notification.deliver"]>(
  JOB_NAMES.notificationDeliver,
  async ([job]) => {
    if (job) await handleNotification(dependencies, job.data);
  },
);
await queue.boss.work<JobPayloads["github.refresh"]>(JOB_NAMES.githubRefresh, async ([job]) => {
  if (job) await handleGitHubRefresh(dependencies, job.data);
});
await queue.boss.work<JobPayloads["obligation.sweep"]>(JOB_NAMES.obligationSweep, async ([job]) => {
  if (job) await handleObligationSweep(dependencies, job.data);
});
await queue.boss.work<JobPayloads["backup.create"]>(JOB_NAMES.backupCreate, async ([job]) => {
  if (job) await handleBackup(dependencies, job.data);
});

await queue.boss.schedule(
  JOB_NAMES.obligationSweep,
  "15 * * * *",
  { orgId: "*" },
  { tz: "Asia/Shanghai" },
);
console.log("FIAT LUX worker started");

const shutdown = async (signal: string) => {
  console.log(`FIAT LUX worker received ${signal}`);
  await queue.stop();
  await client.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
