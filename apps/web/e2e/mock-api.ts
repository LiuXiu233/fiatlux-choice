import type { Page, Route } from "@playwright/test";

const session = {
  user: {
    id: "user-owner",
    email: "owner@fiatlux.local",
    displayName: "经营负责人",
  },
  orgId: "org-fiatlux",
  role: "owner",
  permissions: ["*"],
  mustChangePassword: false,
};

const dashboard = {
  metrics: [
    { key: "active_projects", label: "进行中项目", value: 4, tone: "neutral" },
    { key: "pending_approvals", label: "待审批", value: 2, tone: "warning" },
    { key: "cash_balance", label: "可用现金", value: 280000, tone: "positive" },
    { key: "high_risks", label: "高风险", value: 1, tone: "danger" },
  ],
  priorities: [
    {
      id: "task-1",
      title: "确认训练营试点范围",
      status: "active",
      priority: "high",
      assigneeName: "经营负责人",
      dueDate: "2026-07-20",
    },
  ],
  deadlines: [
    {
      id: "due-1",
      title: "季度企业所得税预缴复核",
      status: "pending",
      category: "财税",
      dueDate: "2026-07-22",
    },
  ],
  cashflow: [
    { label: "7 月", inflow: 180000, outflow: 130000 },
    { label: "8 月", inflow: 210000, outflow: 155000 },
  ],
  riskSummary: [
    { label: "高风险", value: 1, tone: "danger" },
    { label: "中风险", value: 3, tone: "warning" },
    { label: "已缓解", value: 8, tone: "positive" },
  ],
  advisorBriefs: [
    {
      advisor: "总经理顾问",
      title: "本周经营重点已更新",
      confidence: 0.82,
      createdAt: "2026-07-18T08:00:00Z",
      status: "completed",
    },
  ],
};

const tasks: Array<Record<string, unknown>> = [
  {
    id: "task-1",
    title: "确认训练营试点范围",
    status: "active",
    priority: "high",
    assigneeName: "经营负责人",
    dueDate: "2026-07-20",
  },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `advisor-task-${index + 1}`,
    title: `顾问上下文任务 #${index + 1}`,
    status: index % 2 === 0 ? "todo" : "in_progress",
    priority: "normal",
    createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  })),
];

const approval = {
  id: "approval-1",
  title: "支付赛事场地定金",
  status: "pending",
  resourceType: "external-action",
  resourceId: "external-action-pending-1",
  operation: "bank_payment",
  actionType: "bank_payment",
  riskLevel: "high",
  requestedByName: "财务经办",
  requestedBy: "user-owner",
  requestedAt: "2026-07-18T07:00:00Z",
  reason: "依据已归档场地合同支付首期款",
  amount: 50000,
  linkedExternalAction: {
    id: "external-action-pending-1",
    status: "pending_approval",
    adapter: "manual",
    evidence: null,
    externalReference: null,
  },
};

const confirmedApproval = {
  id: "approval-confirmed-1",
  title: "支付电竞教育试点场租尾款",
  status: "approved",
  resourceType: "external-action",
  resourceId: "external-action-confirmed-1",
  operation: "bank_payment",
  actionType: "bank_payment",
  riskLevel: "critical",
  requestedByName: "经营负责人",
  requestedBy: "user-owner",
  requestedAt: "2026-07-17T07:00:00Z",
  reason: "依据场馆验收记录支付已批准尾款",
  amount: 30000,
  linkedExternalAction: {
    id: "external-action-confirmed-1",
    status: "confirmed",
    adapter: "manual",
    evidence: {
      externalReference: "manual-submit-training-20260717",
      receiptReference: "manual-receipt-training-20260717",
    },
    externalReference: "manual-receipt-training-20260717",
  },
};

const approvals = [approval, confirmedApproval];

