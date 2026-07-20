import { expect, test } from "@playwright/test";
import { installMockApi, login } from "./mock-api";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("登录、查看经营工作台并创建任务", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toBeVisible();
  await expect(page.getByText("可用现金")).toBeVisible();

  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "执行", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "任务", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
  await page.getByRole("button", { name: "新建任务" }).click();
  const dialog = page.getByRole("dialog", { name: "新建任务" });
  await dialog.getByRole("textbox", { name: "任务", exact: true }).fill("发布电竞教育试点报名表");
  await dialog.getByRole("combobox", { name: "状态" }).selectOption("in_progress");
  await dialog.getByRole("combobox", { name: "优先级" }).selectOption("high");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("发布电竞教育试点报名表")).toBeVisible();
});

test("电竞教育工作台呈现可审阅内容包、官网清理与人工上线门槛", async ({ page }) => {
  await login(page);
  await page.goto("/education");

  await expect(page.getByRole("heading", { name: "电竞教育" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "公开内容重建" })).toBeVisible();
  await expect(page.getByText("9 篇公开博文中 7 篇仍是模板占位文")).toBeVisible();
  await expect(page.getByText("竞技训练方法", { exact: true })).toBeVisible();
  await expect(page.getByText("健康与数字安全", { exact: true })).toBeVisible();
  await expect(page.getByText("官网、广告、销售话术、案例和合同表述一致且有证据")).toBeVisible();
  await expect(page.getByRole("heading", { name: "版本化内部内容库" })).toBeVisible();
  await expect(page.getByText("12 篇 · v1.0.0")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：如何设定 4 周竞技训练目标" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：一次有效回放复盘怎么做" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：团队语音沟通的最小协议" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "查看文章：人体工学与休息自查" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：从玩家到教练：技能与责任边界" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：电竞职业路径的概率、成本与备选方案" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看文章：游戏账号、设备与社群安全" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "查看文章：成人团队赛训试点复盘" })).toBeVisible();

  await page.getByRole("button", { name: "查看文章：人体工学与休息自查" }).click();
  const articleDialog = page.getByRole("dialog", { name: "人体工学与休息自查" });
  await expect(articleDialog.getByText(/不是医疗建议、诊断、治疗、康复/)).toBeVisible();
  await expect(
    articleDialog.getByText("中国公民健康素养——基本知识与技能（2024年版）"),
  ).toBeVisible();
  await expect(articleDialog.getByText(/不提供适用于所有人的固定休息分钟数/)).toBeVisible();
  await expect(articleDialog.getByRole("link", { name: "查看官方来源" })).toHaveAttribute(
    "href",
    "https://www.gov.cn/zhengce/zhengceku/202405/content_6954649.htm",
  );
  await articleDialog.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "查看文章：游戏账号、设备与社群安全" }).click();
  const securityArticleDialog = page.getByRole("dialog", {
    name: "游戏账号、设备与社群安全",
  });
  await expect(
    securityArticleDialog.getByRole("heading", { name: "账号、设备与社群安全基线" }),
  ).toBeVisible();
  await expect(securityArticleDialog.getByText("中华人民共和国网络安全法")).toBeVisible();
  await expect(securityArticleDialog.getByText(/不要共享密码、验证码、恢复码/)).toBeVisible();
  await expect(securityArticleDialog.getByText("WordPress 未发布").first()).toBeVisible();
  await securityArticleDialog.getByRole("button", { name: "关闭" }).click();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("租约失效运行必须经证据化人工补偿且不会自动重放", async ({ page }) => {
  await login(page);
  await page.goto("/operations");

  await expect(page.getByRole("heading", { name: "运行异常处置" })).toBeVisible();
  await expect(page.getByText("租约失效不等于安全重试")).toBeVisible();
  const incident = page.getByRole("article").filter({ hasText: "每周经营检查" });
  await expect(incident.getByText("待人工处置")).toBeVisible();
  await expect(incident.getByText("1 项")).toBeVisible();
  await expect(incident.getByText(/不要重放旧运行/)).toBeVisible();
  await incident.getByRole("button", { name: "调查并记录处置" }).click();

  const dialog = page.getByRole("dialog", { name: "调查并记录运行异常处置" });
  await expect(dialog.getByLabel("调查结论")).toHaveValue("manual_compensation_completed");
  await expect(dialog.getByLabel("调查结论").getByText("调查后未发现部分副作用")).toHaveCount(0);
  await dialog
    .getByLabel("调查与核对说明")
    .fill("已核对部分创建的任务并完成业务补偿，保留原失败运行作为审计证据。");
  await dialog
    .getByLabel("证据引用（每行一项）")
    .fill(["audit:8feee8b8-6c3a-4360-b535-aef2ec87bc6f", "task:compensation-20260720"].join("\n"));
  await dialog.getByLabel("补偿主记录引用").fill("task:compensation-20260720");
  await dialog
    .getByLabel("我已确认旧运行不会自动重放；如需重做，将创建一个具有明确原因的新运行。")
    .check();
  const resolutionRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname ===
        "/api/v1/operations/incidents/8feee8b8-6c3a-4360-b535-aef2ec87bc6f/resolve" &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "记录调查结论" }).click();
  expect((await resolutionRequest).postDataJSON()).toEqual({
    resolution: "manual_compensation_completed",
    reviewSummary: "已核对部分创建的任务并完成业务补偿，保留原失败运行作为审计证据。",
    evidenceReferences: [
      "audit:8feee8b8-6c3a-4360-b535-aef2ec87bc6f",
      "task:compensation-20260720",
    ],
    compensationReference: "task:compensation-20260720",
    acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
  });
  await expect(page.getByText("当前没有待人工处置的运行异常")).toBeVisible();

  await page.getByRole("tab", { name: "已记录处置" }).click();
  await expect(page.getByText("已完成并核对人工补偿")).toBeVisible();
  const compensation = page.locator(".incident-compensation-reference");
  await expect(compensation.getByText("补偿主记录")).toBeVisible();
  await expect(compensation.getByText("task:compensation-20260720")).toBeVisible();
  await expect(page.getByRole("button", { name: "调查并记录处置" })).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("高风险付款批准后仍显示等待外部执行", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "审批", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "审批中心" }).click();
  }
  await expect(page.getByText("支付赛事场地定金")).toBeVisible();
  await page.getByRole("button", { name: "批准" }).click();
  await page.getByLabel("审批意见").fill("已核对合同、金额和收款账户，批准人工支付");
  await page.getByLabel("本人同时为申请人；我明确确认并承担自批责任").check();
  await page.getByRole("button", { name: "确认批准" }).click();
  await expect(page.getByText("已批准，等待执行凭证")).toBeVisible();
});

