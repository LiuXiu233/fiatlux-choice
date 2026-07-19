import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const recordStatusEnum = pgEnum("record_status", ["active", "archived"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const externalActionStatusEnum = pgEnum("external_action_status", [
  "draft",
  "pending_approval",
  "approved",
  "submitted",
  "confirmed",
  "failed",
  "cancelled",
  "simulated",
]);
export const advisorRunStatusEnum = pgEnum("advisor_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const complianceContentHashStatusEnum = pgEnum("compliance_content_hash_status", [
  "pending_fetch",
  "current",
  "changed",
  "failed",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    currency: text("currency").notNull().default("CNY"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organizations_slug_uq").on(table.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_uq").on(table.email)],
);

const scopedColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    ...scopedColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
  },
  (table) => [
    uniqueIndex("memberships_org_user_uq").on(table.orgId, table.userId),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const roles = pgTable(
  "roles",
  {
    ...scopedColumns(),
    name: text("name").notNull(),
    systemKey: text("system_key"),
    description: text("description"),
  },
  (table) => [
    uniqueIndex("roles_org_name_uq").on(table.orgId, table.name),
    uniqueIndex("roles_org_system_key_uq").on(table.orgId, table.systemKey),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.roleId, table.permission] })],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.membershipId, table.roleId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    ...scopedColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_uq").on(table.tokenHash),
    index("sessions_user_org_idx").on(table.userId, table.orgId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    requestId: text("request_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").notNull().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_org_created_idx").on(table.orgId, table.createdAt),
    index("audit_events_resource_idx").on(table.orgId, table.resourceType, table.resourceId),
  ],
);

