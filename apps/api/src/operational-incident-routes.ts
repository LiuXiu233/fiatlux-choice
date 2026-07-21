import {
  idSchema,
  operationalIncidentListQuerySchema,
  operationalIncidentResolutionSchema,
  operationalIncidentResolutionTypeSchema,
  operationalIncidentTypeSchema,
} from "@fiatlux/contracts";
import { advisorRuns, auditEvents, backups, workflowRuns } from "@fiatlux/db";
import { DomainError } from "@fiatlux/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { type AuthenticateHook, requirePermission } from "./auth.js";
import { requestAuditContext } from "./resource-repository.js";
import type { AppDependencies } from "./types.js";

const incidentIdParamsSchema = z.object({ id: idSchema });
const incidentResourceTypes = operationalIncidentTypeSchema.options;
const RESOLUTION_ACTION = "manual_review_completed";
const RESOLUTION_SCHEMA_VERSION = 1;

interface RawIncidentRow {
  incidentId: string;
  sourceType: string;
  sourceId: string;
  detectedAt: Date | string;
  title: string | null;
  currentStatus: string | null;
  currentVersion: number | null;
  sourceError: string | null;
  sourceExists: boolean;
  recordedPartialEffects: boolean;
  recordedPartialCount: number;
  resolutionAuditId: string | null;
  resolutionType: string | null;
  reviewSummary: string | null;
  evidenceReferences: unknown;
  compensationReference: string | null;
  resolvedAt: Date | string | null;
  resolvedByUserId: string | null;
  resolvedByDisplayName: string | null;
  totalCount: number;
}

function asIsoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Operational incident contains an invalid date");
  return date.toISOString();
}

function normalizeEvidenceReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeIncident(row: RawIncidentRow) {
  const parsedResolution = row.resolutionAuditId
    ? operationalIncidentResolutionSchema.safeParse({
        resolution: row.resolutionType,
        reviewSummary: row.reviewSummary,
        evidenceReferences: normalizeEvidenceReferences(row.evidenceReferences),
        ...(row.compensationReference ? { compensationReference: row.compensationReference } : {}),
        acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
      })
    : null;
  const resolution =
    row.resolutionAuditId && row.resolvedAt && parsedResolution?.success
      ? {
          auditEventId: row.resolutionAuditId,
          resolution: parsedResolution.data.resolution,
          reviewSummary: parsedResolution.data.reviewSummary,
          evidenceReferences: parsedResolution.data.evidenceReferences,
          compensationReference: parsedResolution.data.compensationReference ?? null,
          resolvedAt: asIsoDate(row.resolvedAt),
          resolvedByUserId: row.resolvedByUserId,
          resolvedByDisplayName: row.resolvedByDisplayName,
        }
      : null;

  return {
    incidentId: row.incidentId,
    sourceType: operationalIncidentTypeSchema.parse(row.sourceType),
    sourceId: row.sourceId,
    detectedAt: asIsoDate(row.detectedAt),
    title: row.title ?? `${row.sourceType} ${row.sourceId}`,
    currentStatus: row.currentStatus,
    currentVersion: row.currentVersion,
    sourceError: row.sourceError,
    sourceExists: row.sourceExists,
    possiblePartialEffects: true,
    recordedPartialEffects: row.recordedPartialEffects,
    recordedPartialCount: Number(row.recordedPartialCount ?? 0),
    status: resolution ? ("resolved" as const) : ("open" as const),
    resolution,
  };
}

function recordedWorkflowEffects(output: unknown): number {
  if (output === null) return 0;
  if (typeof output !== "object" || Array.isArray(output)) return 1;
  const steps = (output as { steps?: unknown }).steps;
  return Array.isArray(steps) ? steps.length : 1;
}

