import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  fileCreateSchema,
  idSchema,
  listQuerySchema,
  MAX_FILE_SIZE_BYTES,
} from "@fiatlux/contracts";
import { auditEvents, files } from "@fiatlux/db";
import { DomainError, hasPermission } from "@fiatlux/domain";
import { and, count, desc, eq, ilike, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies, RequestAuditContext } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
const fileUpdateSchema = z.object({
  filename: z.string().trim().min(1).max(500).optional(),
  classification: z.enum(["internal", "confidential", "personal", "public"]).optional(),
  expectedVersion: z.number().int().min(1),
});
const archiveQuerySchema = z.object({ expectedVersion: z.coerce.number().int().min(1) });

async function requireFileContentPermission(request: FastifyRequest) {
  if (
    !hasPermission(request.auth.permissions, "files:update") &&
    !hasPermission(request.auth.permissions, "files:create")
  ) {
    throw new DomainError("FORBIDDEN", "Missing permission to upload file content", 403);
  }
}

function assertCanWriteFileContent(request: FastifyRequest, file: { uploadedBy: string | null }) {
  if (hasPermission(request.auth.permissions, "files:update")) return;
  if (
    hasPermission(request.auth.permissions, "files:create") &&
    file.uploadedBy === request.auth.userId
  ) {
    return;
  }
  throw new DomainError("FORBIDDEN", "Only the uploader can complete this file upload", 403);
}

