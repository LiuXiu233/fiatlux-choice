import { buildApp, createDefaultDependencies } from "./app.js";
import { readApiConfig } from "./config.js";

const config = readApiConfig();
const dependencies = createDefaultDependencies(config);

if (dependencies.queue) await dependencies.queue.start();
const app = await buildApp(dependencies);

const close = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  if (dependencies.queue) await dependencies.queue.stop();
  process.exit(0);
};

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  if (dependencies.queue) await dependencies.queue.stop();
  await app.close();
  process.exit(1);
}
