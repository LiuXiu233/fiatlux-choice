import { z } from "zod";

export const idSchema = z.string().uuid();
const offsetDateTimeSchema = z.string().datetime({ offset: true });
function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const chinaLocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/)
  .refine((value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!match) return false;
    const [, year, month, day, hour, minute, second = "0"] = match;
    return (
      isValidCalendarDate(Number(year), Number(month), Number(day)) &&
      Number(hour) <= 23 &&
      Number(minute) <= 59 &&
      Number(second) <= 59
    );
  }, "Invalid China local calendar date-time")
  .transform((value) => `${value.length === 16 ? `${value}:00` : value}+08:00`);
export const dateTimeSchema = z.union([offsetDateTimeSchema, chinaLocalDateTimeSchema]);
export const dateOrDateTimeSchema = z.union([
  dateTimeSchema,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      return isValidCalendarDate(year ?? 0, month ?? 0, day ?? 0);
    }, "Invalid calendar date")
    .transform((value) => `${value}T00:00:00+08:00`),
]);
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default("CNY");
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const MAX_FILE_SIZE_BYTES = 50_000_000;

export const FILE_UPLOAD_MIME_TYPES_BY_EXTENSION = {
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  csv: ["text/csv"],
  md: ["text/markdown", "text/plain"],
  json: ["application/json"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
} as const;

const blockedFilenameSegments = new Set([
  "app",
  "apk",
  "bat",
  "bash",
  "bin",
  "cjs",
  "cmd",
  "com",
  "desktop",
  "dmg",
  "docm",
  "exe",
  "fish",
  "htm",
  "html",
  "jar",
  "js",
  "jsx",
  "lnk",
  "mjs",
  "msi",
  "msix",
  "php",
  "pl",
  "pkg",
  "ps1",
  "pptm",
  "py",
  "rb",
  "scr",
  "sh",
  "svg",
  "ts",
  "tsx",
  "url",
  "vbe",
  "vbs",
  "wsf",
  "xhtml",
  "xlam",
  "xlsm",
  "zsh",
]);
const reservedFilenameStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const allowedUploadMimeTypes = new Set<string>(
  Object.values(FILE_UPLOAD_MIME_TYPES_BY_EXTENSION).flat(),
);

export function fileNamePolicyIssue(filename: string): string | undefined {
  const normalized = filename.normalize("NFKC");
  if (/[/\\]/.test(normalized) || /[\p{Cc}\p{Cf}]/u.test(normalized)) {
    return "Filename contains a path separator or control character";
  }
  if (
    normalized !== normalized.trim() ||
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    normalized.includes("..")
  ) {
    return "Filename cannot be hidden or contain ambiguous dot segments";
  }
  const originalExtensionMatch = /\.([A-Za-z0-9]+)$/.exec(filename);
  const normalizedExtensionMatch = /\.([A-Za-z0-9]+)$/.exec(normalized);
  if (!originalExtensionMatch || !normalizedExtensionMatch) {
    return "Filename must end with an allowed ASCII extension";
  }
  const extension = normalizedExtensionMatch[1]?.toLowerCase();
  if (originalExtensionMatch[1]?.toLowerCase() !== extension) {
    return "Filename extension uses an ambiguous Unicode representation";
  }
  if (!extension || !(extension in FILE_UPLOAD_MIME_TYPES_BY_EXTENSION)) {
    return "Filename extension is not allowed";
  }
  const normalizedSegments = normalized.toLowerCase().split(".");
  if (normalizedSegments.some((segment) => !segment || segment !== segment.trim())) {
    return "Filename contains an empty or whitespace-padded segment";
  }
  const stem = normalizedSegments[0] ?? "";
  if (!stem || reservedFilenameStem.test(stem)) return "Filename stem is reserved";
  if (normalizedSegments.slice(0, -1).some((segment) => blockedFilenameSegments.has(segment))) {
    return "Filename contains a blocked executable, script, active-content, or macro extension";
  }
  return undefined;
}

export function fileMetadataPolicyIssue(filename: string, contentType: string): string | undefined {
  const filenameIssue = fileNamePolicyIssue(filename);
  if (filenameIssue) return filenameIssue;
  const normalizedContentType = contentType.trim().toLowerCase();
  if (!allowedUploadMimeTypes.has(normalizedContentType)) {
    return "Declared MIME type is not allowed";
  }
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const allowedForExtension = FILE_UPLOAD_MIME_TYPES_BY_EXTENSION[
    extension as keyof typeof FILE_UPLOAD_MIME_TYPES_BY_EXTENSION
  ] as readonly string[] | undefined;
  if (!allowedForExtension?.includes(normalizedContentType)) {
    return "Filename extension does not match the declared MIME type";
  }
  return undefined;
}

export const moneyCentsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const positiveMoneyCentsSchema = moneyCentsSchema.min(1);

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  category: z.string().trim().max(100).optional(),
});