const externalActions: Array<Record<string, unknown>> = [];
const mockRoles = [
  { id: "role-owner", name: "所有者", systemKey: "owner", permissions: ["*"] },
  { id: "role-admin", name: "管理员", systemKey: "admin", permissions: ["users:*"] },
  { id: "role-member", name: "成员", systemKey: "member", permissions: ["tasks:*"] },
];
const workflows: Array<Record<string, unknown>> = [
  {
    id: "workflow-1",
    name: "每周经营检查",
    trigger: "manual",
    enabled: true,
    steps: [
      {
        type: "notify",
        config: {
          recipientId: "user-member",
          title: "每周经营检查",
          body: "请复核本周经营事项",
          channel: "in_app",
          status: "queued",
        },
      },
    ],
    version: 1,
    updatedAt: "2026-07-18T09:00:00Z",
  },
];
const workflowRuns: Array<Record<string, unknown>> = [];
const complianceSource = {
  id: "compliance-source-1",
  title: "中华人民共和国公司法",
  category: "company_governance",
  issuingAuthority: "全国人民代表大会常务委员会",
  status: "uncertain",
  reviewStatus: "stale",
  contentHashStatus: "changed",
  contentHash: "4".repeat(64),
  metadataHash: "5".repeat(64),
  nextReviewAt: "2026-08-18T00:00:00Z",
  nextMonitorAt: "2026-07-25T00:00:00Z",
  version: 2,
};
const complianceReviews: Array<Record<string, unknown>> = [];
const complianceSnapshots = [
  {
    id: "compliance-snapshot-2",
    sourceId: complianceSource.id,
    requestedUrl: "https://www.gov.cn/policy",
    finalUrl: "https://www.gov.cn/policy-v2",
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    sizeBytes: 256,
    rawHash: "3".repeat(64),
    normalizedHash: "4".repeat(64),
    previousContentHash: "2".repeat(64),
    normalizedExcerpt: "第二版发生变化的官方正文摘录",
    changed: true,
    notModified: false,
    fetcherVersion: "official-source-fetcher-v1",
    fetchedAt: "2026-07-18T00:00:00Z",
  },
];
const evidenceFile = {
  id: "file-member-evidence-1",
  filename: "member-evidence.txt",
  contentType: "text/plain",
  sizeBytes: 28,
  checksumSha256: "a".repeat(64),
  classification: "internal",
  uploadStatus: "uploaded",
  status: "active",
  version: 3,
};
const obligations: Array<Record<string, unknown>> = [];
const complianceEvents: Array<Record<string, unknown>> = [];
const complianceMonitoringStatus = {
  generatedAt: "2026-07-20T02:31:00+08:00",
  sourceCount: 1,
  dueAvailableCount: 0,
  inFlightCount: 0,
  pendingFetchCount: 0,
  failedCount: 0,
  changedCount: 0,
  staleReviewCount: 0,
  overdueReviewCount: 0,
  oldestDueAt: null,
  nextFutureMonitorAt: "2026-07-25T00:00:00Z",
  latestDispatch: {
    occurredAt: "2026-07-20T02:30:00+08:00",
    batchLimit: 12,
    dueCount: 1,
    queuedCount: 1,
    hasMoreDue: false,
  },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function installMockApi(
  page: Page,
  options: {
    membershipStatus?: "active" | "inactive" | "offboarded";
    mustChangePassword?: boolean;
    role?: string;
    permissions?: string[];
    displayName?: string;
  } = {},
) {
  let loggedIn = false;
  const sessionState = {
    ...session,
    user: {
      ...session.user,
      displayName: options.displayName ?? session.user.displayName,
    },
    role: options.role ?? session.role,
    permissions: options.permissions ?? session.permissions,
    mustChangePassword: options.mustChangePassword ?? session.mustChangePassword,
  };
  const membershipStatus = options.membershipStatus ?? "active";
  let pendingLifecycleAction: "deactivate" | "offboard" | "reactivate" | null = null;
  const operationalIncidents: Array<Record<string, unknown>> = [
    {
      incidentId: "8feee8b8-6c3a-4360-b535-aef2ec87bc6f",
      sourceType: "workflow-run",
      sourceId: "ef79a0ed-e9df-412f-b0a9-3cb72df7665f",
      detectedAt: "2026-07-20T02:30:00+08:00",
      title: "每周经营检查",
      currentStatus: "failed",
      currentVersion: 5,
      sourceError: "Worker execution lease expired; requires manual review",
      sourceExists: true,
      possiblePartialEffects: true,
      recordedPartialEffects: true,
      recordedPartialCount: 1,
      status: "open",
      resolution: null,
    },
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/auth/me")
      return loggedIn
        ? json(route, { data: sessionState })
        : json(route, { error: { message: "未登录", code: "UNAUTHORIZED" } }, 401);
    if (path === "/auth/login" && request.method() === "POST") {
      loggedIn = true;
      return json(route, { data: sessionState });
    }
    if (path === "/auth/logout") {
      loggedIn = false;
      return json(route, { data: null });
    }
    if (path === "/auth/change-password" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>;
      if (
        input.currentPassword !== "correct-horse-battery-staple" ||
        typeof input.newPassword !== "string" ||
        input.newPassword.length < 14
      ) {
        return json(route, { error: { message: "密码校验失败" } }, 400);
      }
      sessionState.mustChangePassword = false;
      return json(route, { data: { changed: true, revokedOtherSessions: 0 } });
    }
    if (path === "/dashboard") return json(route, { data: dashboard });
    if (path === "/operations/incidents" && request.method() === "GET") {
      const requestedStatus = url.searchParams.get("status") ?? "open";
      const requestedType = url.searchParams.get("type");
      const items = operationalIncidents.filter(
        (incident) =>
          incident.status === requestedStatus &&
          (!requestedType || incident.sourceType === requestedType),
      );
      return json(route, {
        data: items,
        meta: {
          page: 1,
          pageSize: 20,
          total: items.length,
          pageCount: items.length ? 1 : 0,
          status: requestedStatus,
          ...(requestedType ? { type: requestedType } : {}),
        },
      });
    }
    const incidentResolutionMatch = /^\/operations\/incidents\/([^/]+)\/resolve$/.exec(path);
    if (incidentResolutionMatch && request.method() === "POST") {
      const incident = operationalIncidents.find(
        (candidate) => candidate.incidentId === incidentResolutionMatch[1],
      );
      if (incident?.status !== "open") {
        return json(route, { error: { message: "运行异常不存在或已经处置" } }, 409);
      }
      const input = request.postDataJSON() as Record<string, unknown>;
      if (
        input.resolution !== "manual_compensation_completed" ||
        typeof input.reviewSummary !== "string" ||
        input.reviewSummary.trim().length < 20 ||
        !Array.isArray(input.evidenceReferences) ||
        input.evidenceReferences.length === 0 ||
        !input.compensationReference ||
        input.acknowledgement !== "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED"
      ) {
        return json(route, { error: { message: "运行异常处置输入无效" } }, 400);
      }
      incident.status = "resolved";
      incident.resolution = {
        auditEventId: "98d024f1-cbd8-4c3c-9781-40c1a7b283a5",
        resolution: input.resolution,
        reviewSummary: input.reviewSummary,
        evidenceReferences: input.evidenceReferences,
        compensationReference: input.compensationReference,
        resolvedAt: "2026-07-20T03:30:00+08:00",
        resolvedByUserId: sessionState.user.id,
        resolvedByDisplayName: sessionState.user.displayName,
      };
      return json(route, {
        data: {
          resolutionAuditId: "98d024f1-cbd8-4c3c-9781-40c1a7b283a5",
          incidentId: incident.incidentId,
          sourceType: incident.sourceType,
          sourceId: incident.sourceId,
          status: "resolved",
          resolution: input.resolution,
          reviewSummary: input.reviewSummary,
          evidenceReferences: input.evidenceReferences,
          compensationReference: input.compensationReference,
          resolvedAt: "2026-07-20T03:30:00+08:00",
          resolvedByUserId: sessionState.user.id,
          sourceStatus: incident.currentStatus,
          sourceVersion: incident.currentVersion,
          sourceRecordChanged: false,
          automaticReplay: false,
        },
      });
    }
    if (path === "/files" && request.method() === "GET") {
      return json(route, {
        data: [evidenceFile],
        meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
      });
    }
    if (path === `/files/${evidenceFile.id}/download` && request.method() === "GET") {
      return route.fulfill({
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Disposition": `attachment; filename="${evidenceFile.filename}"`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: "member-downloadable-evidence",
      });
    }
    if (path === "/obligations" && request.method() === "GET") {
      return json(route, {
        data: obligations,
        meta: { page: 1, pageSize: 20, total: obligations.length, pageCount: 1 },
      });
    }
    if (path === "/obligations" && request.method() === "POST") {
      const created = {
        id: `obligation-${obligations.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
        version: 1,
      };
      obligations.unshift(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/compliance-events" && request.method() === "GET") {
      return json(route, {
        data: complianceEvents,
        meta: { page: 1, pageSize: 20, total: complianceEvents.length, pageCount: 1 },
      });
    }
    if (path === "/compliance-events" && request.method() === "POST") {
      const created = {
        id: `compliance-event-${complianceEvents.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
        version: 1,
      };
      complianceEvents.unshift(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/compliance-items" && request.method() === "GET") {
      return json(route, {
        data: [complianceSource],
        meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
      });
    }
    if (path === "/compliance-items/monitoring-status" && request.method() === "GET") {
      return json(route, { data: complianceMonitoringStatus });
    }
    if (path === "/compliance-items/compliance-source-1/monitor" && request.method() === "POST") {
      return json(
        route,
        { data: { sourceId: complianceSource.id, jobId: "compliance-job-1", status: "queued" } },
        202,
      );
    }
    if (path === "/compliance-items/compliance-source-1/snapshots" && request.method() === "GET") {
      return json(route, {
        data: complianceSnapshots,
        meta: { page: 1, pageSize: 10, total: 1, pageCount: 1 },
      });
    }
    if (path === "/compliance-items/compliance-source-1/reviews" && request.method() === "GET") {
      return json(route, {
        data: complianceReviews,
        meta: { page: 1, pageSize: 10, total: complianceReviews.length, pageCount: 1 },
      });
    }
    if (path === "/compliance-items/compliance-source-1/reviews" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>;
      if (
        input.expectedVersion !== complianceSource.version ||
        !["applicable", "not_applicable", "changes_required", "insufficient_information"].includes(
          String(input.reviewOutcome),
        ) ||
        !["active", "superseded", "repealed", "uncertain"].includes(
          String(input.resultingStatus),
        ) ||
        !String(input.reviewerOrganization ?? "").trim() ||
        !String(input.missingInformation ?? "").trim() ||
        input.evidenceFileId !== evidenceFile.id
      ) {
        return json(route, { error: { message: "专业复核输入无效" } }, 400);
      }
      const reviewedAt = "2026-07-20T02:00:00.000Z";
      const reviewId = `compliance-review-${complianceReviews.length + 1}`;
      const unresolved = ["changes_required", "insufficient_information"].includes(
        String(input.reviewOutcome),
      );
      const history = {
        id: reviewId,
        sourceId: complianceSource.id,
        recordedByUserId: session.user.id,
        recordedByDisplayName: session.user.displayName,
        recordedAt: reviewedAt,
        ...input,
        reviewerOrganization: input.reviewerOrganization,
        reviewedAt,
        nextReviewAt: `${String(input.nextReviewAt)}T00:00:00+08:00`,
        reviewedSourceVersion: complianceSource.version,
        reviewedContentHash: complianceSource.contentHash,
        reviewedMetadataHash: complianceSource.metadataHash,
      };
      complianceReviews.unshift(history);
      Object.assign(complianceSource, {
        status: input.resultingStatus,
        reviewStatus: unresolved ? "stale" : "reviewed",
        reviewOutcome: input.reviewOutcome,
        reviewerName: input.reviewerName,
        reviewerRole: input.reviewerRole,
        reviewerOrganization: input.reviewerOrganization,
        reviewerQualification: input.reviewerQualification,
        reviewMissingInformation: input.missingInformation,
        reviewEvidenceFileId: input.evidenceFileId,
        reviewedByUserId: session.user.id,
        reviewedAt,
        reviewedSourceVersion: complianceSource.version,
        reviewedContentHash: complianceSource.contentHash,
        reviewedMetadataHash: complianceSource.metadataHash,
        applicability: input.applicability,
        summary: input.summary,
        nextReviewAt: history.nextReviewAt,
        contentHashStatus: unresolved ? complianceSource.contentHashStatus : "current",
        version: complianceSource.version + 1,
      });
      return json(route, { data: complianceSource, meta: { reviewId } }, 201);
    }
    if (path === "/users" && request.method() === "GET") {
      return json(route, {
        data: [
          {
            id: "user-member",
            membershipId: "membership-member",
            email: "member@fiatlux.local",
            displayName: "试点运营成员",
            userStatus: "active",
            membershipStatus,
            pendingLifecycleAction,
            pendingLifecycleApprovalId: pendingLifecycleAction ? "approval-lifecycle" : null,
            roles: [mockRoles[2]],
            version: 2,
            createdAt: "2026-07-18T06:00:00Z",
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1, pageCount: 1 },
      });
    }
    if (path === "/roles" && request.method() === "GET") {
      return json(route, { data: mockRoles });
    }
    if (path === "/role-assignments" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>;
      if (
        input.membershipId !== "membership-member" ||
        input.roleId !== "role-admin" ||
        input.mode !== "assign" ||
        input.expectedVersion !== 2 ||
        typeof input.reason !== "string" ||
        !input.reason.trim() ||
        typeof input.idempotencyKey !== "string"
      ) {
        return json(route, { error: { message: "角色变更申请无效" } }, 400);
      }
      return json(
        route,
        {
          data: {
            id: "approval-role-assignment",
            resourceType: "role-assignment",
            resourceId: input.membershipId,
            status: "pending",
            reason: input.reason,
          },
          meta: { replay: false },
        },
        201,
      );
    }
    if (path === "/users/user-member/lifecycle" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>;
      if (
        (input.action !== "deactivate" &&
          input.action !== "offboard" &&
          input.action !== "reactivate") ||
        input.expectedVersion !== 2 ||
        typeof input.reason !== "string" ||
        input.reason.trim().length === 0 ||
        typeof input.idempotencyKey !== "string"
      ) {
        return json(route, { error: { message: "成员生命周期申请无效" } }, 400);
      }
      if (
        (input.action === "reactivate" && membershipStatus !== "inactive") ||
        (input.action !== "reactivate" && membershipStatus !== "active")
      ) {
        return json(route, { error: { message: "成员状态不允许此操作" } }, 409);
      }
      pendingLifecycleAction = input.action;
      return json(
        route,
        {
          data: {
            id: "approval-lifecycle",
            status: "pending",
            operation:
              input.action === "deactivate"
                ? "membership_deactivate"
                : input.action === "offboard"
                  ? "membership_offboard"
                  : "membership_reactivate",
            reason: input.reason,
            riskLevel: "critical",
          },
          meta: { replay: false },
        },
        201,
      );
    }
    if (path === "/tasks" && request.method() === "GET")
      return json(route, {
        data: tasks,
        meta: { page: 1, pageSize: 20, total: tasks.length, totalPages: 1 },
      });
    if (path === "/tasks" && request.method() === "POST") {
      const created = {
        id: `task-${tasks.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
      };
      tasks.push(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/contracts" && request.method() === "GET") {
      return json(route, {
        data: [
          {
            id: "contract-active-1",
            name: "电竞教育场馆合作协议",
            counterparty: "广州试点场馆",
            status: "active",
            version: 3,
          },
        ],
        meta: { page: 1, pageSize: 100, total: 1, pageCount: 1 },
      });
    }
    if (path === "/financial-entries" && request.method() === "GET") {
      return json(route, {
        data: [
          {
            id: "financial-entry-draft-1",
            description: "电竞教育试点场租首款",
            type: "expense",
            status: "draft",
            amountCents: 500_000,
            currency: "CNY",
            version: 1,
          },
        ],
        meta: { page: 1, pageSize: 100, total: 1, pageCount: 1 },
      });
    }
    if (path === "/approvals" && request.method() === "GET") {
      const status = url.searchParams.get("status");
      const items = status ? approvals.filter((item) => item.status === status) : approvals;
      return json(route, {
        data: items,
        meta: { page: 1, pageSize: 50, total: items.length, pageCount: 1 },
      });
    }
    if (path === "/approvals/approval-1/approve") {
      const decision = request.postDataJSON() as Record<string, unknown>;
      if (decision.acknowledgement !== "SELF_APPROVAL_ACKNOWLEDGED") {
        return json(route, { error: { message: "本人审批必须明确确认" } }, 400);
      }
      return json(route, { data: { ...approval, status: "approved" } });
    }
    if (path === "/external-actions" && request.method() === "GET") {
      return json(route, { data: externalActions });
    }
    if (path === "/external-actions" && request.method() === "POST") {
      const created = {
        id: `external-action-${externalActions.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
        status: "pending_approval",
        approvalId: "approval-new",
        requestedBy: "user-owner",
        createdAt: "2026-07-18T09:00:00Z",
        updatedAt: "2026-07-18T09:00:00Z",
        version: 1,
      };
      externalActions.push(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/workflow-definitions" && request.method() === "GET") {
      return json(route, {
        data: workflows,
        meta: { page: 1, pageSize: 20, total: workflows.length, totalPages: 1 },
      });
    }
    if (path === "/workflow-definitions" && request.method() === "POST") {
      const created = {
        id: `workflow-${workflows.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
        version: 1,
        createdAt: "2026-07-18T09:15:00Z",
        updatedAt: "2026-07-18T09:15:00Z",
      };
      workflows.unshift(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/workflow-runs" && request.method() === "GET") {
      return json(route, {
        data: workflowRuns,
        meta: { page: 1, pageSize: 10, total: workflowRuns.length, totalPages: 1 },
      });
    }
    if (path === "/workflow-runs" && request.method() === "POST") {
      const created = {
        id: `workflow-run-${workflowRuns.length + 1}`,
        ...(request.postDataJSON() as Record<string, unknown>),
        status: "queued",
        version: 1,
        createdAt: "2026-07-18T09:30:00Z",
      };
      workflowRuns.unshift(created);
      return json(route, { data: created }, 201);
    }
    if (path === "/advisors")
      return json(route, {
        data: [
          {
            key: "general_manager",
            name: "General Manager",
            requiredPermission: "advisors:read",
            dataScopes: [
              "objectives",
              "projects",
              "tasks",
              "decisions",
              "risks",
              "financial-entries",
            ],
            promptVersion: {
              advisorKey: "general_manager",
              versionNumber: 1,
              dataScopes: [
                "objectives",
                "projects",
                "tasks",
                "decisions",
                "risks",
                "financial-entries",
              ],
              updatedAt: "2026-07-18T00:00:00Z",
            },
          },
        ],
      });
    if (path === "/advisor-runs" && request.method() === "GET") return json(route, { data: [] });
    if (path === "/advisor-runs" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>;
      return json(
        route,
        {
          data: {
            id: "advisor-run-explicit-context",
            advisorKey: input.advisor,
            question: input.question,
            contextRefs: input.context,
            status: "queued",
            confidence: 0,
            createdAt: "2026-07-18T10:00:00Z",
          },
        },
        201,
      );
    }
    return json(route, { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
  });
}

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("owner@fiatlux.local");
  await page.getByLabel("密码", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "进入工作区" }).click();
  await page.waitForURL("**/");
}
