import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./owner-recovery.js";
export * from "./schema.js";

export interface DatabaseConnectionOptions {
  applicationName?: string;
  connectTimeoutSeconds?: number;
  idleTimeoutSeconds?: number;
  keepAliveSeconds?: number | null;
  maxLifetimeSeconds?: number | null;
  maxConnections?: number;
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
      "Database application name must contain 1-63 ASCII letters, numbers, dots, underscores or hyphens",
    );
  }
  return value;
}

export function createDatabase(
  databaseUrl = process.env.DATABASE_URL,
  options: DatabaseConnectionOptions = {},
) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const maxConnections = integerOption(
    "Database max connections",
    options.maxConnections ?? Number(process.env.DATABASE_POOL_SIZE ?? 5),
    1,
    50,
  );
  const connectTimeoutSeconds = integerOption(
    "Database connect timeout",
    options.connectTimeoutSeconds ?? 10,
    1,
    60,
  );
  const idleTimeoutSeconds = integerOption(
    "Database idle timeout",
    options.idleTimeoutSeconds ?? 0,
    0,
    86_400,
  );
  const keepAliveSeconds =
    options.keepAliveSeconds === null
      ? null
      : integerOption("Database keep-alive", options.keepAliveSeconds ?? 30, 1, 300);
  const maxLifetimeSeconds =
    options.maxLifetimeSeconds === undefined || options.maxLifetimeSeconds === null
      ? options.maxLifetimeSeconds
      : integerOption("Database max lifetime", options.maxLifetimeSeconds, 60, 86_400);
  const applicationName = databaseApplicationName(options.applicationName ?? "fiatlux-choice");

  const client = postgres(databaseUrl, {
    max: maxConnections,
    // This is a small, continuously running internal service. Retiring warm connections after
    // only 20 seconds made the next human request pay for DNS/TCP/SCRAM while the host could be
    // under maintenance or resource pressure. Keep lazily opened connections warm to reduce that
    // exposure; TCP keepalive and postgres.js still detect a real server or network restart.
    idle_timeout: idleTimeoutSeconds,
    connect_timeout: connectTimeoutSeconds,
    keep_alive: keepAliveSeconds,
    ...(maxLifetimeSeconds !== undefined ? { max_lifetime: maxLifetimeSeconds } : {}),
    prepare: false,
    connection: { application_name: applicationName },
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Database = ReturnType<typeof createDatabase>["db"];
