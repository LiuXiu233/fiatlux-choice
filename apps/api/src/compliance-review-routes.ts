import {
  complianceProfessionalReviewSchema,
  complianceReviewListQuerySchema,
  complianceReviewOutcomeSchema,
  idSchema,
} from "@fiatlux/contracts";
import { auditEvents, complianceItems, files, users } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies } from "./types.js";

const idParamsSchema = z.object({ id: idSchema });
const MAX_REVIEW_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;

const reviewAuditMetadataSchema = z.object({
  reviewOutcome: complianceReviewOutcomeSchema,
  resultingStatus: z.enum(["active", "superseded", "repealed", "uncertain"]),
  reviewerName: z.string(),
  reviewerRole: z.string(),
  reviewerOrganization: z.string(),
  reviewerQualification: z.string(),
  evidenceFileId: idSchema,
  applicability: z.string(),
  summary: z.string(),
  missingInformation: z.string(),
  reason: z.string(),
  reviewedAt: z.string().datetime(),
  nextReviewAt: z.string().datetime(),
  reviewedSourceVersion: z.number().int().min(1),
  reviewedContentHash: z.string().nullable(),
  reviewedMetadataHash: z.string().nullable(),
});

function reviewWindow(nextReviewAt: string, reviewedAt: Date) {
  const nextReview = new Date(nextReviewAt);
  if (
    Number.isNaN(nextReview.valueOf()) ||
    nextReview <= reviewedAt ||
    nextReview.valueOf() - reviewedAt.valueOf() > MAX_REVIEW_WINDOW_MS
  ) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The next professional review must be after the registration time and no more than 366 days away",
      400,
    );
  }
  return nextReview;
}