export const operationalIncidentTypeSchema = z.enum(["advisor-run", "workflow-run", "backup"]);
export const operationalIncidentStatusSchema = z.enum(["open", "resolved"]);
export const operationalIncidentResolutionTypeSchema = z.enum([
  "no_partial_effects_found",
  "manual_compensation_completed",
]);

export const operationalIncidentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: operationalIncidentStatusSchema.default("open"),
  type: operationalIncidentTypeSchema.optional(),
});

export const operationalIncidentResolutionSchema = z
  .object({
    resolution: operationalIncidentResolutionTypeSchema,
    reviewSummary: z.string().trim().min(20).max(5_000),
    evidenceReferences: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    compensationReference: z.string().trim().min(1).max(500).optional(),
    acknowledgement: z.literal("NO_AUTOMATIC_REPLAY_ACKNOWLEDGED"),
  })
  .superRefine((input, context) => {
    if (input.resolution === "manual_compensation_completed" && !input.compensationReference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compensationReference"],
        message: "A compensation reference is required when manual compensation is completed",
      });
    }
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(10).max(256),
  orgId: idSchema.optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(14).max(256),
  })
  .refine((input) => input.currentPassword !== input.newPassword, {
    message: "New password must differ from the current password",
    path: ["newPassword"],
  });

export const membershipLifecycleActionSchema = z.enum(["deactivate", "offboard", "reactivate"]);
export const membershipLifecycleStatusSchema = z.enum([
  "pending",
  "active",
  "inactive",
  "offboarded",
]);
export const membershipLifecycleRequestSchema = z.object({
  action: membershipLifecycleActionSchema,
  reason: z.string().trim().min(1).max(5_000),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export const membershipLifecycleApprovalPayloadSchema = membershipLifecycleRequestSchema
  .omit({ reason: true })
  .extend({
    membershipId: idSchema,
    userId: idSchema,
  });

export const roleAssignmentModeSchema = z.enum(["assign", "remove"]);
export const roleAssignmentRequestSchema = z.object({
  membershipId: idSchema,
  roleId: idSchema,
  mode: roleAssignmentModeSchema,
  reason: z.string().trim().min(1).max(5_000),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export const roleAssignmentApprovalPayloadSchema = z.object({
  membershipId: idSchema,
  roleId: idSchema,
  mode: roleAssignmentModeSchema,
  expectedVersion: z.number().int().min(1).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  activateMembership: z.boolean().optional().default(false),
});

export const objectiveCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullish(),
  status: z.enum(["draft", "active", "at_risk", "completed", "cancelled"]).default("draft"),
  ownerId: idSchema.nullish(),
  startsAt: dateTimeSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
  progress: z.number().int().min(0).max(100).default(0),
});

export const projectCreateSchema = z.object({
  objectiveId: idSchema.nullish(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).nullish(),
  status: z.enum(["planned", "active", "blocked", "completed", "cancelled"]).default("planned"),
  ownerId: idSchema.nullish(),
  startsAt: dateTimeSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
});

export const taskCreateSchema = z.object({
  projectId: idSchema.nullish(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).nullish(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).default("todo"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeId: idSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
});

export const decisionCreateSchema = z.object({
  objectiveId: idSchema.nullish(),
  projectId: idSchema.nullish(),
  taskId: idSchema.nullish(),
  title: z.string().trim().min(1).max(300),
  context: z.string().trim().min(1).max(30_000),
  decision: z.string().trim().max(30_000).nullish(),
  status: z.enum(["proposed", "approved", "rejected", "superseded"]).default("proposed"),
  decidedAt: dateTimeSchema.nullish(),
});

export const obligationCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).nullish(),
  category: z.enum(["corporate", "tax", "labor", "contract", "data", "ip", "archive", "other"]),
  status: z.enum(["open", "in_progress", "satisfied", "overdue", "waived"]).default("open"),
  ownerId: idSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
  recurrenceRule: z.string().trim().max(500).nullish(),
  sourceId: idSchema.nullish(),
  evidenceFileId: idSchema.nullish(),
});

