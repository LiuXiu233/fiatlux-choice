import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3ObjectStorage } from "../src/index.js";

const endpoint = process.env.TEST_S3_ENDPOINT;
const testEndpoint = endpoint ?? "http://127.0.0.1:9000";
const region = process.env.TEST_S3_REGION ?? "us-east-1";
const accessKeyId = process.env.TEST_S3_ACCESS_KEY_ID ?? "minioadmin";
const secretAccessKey = process.env.TEST_S3_SECRET_ACCESS_KEY ?? "minioadmin";
const bucket = process.env.TEST_S3_BUCKET ?? `fiatlux-test-${randomUUID()}`;

describe.skipIf(!endpoint)("S3/MinIO verified streaming", () => {
  it("uploads, verifies, downloads and deletes actual bytes", async () => {
    const client = new S3Client({
      endpoint: testEndpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "";
      if (!name.includes("BucketAlready")) throw error;
    });
    const storage = new S3ObjectStorage({
      endpoint: testEndpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    });
    const data = Buffer.from("FIAT LUX verified object storage integration test");
    const checksum = createHash("sha256").update(data).digest("hex");
    const key = `test/${randomUUID()}`;

    const uploaded = await storage.putVerified({
      storageKey: key,
      body: Readable.from(data),
      contentType: "text/plain",
      expectedSizeBytes: data.byteLength,
      expectedChecksumSha256: checksum,
    });
    expect(uploaded).toMatchObject({ sizeBytes: data.byteLength, checksumSha256: checksum });

    const downloaded = await storage.get(key);
    expect(downloaded).not.toBeNull();
    const chunks: Buffer[] = [];
    if (downloaded) for await (const chunk of downloaded.body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(data);

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
  });

  it("deletes content when the declared checksum is wrong", async () => {
    const storage = new S3ObjectStorage({
      endpoint: testEndpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    });
    const key = `test/${randomUUID()}`;
    await expect(
      storage.putVerified({
        storageKey: key,
        body: Readable.from("wrong"),
        contentType: "text/plain",
        expectedSizeBytes: 5,
        expectedChecksumSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/does not match/);
    expect(await storage.head(key)).toBeNull();
  });
});