export function registerComplianceReviewRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/compliance-items/:id/reviews",
    {
      preHandler: [authenticate, requirePermission("compliance-items:read")],
      schema: {
        tags: ["compliance-items"],
        summary: "List immutable professional review history",
      },
    },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const query = complianceReviewListQuerySchema.parse(request.query);
      const [source] = await dependencies.db
        .select({ id: complianceItems.id })
        .from(complianceItems)
        .where(
          and(
            eq(complianceItems.id, id),
            eq(complianceItems.orgId, request.auth.orgId),
            isNull(complianceItems.archivedAt),
          ),
        )
        .limit(1);
      if (!source) throw new DomainError("NOT_FOUND", "Compliance source not found", 404);

      const filter = and(
        eq(auditEvents.orgId, request.auth.orgId),
        eq(auditEvents.resourceType, "compliance-items"),
        eq(auditEvents.resourceId, id),
        eq(auditEvents.action, "professional_review"),
      );
      const offset = (query.page - 1) * query.pageSize;
      const [history, totals] = await Promise.all([
        dependencies.db
          .select({
            id: auditEvents.id,
            recordedByUserId: auditEvents.actorUserId,
            recordedByDisplayName: users.displayName,
            metadata: auditEvents.metadata,
            createdAt: auditEvents.createdAt,
          })
          .from(auditEvents)
          .leftJoin(users, eq(users.id, auditEvents.actorUserId))
          .where(filter)
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(query.pageSize)
          .offset(offset),
        dependencies.db.select({ value: count() }).from(auditEvents).where(filter),
      ]);
      const total = Number(totals[0]?.value ?? 0);
      return {
        data: history.map((entry) => ({
          id: entry.id,
          sourceId: id,
          recordedByUserId: entry.recordedByUserId,
          recordedByDisplayName: entry.recordedByDisplayName,
          recordedAt: entry.createdAt,
          ...reviewAuditMetadataSchema.parse(entry.metadata),
        })),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  app.post(
    "/api/v1/compliance-items/:id/reviews",
    {
      preHandler: [
        authenticate,
        requirePermission("compliance-items:update"),
        requirePermission("files:read"),
      ],
      schema: {
        tags: ["compliance-items"],
        summary: "Record an evidence-backed professional review",
      },
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const input = complianceProfessionalReviewSchema.parse(request.body);
      const context = requestAuditContext(request);
      const reviewedAt = new Date();
      const nextReviewAt = reviewWindow(input.nextReviewAt, reviewedAt);
      const unresolved = ["changes_required", "insufficient_information"].includes(
        input.reviewOutcome,
      );

      const result = await dependencies.db.transaction(async (tx) => {
        const [source] = await tx
          .select()
          .from(complianceItems)
          .where(
            and(
              eq(complianceItems.id, id),
              eq(complianceItems.orgId, request.auth.orgId),
              isNull(complianceItems.archivedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!source) throw new DomainError("NOT_FOUND", "Compliance source not found", 404);
        if (source.version !== input.expectedVersion) {
          throw new DomainError(
            "CONFLICT",
            "The compliance source changed since it was loaded",
            409,
            {
              expectedVersion: input.expectedVersion,
              actualVersion: source.version,
            },
          );
        }

        const [evidence] = await tx
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.id, input.evidenceFileId),
              eq(files.orgId, request.auth.orgId),
              eq(files.uploadStatus, "uploaded"),
              isNull(files.archivedAt),
            ),
          )
          .limit(1)
          .for("share");
        if (!evidence) {
          throw new DomainError(
            "VALIDATION_FAILED",
            "Professional review evidence must be an uploaded file in the active organization",
            400,
          );
        }

        const reviewStatus = unresolved ? "stale" : "reviewed";
        const reviewedContentHash = source.contentHash ?? null;
        const reviewedMetadataHash = source.metadataHash ?? null;
        const [updated] = await tx
          .update(complianceItems)
          .set({
            status: input.resultingStatus,
            reviewStatus,
            reviewOutcome: input.reviewOutcome,
            reviewerName: input.reviewerName,
            reviewerRole: input.reviewerRole,
            reviewerOrganization: input.reviewerOrganization,
            reviewerQualification: input.reviewerQualification,
            reviewMissingInformation: input.missingInformation,
            reviewEvidenceFileId: input.evidenceFileId,
            reviewedByUserId: request.auth.userId,
            reviewedAt,
            reviewedSourceVersion: source.version,
            reviewedContentHash,
            reviewedMetadataHash,
            applicability: input.applicability,
            summary: input.summary,
            lastVerifiedAt: reviewedAt,
            nextReviewAt,
            contentHashStatus:
              !unresolved && source.contentHashStatus === "changed" && source.contentHash
                ? "current"
                : source.contentHashStatus,
            updatedAt: reviewedAt,
            version: sql`${complianceItems.version} + 1`,
          })
          .where(
            and(
              eq(complianceItems.id, id),
              eq(complianceItems.orgId, request.auth.orgId),
              eq(complianceItems.version, input.expectedVersion),
              isNull(complianceItems.archivedAt),
            ),
          )
          .returning();
        if (!updated) {
          throw new DomainError(
            "CONFLICT",
            "The compliance source changed since it was loaded",
            409,
          );
        }

        const metadata = {
          reviewOutcome: input.reviewOutcome,
          resultingStatus: input.resultingStatus,
          reviewerName: input.reviewerName,
          reviewerRole: input.reviewerRole,
          reviewerOrganization: input.reviewerOrganization,
          reviewerQualification: input.reviewerQualification,
          evidenceFileId: input.evidenceFileId,
          applicability: input.applicability,
          summary: input.summary,
          missingInformation: input.missingInformation,
          reason: input.reason,
          reviewedAt: reviewedAt.toISOString(),
          nextReviewAt: nextReviewAt.toISOString(),
          reviewedSourceVersion: source.version,
          reviewedContentHash,
          reviewedMetadataHash,
        };
        const [audit] = await tx
          .insert(auditEvents)
          .values({
            orgId: context.orgId,
            actorUserId: context.actorUserId,
            action: "professional_review",
            resourceType: "compliance-items",
            resourceId: id,
            requestId: context.requestId,
            before: source,
            after: updated,
            metadata,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          })
          .returning({ id: auditEvents.id });
        if (!audit) throw new Error("Failed to append compliance professional review audit");
        return { updated, reviewId: audit.id };
      });

      return reply.status(201).send({
        data: result.updated,
        meta: { reviewId: result.reviewId },
      });
    },
  );
}