export const complianceItemCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(100),
  issuingAuthority: z.string().trim().min(1).max(300),
  sourceUrl: z.string().url().max(2_000),
  effectiveDate: dateOrDateTimeSchema.nullish(),
  lastVerifiedAt: dateOrDateTimeSchema.nullish(),
  reviewStatus: z.enum(["pending", "reviewed", "stale"]).default("pending"),
  applicability: z.string().trim().max(20_000).nullish(),
  summary: z.string().trim().max(30_000).nullish(),
  jurisdiction: z.string().trim().min(1).max(100).default("中国/广东省/广州市"),
  sourceTitle: z.string().trim().min(1).max(500).nullish(),
  sourcePublishedAt: dateOrDateTimeSchema.nullish(),
  sourceStatus: z.string().trim().max(100).nullish(),
  sourceMetadata: jsonObjectSchema.optional(),
  status: z.enum(["draft", "active", "superseded", "repealed", "uncertain"]).default("draft"),
  contentHash: z.string().trim().max(128).nullish(),
  metadataHash: z.string().trim().max(128).nullish(),
  contentHashStatus: z
    .enum(["pending_fetch", "current", "changed", "failed"])
    .default("pending_fetch"),
  nextReviewAt: dateOrDateTimeSchema.nullish(),
  monitoringCadenceDays: z.number().int().min(1).max(365).default(30),
});

export const complianceMonitorRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2_000).optional(),
});

export const complianceMonitorDispatchSummarySchema = z
  .object({
    occurredAt: dateTimeSchema,
    batchLimit: z.number().int().min(1).max(250),
    dueCount: z.number().int().min(0),
    queuedCount: z.number().int().min(0),
    hasMoreDue: z.boolean(),
  })
  .refine((summary) => summary.queuedCount <= summary.dueCount, {
    message: "Queued compliance sources cannot exceed selected due sources",
    path: ["queuedCount"],
  });

export const complianceMonitoringStatusSchema = z.object({
  generatedAt: dateTimeSchema,
  sourceCount: z.number().int().min(0),
  dueAvailableCount: z.number().int().min(0),
  inFlightCount: z.number().int().min(0),
  pendingFetchCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  changedCount: z.number().int().min(0),
  staleReviewCount: z.number().int().min(0),
  overdueReviewCount: z.number().int().min(0),
  oldestDueAt: dateTimeSchema.nullable(),
  nextFutureMonitorAt: dateTimeSchema.nullable(),
  latestDispatch: complianceMonitorDispatchSummarySchema.nullable(),
});

export const complianceReviewOutcomeSchema = z.enum([
  "applicable",
  "not_applicable",
  "changes_required",
  "insufficient_information",
]);

export const complianceProfessionalReviewSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    reviewOutcome: complianceReviewOutcomeSchema,
    resultingStatus: z.enum(["active", "superseded", "repealed", "uncertain"]),
    reviewerName: z.string().trim().min(2).max(200),
    reviewerRole: z.string().trim().min(2).max(200),
    reviewerOrganization: z.string().trim().min(2).max(300),
    reviewerQualification: z.string().trim().min(10).max(5_000),
    evidenceFileId: idSchema,
    applicability: z.string().trim().min(10).max(20_000),
    summary: z.string().trim().min(10).max(30_000),
    missingInformation: z.string().trim().min(5).max(20_000),
    nextReviewAt: dateOrDateTimeSchema,
    reason: z.string().trim().min(10).max(5_000),
  })
  .superRefine((input, context) => {
    const unresolved = ["changes_required", "insufficient_information"].includes(
      input.reviewOutcome,
    );
    if (unresolved && input.resultingStatus !== "uncertain") {
      context.addIssue({
        code: "custom",
        path: ["resultingStatus"],
        message: "Unresolved review outcomes must leave the source uncertain",
      });
    }
    if (!unresolved && input.resultingStatus === "uncertain") {
      context.addIssue({
        code: "custom",
        path: ["resultingStatus"],
        message: "A conclusive review must record the source lifecycle status",
      });
    }
  });

export const complianceReviewListQuerySchema = listQuerySchema.pick({
  page: true,
  pageSize: true,
});

export const riskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(20_000),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  treatment: z.string().trim().max(20_000).nullish(),
  status: z.enum(["open", "mitigating", "accepted", "closed"]).default("open"),
  ownerId: idSchema.nullish(),
});

