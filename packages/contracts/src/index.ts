import { z } from "zod";

export const idSchema = z.string().uuid();
const offsetDateTimeSchema = z.string().datetime({ offset: true });
const chinaLocalDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/)
  .transform((value) => `${value.length === 16 ? `${value}:00` : value}+08:00`);
export const dateTimeSchema = z.union([offsetDateTimeSchema, chinaLocalDateTimeSchema]);
export const dateOrDateTimeSchema = z.union([
  dateTimeSchema,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => `${value}T00:00:00+08:00`),
]);
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .default("CNY");
export const jsonObjectSchema = z.record(z.string(), z.unknown());
export const MAX_FILE_SIZE_BYTES = 50_000_000;

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

export const objectiveCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
  status: z.enum(["draft", "active", "at_risk", "completed", "cancelled"]).default("draft"),
  ownerId: idSchema.nullish(),
  startsAt: dateTimeSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
  progress: z.number().int().min(0).max(100).default(0),
});

export const projectCreateSchema = z.object({
  objectiveId: idSchema.nullish(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
  status: z.enum(["planned", "active", "blocked", "completed", "cancelled"]).default("planned"),
  ownerId: idSchema.nullish(),
  startsAt: dateTimeSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
});

export const taskCreateSchema = z.object({
  projectId: idSchema.nullish(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).default("todo"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeId: idSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
});

export const decisionCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  context: z.string().trim().min(1).max(30_000),
  decision: z.string().trim().max(30_000).optional(),
  status: z.enum(["proposed", "approved", "rejected", "superseded"]).default("proposed"),
  decidedAt: dateTimeSchema.nullish(),
});

export const obligationCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20_000).optional(),
  category: z.enum(["corporate", "tax", "labor", "contract", "data", "ip", "archive", "other"]),
  status: z.enum(["open", "in_progress", "satisfied", "overdue", "waived"]).default("open"),
  ownerId: idSchema.nullish(),
  dueAt: dateTimeSchema.nullish(),
  recurrenceRule: z.string().trim().max(500).nullish(),
  sourceId: idSchema.nullish(),
});

export const complianceItemCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(100),
  issuingAuthority: z.string().trim().min(1).max(300),
  sourceUrl: z.string().url().max(2_000),
  effectiveDate: dateOrDateTimeSchema.nullish(),
  lastVerifiedAt: dateOrDateTimeSchema.nullish(),
  reviewStatus: z.enum(["pending", "reviewed", "stale"]).default("pending"),
  applicability: z.string().trim().max(20_000).optional(),
  summary: z.string().trim().max(30_000).optional(),
  jurisdiction: z.string().trim().min(1).max(100).default("中国/广东省/广州市"),
  sourceTitle: z.string().trim().min(1).max(500).optional(),
  sourcePublishedAt: dateOrDateTimeSchema.nullish(),
  sourceStatus: z.string().trim().max(100).optional(),
  sourceMetadata: jsonObjectSchema.optional(),
  status: z.enum(["draft", "active", "superseded", "repealed", "uncertain"]).default("draft"),
  contentHash: z.string().trim().max(128).nullish(),
  metadataHash: z.string().trim().max(128).nullish(),
});

export const riskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(20_000),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  treatment: z.string().trim().max(20_000).optional(),
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
  valueCents: z.number().int().nonnegative().nullish(),
  currency: currencySchema,
  fileId: idSchema.nullish(),
  ownerId: idSchema.nullish(),
});

export const financialEntryCreateSchema = z.object({
  occurredAt: dateTimeSchema,
  type: z.enum(["income", "expense", "transfer", "adjustment"]),
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2_000),
  amountCents: z.number().int().nonnegative(),
  currency: currencySchema,
  status: z.enum(["draft", "posted", "void"]).default("draft"),
  externalActionId: idSchema.nullish(),
});

export const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().trim().max(100).nullish(),
  direction: z.enum(["incoming", "outgoing"]),
  counterparty: z.string().trim().min(1).max(300),
  amountCents: z.number().int().nonnegative(),
  taxAmountCents: z.number().int().nonnegative().default(0),
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
  amountCents: z.number().int().positive(),
  currency: currencySchema,
  description: z.string().trim().max(2_000).optional(),
  status: z.enum(["forecast", "actual", "cancelled"]).default("forecast"),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).optional(),
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
  description: z.string().trim().max(20_000).optional(),
  eventType: z
    .enum(["deadline", "review", "filing", "renewal", "training", "monitoring"])
    .default("deadline"),
  sourceId: idSchema.nullish(),
  ownerId: idSchema.nullish(),
});

export const opportunityCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  source: z.string().trim().max(200).optional(),
  organization: z.string().trim().max(300).optional(),
  contact: z.string().trim().max(300).optional(),
  status: z.enum(["new", "qualified", "proposal", "won", "lost", "on_hold"]).default("new"),
  valueCents: z.number().int().nonnegative().nullish(),
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
  status: z.enum(["queued", "sent", "failed", "read"]).default("queued"),
});

export const workflowDefinitionCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  trigger: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        type: z.enum(["notify", "create_task", "request_approval", "advisor_run"]),
        config: jsonObjectSchema,
      }),
    )
    .min(1)
    .max(50),
});

export const workflowRunCreateSchema = z.object({
  definitionId: idSchema,
  input: jsonObjectSchema.default({}),
});

export const fileCreateSchema = z.object({
  filename: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().min(0).max(MAX_FILE_SIZE_BYTES),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  classification: z.enum(["internal", "confidential", "personal", "public"]).default("internal"),
});

export const approvalRequestSchema = z.object({
  resourceType: z.string().trim().min(1).max(100),
  resourceId: idSchema,
  operation: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(5_000),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("high"),
});

export const approvalDecisionSchema = z.object({
  comment: z.string().trim().min(1).max(5_000),
  acknowledgement: z.string().trim().max(500).optional(),
});

export const externalActionCreateSchema = z.object({
  kind: z.enum([
    "bank_payment",
    "tax_filing",
    "invoice_red",
    "contract_sign",
    "hr_discipline",
    "permission_change",
    "external_legal_commitment",
    "notification",
    "github_sync",
  ]),
  adapter: z.enum(["manual", "mock", "real"]),
  payload: jsonObjectSchema,
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(1).max(5_000),
});

export const externalActionTransitionSchema = z.object({
  targetStatus: z.enum(["submitted", "confirmed", "failed", "cancelled", "simulated"]),
  evidence: jsonObjectSchema.optional(),
  note: z.string().trim().max(5_000).optional(),
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