test("发起关键银行付款并进入人工审批", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "审批", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "审批中心" }).click();
  }
  await page.getByRole("tab", { name: "外部执行" }).click();
  await page.getByRole("button", { name: "发起关键动作" }).click();
  const dialog = page.getByRole("dialog", { name: "发起关键动作" });
  await dialog.getByLabel("选择待付款费用").selectOption("financial-entry-draft-1");
  await dialog.getByLabel("收款方").fill("广州试点场馆");
  await expect(dialog.getByLabel("金额（元）")).toHaveValue("5000");
  await dialog.getByLabel("动作说明").fill("电竞教育试点场租首款");
  await dialog.getByLabel("申请理由").fill("合同与收款信息已由经办人复核");
  await dialog.getByRole("button", { name: "提交审批" }).click();
  await expect(page.getByText("关键动作已提交人工审批")).toBeVisible();
  await expect(page.getByText("广州试点场馆")).not.toBeVisible();
  await expect(page.getByText("银行付款").first()).toBeVisible();
});

test("合同终止只能从有效合同发起人工审批", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "审批", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "审批中心" }).click();
  }
  await page.getByRole("tab", { name: "外部执行" }).click();
  await page.getByRole("button", { name: "发起关键动作" }).click();
  const dialog = page.getByRole("dialog", { name: "发起关键动作" });
  await dialog.getByLabel("动作类型").selectOption("contract_terminate");
  await dialog.getByLabel("选择有效合同").selectOption("contract-active-1");
  await dialog.getByLabel("终止依据").fill("双方书面确认提前终止并完成后续义务清理");
  await dialog.getByLabel("申请理由").fill("合同终止属于对外法律承诺，需人工批准并留存凭证");
  await dialog.getByRole("button", { name: "提交审批" }).click();
  await expect(page.getByText("关键动作已提交人工审批")).toBeVisible();
  await expect(page.getByText("合同终止").first()).toBeVisible();
});