export const contractCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  counterparty: z.string().trim().min(1).max(300),
  contractNumber: z.string().trim().max(100).nullish(),
  status: z
    .enum(["draft", "review", "pending_signature", "active", "expired", "terminated"])
    .default("draft"),
  startsAt: dateTimeSchema.nullish(),
  endsAt: dateTimeSchema.nullish(),
  valueCents: moneyCentsSchema.nullish(),
  currency: currencySchema,
  fileId: idSchema.nullish(),
  ownerId: idSchema.nullish(),
});

export const financialEntryCreateSchema = z.object({
  occurredAt: dateTimeSchema,
  type: z.enum(["income", "expense", "transfer", "adjustment"]),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2_000),
  amountCents: moneyCentsSchema,
  currency: currencySchema,
  status: z.enum(["draft", "posted", "void"]).default("draft"),
});

export const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().trim().max(100).nullish(),
  direction: z.enum(["incoming", "outgoing"]),
  counterparty: z.string().trim().min(1).max(300),
  amountCents: moneyCentsSchema,
  taxAmountCents: moneyCentsSchema.default(0),
  currency: currencySchema,
  status: z
    .enum(["draft", "issued", "received", "paid", "void", "red_pending", "red_confirmed"])
    .default("draft"),
  issuedAt: dateTimeSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
  fileId: idSchema.nullish(),
});

export const cashFlowCreateSchema = z.object({
  occurredAt: dateTimeSchema,
  direction: z.enum(["in", "out"]),
  category: z.string().trim().min(1).max(100),
  amountCents: positiveMoneyCentsSchema,
  currency: currencySchema,
  description: z.string().trim().max(2_000).nullish(),
  status: z.enum(["forecast", "actual", "cancelled"]).default("forecast"),
});

export const productCreateSchema = z.object({
  projectId: idSchema.nullish(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).nullish(),
  category: z
    .enum(["online_education", "esports_service", "software", "content", "other"])
    .default("other"),
  stage: z.enum(["idea", "validation", "development", "launched", "retired"]).default("idea"),
  status: z.enum(["on_track", "at_risk", "paused", "closed"]).default("on_track"),
  ownerId: idSchema.nullish(),
});

export const complianceEventCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(100),
  dueDate: dateOrDateTimeSchema,
  status: z
    .enum([
      "draft",
      "active",
      "pending",
      "completed",
      "blocked",
      "archived",
      "overdue",
      "cancelled",
    ])
    .default("draft"),
  reviewStatus: z.enum(["pending", "reviewed", "stale"]).default("pending"),
  description: z.string().trim().max(20_000).nullish(),
  eventType: z
    .enum(["deadline", "review", "filing", "renewal", "training", "monitoring"])
    .default("deadline"),
  sourceId: idSchema.nullish(),
  evidenceFileId: idSchema.nullish(),
  ownerId: idSchema.nullish(),
});

export const opportunityCreateSchema = z.object({
  productId: idSchema.nullish(),
  projectId: idSchema.nullish(),
  title: z.string().trim().min(1).max(300),
  source: z.string().trim().max(200).nullish(),
  organization: z.string().trim().max(300).nullish(),
  contact: z.string().trim().max(300).nullish(),
  status: z.enum(["new", "qualified", "proposal", "won", "lost", "on_hold"]).default("new"),
  valueCents: moneyCentsSchema.nullish(),
  currency: currencySchema,
  nextActionAt: dateTimeSchema.nullish(),
  ownerId: idSchema.nullish(),
});

export const githubInsightCreateSchema = z.object({
  repository: z
    .string()
    .trim()
    .regex(/^[^/\s]+\/[^/\s]+$/),
  kind: z.enum(["repository", "release", "issue", "pull_request", "security", "trend"]),
  summary: z.string().trim().min(1).max(20_000),
  url: z.string().url().max(2_000),
  capturedAt: dateTimeSchema,
  payload: jsonObjectSchema.default({}),
});

export const notificationCreateSchema = z.object({
  recipientId: idSchema,
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
  channel: z.enum(["in_app", "email", "webhook"]).default("in_app"),
  status: z.literal("queued").default("queued"),
});

export const notificationMarkReadSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

export const advisorKeySchema = z.enum([
  "general_manager",
  "finance",
  "legal_compliance",
  "product_rnd",
  "market_opportunity",
  "hr_admin",
  "information_security",
]);