export function registerOperationalIncidentRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
  authenticate: AuthenticateHook,
) {
  app.get(
    "/api/v1/operations/incidents",
    {
      preHandler: [authenticate, requirePermission("operations-incidents:read")],
      schema: {
        tags: ["operations"],
        summary: "List lease-expiry incidents that require explicit human investigation",
      },
    },
    async (request) => {
      const query = operationalIncidentListQuerySchema.parse(request.query);
      const typeFilter = query.type ? sql`AND incident.resource_type = ${query.type}` : sql``;
      const resolutionFilter =
        query.status === "open"
          ? sql`AND resolution.id IS NULL`
          : sql`AND resolution.id IS NOT NULL`;
      const offset = (query.page - 1) * query.pageSize;
      const result = await dependencies.db.execute(sql`
        SELECT
          incident.id AS "incidentId",
          incident.resource_type AS "sourceType",
          incident.resource_id AS "sourceId",
          incident.created_at AS "detectedAt",
          CASE incident.resource_type
            WHEN 'advisor-run' THEN advisor.question
            WHEN 'workflow-run' THEN workflow_definition.name
            WHEN 'backup' THEN backup.name
          END AS title,
          CASE incident.resource_type
            WHEN 'advisor-run' THEN advisor.status::text
            WHEN 'workflow-run' THEN workflow.status::text
            WHEN 'backup' THEN backup.status::text
          END AS "currentStatus",
          CASE incident.resource_type
            WHEN 'advisor-run' THEN advisor.version
            WHEN 'workflow-run' THEN workflow.version
            WHEN 'backup' THEN backup.version
          END AS "currentVersion",
          CASE incident.resource_type
            WHEN 'advisor-run' THEN advisor.error
            WHEN 'workflow-run' THEN workflow.error
            WHEN 'backup' THEN backup.error
          END AS "sourceError",
          (advisor.id IS NOT NULL OR workflow.id IS NOT NULL OR backup.id IS NOT NULL)
            AS "sourceExists",
          CASE incident.resource_type
            WHEN 'advisor-run' THEN advisor.output IS NOT NULL
            WHEN 'workflow-run' THEN
              CASE
                WHEN jsonb_typeof(workflow.output -> 'steps') = 'array'
                  THEN jsonb_array_length(workflow.output -> 'steps') > 0
                ELSE workflow.output IS NOT NULL
              END
            WHEN 'backup' THEN
              backup.storage_key IS NOT NULL
              OR backup.checksum_sha256 IS NOT NULL
              OR backup.size_bytes IS NOT NULL
            ELSE false
          END AS "recordedPartialEffects",
          CASE
            WHEN incident.resource_type = 'workflow-run'
              AND jsonb_typeof(workflow.output -> 'steps') = 'array'
              THEN jsonb_array_length(workflow.output -> 'steps')
            ELSE 0
          END::integer AS "recordedPartialCount",
          resolution.id AS "resolutionAuditId",
          resolution.metadata ->> 'resolution' AS "resolutionType",
          resolution.metadata ->> 'reviewSummary' AS "reviewSummary",
          resolution.metadata -> 'evidenceReferences' AS "evidenceReferences",
          resolution.metadata ->> 'compensationReference' AS "compensationReference",
          resolution.created_at AS "resolvedAt",
          resolution.actor_user_id AS "resolvedByUserId",
          resolution.display_name AS "resolvedByDisplayName",
          count(*) OVER()::integer AS "totalCount"
        FROM audit_events incident
        LEFT JOIN advisor_runs advisor
          ON incident.resource_type = 'advisor-run'
          AND advisor.id::text = incident.resource_id
          AND advisor.org_id = incident.org_id
        LEFT JOIN workflow_runs workflow
          ON incident.resource_type = 'workflow-run'
          AND workflow.id::text = incident.resource_id
          AND workflow.org_id = incident.org_id
        LEFT JOIN workflow_definitions workflow_definition
          ON workflow_definition.id = workflow.definition_id
          AND workflow_definition.org_id = incident.org_id
        LEFT JOIN backups backup
          ON incident.resource_type = 'backup'
          AND backup.id::text = incident.resource_id
          AND backup.org_id = incident.org_id
        LEFT JOIN LATERAL (
          SELECT candidate.*, reviewer.display_name
          FROM audit_events candidate
          LEFT JOIN users reviewer ON reviewer.id = candidate.actor_user_id
          WHERE candidate.org_id = incident.org_id
            AND candidate.resource_type = incident.resource_type
            AND candidate.resource_id = incident.resource_id
            AND candidate.action = ${RESOLUTION_ACTION}
            AND candidate.metadata ->> 'incidentAuditId' = incident.id::text
            AND candidate.metadata ->> 'schemaVersion' = ${String(RESOLUTION_SCHEMA_VERSION)}
            AND candidate.metadata ->> 'acknowledgement'
              = 'NO_AUTOMATIC_REPLAY_ACKNOWLEDGED'
            AND candidate.metadata ->> 'resolution' IN (
              'no_partial_effects_found',
              'manual_compensation_completed'
            )
            AND jsonb_typeof(candidate.metadata -> 'reviewSummary') = 'string'
            AND char_length(btrim(candidate.metadata ->> 'reviewSummary')) BETWEEN 20 AND 5000
            AND jsonb_array_length(
              CASE
                WHEN jsonb_typeof(candidate.metadata -> 'evidenceReferences') = 'array'
                  THEN candidate.metadata -> 'evidenceReferences'
                ELSE '[]'::jsonb
              END
            ) BETWEEN 1 AND 20
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(candidate.metadata -> 'evidenceReferences') = 'array'
                    THEN candidate.metadata -> 'evidenceReferences'
                  ELSE '[]'::jsonb
                END
              ) AS evidence_reference(value)
              WHERE jsonb_typeof(evidence_reference.value) <> 'string'
                OR char_length(btrim(evidence_reference.value #>> '{}')) NOT BETWEEN 1 AND 500
            )
            AND CASE candidate.metadata ->> 'resolution'
              WHEN 'manual_compensation_completed' THEN
                jsonb_typeof(candidate.metadata -> 'compensationReference') = 'string'
                AND char_length(
                  btrim(candidate.metadata ->> 'compensationReference')
                ) BETWEEN 1 AND 500
              ELSE
                candidate.metadata -> 'compensationReference' IS NULL
                OR jsonb_typeof(candidate.metadata -> 'compensationReference') = 'null'
                OR (
                  jsonb_typeof(candidate.metadata -> 'compensationReference') = 'string'
                  AND char_length(
                    btrim(candidate.metadata ->> 'compensationReference')
                  ) BETWEEN 1 AND 500
                )
            END
          ORDER BY candidate.created_at DESC, candidate.id DESC
          LIMIT 1
        ) resolution ON true
        WHERE incident.org_id = ${request.auth.orgId}
          AND incident.action = 'lease_expired'
          AND incident.resource_type IN ('advisor-run', 'workflow-run', 'backup')
          ${typeFilter}
          ${resolutionFilter}
        ORDER BY incident.created_at DESC, incident.id DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `);
      const rows = Array.from(result) as unknown as RawIncidentRow[];
      const data = rows.map(normalizeIncident);
      const total = Number(rows[0]?.totalCount ?? 0);
      return {
        data,
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          pageCount: Math.ceil(total / query.pageSize),
          status: query.status,
          ...(query.type ? { type: query.type } : {}),
        },
      };
    },
  );

  app.post(
    "/api/v1/operations/incidents/:id/resolve",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: [authenticate, requirePermission("operations-incidents:update")],
      schema: {
        tags: ["operations"],
        summary: "Record human investigation without replaying or changing the failed run",
      },
    },
    async (request) => {
      const { id } = incidentIdParamsSchema.parse(request.params);
      const input = operationalIncidentResolutionSchema.parse(request.body);
      const auditContext = requestAuditContext(request);

      const resolution = await dependencies.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('fiatlux-operational-incident'), hashtext(${id}))`,
        );
        const [incident] = await tx
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.id, id),
              eq(auditEvents.orgId, request.auth.orgId),
              eq(auditEvents.action, "lease_expired"),
              inArray(auditEvents.resourceType, incidentResourceTypes),
            ),
          )
          .limit(1);
        if (!incident) throw new DomainError("NOT_FOUND", "Operational incident not found", 404);
        const sourceId = idSchema.safeParse(incident.resourceId);
        if (!sourceId.success) {
          throw new DomainError(
            "CONFLICT",
            "Operational incident source reference is invalid",
            409,
          );
        }

        const [existing] = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.orgId, request.auth.orgId),
              eq(auditEvents.resourceType, incident.resourceType),
              eq(auditEvents.resourceId, incident.resourceId),
              eq(auditEvents.action, RESOLUTION_ACTION),
              sql`${auditEvents.metadata} ->> 'incidentAuditId' = ${incident.id}`,
              sql`${auditEvents.metadata} ->> 'schemaVersion' = ${String(
                RESOLUTION_SCHEMA_VERSION,
              )}`,
            ),
          )
          .limit(1);
        if (existing) {
          throw new DomainError("CONFLICT", "Operational incident is already resolved", 409);
        }

        let sourceStatus: string | null = null;
        let sourceVersion: number | null = null;
        let recordedPartialEffects = false;
        if (incident.resourceType === "advisor-run") {
          const [source] = await tx
            .select({
              status: advisorRuns.status,
              version: advisorRuns.version,
              output: advisorRuns.output,
            })
            .from(advisorRuns)
            .where(
              and(eq(advisorRuns.id, sourceId.data), eq(advisorRuns.orgId, request.auth.orgId)),
            )
            .limit(1)
            .for("share");
          if (!source) throw new DomainError("CONFLICT", "Advisor run evidence is missing", 409);
          sourceStatus = source.status;
          sourceVersion = source.version;
          recordedPartialEffects = source.output !== null;
        } else if (incident.resourceType === "workflow-run") {
          const [source] = await tx
            .select({
              status: workflowRuns.status,
              version: workflowRuns.version,
              output: workflowRuns.output,
            })
            .from(workflowRuns)
            .where(
              and(eq(workflowRuns.id, sourceId.data), eq(workflowRuns.orgId, request.auth.orgId)),
            )
            .limit(1)
            .for("share");
          if (!source) throw new DomainError("CONFLICT", "Workflow run evidence is missing", 409);
          sourceStatus = source.status;
          sourceVersion = source.version;
          recordedPartialEffects = recordedWorkflowEffects(source.output) > 0;
        } else {
          const [source] = await tx
            .select({
              status: backups.status,
              version: backups.version,
              storageKey: backups.storageKey,
              checksumSha256: backups.checksumSha256,
              sizeBytes: backups.sizeBytes,
            })
            .from(backups)
            .where(and(eq(backups.id, sourceId.data), eq(backups.orgId, request.auth.orgId)))
            .limit(1)
            .for("share");
          if (!source) throw new DomainError("CONFLICT", "Backup run evidence is missing", 409);
          sourceStatus = source.status;
          sourceVersion = source.version;
          recordedPartialEffects = Boolean(
            source.storageKey || source.checksumSha256 || source.sizeBytes !== null,
          );
        }

        if (recordedPartialEffects && input.resolution === "no_partial_effects_found") {
          throw new DomainError(
            "CONFLICT",
            "The run contains recorded partial effects; document completed compensation instead",
            409,
          );
        }

        const metadata = {
          schemaVersion: RESOLUTION_SCHEMA_VERSION,
          incidentAuditId: incident.id,
          resolution: input.resolution,
          reviewSummary: input.reviewSummary,
          evidenceReferences: input.evidenceReferences,
          compensationReference: input.compensationReference ?? null,
          acknowledgement: input.acknowledgement,
          automaticReplay: false,
        };
        const [created] = await tx
          .insert(auditEvents)
          .values({
            orgId: auditContext.orgId,
            actorUserId: auditContext.actorUserId,
            action: RESOLUTION_ACTION,
            resourceType: incident.resourceType,
            resourceId: incident.resourceId,
            requestId: auditContext.requestId,
            before: {
              status: "open",
              sourceStatus,
              sourceVersion,
              recordedPartialEffects,
            },
            after: {
              status: "resolved",
              resolution: input.resolution,
              sourceStatus,
              sourceVersion,
            },
            metadata,
            ipAddress: auditContext.ipAddress,
            userAgent: auditContext.userAgent,
          })
          .returning({ id: auditEvents.id, createdAt: auditEvents.createdAt });
        if (!created) throw new Error("Failed to record operational incident resolution");
        return {
          resolutionAuditId: created.id,
          incidentId: incident.id,
          sourceType: operationalIncidentTypeSchema.parse(incident.resourceType),
          sourceId: sourceId.data,
          status: "resolved" as const,
          resolution: operationalIncidentResolutionTypeSchema.parse(input.resolution),
          reviewSummary: input.reviewSummary,
          evidenceReferences: input.evidenceReferences,
          compensationReference: input.compensationReference ?? null,
          resolvedAt: created.createdAt.toISOString(),
          resolvedByUserId: request.auth.userId,
          sourceStatus,
          sourceVersion,
          sourceRecordChanged: false,
          automaticReplay: false,
        };
      });

      return { data: resolution };
    },
  );
}