test("更换初始密码并撤销其他会话", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "更多" }).click();
  }
  await page.getByRole("link", { name: "集成与备份" }).click();
  await page.getByLabel("当前密码").fill("correct-horse-battery-staple");
  await page.getByLabel("新密码", { exact: true }).fill("replacement-password-2026");
  await page.getByLabel("确认新密码").fill("replacement-password-2026");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page.getByText("密码已更新，其他会话已撤销")).toBeVisible();
});

test("从工作流定义发起后台运行并查看状态", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "更多" }).click();
  }
  await page.getByRole("link", { name: "工作流", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作流", exact: true })).toBeVisible();
  await expect(page.getByText("每周经营检查")).toBeVisible();
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "运行", exact: true }).click();
  await expect(page.getByText("工作流已进入后台队列")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "工作流运行记录" }).getByText("排队中"),
  ).toBeVisible();
});

test("用可视化表单创建可运行的人工通知工作流", async ({ page }) => {
  await login(page);
  await page.goto("/resources/workflows");
  await page.getByRole("button", { name: "新建工作流" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建工作流" });
  await dialog.getByLabel("工作流名称").fill("电竞教育周报提醒");
  await dialog.getByLabel("通知接收人").selectOption("user-member");
  await dialog.getByLabel("通知主题").fill("请复核电竞教育周报");
  await dialog.getByLabel("通知内容").fill("请在周五前复核目标、项目与合规事项。");
  const createRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/workflow-definitions" &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "保存" }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({
    name: "电竞教育周报提醒",
    trigger: "manual",
    enabled: true,
    steps: [
      {
        type: "notify",
        config: {
          recipientId: "user-member",
          title: "请复核电竞教育周报",
          body: "请在周五前复核目标、项目与合规事项。",
          channel: "in_app",
          status: "queued",
        },
      },
    ],
  });
  await expect(page.getByText("电竞教育周报提醒", { exact: true })).toBeVisible();
});

test("成员停用在桌面和移动端保持人工审批边界", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "更多" }).click();
  }
  await page.getByRole("link", { name: "成员与权限" }).click();
  await expect(page.getByRole("heading", { name: "成员与权限" })).toBeVisible();
  await expect(page.getByText("试点运营成员")).toBeVisible();

  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("button", { name: "申请停用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请离职" })).toBeVisible();
  await page.getByRole("button", { name: "申请停用" }).click();

  const dialog = page.getByRole("dialog", { name: "申请停用成员" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/申请批准前.*仍保持有效/)).toBeVisible();
  await dialog.getByLabel("申请理由").fill("临时停用并完成职责与外部权限复核");
  await expect(dialog.getByRole("button", { name: "提交停用审批" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    const [bounds, viewport] = await Promise.all([dialog.boundingBox(), page.viewportSize()]);
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      (viewport?.height ?? 0) + 1,
    );
  }
  await dialog.getByRole("button", { name: "提交停用审批" }).click();

  await expect(page.getByText("停用申请已进入人工审批，成员状态尚未改变")).toBeVisible();
  await expect(page.getByText("待审批：停用")).toBeVisible();
  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("button", { name: "申请停用" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "申请离职" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "申请重新启用" })).toHaveCount(0);
});

