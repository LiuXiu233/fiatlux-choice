import { randomUUID } from "node:crypto";
import { createDatabase, roles, sessions } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  const cookieValue = first?.split(";", 1)[0];
  if (!cookieValue) throw new Error("Login did not set a cookie");
  return cookieValue;
}

describe.skipIf(!databaseUrl)("archived role authentication boundary", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let userId: string;
  let ownerRoleId: string;
  const suffix = randomUUID().slice(0, 8);
  const email = `archived-role-owner-${suffix}@example.test`;
  const password = "archived-role-owner-password-long-enough";

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "Archived Role Auth Company",
      organizationSlug: `archived-role-auth-${suffix}`,
      adminEmail: email,
      adminDisplayName: "Archived Role Owner",
      adminPassword: password,
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
    const [ownerRole] = await dbHandle.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.orgId, orgId), eq(roles.systemKey, "owner")));
    if (!ownerRole) throw new Error("Seed did not create the owner role");
    ownerRoleId = ownerRole.id;

    app = await buildApp({
      config: apiConfigSchema.parse({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        JWT_SECRET: "archived-role-test-secret-longer-than-32-characters",
        WEB_ORIGIN: "http://localhost:3000",
        LLM_DRIVER: "mock",
      }),
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue: { send: async () => randomUUID() } as unknown as JobQueue,
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("removes live permissions and refuses new sessions until the role is restored", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const activeCookie = cookie(login);
    const initialSessionRows = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, userId)));
    expect(initialSessionRows).toHaveLength(1);

    const beforeArchive = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: activeCookie },
    });
    expect(beforeArchive.statusCode, beforeArchive.body).toBe(200);

    await dbHandle.db
      .update(roles)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(roles.id, ownerRoleId), eq(roles.orgId, orgId)));

    const existingSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: activeCookie },
    });
    expect(existingSession.statusCode, existingSession.body).toBe(403);

    const failedLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(failedLogin.statusCode, failedLogin.body).toBe(403);
    const afterFailedLoginRows = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, userId)));
    expect(afterFailedLoginRows).toHaveLength(initialSessionRows.length);

    await dbHandle.db
      .update(roles)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(roles.id, ownerRoleId), eq(roles.orgId, orgId)));

    const restoredExistingSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: activeCookie },
    });
    expect(restoredExistingSession.statusCode, restoredExistingSession.body).toBe(200);
    const restoredLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(restoredLogin.statusCode, restoredLogin.body).toBe(200);
    const restoredSessionRows = await dbHandle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.orgId, orgId), eq(sessions.userId, userId)));
    expect(restoredSessionRows).toHaveLength(initialSessionRows.length + 1);
  });
});
