import { JobQueue } from "./jobs.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const queue = new JobQueue(databaseUrl);
try {
  await queue.start();
} finally {
  await queue.stop();
}

console.log("pg-boss schema and declared queues are ready");
