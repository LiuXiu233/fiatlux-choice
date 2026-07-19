import { createHash, randomUUID } from "node:crypto";
import { auditEvents, createDatabase, files } from "@fiatlux/db";
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Models the destructive cleanup behavior of S3ObjectStorage.putVerified(): a checksum failure
 * deletes the shared key. The first successful write pauses before returning so a second API
 * process would hit the exact object-deletion/DB-stored split without a database upload claim.
 */
class DestructiveRaceMemoryStorage extends MemoryObjectStorage {
  readonly firstObjectStored = deferred();
  readonly releaseFirstAttempt = deferred();
  readonly secondStorageAttempt = deferred();
  callCount = 0;

  override async putVerified(input: Parameters<MemoryObjectStorage["putVerified"]>[0]) {
    this.callCount += 1;
    if (this.callCount === 1) {
      const metadata = await super.putVerified(input);
      this.firstObjectStored.resolve();
      await this.releaseFirstAttempt.promise;
      return metadata;
    }

    this.secondStorageAttempt.resolve();
    try {
      return await super.putVerified(input);
    } catch (error) {
      await this.delete(input.storageKey);
      throw error;
    }
  }
}

describe.skipIf(!databaseUrl)("file content upload serialization", () => {
  let firstApp: FastifyInstance;
  let secondApp: FastifyInstance;
  let dbHandle: ReturnType<typeof createDatabase>;
  let storage: DestructiveRaceMemoryStorage;
  let ownerCookie: string;
  let orgId: string;
  const suffix = randomUUID().slice(0, 8);

  async function waitForBlockedFileTransaction() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await dbHandle.db.execute(sql`
        select count(*)::integer as waiting
        from pg_stat_activity
        where datname = current_database()
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%files%'
      `);
      const waiting = Number((result as unknown as Array<{ waiting: number }>)[0]?.waiting ?? 0);
      if (waiting > 0) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }

  beforeAll(async () => {
    dbHandle = createDatabase(testDatabaseUrl);
    const seeded = await seedDatabase(dbHandle.db, {
      organizationName: "File Upload Serialization Company",
      organizationSlug: `file-upload-serialization-${suffix}`,
      adminEmail: `file-upload-owner-${suffix}@example.test`,
      adminDisplayName: "File Upload Owner",
      adminPassword: "correct-horse-battery-staple-file-upload",
      adminMustChangePassword: false,
    });
    orgId = seeded.organization.id;
    const config = apiConfigSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "integration-test-secret-longer-than-32-characters",
      WEB_ORIGIN: "http://localhost:3000",
      LLM_DRIVER: "mock",
    });
    const queue = { send: async () => randomUUID() } as unknown as JobQueue;
    storage = new DestructiveRaceMemoryStorage();
    firstApp = await buildApp({ config, db: dbHandle.db, storage, queue });
    secondApp = await buildApp({ config, db: dbHandle.db, storage, queue });

    const login = await firstApp.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `file-upload-owner-${suffix}@example.test`,
        password: "correct-horse-battery-staple-file-upload",
      },
    });
    expect(login.statusCode, login.body).toBe(200);
    ownerCookie = cookie(login);
  }, 120_000);

  afterAll(async () => {
    await Promise.all([firstApp?.close(), secondApp?.close()]);
    await dbHandle?.client.end();
  });

  it("lets only one API process call storage and preserves its object", async () => {
    const acceptedContent = Buffer.from("serialized winner bytes");
    const rejectedContent = Buffer.from("x".repeat(acceptedContent.byteLength));
    const checksumSha256 = createHash("sha256").update(acceptedContent).digest("hex");
    const metadataResponse = await firstApp.inject({
      method: "POST",
      url: "/api/v1/files",
      headers: { cookie: ownerCookie },
      payload: {
        filename: `serialized-${suffix}.txt`,
        contentType: "text/plain",
        sizeBytes: acceptedContent.byteLength,
        checksumSha256,
        classification: "confidential",
      },
    });
    expect(metadataResponse.statusCode, metadataResponse.body).toBe(201);
    const metadata = body(metadataResponse).data as { file: JsonObject; upload: JsonObject };
    const fileId = String(metadata.file.id);
    const uploadUrl = String(metadata.upload.uploadUrl);

    const acceptedRequest = firstApp.inject({
      method: "PUT",
      url: uploadUrl,
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "content-length": String(acceptedContent.byteLength),
      },
      payload: acceptedContent,
    });
    await storage.firstObjectStored.promise;

    const rejectedRequest = secondApp.inject({
      method: "PUT",
      url: uploadUrl,
      headers: {
        cookie: ownerCookie,
        "content-type": "application/octet-stream",
        "content-length": String(rejectedContent.byteLength),
      },
      payload: rejectedContent,
    });

    let claimOutcome: "database-lock" | "storage-race" | "timeout";
    try {
      claimOutcome = await Promise.race([
        storage.secondStorageAttempt.promise.then(() => "storage-race" as const),
        waitForBlockedFileTransaction().then((blocked) =>
          blocked ? ("database-lock" as const) : ("timeout" as const),
        ),
      ]);
      expect(claimOutcome).toBe("database-lock");
      expect(storage.callCount).toBe(1);
    } finally {
      storage.releaseFirstAttempt.resolve();
    }

    const [acceptedResponse, rejectedResponse] = await Promise.all([
      acceptedRequest,
      rejectedRequest,
    ]);
    expect(acceptedResponse.statusCode, acceptedResponse.body).toBe(201);
    expect(rejectedResponse.statusCode, rejectedResponse.body).toBe(409);
    expect(storage.callCount).toBe(1);

    const [record] = await dbHandle.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(record).toMatchObject({ uploadStatus: "stored", version: 2 });
    const storedObject = await storage.get(`${orgId}/${fileId}`);
    expect(storedObject).not.toBeNull();
    const chunks: Buffer[] = [];
    if (storedObject) {
      for await (const chunk of storedObject.body) chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(acceptedContent);

    const auditCount = await dbHandle.db
      .select({ value: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.orgId, orgId),
          eq(auditEvents.resourceType, "file"),
          eq(auditEvents.resourceId, fileId),
          eq(auditEvents.action, "content_stored"),
        ),
      );
    expect(auditCount[0]?.value).toBe(1);

    const completed = await secondApp.inject({
      method: "POST",
      url: `/api/v1/files/${fileId}/complete`,
      headers: { cookie: ownerCookie },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(body(completed).data).toMatchObject({ uploadStatus: "uploaded", version: 3 });
  }, 30_000);
});
