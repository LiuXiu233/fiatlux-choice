import { randomUUID } from "node:crypto";
import {
  complianceEvents,
  contracts,
  createDatabase,
  files,
  invoices,
  obligations,
} from "@fiatlux/db";
import { seedDatabase } from "@fiatlux/db/seed";
import { type JobQueue, MemoryObjectStorage } from "@fiatlux/integrations";
import { and, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { apiConfigSchema } from "../../src/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseUrl = databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused";

type JsonObject = Record<string, unknown>;

function cookie(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
  const cookieValue = first?.split(";", 1)[0];
  if (!cookieValue) throw new Error("Login did not set a cookie");
  return cookieValue;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe.skipIf(!databaseUrl)("file evidence reference concurrency", () => {
  let app: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let orgId: string;
  let ownerUserId: string;
  let ownerCookie: string;
  const suffix = randomUUID().slice(0, 8);

  async function holdFileRow(fileId: string) {
    const ready = deferred();
    const released = deferred();
    let holderPid = 0;
    const done = dbHandle.db
      .transaction(async (tx) => {
        const pidResult = await tx.execute(sql`select pg_backend_pid()::integer as pid`);
        holderPid = Number((pidResult as unknown as Array<{ pid: number }>)[0]?.pid ?? 0);
        const [locked] = await tx
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.orgId, orgId)))
          .for("update");
        if (!locked || holderPid < 1) throw new Error("File barrier target was not locked");
        ready.resolve();
        await released.promise;
      })
      .catch((error) => {
        ready.reject(error);
        throw error;
      });
    await ready.promise;
    return { holderPid, release: released.resolve, done };
  }

  async function waitForBlockedClients(holderPid: number, expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await dbHandle.db.execute(sql`
        select count(*)::integer as waiting
        from pg_stat_activity activity
        where ${holderPid} = any(pg_blocking_pids(activity.pid))
      `);
      const waiting = Number((result as unknown as Array<{ waiting: number }>)[0]?.waiting ?? 0);
      if (waiting >= expected) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected ${expected} clients to wait on the file-row barrier`);
  }

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "File Evidence Concurrency Company",
      organizationSlug: `file-evidence-concurrency-${suffix}`,
      adminEmail: `file-evidence-owner-${suffix}@example.test`,
      adminDisplayName: "File Evidence Owner",
      adminPassword: "correct-horse-battery-staple-file-evidence",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    ownerUserId = seeded.user.id;
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = { send: async () => randomUUID() } as unknown as JobQueue;
    app = await buildApp({
      config,
      db: dbHandle.db,
      storage: new MemoryObjectStorage(),
      queue,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `file-evidence-owner-${suffix}@example.test`,
        password: "correct-horse-battery-staple-file-evidence",
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    ownerCookie = cookie(login);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await dbHandle?.client.end();
  });

  it.each([
    {
      resource: "contracts" as const,
      payload: (fileId: string) => ({
        name: `Concurrent contract ${suffix}`,
        counterparty: "Concurrency Counterparty",
        contractNumber: `RACE-CONTRACT-${suffix}`,
        status: "draft",
        currency: "CNY",
        fileId,
      }),
    },
    {
      resource: "invoices" as const,
      payload: (fileId: string) => ({
        invoiceNumber: `RACE-INVOICE-${suffix}`,
        direction: "outgoing",
        counterparty: "Concurrency Counterparty",
        amountCents: 10_000,
        taxAmountCents: 566,
        currency: "CNY",
        status: "draft",
        fileId,
      }),
    },
    {
      resource: "obligations" as const,
      payload: (fileId: string) => ({
        title: `Concurrent obligation ${suffix}`,
        category: "archive",
        status: "open",
        evidenceFileId: fileId,
      }),
    },
    {
      resource: "compliance-events" as const,
      payload: (fileId: string) => ({
        title: `Concurrent compliance event ${suffix}`,
        category: "archive",
        dueDate: "2027-01-01",
        status: "pending",
        evidenceFileId: fileId,
      }),
    },
  ])(
    "never commits both an archived file and a new $resource reference",
    async (scenario) => {
      const fileId = randomUUID();
      await dbHandle.db.insert(files).values({
        id: fileId,
        orgId,
        filename: `${scenario.resource}-${suffix}.pdf`,
        contentType: "application/pdf",
        sizeBytes: 1,
        checksumSha256: "a".repeat(64),
        storageKey: `${orgId}/${fileId}`,
        uploadStatus: "uploaded",
        uploadedBy: ownerUserId,
      });

      const barrier = await holdFileRow(fileId);
      let archivePromise: Promise<{ statusCode: number; body: string }> | undefined;
      let createPromise: Promise<{ statusCode: number; body: string }> | undefined;
      let earlyCreateResponse: { statusCode: number; body: string } | undefined;
      try {
        createPromise = app.inject({
          method: "POST",
          url: `/api/v1/${scenario.resource}`,
          headers: { cookie: ownerCookie },
          payload: scenario.payload(fileId),
        });
        void createPromise.then((response) => {
          earlyCreateResponse = response;
        });
        try {
          await waitForBlockedClients(barrier.holderPid, 1);
        } catch (error) {
          if (earlyCreateResponse) {
            throw new Error(
              `Reference creation completed before the file lock was released: ${earlyCreateResponse.statusCode} ${earlyCreateResponse.body}`,
            );
          }
          throw error;
        }

        archivePromise = app.inject({
          method: "DELETE",
          url: `/api/v1/files/${fileId}?expectedVersion=1`,
          headers: { cookie: ownerCookie },
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      } finally {
        barrier.release();
        await barrier.done;
      }

      if (!archivePromise || !createPromise) throw new Error("Race requests were not started");
      const [archiveResponse, createResponse] = await Promise.all([archivePromise, createPromise]);
      const [storedFile] = await dbHandle.db
        .select()
        .from(files)
        .where(eq(files.id, fileId))
        .limit(1);
      const referenceCount =
        scenario.resource === "contracts"
          ? await dbHandle.db
              .select({ value: count() })
              .from(contracts)
              .where(and(eq(contracts.orgId, orgId), eq(contracts.fileId, fileId)))
          : scenario.resource === "invoices"
            ? await dbHandle.db
                .select({ value: count() })
                .from(invoices)
                .where(and(eq(invoices.orgId, orgId), eq(invoices.fileId, fileId)))
            : scenario.resource === "obligations"
              ? await dbHandle.db
                  .select({ value: count() })
                  .from(obligations)
                  .where(and(eq(obligations.orgId, orgId), eq(obligations.evidenceFileId, fileId)))
              : await dbHandle.db
                  .select({ value: count() })
                  .from(complianceEvents)
                  .where(
                    and(
                      eq(complianceEvents.orgId, orgId),
                      eq(complianceEvents.evidenceFileId, fileId),
                    ),
                  );

      expect(
        archiveResponse.statusCode >= 400 || createResponse.statusCode >= 400,
        JSON.stringify({
          archiveStatus: archiveResponse.statusCode,
          createStatus: createResponse.statusCode,
          fileArchived: Boolean(storedFile?.archivedAt),
          referenceCount: referenceCount[0]?.value ?? 0,
          archiveBody: archiveResponse.body,
          createBody: createResponse.body,
        } satisfies JsonObject),
      ).toBe(true);
    },
    30_000,
  );
});
