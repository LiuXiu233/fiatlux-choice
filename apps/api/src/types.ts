import type { Database } from "@fiatlux/db";
import type { JobQueue, ObjectStorage } from "@fiatlux/integrations";

import type { ApiConfig } from "./config.js";

export interface AuthContext {
  userId: string;
  orgId: string;
  sessionId: string;
  permissions: string[];
}

export interface RequestAuditContext {
  orgId: string;
  actorUserId: string | null;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AppDependencies {
  config: ApiConfig;
  db: Database;
  closeDatabase?: () => Promise<void>;
  storage: ObjectStorage;
  queue?: JobQueue;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; orgId: string; sid: string };
    user: { sub: string; orgId: string; sid: string };
  }
}