function auditValue(
  context: RequestAuditContext,
  event: {
    action: string;
    resourceId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return {
    orgId: context.orgId,
    actorUserId: context.actorUserId,
    action: event.action,
    resourceType: "file",
    resourceId: event.resourceId,
    requestId: context.requestId,
    before: event.before,
    after: event.after,
    metadata: {},
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}

export function registerFileRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/files",
    {
      preHandler: [authenticate, requirePermission("files:read")],
      schema: { tags: ["files"], summary: "List file metadata" },
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const where = query.search
        ? and(
            eq(files.orgId, request.auth.orgId),
            isNull(files.archivedAt),
            ilike(files.filename, `%${query.search}%`),
          )
        : and(eq(files.orgId, request.auth.orgId), isNull(files.archivedAt));
      const [items, totals] = await Promise.all([
        dependencies.db
          .select()
          .from(files)
          .where(where)
          .orderBy(desc(files.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        dependencies.db.select({ total: count() }).from(files).where(where),
      ]);
      const total = totals[0]?.total ?? 0;
      return {
        data: items,
        meta: { ...query, total, pageCount: Math.ceil(total / query.pageSize) },
      };
    },
  );

  app.post(
    "/api/v1/files",
    {
      preHandler: [authenticate, requirePermission("files:create")],
      schema: { tags: ["files"], summary: "Create file metadata and a direct upload ticket" },
    },
    async (request, reply) => {
      const input = fileCreateSchema.parse(request.body);
      const id = randomUUID();
      const storageKey = `${request.auth.orgId}/${id}`;
      const ticket = {
        storageKey,
        uploadUrl: `/api/v1/files/${id}/content`,
        method: "PUT",
        requiredHeaders: { "content-type": "application/octet-stream" },
      };
      const context = requestAuditContext(request);
      const [created] = await dependencies.db.transaction(async (tx) => {
        const [record] = await tx
          .insert(files)
          .values({
            id,
            orgId: request.auth.orgId,
            storageKey,
            ...input,
            uploadedBy: request.auth.userId,
          })
          .returning();
        if (!record) throw new Error("Failed to create file metadata");
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "create",
            resourceId: id,
            after: record,
          }),
        );
        return [record];
      });
      return reply.status(201).send({ data: { file: created, upload: ticket } });
    },
  );

  app.put(
    "/api/v1/files/:id/content",
    {
      onRequest: [authenticate, requireFileContentPermission],
      bodyLimit: MAX_FILE_SIZE_BYTES,
      schema: {
        tags: ["files"],
        summary: "Store and verify a bounded file upload through the authenticated API",
      },
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const [current] = await dependencies.db
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)))
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
      assertCanWriteFileContent(request, current);
      if (!Buffer.isBuffer(request.body)) {
        throw new DomainError("VALIDATION_FAILED", "A binary request body is required", 400);
      }
      const contentLength = Number(request.headers["content-length"] ?? -1);
      if (contentLength !== current.sizeBytes) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Content-Length does not match declared file size",
          400,
        );
      }
      try {
        await dependencies.storage.putVerified({
          storageKey: current.storageKey,
          body: Readable.from([request.body]),
          contentType: current.contentType,
          expectedSizeBytes: current.sizeBytes,
          expectedChecksumSha256: current.checksumSha256,
        });
      } catch (error) {
        throw new DomainError(
          "VALIDATION_FAILED",
          error instanceof Error ? error.message : "Upload verification failed",
          400,
        );
      }
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(files)
          .set({
            uploadStatus: "stored",
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, current.version),
            ),
          )
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "File changed concurrently", 409);
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "content_stored",
            resourceId: id,
            before: current,
            after: changed,
          }),
        );
        return [changed];
      });
      return reply.status(201).send({ data: updated });
    },
  );

  app.get(
    "/api/v1/files/:id",
    {
      preHandler: [authenticate, requirePermission("files:read")],
      schema: { tags: ["files"], summary: "Read file metadata" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [record] = await dependencies.db
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)))
        .limit(1);
      if (!record) throw new DomainError("NOT_FOUND", "File not found", 404);
      return { data: record };
    },
  );

  app.patch(
    "/api/v1/files/:id",
    {
      preHandler: [authenticate, requirePermission("files:update")],
      schema: { tags: ["files"], summary: "Update mutable file metadata" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const { expectedVersion, ...patch } = fileUpdateSchema.parse(request.body);
      const [current] = await dependencies.db
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)))
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(files)
          .set({
            ...patch,
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, expectedVersion),
            ),
          )
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "File metadata changed concurrently", 409);
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "update",
            resourceId: id,
            before: current,
            after: changed,
          }),
        );
        return [changed];
      });
      return { data: updated };
    },
  );

  app.post(
    "/api/v1/files/:id/complete",
    {
      preHandler: [authenticate, requireFileContentPermission],
      schema: { tags: ["files"], summary: "Verify a direct upload before making it available" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const [current] = await dependencies.db
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)))
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
      assertCanWriteFileContent(request, current);
      const object = await dependencies.storage.head(current.storageKey);
      if (!object) throw new DomainError("NOT_FOUND", "Uploaded object was not found", 404);
      if (
        object.sizeBytes !== current.sizeBytes ||
        object.checksumSha256 !== current.checksumSha256
      ) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Uploaded object metadata does not match the declaration",
          400,
          {
            expectedSizeBytes: current.sizeBytes,
            actualSizeBytes: object.sizeBytes,
          },
        );
      }
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(files)
          .set({
            uploadStatus: "uploaded",
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, current.version),
            ),
          )
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "File changed concurrently", 409);
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "upload_verified",
            resourceId: id,
            before: current,
            after: changed,
          }),
        );
        return [changed];
      });
      return { data: updated };
    },
  );

  app.get(
    "/api/v1/files/:id/download",
    {
      preHandler: [authenticate, requirePermission("files:read")],
      schema: { tags: ["files"], summary: "Create a short-lived download URL" },
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const [record] = await dependencies.db
        .select()
        .from(files)
        .where(
          and(
            eq(files.id, id),
            eq(files.orgId, request.auth.orgId),
            eq(files.uploadStatus, "uploaded"),
            isNull(files.archivedAt),
          ),
        )
        .limit(1);
      if (!record) throw new DomainError("NOT_FOUND", "Uploaded file not found", 404);
      const download = await dependencies.storage.get(record.storageKey);
      if (!download) throw new DomainError("NOT_FOUND", "Stored object not found", 404);
      reply.header("content-type", record.contentType);
      reply.header("content-length", String(download.metadata.sizeBytes));
      reply.header(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
      );
      return reply.send(download.body);
    },
  );

  app.delete(
    "/api/v1/files/:id",
    {
      preHandler: [authenticate, requirePermission("files:delete")],
      schema: { tags: ["files"], summary: "Archive file metadata" },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const { expectedVersion } = archiveQuerySchema.parse(request.query);
      const [current] = await dependencies.db
        .select()
        .from(files)
        .where(and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)))
        .limit(1);
      if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(files)
          .set({
            archivedAt: new Date(),
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, expectedVersion),
            ),
          )
          .returning();
        if (!changed) throw new DomainError("CONFLICT", "File metadata changed concurrently", 409);
        await tx.insert(auditEvents).values(
          auditValue(context, {
            action: "archive",
            resourceId: id,
            before: current,
            after: changed,
          }),
        );
        return [changed];
      });
      return { data: updated };
    },
  );
}