export const workflowStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    config: notificationCreateSchema.extend({ status: z.literal("queued").default("queued") }),
  }),
  z.object({ type: z.literal("create_task"), config: taskCreateSchema }),
  z.object({
    type: z.literal("request_approval"),
    config: z
      .object({
        resourceType: z.string().trim().min(1).max(100),
        resourceId: idSchema,
        operation: z.string().trim().min(1).max(100),
        reason: z.string().trim().min(1).max(5_000),
        riskLevel: z.enum(["low", "medium", "high", "critical"]).default("high"),
      })
      .refine(
        (input) =>
          !["external-action", "membership-lifecycle", "role-assignment"].includes(
            input.resourceType,
          ),
        "Reserved approvals must use their controlled business workflow",
      ),
  }),
  z.object({
    type: z.literal("advisor_run"),
    config: z.object({
      advisor: advisorKeySchema,
      question: z.string().trim().min(1).max(20_000),
    }),
  }),
]);

export const workflowDefinitionCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trigger: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  steps: z.array(workflowStepSchema).min(1).max(50),
});

export const workflowRunCreateSchema = z.object({
  definitionId: idSchema,
  input: jsonObjectSchema.default({}),
});

export const fileCreateSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.string().trim().toLowerCase().min(1).max(200),
    sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE_BYTES),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    classification: z.enum(["internal", "confidential", "personal", "public"]).default("internal"),
  })
  .superRefine((input, context) => {
    const issue = fileMetadataPolicyIssue(input.filename, input.contentType);
    if (issue) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue,
        path: [issue.startsWith("Declared MIME") ? "contentType" : "filename"],
      });
    }
  });

export const RESERVED_APPROVAL_RESOURCE_TYPES = [
  "external-action",
  "membership-lifecycle",
  "role-assignment",
] as const;

export const approvalRequestSchema = z
  .object({
    resourceType: z.string().trim().min(1).max(100),
    resourceId: idSchema,
    operation: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(1).max(5_000),
    riskLevel: z.enum(["low", "medium", "high", "critical"]).default("high"),
  })
  .refine(
    (input) =>
      !(RESERVED_APPROVAL_RESOURCE_TYPES as readonly string[]).includes(input.resourceType),
    {
      message: "This approval type can only be created by its controlled business workflow",
      path: ["resourceType"],
    },
  );

export const approvalDecisionSchema = z.object({
  comment: z.string().trim().min(1).max(5_000),
  acknowledgement: z.string().trim().max(500).optional(),
});

const externalActionRequestFields = {
  adapter: z.enum(["manual", "mock"]),
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(1).max(5_000),
} as const;

