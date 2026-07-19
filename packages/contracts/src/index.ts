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
