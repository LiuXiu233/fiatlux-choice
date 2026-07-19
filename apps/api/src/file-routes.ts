import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  fileCreateSchema,
  fileMetadataPolicyIssue,
  idSchema,
  listQuerySchema,
  MAX_FILE_SIZE_BYTES,
} from "@fiatlux/contracts";
import {
  auditEvents,
  complianceEvents,
  contracts,
  files,
  invoices,
  obligations,
} from "@fiatlux/db";
import { DomainError, hasPermission } from "@fiatlux/domain";
import { sanitizeIntegrationError } from "@fiatlux/integrations";
import { and, count, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { fileContentPolicyIssue } from "./file-content-policy.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies, RequestAuditContext } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
export const fileUpdateSchema = z.object({
  filename: z.string().min(1).max(255).optional(),
  classification: z.enum(["internal", "confidential", "personal", "public"]).optional(),
  expectedVersion: z.number().int().min(1),
});
export const fileArchiveQuerySchema = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});

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
    metadata?: Record<string, unknown>;
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
    metadata: event.metadata ?? {},
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
      const where = and(
        eq(files.orgId, request.auth.orgId),
        isNull(files.archivedAt),
        query.search ? ilike(files.filename, `%${query.search}%`) : undefined,
        query.status ? eq(files.uploadStatus, query.status) : undefined,
      );
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
      const content = request.body;
      if (!Buffer.isBuffer(content)) {
        throw new DomainError("VALIDATION_FAILED", "A binary request body is required", 400);
      }
      const contentLength = Number(request.headers["content-length"] ?? -1);
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        // Keep the row lock across object storage verification. This row is the cross-process
        // upload claim: no second API process may touch the same storage key until this attempt
        // either commits `stored` or rolls back to `pending`.
        const [current] = await tx
          .select()
          .from(files)
          .where(
            and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)),
          )
          .limit(1)
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
        assertCanWriteFileContent(request, current);
        if (current.uploadStatus !== "pending") {
          throw new DomainError("CONFLICT", "Only a pending file can receive content", 409);
        }
        if (contentLength !== current.sizeBytes) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Content-Length does not match declared file size",
            400,
          );
        }
        const contentIssue = fileContentPolicyIssue(current.filename, current.contentType, content);
        if (contentIssue) {
          throw new DomainError("VALIDATION_FAILED", contentIssue, 400);
        }
        try {
          await dependencies.storage.putVerified({
            storageKey: current.storageKey,
            body: Readable.from([content]),
            contentType: current.contentType,
            expectedSizeBytes: current.sizeBytes,
            expectedChecksumSha256: current.checksumSha256,
          });
        } catch (error) {
          throw new DomainError(
            "VALIDATION_FAILED",
            sanitizeIntegrationError(error, "Upload verification failed", { maxLength: 500 }),
            400,
          );
        }
        const [changed] = await tx
          .update(files)
          .set({
            uploadStatus: "stored",
            updatedAt: new Date(),
            version: sql`${files.version} + 1`,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, current.version),
              eq(files.uploadStatus, "pending"),
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
      if (expectedVersion !== current.version) {
        throw new DomainError("CONFLICT", "File metadata changed concurrently", 409, {
          expectedVersion,
          actualVersion: current.version,
        });
      }
      if (patch.filename) {
        const policyIssue = fileMetadataPolicyIssue(patch.filename, current.contentType);
        if (policyIssue) {
          throw new DomainError("VALIDATION_FAILED", policyIssue, 400);
        }
      }
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [changed] = await tx
          .update(files)
          .set({
            ...patch,
            updatedAt: new Date(),
            version: sql`${files.version} + 1`,
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
      if (current.uploadStatus !== "stored") {
        throw new DomainError("CONFLICT", "Only verified stored content can be completed", 409);
      }
      let object: Awaited<ReturnType<AppDependencies["storage"]["head"]>>;
      try {
        object = await dependencies.storage.head(current.storageKey);
      } catch (error) {
        throw new DomainError(
          "INTEGRATION_UNAVAILABLE",
          sanitizeIntegrationError(error, "Object storage verification failed", {
            maxLength: 500,
          }),
          503,
        );
      }
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
            version: sql`${files.version} + 1`,
          })
          .where(
            and(
              eq(files.id, id),
              eq(files.orgId, request.auth.orgId),
              eq(files.version, current.version),
              eq(files.uploadStatus, "stored"),
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
      let download: Awaited<ReturnType<AppDependencies["storage"]["get"]>>;
      try {
        download = await dependencies.storage.get(record.storageKey);
      } catch (error) {
        throw new DomainError(
          "INTEGRATION_UNAVAILABLE",
          sanitizeIntegrationError(error, "Object storage download failed", { maxLength: 500 }),
          503,
        );
      }
      if (!download) throw new DomainError("NOT_FOUND", "Stored object not found", 404);
      const context = requestAuditContext(request);
      await dependencies.db.insert(auditEvents).values(
        auditValue(context, {
          action: "download_issued",
          resourceId: id,
          metadata: {
            classification: record.classification,
            sizeBytes: download.metadata.sizeBytes,
            checksumSha256: record.checksumSha256,
            semantics: "authorized object stream issued; client receipt is not asserted",
          },
        }),
      );
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
      const { expectedVersion } = fileArchiveQuerySchema.parse(request.query);
      const context = requestAuditContext(request);
      const [updated] = await dependencies.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(files)
          .where(
            and(eq(files.id, id), eq(files.orgId, request.auth.orgId), isNull(files.archivedAt)),
          )
          .limit(1)
          .for("update");
        if (!current) throw new DomainError("NOT_FOUND", "File not found", 404);
        if (expectedVersion !== current.version) {
          throw new DomainError("CONFLICT", "File metadata changed concurrently", 409, {
            expectedVersion,
            actualVersion: current.version,
          });
        }
        const [contractReferences, invoiceReferences, obligationReferences, eventReferences] =
          await Promise.all([
            tx
              .select({ id: contracts.id })
              .from(contracts)
              .where(
                and(
                  eq(contracts.orgId, request.auth.orgId),
                  eq(contracts.fileId, current.id),
                  isNull(contracts.archivedAt),
                ),
              )
              .limit(1),
            tx
              .select({ id: invoices.id })
              .from(invoices)
              .where(
                and(
                  eq(invoices.orgId, request.auth.orgId),
                  eq(invoices.fileId, current.id),
                  isNull(invoices.archivedAt),
                ),
              )
              .limit(1),
            tx
              .select({ id: obligations.id })
              .from(obligations)
              .where(
                and(
                  eq(obligations.orgId, request.auth.orgId),
                  eq(obligations.evidenceFileId, current.id),
                  isNull(obligations.archivedAt),
                ),
              )
              .limit(1),
            tx
              .select({ id: complianceEvents.id })
              .from(complianceEvents)
              .where(
                and(
                  eq(complianceEvents.orgId, request.auth.orgId),
                  eq(complianceEvents.evidenceFileId, current.id),
                  isNull(complianceEvents.archivedAt),
                ),
              )
              .limit(1),
          ]);
        if (
          contractReferences[0] ||
          invoiceReferences[0] ||
          obligationReferences[0] ||
          eventReferences[0]
        ) {
          throw new DomainError("CONFLICT", "Referenced business evidence cannot be archived", 409);
        }
        const [changed] = await tx
          .update(files)
          .set({
            archivedAt: new Date(),
            updatedAt: new Date(),
            version: sql`${files.version} + 1`,
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