export const externalActionCreateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("bank_payment"),
      ...externalActionRequestFields,
      payload: z
        .object({
          beneficiary: z.string().trim().min(1).max(500),
          amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
          purpose: z.string().trim().min(1).max(2_000).optional(),
          financialEntryId: idSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tax_filing"),
      ...externalActionRequestFields,
      payload: z
        .object({
          filingPeriod: z.string().trim().min(1).max(100),
          taxType: z.string().trim().min(1).max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("invoice_red"),
      ...externalActionRequestFields,
      payload: z
        .object({
          invoiceId: idSchema,
          reason: z.string().trim().min(1).max(2_000).optional(),
          reasonCode: z.string().trim().min(1).max(200).optional(),
        })
        .strict()
        .refine((payload) => Boolean(payload.reason || payload.reasonCode), {
          message: "Invoice red-letter actions require a reason or reasonCode",
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contract_sign"),
      ...externalActionRequestFields,
      payload: z
        .object({
          contractId: idSchema,
          signingBasis: z.string().trim().min(1).max(2_000).optional(),
          fileId: idSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("contract_terminate"),
      ...externalActionRequestFields,
      payload: z
        .object({
          contractId: idSchema,
          terminationBasis: z.string().trim().min(1).max(5_000),
          effectiveAt: dateTimeSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hr_discipline"),
      ...externalActionRequestFields,
      payload: z
        .object({
          userId: idSchema,
          proposedMeasure: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("permission_change"),
      ...externalActionRequestFields,
      payload: z
        .object({
          membershipId: idSchema,
          requestedChange: z.string().trim().min(1).max(2_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("external_legal_commitment"),
      ...externalActionRequestFields,
      payload: z
        .object({
          counterparty: z.string().trim().min(1).max(500),
          commitment: z.string().trim().min(1).max(5_000),
        })
        .strict(),
    })
    .strict(),
]);

export const externalActionTransitionSchema = z.object({
  targetStatus: z.enum(["submitted", "confirmed", "failed", "cancelled", "simulated"]),
  evidence: jsonObjectSchema.optional(),
  note: z.string().trim().max(5_000).optional(),
});

const evidenceSchema = z.object({
  sourceType: z.string().min(1).max(100),
  sourceId: z.string().min(1).max(500),
  excerpt: z.string().max(2_000).optional(),
});

export const advisorOutputSchema = z.object({
  facts: z.array(z.object({ claim: z.string().min(1), evidence: z.array(evidenceSchema).min(1) })),
  inferences: z.array(
    z.object({
      claim: z.string().min(1),
      basis: z.array(z.string().min(1)),
      confidence: z.number().min(0).max(1),
    }),
  ),
  recommendations: z.array(
    z.object({
      action: z.string().min(1),
      rationale: z.string().min(1),
      risk: z.string().min(1),
      priority: z.enum(["low", "medium", "high", "critical"]),
    }),
  ),
  risks: z.array(
    z.object({
      description: z.string().min(1),
      severity: z.enum(["low", "medium", "high", "critical"]),
      mitigation: z.string().min(1),
    }),
  ),
  missingInformation: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  disclaimer: z.string().min(1),
});

export const advisorRunCreateSchema = z.object({
  advisor: advisorKeySchema,
  question: z.string().trim().min(1).max(20_000),
  context: z
    .array(
      z.object({
        resourceType: z.string().trim().min(1).max(100),
        resourceId: idSchema,
      }),
    )
    .max(100)
    .default([]),
});

export const advisorRunEditSchema = z.object({
  output: advisorOutputSchema,
  reason: z.string().trim().min(1).max(5_000),
  expectedVersion: z.number().int().min(1),
});

export const resourceContracts = {
  objectives: objectiveCreateSchema,
  projects: projectCreateSchema,
  tasks: taskCreateSchema,
  decisions: decisionCreateSchema,
  obligations: obligationCreateSchema,
  "compliance-items": complianceItemCreateSchema,
  "compliance-events": complianceEventCreateSchema,
  risks: riskCreateSchema,
  contracts: contractCreateSchema,
  "financial-entries": financialEntryCreateSchema,
  invoices: invoiceCreateSchema,
  "cash-flow": cashFlowCreateSchema,
  products: productCreateSchema,
  opportunities: opportunityCreateSchema,
  "github-insights": githubInsightCreateSchema,
  notifications: notificationCreateSchema,
  "workflow-definitions": workflowDefinitionCreateSchema,
  "workflow-runs": workflowRunCreateSchema,
} as const;

export type ResourceName = keyof typeof resourceContracts;
export type AdvisorKey = z.infer<typeof advisorKeySchema>;
export type AdvisorOutput = z.infer<typeof advisorOutputSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ComplianceMonitoringStatus = z.infer<typeof complianceMonitoringStatusSchema>;

export const resourceNameSchema = z.enum(
  Object.keys(resourceContracts) as [ResourceName, ...ResourceName[]],
);

export function updateSchemaFor(resource: ResourceName) {
  return resourceContracts[resource].partial().extend({
    expectedVersion: z.number().int().min(1),
  });
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export const v1ReleaseGateIds = [
  "local_core_acceptance",
  "local_security_and_sensitive_data",
  "github_ci_security",
  "ghcr_release_artifacts",
  "target_intranet_deployment",
  "managed_device_pwa",
  "production_backup_restore",
  "real_llm_github_adapters",
  "compliance_professional_review",
  "education_content_clearance",
  "operational_responsibility_drills",
  "residual_risk_decisions",
  "known_blocking_defects_closed",
  "business_release_approval",
] as const;

export const v1ReleaseGateIdSchema = z.enum(v1ReleaseGateIds);
export const v1ReleaseEvidenceKindSchema = z.enum([
  "repository",
  "machine_evidence",
  "github_run",
  "registry",
  "target_environment",
  "approval",
  "professional_review",
  "risk_decision",
  "external_publication",
]);
export const v1ReleaseGitHubWorkflowSchema = z.enum(["ci", "security"]);
export const v1ReleaseArtifactSchema = z.enum([
  "api",
  "postgres",
  "minio",
  "worker",
  "web",
  "gateway",
  "backup",
]);

const gitCommitSchema = z.string().regex(/^[0-9a-f]{40}$/, "必须使用完整小写 Git commit SHA");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "必须使用 64 位小写 SHA-256");
const evidenceReferenceSchema = z
  .string()
  .trim()
  .min(5)
  .max(2_000)
  .refine(
    (value) => !/^(?:pending|todo|tbd|unknown|none|n\/a|placeholder)$/i.test(value),
    "证据引用不能使用占位值",
  );

export const v1ReleaseEvidenceSchema = z
  .object({
    kind: v1ReleaseEvidenceKindSchema,
    result: z.enum(["success", "blocked", "failure", "not_run"]),
    reference: evidenceReferenceSchema,
    verifiedAt: offsetDateTimeSchema,
    subjectCommit: gitCommitSchema.optional(),
    sha256: sha256Schema.optional(),
    githubWorkflow: v1ReleaseGitHubWorkflowSchema.optional(),
    releaseArtifact: v1ReleaseArtifactSchema.optional(),
    note: z.string().trim().min(5).max(2_000).optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.kind === "github_run" && !evidence.githubWorkflow) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubWorkflow"],
        message: "GitHub run 证据必须标识 ci 或 security workflow",
      });
    } else if (evidence.kind !== "github_run" && evidence.githubWorkflow) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["githubWorkflow"],
        message: "只有 GitHub run 证据可以标识 githubWorkflow",
      });
    }

    if (
      evidence.kind === "registry" &&
      evidence.result === "success" &&
      !evidence.releaseArtifact
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releaseArtifact"],
        message: "成功 registry 证据必须标识七类发布制品之一",
      });
    } else if (evidence.kind !== "registry" && evidence.releaseArtifact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releaseArtifact"],
        message: "只有 registry 证据可以标识 releaseArtifact",
      });
    }
  });

