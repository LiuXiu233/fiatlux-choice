import { randomUUID } from "node:crypto";
import { auditEvents, createDatabase, users } from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

type JsonObject = Record<string, unknown>;

function body(response: { body: string }) {
  return JSON.parse(response.body) as JsonObject;
}

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  const cookieValue = first?.split(";", 1)[0];
  if (!cookieValue) throw new Error("Login did not set a cookie");
  return cookieValue;
}

describe.skipIf(!databaseUrl)("first-login password boundary", () => {
  it("requires a one-time password change and never resets an existing seed administrator", async () => {
    const dbHandle = createDatabase(testDatabaseUrl);
    let app: FastifyInstance | undefined;
    const suffix = randomUUID().slice(0, 8);
    const email = `first-login-${suffix}@example.test`;
    const originalPassword = "first-login-original-password-long-enough";
    const ignoredReseedPassword = "first-login-reseed-must-not-take-effect";
    const finalPassword = "first-login-owner-rotated-password-2026";

    try {
      const firstSeed = await seedDatabase(dbHandle.db, {
        organizationName: "First Login Test Company",
        organizationSlug: `first-login-${suffix}`,
        adminEmail: email,
        adminDisplayName: "First Login Owner",
        adminPassword: originalPassword,
      });
      expect(firstSeed.user.mustChangePassword).toBe(true);

      await seedDatabase(dbHandle.db, {
        mode: "metadata-only",
        organizationSlug: firstSeed.organization.slug,
      });
      const [preservedUser] = await dbHandle.db
        .select()
        .from(users)
        .where(eq(users.id, firstSeed.user.id))
        .limit(1);
      expect(preservedUser).toMatchObject({
        id: firstSeed.user.id,
        displayName: "First Login Owner",
        mustChangePassword: true,
      });

      app = await buildApp({
        config: apiConfigSchema.parse({
          NODE_ENV: "test",
          DATABASE_URL: databaseUrl,
          JWT_SECRET: "first-login-test-secret-longer-than-32-characters",
          WEB_ORIGIN: "http://localhost:3000",
          LLM_DRIVER: "mock",
        }),
        db: dbHandle.db,
        storage: new MemoryObjectStorage(),
        queue: { send: async () => randomUUID() } as unknown as JobQueue,
      });

      const overwrittenPasswordLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: ignoredReseedPassword },
      });
      expect(overwrittenPasswordLogin.statusCode).toBe(401);

      const firstLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: originalPassword },
      });
      const secondLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: originalPassword },
      });
      expect(firstLogin.statusCode).toBe(200);
      expect(secondLogin.statusCode).toBe(200);
      expect(body(firstLogin).data).toMatchObject({ mustChangePassword: true });
      const firstCookie = cookie(firstLogin);
      const secondCookie = cookie(secondLogin);

      const meBeforeChange = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: firstCookie },
      });
      expect(meBeforeChange.statusCode).toBe(200);
      expect(body(meBeforeChange).data).toMatchObject({ mustChangePassword: true });

      const blockedWorkspace = await app.inject({
        method: "GET",
        url: "/api/v1/dashboard",
        headers: { cookie: firstCookie },
      });
      expect(blockedWorkspace.statusCode).toBe(403);
      expect(body(blockedWorkspace).error).toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });

      const changed = await app.inject({
        method: "POST",
        url: "/api/v1/auth/change-password",
        headers: { cookie: firstCookie },
        payload: { currentPassword: originalPassword, newPassword: finalPassword },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(body(changed).data).toMatchObject({ changed: true, revokedOtherSessions: 1 });

      const [meAfterChange, workspaceAfterChange, revokedOtherSession] = await Promise.all([
        app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: firstCookie },
        }),
        app.inject({
          method: "GET",
          url: "/api/v1/dashboard",
          headers: { cookie: firstCookie },
        }),
        app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { cookie: secondCookie },
        }),
      ]);
      expect(meAfterChange.statusCode).toBe(200);
      expect(body(meAfterChange).data).toMatchObject({ mustChangePassword: false });
      expect(workspaceAfterChange.statusCode).toBe(200);
      expect(revokedOtherSession.statusCode).toBe(401);

      const [oldPasswordLogin, newPasswordLogin] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password: originalPassword },
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password: finalPassword },
        }),
      ]);
      expect(oldPasswordLogin.statusCode).toBe(401);
      expect(newPasswordLogin.statusCode).toBe(200);
      expect(body(newPasswordLogin).data).toMatchObject({ mustChangePassword: false });

      const rejectionAudits = await dbHandle.db
        .select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.orgId, firstSeed.organization.id),
            eq(auditEvents.actorUserId, firstSeed.user.id),
            eq(auditEvents.action, "request_rejected"),
          ),
        );
      expect(rejectionAudits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ code: "PASSWORD_CHANGE_REQUIRED", status: 403 }),
          }),
        ]),
      );
    } finally {
      await app?.close();
      await dbHandle.client.end();
    }
  }, 120_000);
});
