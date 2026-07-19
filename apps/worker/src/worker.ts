import { createDatabase } from "@fiatlux/db";
import {
  createLlmProvider,
  GitHubApiReader,
  JOB_NAMES,
  JobQueue,
  ManualGitHubReader,
  OfficialSourceReader,
  sanitizeIntegrationError,
} from "@fiatlux/integrations";

import { readWorkerConfig } from "./config.js";
import {
  handleAdvisorRun,
  handleBackup,
  handleComplianceSourceMonitor,
  handleGitHubRefresh,
  handleNotification,
  handleObligationSweep,
  handleWorkflowRun,
  type WorkerDependencies,
} from "./handlers.js";
import { startWorkerHeartbeat } from "./health.js";

const config = readWorkerConfig();
const { db, client } = createDatabase(config.DATABASE_URL);
const queue = new JobQueue(config.DATABASE_URL, { migrate: false, provisionQueues: false });
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
  officialSource: new OfficialSourceReader(),
  config,
};

let heartbeat: Awaited<ReturnType<typeof startWorkerHeartbeat>> | undefined;
queue.onError((error) => {
  console.error(
    `FIAT LUX worker queue error: ${sanitizeIntegrationError(error, "Queue failure", { maxLength: 500 })}`,
  );
});
queue.onReadinessInvalidated(() => heartbeat?.markUnready());

await queue.start();

await queue.work(JOB_NAMES.advisorRun, async ([job]) => {
  if (job) await handleAdvisorRun(dependencies, job.data);
});
await queue.work(JOB_NAMES.workflowRun, async ([job]) => {
  if (job) await handleWorkflowRun(dependencies, job.data);
});
await queue.work(JOB_NAMES.notificationDeliver, async ([job]) => {
  if (job) await handleNotification(dependencies, job.data);
});
await queue.work(JOB_NAMES.githubRefresh, async ([job]) => {
  if (job) await handleGitHubRefresh(dependencies, job.data);
});
await queue.work(JOB_NAMES.obligationSweep, async ([job]) => {
  if (job) await handleObligationSweep(dependencies, job.data);
});
await queue.work(JOB_NAMES.complianceSourceMonitor, async ([job]) => {
  if (job) await handleComplianceSourceMonitor(dependencies, job.data);
});
await queue.work(JOB_NAMES.backupCreate, async ([job]) => {
  if (job) await handleBackup(dependencies, job.data);
});

await queue.schedule(
  JOB_NAMES.obligationSweep,
  "15 * * * *",
  { orgId: "*" },
  { tz: "Asia/Shanghai" },
);
await queue.schedule(
  JOB_NAMES.complianceSourceMonitor,
  "30 2 * * *",
  { orgId: "*" },
  { tz: "Asia/Shanghai" },
);
heartbeat = await startWorkerHeartbeat({
  probe: () => queue.workerReadiness(),
  onProbeError: (error) => {
    console.error(
      `FIAT LUX worker health probe failed: ${sanitizeIntegrationError(error, "Queue health probe failed", { maxLength: 500 })}`,
    );
  },
});
console.log("FIAT LUX worker started");

const shutdown = async (signal: string) => {
  console.log(`FIAT LUX worker received ${signal}`);
  heartbeat?.stop();
  await queue.stop();
  await client.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