export const files = pgTable(
  "files",
  {
    ...scopedColumns(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    classification: text("classification").notNull().default("internal"),
    uploadStatus: text("upload_status").notNull().default("pending"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("files_org_storage_key_uq").on(table.orgId, table.storageKey),
    index("files_org_created_idx").on(table.orgId, table.createdAt),
  ],
);

export const objectives = pgTable(
  "objectives",
  {
    ...scopedColumns(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    progress: integer("progress").notNull().default(0),
  },
  (table) => [index("objectives_org_status_idx").on(table.orgId, table.status)],
);

export const projects = pgTable(
  "projects",
  {
    ...scopedColumns(),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("planned"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
  },
  (table) => [index("projects_org_status_idx").on(table.orgId, table.status)],
);

export const tasks = pgTable(
  "tasks",
  {
    ...scopedColumns(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_org_status_idx").on(table.orgId, table.status),
    index("tasks_project_idx").on(table.orgId, table.projectId),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    ...scopedColumns(),
    objectiveId: uuid("objective_id").references(() => objectives.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    context: text("context").notNull(),
    decision: text("decision"),
    status: text("status").notNull().default("proposed"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("decisions_org_status_idx").on(table.orgId, table.status),
    index("decisions_org_objective_idx").on(table.orgId, table.objectiveId),
    index("decisions_org_project_idx").on(table.orgId, table.projectId),
    index("decisions_org_task_idx").on(table.orgId, table.taskId),
  ],
);

export const complianceItems = pgTable(
  "compliance_items",
  {
    ...scopedColumns(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    issuingAuthority: text("issuing_authority").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    sourceStatus: text("source_status"),
    sourceMetadata: jsonb("source_metadata").notNull().default({}),
    effectiveDate: timestamp("effective_date", { withTimezone: true }),
    jurisdiction: text("jurisdiction").notNull().default("中国/广东省/广州市"),
    applicability: text("applicability"),
    summary: text("summary"),
    status: text("status").notNull().default("draft"),
    reviewStatus: text("review_status").notNull().default("pending"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    metadataHash: text("metadata_hash"),
    contentHashStatus: complianceContentHashStatusEnum("content_hash_status")
      .notNull()
      .default("pending_fetch"),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    monitoringCadenceDays: integer("monitoring_cadence_days").notNull().default(30),
    nextMonitorAt: timestamp("next_monitor_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastResolvedUrl: text("last_resolved_url"),
    lastHttpStatus: integer("last_http_status"),
    lastEtag: text("last_etag"),
    lastModified: text("last_modified"),
    rawSnapshotHash: text("raw_snapshot_hash"),
    monitoringFailureCount: integer("monitoring_failure_count").notNull().default(0),
    lastMonitoringError: text("last_monitoring_error"),
    monitoringLeaseToken: text("monitoring_lease_token"),
    monitoringLeaseUntil: timestamp("monitoring_lease_until", { withTimezone: true }),
    monitoringJobId: text("monitoring_job_id"),
  },
  (table) => [
    index("compliance_items_org_status_idx").on(table.orgId, table.status, table.reviewStatus),
    index("compliance_items_org_monitor_idx").on(
      table.orgId,
      table.contentHashStatus,
      table.nextMonitorAt,
    ),
    uniqueIndex("compliance_items_org_source_url_uq").on(table.orgId, table.sourceUrl),
  ],
);

export const complianceSourceSnapshots = pgTable(
  "compliance_source_snapshots",
  {
    ...scopedColumns(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => complianceItems.id, { onDelete: "cascade" }),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url").notNull(),
    httpStatus: integer("http_status").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    rawHash: text("raw_hash"),
    normalizedHash: text("normalized_hash"),
    previousContentHash: text("previous_content_hash"),
    normalizedExcerpt: text("normalized_excerpt"),
    changed: boolean("changed").notNull().default(false),
    notModified: boolean("not_modified").notNull().default(false),
    fetcherVersion: text("fetcher_version").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("compliance_source_snapshots_org_source_idx").on(
      table.orgId,
      table.sourceId,
      table.fetchedAt,
    ),
  ],
);

export const obligations = pgTable(
  "obligations",
  {
    ...scopedColumns(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    status: text("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    recurrenceRule: text("recurrence_rule"),
    sourceId: uuid("source_id").references(() => complianceItems.id, { onDelete: "set null" }),
    evidenceFileId: uuid("evidence_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("obligations_org_due_idx").on(table.orgId, table.status, table.dueAt),
    index("obligations_org_evidence_file_idx").on(table.orgId, table.evidenceFileId),
  ],
);

export const risks = pgTable(
  "risks",
  {
    ...scopedColumns(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    likelihood: integer("likelihood").notNull(),
    impact: integer("impact").notNull(),
    treatment: text("treatment"),
    status: text("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("risks_org_status_idx").on(table.orgId, table.status)],
);

export const contracts = pgTable(
  "contracts",
  {
    ...scopedColumns(),
    name: text("name").notNull(),
    counterparty: text("counterparty").notNull(),
    contractNumber: text("contract_number"),
    status: text("status").notNull().default("draft"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    valueCents: bigint("value_cents", { mode: "number" }),
    currency: text("currency").notNull().default("CNY"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [index("contracts_org_status_idx").on(table.orgId, table.status)],
);

export const financialEntries = pgTable(
  "financial_entries",
  {
    ...scopedColumns(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CNY"),
    status: text("status").notNull().default("draft"),
    externalActionId: uuid("external_action_id"),
  },
  (table) => [
    index("financial_entries_org_date_idx").on(table.orgId, table.occurredAt),
    uniqueIndex("financial_entries_org_external_action_uq").on(table.orgId, table.externalActionId),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    ...scopedColumns(),
    invoiceNumber: text("invoice_number"),
    direction: text("direction").notNull(),
    counterparty: text("counterparty").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    taxAmountCents: bigint("tax_amount_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("CNY"),
    status: text("status").notNull().default("draft"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  },
  (table) => [index("invoices_org_status_idx").on(table.orgId, table.status)],
);

export const cashFlowEntries = pgTable(
  "cash_flow_entries",
  {
    ...scopedColumns(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    direction: text("direction").notNull(),
    category: text("category").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CNY"),
    description: text("description"),
    status: text("status").notNull().default("forecast"),
  },
  (table) => [index("cash_flow_org_date_idx").on(table.orgId, table.occurredAt)],
);

export const products = pgTable(
  "products",
  {
    ...scopedColumns(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("other"),
    stage: text("stage").notNull().default("idea"),
    status: text("status").notNull().default("on_track"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("products_org_stage_idx").on(table.orgId, table.stage),
    index("products_org_category_idx").on(table.orgId, table.category),
    index("products_org_project_idx").on(table.orgId, table.projectId),
  ],
);

export const complianceEvents = pgTable(
  "compliance_events",
  {
    ...scopedColumns(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    eventType: text("event_type").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    reviewStatus: text("review_status").notNull().default("pending"),
    description: text("description"),
    sourceId: uuid("source_id").references(() => complianceItems.id, { onDelete: "set null" }),
    evidenceFileId: uuid("evidence_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("compliance_events_org_due_idx").on(
      table.orgId,
      table.category,
      table.status,
      table.dueDate,
    ),
    index("compliance_events_org_evidence_file_idx").on(table.orgId, table.evidenceFileId),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    ...scopedColumns(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    source: text("source"),
    organization: text("organization"),
    contact: text("contact"),
    status: text("status").notNull().default("new"),
    valueCents: bigint("value_cents", { mode: "number" }),
    currency: text("currency").notNull().default("CNY"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("opportunities_org_status_idx").on(table.orgId, table.status),
    index("opportunities_org_product_idx").on(table.orgId, table.productId),
    index("opportunities_org_project_idx").on(table.orgId, table.projectId),
  ],
);

export const githubInsights = pgTable(
  "github_insights",
  {
    ...scopedColumns(),
    repository: text("repository").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    url: text("url").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().default({}),
  },
  (table) => [
    index("github_insights_org_repo_idx").on(table.orgId, table.repository, table.capturedAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    ...scopedColumns(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    channel: text("channel").notNull().default("in_app"),
    status: text("status").notNull().default("queued"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("notifications_recipient_status_idx").on(table.orgId, table.recipientId, table.status),
  ],
);

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    ...scopedColumns(),
    name: text("name").notNull(),
    trigger: text("trigger").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    steps: jsonb("steps").notNull().default([]),
  },
  (table) => [index("workflow_definitions_trigger_idx").on(table.orgId, table.trigger)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    ...scopedColumns(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").notNull().default({}),
    definitionVersion: integer("definition_version"),
    stepsSnapshot: jsonb("steps_snapshot"),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("workflow_runs_org_status_idx").on(table.orgId, table.status)],
);

export const approvals = pgTable(
  "approvals",
  {
    ...scopedColumns(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    operation: text("operation").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").notNull().default({}),
    riskLevel: text("risk_level").notNull().default("high"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
  },
  (table) => [index("approvals_org_status_idx").on(table.orgId, table.status, table.createdAt)],
);

export const externalActions = pgTable(
  "external_actions",
  {
    ...scopedColumns(),
    kind: text("kind").notNull(),
    adapter: text("adapter").notNull(),
    status: externalActionStatusEnum("status").notNull().default("draft"),
    payload: jsonb("payload").notNull(),
    evidence: jsonb("evidence"),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason").notNull(),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    uniqueIndex("external_actions_org_idempotency_uq").on(table.orgId, table.idempotencyKey),
    index("external_actions_org_status_idx").on(table.orgId, table.status),
  ],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    ...scopedColumns(),
    advisorKey: text("advisor_key").notNull(),
    versionNumber: integer("version_number").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    toolPolicy: jsonb("tool_policy").notNull().default({}),
    dataScopes: jsonb("data_scopes").notNull().default([]),
    active: boolean("active").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("prompt_versions_org_advisor_version_uq").on(
      table.orgId,
      table.advisorKey,
      table.versionNumber,
    ),
  ],
);

export const advisorRuns = pgTable(
  "advisor_runs",
  {
    ...scopedColumns(),
    advisorKey: text("advisor_key").notNull(),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    question: text("question").notNull(),
    contextRefs: jsonb("context_refs").notNull().default([]),
    contextSnapshot: jsonb("context_snapshot").notNull().default([]),
    status: advisorRunStatusEnum("status").notNull().default("queued"),
    output: jsonb("output"),
    confidence: integer("confidence_basis_points"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("advisor_runs_org_status_idx").on(table.orgId, table.status, table.createdAt)],
);

export const advisorModelCalls = pgTable(
  "advisor_model_calls",
  {
    ...scopedColumns(),
    runId: uuid("run_id")
      .notNull()
      .references(() => advisorRuns.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id, { onDelete: "restrict" }),
    requestPayload: jsonb("request_payload").notNull(),
    responsePayload: jsonb("response_payload"),
    status: text("status").notNull().default("started"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
  },
  (table) => [index("advisor_model_calls_run_idx").on(table.orgId, table.runId, table.createdAt)],
);

export const advisorToolCalls = pgTable(
  "advisor_tool_calls",
  {
    ...scopedColumns(),
    runId: uuid("run_id")
      .notNull()
      .references(() => advisorRuns.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output"),
    status: text("status").notNull(),
    error: text("error"),
  },
  (table) => [index("advisor_tool_calls_run_idx").on(table.orgId, table.runId, table.createdAt)],
);

export const advisorCitations = pgTable(
  "advisor_citations",
  {
    ...scopedColumns(),
    runId: uuid("run_id")
      .notNull()
      .references(() => advisorRuns.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url"),
    excerpt: text("excerpt"),
  },
  (table) => [index("advisor_citations_run_idx").on(table.orgId, table.runId)],
);

export const advisorEdits = pgTable(
  "advisor_edits",
  {
    ...scopedColumns(),
    runId: uuid("run_id")
      .notNull()
      .references(() => advisorRuns.id, { onDelete: "cascade" }),
    editedBy: uuid("edited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    before: jsonb("before").notNull(),
    after: jsonb("after").notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [index("advisor_edits_run_idx").on(table.orgId, table.runId, table.createdAt)],
);

export const integrationChecks = pgTable(
  "integration_checks",
  {
    ...scopedColumns(),
    integrationId: text("integration_id").notNull(),
    status: text("status").notNull(),
    detail: text("detail").notNull(),
    checkedBy: uuid("checked_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integration_checks_org_integration_idx").on(
      table.orgId,
      table.integrationId,
      table.checkedAt,
    ),
  ],
);

export const backups = pgTable(
  "backups",
  {
    ...scopedColumns(),
    name: text("name").notNull(),
    scope: text("scope").notNull().default("full"),
    status: text("status").notNull().default("queued"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    storageKey: text("storage_key"),
    checksumSha256: text("checksum_sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [index("backups_org_status_idx").on(table.orgId, table.status, table.createdAt)],
);

export const resourceTables = {
  objectives,
  projects,
  tasks,
  decisions,
  obligations,
  "compliance-items": complianceItems,
  "compliance-events": complianceEvents,
  risks,
  contracts,
  "financial-entries": financialEntries,
  invoices,
  "cash-flow": cashFlowEntries,
  products,
  opportunities,
  "github-insights": githubInsights,
  notifications,
  "workflow-definitions": workflowDefinitions,
  "workflow-runs": workflowRuns,
} as const;
