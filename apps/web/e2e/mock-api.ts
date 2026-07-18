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
];

const approval = {
  id: "approval-1",
  title: "支付赛事场地定金",
  status: "pending_approval",
  actionType: "bank_payment",
  riskLevel: "high",
  requestedByName: "财务经办",
  requestedBy: "user-owner",
  requestedAt: "2026-07-18T07:00:00Z",
  reason: "依据已归档场地合同支付首期款",
  amount: 50000,
  externalState: "not_started",
  evidenceRequired: true,
};

const externalActions: Array<Record<string, unknown>> = [];
const workflows: Array<Record<string, unknown>> = [
  {
    id: "workflow-1",
    name: "每周经营检查",
    trigger: "manual",
    enabled: true,
    steps: [{ type: "notify", config: {} }],
    version: 1,
    updatedAt: "2026-07-18T09:00:00Z",
  },
];
const workflowRuns: Array<Record<string, unknown>> = [];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function installMockApi(page: Page) {
  let loggedIn = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/auth/me")
      return loggedIn
        ? json(route, { data: session })
        : json(route, { error: { message: "未登录", code: "UNAUTHORIZED" } }, 401);
    if (path === "/auth/login" && request.method() === "POST") {
      loggedIn = true;
      return json(route, { data: session });
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
      return json(route, { data: { changed: true } });
    }
    if (path === "/dashboard") return json(route, { data: dashboard });
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
    if (path === "/approvals" && request.method() === "GET")
      return json(route, { data: [approval] });
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
    if (path === "/advisors") return json(route, { data: [] });
    if (path === "/advisor-runs") return json(route, { data: [] });
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