export const v1ReleaseApprovalSchema = z
  .object({
    approverIdentity: z.string().trim().min(2).max(200),
    approverRole: z.string().trim().min(2).max(200),
    approvalReference: evidenceReferenceSchema,
    approvedAt: offsetDateTimeSchema,
  })
  .strict();

export const v1ReleaseGateSchema = z
  .object({
    id: v1ReleaseGateIdSchema,
    status: z.enum(["passed", "blocked"]),
    ownerRole: z.string().trim().min(2).max(200),
    summary: z.string().trim().min(10).max(2_000),
    evidence: z.array(v1ReleaseEvidenceSchema).min(1).max(30),
    blockers: z.array(z.string().trim().min(10).max(2_000)).max(20),
    approval: v1ReleaseApprovalSchema.optional(),
    reviewedAt: offsetDateTimeSchema,
  })
  .strict();

const approvalRequiredGateIds = new Set<(typeof v1ReleaseGateIds)[number]>([
  "target_intranet_deployment",
  "managed_device_pwa",
  "production_backup_restore",
  "real_llm_github_adapters",
  "compliance_professional_review",
  "education_content_clearance",
  "operational_responsibility_drills",
  "residual_risk_decisions",
  "known_blocking_defects_closed",
  "business_release_approval",
]);

const requiredEvidenceKinds = {
  local_core_acceptance: ["machine_evidence"],
  local_security_and_sensitive_data: ["machine_evidence"],
  target_intranet_deployment: ["target_environment", "approval"],
  managed_device_pwa: ["target_environment", "approval"],
  production_backup_restore: ["machine_evidence", "approval"],
  real_llm_github_adapters: ["machine_evidence", "approval"],
  compliance_professional_review: ["professional_review", "approval"],
  education_content_clearance: ["professional_review", "external_publication", "approval"],
  operational_responsibility_drills: ["target_environment", "approval"],
  residual_risk_decisions: ["risk_decision", "approval"],
  known_blocking_defects_closed: ["risk_decision", "approval"],
  business_release_approval: ["approval"],
} as const satisfies Partial<
  Record<(typeof v1ReleaseGateIds)[number], readonly z.infer<typeof v1ReleaseEvidenceKindSchema>[]>
>;

