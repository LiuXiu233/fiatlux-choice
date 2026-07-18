import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectMetadata {
  sizeBytes: number;
  contentType?: string;
  checksumSha256?: string;
}

export interface UploadTicket {
  storageKey: string;
  uploadUrl: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
}

export interface ObjectStorage {
  healthCheck(): Promise<void>;
  createUploadTicket(input: {
    orgId: string;
    fileId: string;
    contentType: string;
    checksumSha256: string;
    expiresInSeconds?: number;
  }): Promise<UploadTicket>;
  head(storageKey: string): Promise<ObjectMetadata | null>;
  createDownloadUrl(
    storageKey: string,
    expiresInSeconds?: number,
  ): Promise<{ url: string; expiresAt: Date }>;
  putVerified(input: {
    storageKey: string;
    body: Readable;
    contentType: string;
    expectedSizeBytes: number;
    expectedChecksumSha256: string;
  }): Promise<ObjectMetadata>;
  get(storageKey: string): Promise<{ body: Readable; metadata: ObjectMetadata } | null>;
  delete(storageKey: string): Promise<void>;
}

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3StorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async healthCheck() {
    await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
  }

  async createUploadTicket(input: {
    orgId: string;
    fileId: string;
    contentType: string;
    checksumSha256: string;
    expiresInSeconds?: number;
  }): Promise<UploadTicket> {
    const expiresIn = Math.min(input.expiresInSeconds ?? 900, 3_600);
    const storageKey = `${input.orgId}/${input.fileId}`;
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: storageKey,
      ContentType: input.contentType,
      Metadata: { sha256: input.checksumSha256 },
    });
    const uploadUrl = await getSignedUrl(this.#client, command, { expiresIn });
    return {
      storageKey,
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1_000),
      requiredHeaders: { "content-type": input.contentType },
    };
  }

  async head(storageKey: string): Promise<ObjectMetadata | null> {
    try {
      const result = await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucket,
          Key: storageKey,
        }),
      );
      return {
        sizeBytes: result.ContentLength ?? 0,
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
        ...(result.Metadata?.sha256 ? { checksumSha256: result.Metadata.sha256 } : {}),
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && "$metadata" in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 404) return null;
      }
      throw error;
    }
  }

  async createDownloadUrl(storageKey: string, expiresInSeconds = 300) {
    const expiresIn = Math.min(expiresInSeconds, 900);
    const url = await getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: storageKey,
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1_000) };
  }

  async putVerified(input: {
    storageKey: string;
    body: Readable;
    contentType: string;
    expectedSizeBytes: number;
    expectedChecksumSha256: string;
  }) {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer | string, encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        sizeBytes += buffer.byteLength;
        hash.update(buffer);
        callback(null, buffer);
      },
    });
    try {
      await new Upload({
        client: this.#client,
        params: {
          Bucket: this.#bucket,
          Key: input.storageKey,
          Body: input.body.pipe(verifier),
          ContentType: input.contentType,
          Metadata: { sha256: input.expectedChecksumSha256 },
        },
      }).done();
      const checksumSha256 = hash.digest("hex");
      if (
        sizeBytes !== input.expectedSizeBytes ||
        checksumSha256 !== input.expectedChecksumSha256
      ) {
        await this.delete(input.storageKey);
        throw new Error("Uploaded content does not match the declared size and SHA-256 checksum");
      }
      return { sizeBytes, contentType: input.contentType, checksumSha256 };
    } catch (error) {
      await this.delete(input.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async get(storageKey: string) {
    try {
      const result = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: storageKey }),
      );
      if (!result.Body) return null;
      return {
        body: result.Body as Readable,
        metadata: {
          sizeBytes: result.ContentLength ?? 0,
          ...(result.ContentType ? { contentType: result.ContentType } : {}),
          ...(result.Metadata?.sha256 ? { checksumSha256: result.Metadata.sha256 } : {}),
        },
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && "$metadata" in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 404) return null;
      }
      throw error;
    }
  }

  async delete(storageKey: string) {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: storageKey }));
  }
}

export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { metadata: ObjectMetadata; data: Buffer }>();

  async healthCheck() {}

  async createUploadTicket(input: {
    orgId: string;
    fileId: string;
    contentType: string;
    checksumSha256: string;
  }): Promise<UploadTicket> {
    const storageKey = `${input.orgId}/${input.fileId}`;
    return {
      storageKey,
      uploadUrl: `memory://${storageKey}`,
      expiresAt: new Date(Date.now() + 900_000),
      requiredHeaders: { "content-type": input.contentType },
    };
  }

  async head(storageKey: string): Promise<ObjectMetadata | null> {
    return this.objects.get(storageKey)?.metadata ?? null;
  }

  async createDownloadUrl(storageKey: string, expiresInSeconds = 300) {
    return {
      url: `memory://${storageKey}`,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
    };
  }

  async putVerified(input: {
    storageKey: string;
    body: Readable;
    contentType: string;
    expectedSizeBytes: number;
    expectedChecksumSha256: string;
  }) {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    const checksumSha256 = createHash("sha256").update(data).digest("hex");
    if (
      data.byteLength !== input.expectedSizeBytes ||
      checksumSha256 !== input.expectedChecksumSha256
    ) {
      throw new Error("Uploaded content does not match the declared size and SHA-256 checksum");
    }
    const metadata = { sizeBytes: data.byteLength, contentType: input.contentType, checksumSha256 };
    this.objects.set(input.storageKey, { metadata, data });
    return metadata;
  }

  async get(storageKey: string) {
    const stored = this.objects.get(storageKey);
    return stored ? { body: Readable.from(stored.data), metadata: stored.metadata } : null;
  }

  async delete(storageKey: string) {
    this.objects.delete(storageKey);
  }
}
