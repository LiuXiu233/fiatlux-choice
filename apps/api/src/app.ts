import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { MAX_FILE_SIZE_BYTES } from "@fiatlux/contracts";
import { createDatabase } from "@fiatlux/db";
import {
  createLlmProvider,
  JobQueue,
  MemoryObjectStorage,
  S3ObjectStorage,
} from "@fiatlux/integrations";
import { sql } from "drizzle-orm";
import Fastify from "fastify";

import { registerAdminRoutes, registerOperationsRoutes } from "./admin-routes.js";
import { registerAdvisorRoutes } from "./advisor-routes.js";
import { registerApprovalRoutes } from "./approval-routes.js";
import { registerAuthRoutes } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { registerDashboardRoutes } from "./dashboard-routes.js";
import { registerFileRoutes } from "./file-routes.js";
import { registerErrorHandler } from "./http-errors.js";
import { registerResourceRoutes } from "./resource-routes.js";
import type { AppDependencies } from "./types.js";

export function createDefaultDependencies(config: ApiConfig): AppDependencies {
  const { db, client } = createDatabase(config.DATABASE_URL);
  const storage =
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? new S3ObjectStorage({
          ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
          region: config.S3_REGION,
          bucket: config.S3_BUCKET,
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        })
      : config.NODE_ENV === "production"
        ? (() => {
            throw new Error("Production requires S3 object storage credentials");
          })()
        : new MemoryObjectStorage();
  const llmProvider = createLlmProvider({
    driver: config.LLM_DRIVER,
    ...(config.LLM_BASE_URL ? { baseUrl: config.LLM_BASE_URL } : {}),
    ...(config.LLM_API_KEY ? { apiKey: config.LLM_API_KEY } : {}),
    model: config.LLM_MODEL,
  });
  return {
    config,
    db,
    closeDatabase: () => client.end(),
    storage,
    queue: new JobQueue(config.DATABASE_URL),
    llmProvider,
  };
}

export async function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: {
      level: dependencies.config.NODE_ENV === "test" ? "silent" : "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "apiKey",
        "secretAccessKey",
      ],
    },
    requestIdHeader: "x-request-id",
    trustProxy: dependencies.config.TRUST_PROXY,
  });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_FILE_SIZE_BYTES },
    (_request, payload, done) => done(null, payload),
  );

  await app.register(cookie);
  await app.register(jwt, {
    secret: dependencies.config.JWT_SECRET,
    cookie: { cookieName: "fiatlux_session", signed: false },
  });
  await app.register(cors, {
    origin: dependencies.config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "FIAT LUX CHOICE API",
        description: "Organization-scoped internal company management API",
        version: "0.1.0",
      },
      servers: [{ url: "/api/v1" }],
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: "fiatlux_session" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("onRequest", async (request, reply) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin && origin !== dependencies.config.WEB_ORIGIN) {
        return reply.status(403).send({
          error: {
            code: "FORBIDDEN_ORIGIN",
            message: "Request origin is not allowed",
            requestId: request.id,
          },
        });
      }
    }
  });

  app.get("/health", { schema: { tags: ["health"] } }, async () => ({
    data: { status: "ok", service: "api", timestamp: new Date() },
  }));
  app.get("/health/live", { schema: { tags: ["health"] } }, async () => ({
    data: { status: "alive" },
  }));
  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const results = await Promise.allSettled([
      dependencies.db.execute(sql`SELECT 1`),
      dependencies.queue
        ? dependencies.queue.healthCheck()
        : Promise.reject(new Error("queue unavailable")),
      dependencies.storage.healthCheck(),
    ]);
    const checks = {
      database: results[0]?.status === "fulfilled" ? "ready" : "unavailable",
      queue: results[1]?.status === "fulfilled" ? "ready" : "unavailable",
      objectStorage: results[2]?.status === "fulfilled" ? "ready" : "unavailable",
    };
    if (Object.values(checks).some((status) => status !== "ready")) {
      return reply.status(503).send({ data: { status: "not_ready", checks } });
    }
    return { data: { status: "ready", checks } };
  });

  const authenticate = registerAuthRoutes(app, dependencies);
  registerDashboardRoutes(app, dependencies, authenticate);
  registerResourceRoutes(app, dependencies, authenticate);
  registerApprovalRoutes(app, dependencies, authenticate);
  registerFileRoutes(app, dependencies, authenticate);
  registerAdvisorRoutes(app, dependencies, authenticate);
  registerAdminRoutes(app, dependencies, authenticate);
  registerOperationsRoutes(app, dependencies, authenticate);

  registerErrorHandler(app, dependencies.db);
  app.addHook("onClose", async () => {
    if (dependencies.closeDatabase) await dependencies.closeDatabase();
  });

  return app;
}
