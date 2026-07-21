import { randomBytes, randomUUID } from "node:crypto";
import {
  auditEvents,
  createDatabase,
  mfaLoginChallenges,
  userMfaCredentials,
  userMfaRecoveryCodes,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";
import { createTotpCode } from "../../src/mfa.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

type JsonObject = Record<string, unknown>;

function body(response: { body: string }) {
  return JSON.parse(response.body) as JsonObject;
}

function cookie(
  response: { headers: Record<string, string | string[] | number | undefined> },
  name: string,
) {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
  const match = values.find((value) => value.startsWith(`${name}=`));
  const pair = match?.split(";", 1)[0];
  if (!pair) throw new Error(`Response did not set ${name}`);
  return pair;
}

describe.skipIf(!databaseUrl)("TOTP MFA login and recovery boundaries", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let email: string;
  let password: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const suffix = randomUUID().slice(0, 8);
    email = `mfa-owner-${suffix}@example.test`;
    password = "mfa-owner-password-long-enough-2026";
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "MFA Integration Company",
      organizationSlug: `mfa-integration-${suffix}`,
      adminEmail: email,
      adminDisplayName: "MFA Owner",
      adminPassword: password,
      adminMustChangePassword: false,
      complianceSourcesFile: `/nonexistent/mfa-${suffix}.json`,
    });
    orgId = seeded.organization.id;
    userId = seeded.user.id;
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "mfa-integration-session-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
      MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
      MFA_ENCRYPTION_KEY_ID: "integration-v1",
      MFA_REQUIRED_ROLES: "owner,admin",
    });
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue: { send: async () => randomUUID() } as unknown as JobQueue,
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it("forces enrollment, issues one-time recovery codes, and withholds sessions until MFA", async () => {
    const firstLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password, orgId },
    });
    const secondLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password, orgId },
    });
    expect(firstLogin.statusCode, firstLogin.body).toBe(200);
    expect(secondLogin.statusCode, secondLogin.body).toBe(200);
    expect(body(firstLogin).data).toMatchObject({
      mfaEnabled: false,
      mfaRequired: true,
      mustSetupMfa: true,
    });
    const currentSession = cookie(firstLogin, "fiatlux_session");
    const otherSession = cookie(secondLogin, "fiatlux_session");

    const blockedDashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: currentSession },
    });
    expect(blockedDashboard.statusCode).toBe(403);
    expect(body(blockedDashboard).error).toMatchObject({ code: "MFA_SETUP_REQUIRED" });

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/setup",
      headers: { cookie: currentSession },
      payload: { confirmation: "START_MFA_ENROLLMENT" },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    const setupData = body(setup).data as JsonObject;
    const secret = String(setupData.secret);
    expect(secret).toMatch(/^[A-Z2-7]+$/u);
    expect(String(setupData.otpAuthUri)).toContain("algorithm=SHA256");

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      headers: { cookie: currentSession },
      payload: { code: createTotpCode(secret) },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const confirmedData = body(confirmed).data as JsonObject;
    const recoveryCodes = confirmedData.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    expect(confirmedData.revokedOtherSessions).toBe(1);

    const [credential, storedRecoveryCodes] = await Promise.all([
      dbHandle.db.select().from(userMfaCredentials).where(eq(userMfaCredentials.userId, userId)),
      dbHandle.db
        .select()
        .from(userMfaRecoveryCodes)
        .where(eq(userMfaRecoveryCodes.userId, userId)),
    ]);
    expect(credential[0]?.enabledAt).toBeInstanceOf(Date);
    expect(storedRecoveryCodes).toHaveLength(10);
    expect(storedRecoveryCodes.map((entry) => entry.codeHash)).not.toContain(recoveryCodes[0]);

    const dashboard = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard",
      headers: { cookie: currentSession },
    });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    const revokedOtherSession = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: otherSession },
    });
    expect(revokedOtherSession.statusCode).toBe(401);

    const challengedLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password, orgId },
    });
    expect(challengedLogin.statusCode, challengedLogin.body).toBe(202);
    expect(body(challengedLogin).data).toMatchObject({ mfaRequired: true });
    const challengeCookie = cookie(challengedLogin, "fiatlux_mfa_challenge");

    const verified = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers: { cookie: challengeCookie },
      payload: { code: recoveryCodes[0] },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect(body(verified).data).toMatchObject({ mfaEnabled: true, mustSetupMfa: false });
    const verifiedSession = cookie(verified, "fiatlux_session");

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: verifiedSession },
    });
    expect(logout.statusCode).toBe(200);
    const secondChallenge = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password, orgId },
    });
    const secondChallengeCookie = cookie(secondChallenge, "fiatlux_mfa_challenge");
    const replayedRecoveryCode = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers: { cookie: secondChallengeCookie },
      payload: { code: recoveryCodes[0] },
    });
    expect(replayedRecoveryCode.statusCode).toBe(401);
    expect(body(replayedRecoveryCode).error).toMatchObject({
      code: "MFA_CODE_INVALID",
      details: { attemptsRemaining: 4 },
    });
    const recovered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers: { cookie: secondChallengeCookie },
      payload: { code: recoveryCodes[1] },
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    const recoveredSession = cookie(recovered, "fiatlux_session");

    const disableRequiredMfa = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      headers: { cookie: recoveredSession },
      payload: {
        currentPassword: password,
        code: recoveryCodes[2],
        confirmation: "DISABLE_MFA",
      },
    });
    expect(disableRequiredMfa.statusCode).toBe(403);

    const exhaustedLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password, orgId },
    });
    const exhaustedChallengeCookie = cookie(exhaustedLogin, "fiatlux_mfa_challenge");
    for (const attemptsRemaining of [4, 3, 2, 1, 0]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/auth/mfa/verify",
        headers: { cookie: exhaustedChallengeCookie },
        payload: { code: recoveryCodes[0] },
      });
      expect(rejected.statusCode).toBe(401);
      expect(body(rejected).error).toMatchObject({
        code: "MFA_CODE_INVALID",
        details: { attemptsRemaining },
      });
    }

    const [remainingCodes, challenges, audits] = await Promise.all([
      dbHandle.db
        .select()
        .from(userMfaRecoveryCodes)
        .where(and(eq(userMfaRecoveryCodes.userId, userId))),
      dbHandle.db.select().from(mfaLoginChallenges).where(eq(mfaLoginChallenges.userId, userId)),
      dbHandle.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.actorUserId, userId)),
    ]);
    expect(remainingCodes.filter((entry) => entry.usedAt === null)).toHaveLength(8);
    expect(challenges.every((challenge) => challenge.consumedAt instanceof Date)).toBe(true);
    expect(challenges.some((challenge) => challenge.attemptsRemaining === 0)).toBe(true);
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "mfa_setup_started",
        "mfa_enabled",
        "mfa_login_challenge_created",
        "mfa_login_verification_failed",
        "mfa_login_verified",
      ]),
    );
  }, 60_000);
});