test("成员角色变更显示当前角色并在人工批准前保持不变", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "更多" }).click();
  }
  await page.getByRole("link", { name: "成员与权限" }).click();
  const memberRow = page.getByRole("row").filter({ hasText: "试点运营成员" });
  await expect(memberRow).toContainText("成员");
  await memberRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "管理角色" }).click();
  const dialog = page.getByRole("dialog", { name: /管理角色：试点运营成员/ });
  await expect(dialog).toContainText("当前角色：成员");
  await dialog.getByLabel("角色").selectOption("role-admin");
  await dialog.getByLabel("申请理由").fill("为试点复核临时增加最小范围管理职责");
  const request = page.waitForRequest(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/v1/role-assignments" &&
      candidate.method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交审批" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    membershipId: "membership-member",
    roleId: "role-admin",
    mode: "assign",
    expectedVersion: 2,
  });
  await expect(page.getByText("角色变更已提交人工审批，当前权限尚未改变")).toBeVisible();
  await expect(memberRow).toContainText("成员");
  await expect(memberRow).not.toContainText("管理员");
});

test("AI 顾问只发送用户逐条选择的公司记录", async ({ page }) => {
  await login(page);
  await page.goto("/advisors");
  const card = page.locator("article.advisor-card").filter({ hasText: "总经理顾问" });
  await card.getByRole("button", { name: "运行分析" }).click();
  const dialog = page.getByRole("dialog", { name: "运行总经理顾问" });
  await expect(dialog.getByText("本次明确授权 0 条记录")).toBeVisible();
  await dialog.getByRole("checkbox", { name: /顾问上下文任务 #1/ }).check();
  await dialog.getByRole("checkbox", { name: /顾问上下文任务 #8/ }).check();
  await expect(dialog.getByText("本次明确授权 2 条记录")).toBeVisible();
  const advisorRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/advisor-runs" && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "开始分析" }).click();
  expect((await advisorRequest).postDataJSON()).toMatchObject({
    advisor: "general_manager",
    context: [
      { resourceType: "tasks", resourceId: "advisor-task-1" },
      { resourceType: "tasks", resourceId: "advisor-task-8" },
    ],
  });
});

test("PWA manifest 可用且不声明 API 运行时缓存", async ({ page, request }) => {
  await page.goto("/login");
  const manifestLink = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestLink).toBeTruthy();
  const manifest = await request.get(
    new URL(manifestLink ?? "/manifest.webmanifest", page.url()).toString(),
  );
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).name).toBe("FIAT LUX CHOICE");
});

test("已登录用户离线时隐藏工作区并在联网后重新验证", async ({ page, context }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByRole("heading", { name: "当前无网络连接" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toHaveCount(0);
  await expect(page.getByLabel("邮箱")).toHaveCount(0);
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "需要重新验证会话" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toBeVisible();
});

test("登录页离线时隐藏登录表单", async ({ page, context }) => {
  await page.goto("/login");
  await expect(page.getByLabel("邮箱")).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByRole("heading", { name: "当前无网络连接" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toHaveCount(0);
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);

  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "需要重新验证会话" })).toBeVisible();
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("邮箱")).toBeVisible();
});

test("会话网络错误不会被误判为未登录", async ({ page }) => {
  const sessionEndpoint = "**/api/v1/auth/me";
  await page.route(sessionEndpoint, (route) => route.abort("connectionfailed"));
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "暂时无法连接服务" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toHaveCount(0);
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);

  await page.unroute(sessionEndpoint);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByLabel("邮箱")).toBeVisible();
});

test("移动端无横向溢出且底部导航可用", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "仅移动端项目执行");
  await login(page);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.getByRole("navigation", { name: "移动导航" })).toBeVisible();
  await page.getByRole("link", { name: "更多" }).click();
  await expect(page.getByRole("heading", { name: "全部模块" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "文件", exact: true }).click();
  await expect(page.getByRole("heading", { name: "文件", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator(".page-header").getByRole("button", { name: "新建文件" }).click();
  await expect(page.getByRole("dialog", { name: "新建文件" })).toBeVisible();
});
