import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { MAX_FILE_SIZE_BYTES } from "@fiatlux/contracts";
import { createDatabase } from "@fiatlux/db";
import { JobQueue, MemoryObjectStorage, S3ObjectStorage } from "@fiatlux/integrations";
import { sql } from "drizzle-orm";
import Fastify from "fastify";

import { registerAdminRoutes, registerOperationsRoutes } from "./admin-routes.js";
import { registerAdvisorRoutes } from "./advisor-routes.js";
import { registerApprovalRoutes } from "./approval-routes.js";
import { registerAuthRoutes } from "./auth.js";
import { registerComplianceMonitorRoutes } from "./compliance-monitor-routes.js";
import { registerComplianceReviewRoutes } from "./compliance-review-routes.js";
import type { ApiConfig } from "./config.js";
import { registerDashboardRoutes } from "./dashboard-routes.js";
import { registerFileRoutes } from "./file-routes.js";
import { registerErrorHandler } from "./http-errors.js";
import {
  attachPublicRouteInventory,
  OPENAPI_ERROR_SCHEMA,
  openApiTransform,
  openApiTransformObject,
} from "./openapi.js";
import { registerOperationalIncidentRoutes } from "./operational-incident-routes.js";
import { createBoundedReadinessProbe } from "./readiness.js";
import { registerResourceRoutes } from "./resource-routes.js";
import type { AppDependencies } from "./types.js";

export function createDefaultDependencies(config: ApiConfig): AppDependencies {
  const { db, client } = createDatabase(config.DATABASE_URL, {
    applicationName: "fiatlux-api",
    connectTimeoutSeconds: config.DATABASE_CONNECT_TIMEOUT_SECONDS,
    maxConnections: config.DATABASE_POOL_SIZE,
  });
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
  return {
    config,
    db,
    closeDatabase: () => client.end(),
    storage,
    queue: new JobQueue(config.DATABASE_URL, {
      applicationName: "fiatlux-api-queue",
      connectTimeoutSeconds: config.DATABASE_CONNECT_TIMEOUT_SECONDS,
      maxConnections: config.DATABASE_POOL_SIZE,
      migrate: false,
      provisionQueues: false,
    }),
  };
}

export async function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    exposeHeadRoutes: false,
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
  const databaseReadiness = createBoundedReadinessProbe(
    () => dependencies.db.execute(sql`SELECT 1`),
    dependencies.config.READINESS_TIMEOUT_MS,
  );
  const queueReadiness = createBoundedReadinessProbe(
    () =>
      dependencies.queue
        ? dependencies.queue.healthCheck()
        : Promise.reject(new Error("queue unavailable")),
    dependencies.config.READINESS_TIMEOUT_MS,
  );
  const objectStorageReadiness = createBoundedReadinessProbe(
    () => dependencies.storage.healthCheck(),
    dependencies.config.READINESS_TIMEOUT_MS,
  );

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
      openapi: "3.1.0",
      jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
      info: {
        title: "FIAT LUX CHOICE API",
        description: "Organization-scoped internal company management API",
        version: "0.1.0",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: "fiatlux_session" },
        },
        schemas: { ErrorResponse: OPENAPI_ERROR_SCHEMA },
      },
    },
    transform: openApiTransform,
    transformObject: openApiTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  attachPublicRouteInventory(app);

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

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store, max-age=0");
      reply.header("Pragma", "no-cache");
      reply.header("Expires", "0");
    }
    return payload;
  });

  app.get("/health", { schema: { tags: ["health"] } }, async () => ({
    data: { status: "ok", service: "api", timestamp: new Date() },
  }));
  app.get("/health/live", { schema: { tags: ["health"] } }, async () => ({
    data: { status: "alive" },
  }));
  app.get("/health/ready", { schema: { tags: ["health"] } }, async (_request, reply) => {
    const [database, queue, objectStorage] = await Promise.all([
      databaseReadiness(),
      queueReadiness(),
      objectStorageReadiness(),
    ]);
    const checks = {
      database,
      queue,
      objectStorage,
    };
    if (Object.values(checks).some((status) => status !== "ready")) {
      return reply.status(503).send({ data: { status: "not_ready", checks } });
    }
    return { data: { status: "ready", checks } };
  });

  const authenticate = registerAuthRoutes(app, dependencies);
  registerDashboardRoutes(app, dependencies, authenticate);
  registerResourceRoutes(app, dependencies, authenticate);
  registerComplianceMonitorRoutes(app, dependencies, authenticate);
  registerComplianceReviewRoutes(app, dependencies, authenticate);
  registerApprovalRoutes(app, dependencies, authenticate);
  registerFileRoutes(app, dependencies, authenticate);
  registerAdvisorRoutes(app, dependencies, authenticate);
  registerOperationalIncidentRoutes(app, dependencies, authenticate);
  registerAdminRoutes(app, dependencies, authenticate);
  registerOperationsRoutes(app, dependencies, authenticate);

  registerErrorHandler(app, dependencies.db);
  app.addHook("onClose", async () => {
    if (dependencies.closeDatabase) await dependencies.closeDatabase();
  });

  return app;
}