export const v1ReleaseReadinessManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    versionLabel: z.string().trim().min(3).max(100),
    overallStatus: z.enum(["ready", "blocked"]),
    evaluatedAt: offsetDateTimeSchema,
    candidate: z
      .object({
        repository: z.string().url().startsWith("https://github.com/"),
        branch: z.string().trim().min(1).max(255),
        implementationCommit: gitCommitSchema,
        evidenceCommit: gitCommitSchema,
      })
      .strict(),
    gates: z.array(v1ReleaseGateSchema).length(v1ReleaseGateIds.length),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, gate] of manifest.gates.entries()) {
      if (seen.has(gate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gates", index, "id"],
          message: `V1 门禁重复：${gate.id}`,
        });
      }
      seen.add(gate.id);

      if (gate.status === "passed") {
        if (gate.blockers.length > 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "blockers"],
            message: "已通过门禁不得保留阻断项",
          });
        }
        const nonSuccessEvidence = gate.evidence.find(({ result }) => result !== "success");
        if (nonSuccessEvidence) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "evidence"],
            message: "已通过门禁的全部证据必须为 success",
          });
        }
        if (approvalRequiredGateIds.has(gate.id) && !gate.approval) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "approval"],
            message: "该门禁必须保留可识别人工批准",
          });
        }
        if (
          gate.approval &&
          !gate.evidence.some(
            ({ kind, result, reference }) =>
              kind === "approval" &&
              result === "success" &&
              reference === gate.approval?.approvalReference,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "evidence"],
            message: "人工批准元数据必须与一条 success approval 证据引用一致",
          });
        }
        const requiredKinds = requiredEvidenceKinds[gate.id as keyof typeof requiredEvidenceKinds];
        for (const requiredKind of requiredKinds ?? []) {
          if (
            !gate.evidence.some(({ kind, result }) => kind === requiredKind && result === "success")
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["gates", index, "evidence"],
              message: `已通过门禁缺少 ${requiredKind} 成功证据`,
            });
          }
        }
      } else if (gate.blockers.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gates", index, "blockers"],
          message: "阻断门禁必须说明至少一个具体阻断项",
        });
      }

      if (gate.id === "github_ci_security" && gate.status === "passed") {
        const githubRuns = gate.evidence.filter(
          ({ kind, result }) => kind === "github_run" && result === "success",
        );
        const distinctRunReferences = new Set(githubRuns.map(({ reference }) => reference));
        const workflowScopes = new Set(githubRuns.map(({ githubWorkflow }) => githubWorkflow));
        if (
          distinctRunReferences.size < 2 ||
          !workflowScopes.has("ci") ||
          !workflowScopes.has("security") ||
          githubRuns.some(
            ({ subjectCommit }) => subjectCommit !== manifest.candidate.evidenceCommit,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "evidence"],
            message: "GitHub CI 与 Security 必须有两个绑定 evidenceCommit 的独立绿色 run",
          });
        }
      }

      if (
        (gate.id === "local_core_acceptance" || gate.id === "local_security_and_sensitive_data") &&
        gate.status === "passed" &&
        !gate.evidence.some(
          ({ kind, result, subjectCommit }) =>
            kind === "machine_evidence" &&
            result === "success" &&
            subjectCommit === manifest.candidate.implementationCommit,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["gates", index, "evidence"],
          message: "本地通过门禁必须有绑定 implementationCommit 的成功机器证据",
        });
      }

      if (gate.id === "ghcr_release_artifacts" && gate.status === "passed") {
        const registryEvidence = gate.evidence.filter(
          ({ kind, result }) => kind === "registry" && result === "success",
        );
        const distinctArtifacts = new Set(registryEvidence.map(({ reference }) => reference));
        const artifactScopes = new Set(
          registryEvidence.map(({ releaseArtifact }) => releaseArtifact),
        );
        if (
          distinctArtifacts.size < 7 ||
          artifactScopes.size < v1ReleaseArtifactSchema.options.length ||
          registryEvidence.some(
            ({ subjectCommit }) => subjectCommit !== manifest.candidate.evidenceCommit,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["gates", index, "evidence"],
            message: "GHCR 必须有七个绑定 evidenceCommit 的独立发布制品证据",
          });
        }
      }
    }

    const missingGateIds = v1ReleaseGateIds.filter((gateId) => !seen.has(gateId));
    if (missingGateIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gates"],
        message: `缺少 V1 门禁：${missingGateIds.join("、")}`,
      });
    }

    const computedStatus = manifest.gates.every(({ status }) => status === "passed")
      ? "ready"
      : "blocked";
    if (manifest.overallStatus !== computedStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overallStatus"],
        message: `overallStatus 必须与逐项门禁一致：${computedStatus}`,
      });
    }
  });

export type V1ReleaseGateId = z.infer<typeof v1ReleaseGateIdSchema>;
export type V1ReleaseReadinessManifest = z.infer<typeof v1ReleaseReadinessManifestSchema>;

export function evaluateV1ReleaseReadiness(manifest: V1ReleaseReadinessManifest) {
  const passedGateIds = manifest.gates
    .filter(({ status }) => status === "passed")
    .map(({ id }) => id);
  const blockedGates = manifest.gates
    .filter(({ status }) => status === "blocked")
    .map(({ id, blockers, ownerRole }) => ({ id, blockers, ownerRole }));
  return {
    ready: blockedGates.length === 0,
    overallStatus: manifest.overallStatus,
    totalGateCount: manifest.gates.length,
    passedGateCount: passedGateIds.length,
    blockedGateCount: blockedGates.length,
    passedGateIds,
    blockedGates,
  } as const;
}
