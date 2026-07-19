import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";

const adminEmail = process.env.REAL_E2E_ADMIN_EMAIL ?? "e2e-admin@fiatlux.local";
const adminPassword = process.env.REAL_E2E_ADMIN_PASSWORD ?? "e2e-only-admin-password-2026";
const rotatedAdminPassword =
  process.env.REAL_E2E_ADMIN_ROTATED_PASSWORD ?? "e2e-only-rotated-admin-password-2026";

async function loginThroughRealApi(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录" })).toBeVisible();
  const attempt = async (password: string) => {
    await page.getByLabel("邮箱").fill(adminEmail);
    await page.getByLabel("密码", { exact: true }).fill(password);
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/login" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "进入工作区" }).click();
    return { response: await responsePromise, password };
  };

  let result = await attempt(adminPassword);
  if (result.response.status() === 401) {
    result = await attempt(rotatedAdminPassword);
  }
  expect(result.response.status()).toBe(200);
  const authPayload = (await result.response.json()) as {
    data: { mustChangePassword: boolean };
  };
  if (authPayload.data.mustChangePassword) {
    await page.waitForURL((url) => url.pathname === "/settings");
    await expect(page.getByRole("heading", { name: "首次登录安全设置" })).toBeVisible();
    await page.getByLabel("当前密码").fill(result.password);
    await page.getByLabel("新密码", { exact: true }).fill(rotatedAdminPassword);
    await page.getByLabel("确认新密码").fill(rotatedAdminPassword);
    const changeResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/change-password" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "更新密码" }).click();
    expect((await changeResponse).status()).toBe(200);
  }
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator(".page-header").getByText("经营工作台", { exact: true })).toBeVisible();
}

async function openCreateDialog(page: Page, linkName: string, heading: string, dialogName: string) {
  await page.getByRole("link", { name: linkName, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await page.getByRole("button", { name: dialogName }).first().click();
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saveResource(dialog: Locator, expectedText: string, page: Page) {
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(expectedText, { exact: true }).first()).toBeVisible();
}

test("@desktop-core 真实栈完成经营闭环、文件往返、审批停点、顾问任务与审计", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const goalTitle = `电竞教育在线目标-${suffix}`;
  const projectName = `电竞教育试点项目-${suffix}`;
  const taskTitle = `完成课程报名闭环-${suffix}`;
  const decisionTitle = `确认试点课程范围-${suffix}`;
  const fileName = `试点验收证据-${suffix}.txt`;
  const fileBytes = Buffer.from(`FIAT LUX real-stack MinIO evidence ${suffix}\n`, "utf8");
  const approvalReason = `真实栈人工审批边界-${suffix}`;
  const expenseDescription = `电竞教育试点场地首款-${suffix}`;
  const submissionReference = `manual-submit-${suffix}`;
  const receiptReference = `manual-receipt-${suffix}`;
  const advisorQuestion = `复盘电竞教育试点闭环 ${suffix}`;

  await loginThroughRealApi(page);

  const goalDialog = await openCreateDialog(page, "目标", "目标", "新建目标");
  await goalDialog.locator("#resource-field-title").fill(goalTitle);
  await goalDialog.getByLabel("状态").selectOption("active");
  await goalDialog.getByLabel("进度（%）").fill("20");
  await goalDialog.getByLabel("说明").fill("筹备可维护的电竞教育在线业务闭环");
  await saveResource(goalDialog, goalTitle, page);

  const projectDialog = await openCreateDialog(page, "项目", "项目", "新建项目");
  await projectDialog.getByLabel("项目名称").fill(projectName);
  await projectDialog.getByLabel("状态").selectOption("active");
  await projectDialog.getByLabel("关联目标").selectOption({ label: goalTitle });
  await projectDialog.getByLabel("说明").fill("以小团队可运营方式验证课程交付与报名流程");
  await saveResource(projectDialog, projectName, page);

  const taskDialog = await openCreateDialog(page, "任务", "任务", "新建任务");
  await taskDialog.locator("#resource-field-title").fill(taskTitle);
  await taskDialog.getByLabel("状态").selectOption("in_progress");
  await taskDialog.getByLabel("优先级").selectOption("high");
  await taskDialog.getByLabel("关联项目").selectOption({ label: projectName });
  await taskDialog.getByLabel("说明").fill("从真实前端写入 Fastify 与 PostgreSQL");
  await saveResource(taskDialog, taskTitle, page);

  const decisionDialog = await openCreateDialog(page, "决策", "决策", "新建决策");
  await decisionDialog.getByLabel("议题").fill(decisionTitle);
  await decisionDialog.getByLabel("状态").selectOption("approved");
  await decisionDialog.getByLabel("关联目标").selectOption({ label: goalTitle });
  await decisionDialog.getByLabel("关联项目").selectOption({ label: projectName });
  await decisionDialog.getByLabel("关联任务").selectOption({ label: taskTitle });
  await decisionDialog.getByLabel("背景与选项").fill("基于试点目标、项目与任务的真实关系作出决策");
  await decisionDialog.getByLabel("决策结论").fill("先交付最小课程单元并保留人工质量复核");
  await decisionDialog.getByLabel("决策时间").fill("2026-07-18T12:00");
  await saveResource(decisionDialog, decisionTitle, page);

  const decisionRow = page.getByRole("row").filter({ hasText: decisionTitle });
  await decisionRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const persistedDecision = page.getByRole("dialog", { name: "编辑决策" });
  await expect(persistedDecision.getByLabel("关联目标").locator("option:checked")).toHaveText(
    goalTitle,
  );
  await expect(persistedDecision.getByLabel("关联项目").locator("option:checked")).toHaveText(
    projectName,
  );
  await expect(persistedDecision.getByLabel("关联任务").locator("option:checked")).toHaveText(
    taskTitle,
  );
  await persistedDecision.getByRole("button", { name: "关闭" }).click();

  const fileDialog = await openCreateDialog(page, "文件", "文件", "新建文件");
  await fileDialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: fileBytes,
  });
  await expect(fileDialog.getByLabel("文件名称")).toHaveValue(fileName);
  await fileDialog.getByLabel("信息分类").selectOption("confidential");
  await saveResource(fileDialog, fileName, page);

  const fileRow = page.getByRole("row").filter({ hasText: fileName });
  await expect(fileRow).toContainText("uploaded");
  await fileRow.getByRole("button", { name: "更多操作" }).click();
  const downloadStarted = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载", exact: true }).click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe(fileName);
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  expect(await readFile(downloadedPath as string)).toEqual(fileBytes);

  const expenseDialog = await openCreateDialog(page, "收支", "收支", "新建收支记录");
  await expenseDialog.getByLabel("摘要").fill(expenseDescription);
  await expenseDialog.getByLabel("类型").selectOption("expense");
  await expenseDialog.getByLabel("金额（元）").fill("5000");
  await expenseDialog.getByLabel("状态").selectOption("draft");
  await expenseDialog.getByLabel("业务时间").fill("2026-07-19T12:00");
  await expenseDialog.getByLabel("科目").fill("电竞教育试点场地费");
  await saveResource(expenseDialog, expenseDescription, page);

  await page.getByRole("link", { name: "审批中心", exact: true }).click();
  await page.getByRole("tab", { name: "外部执行" }).click();
  await page.getByRole("button", { name: "发起关键动作" }).click();
  const actionDialog = page.getByRole("dialog", { name: "发起关键动作" });
  await actionDialog.getByLabel("执行边界").selectOption("manual");
  const expenseOptionValue = await actionDialog
    .getByLabel("选择待付款费用")
    .locator("option")
    .filter({ hasText: expenseDescription })
    .getAttribute("value");
  expect(expenseOptionValue).toBeTruthy();
  await actionDialog.getByLabel("选择待付款费用").selectOption(expenseOptionValue as string);
  await actionDialog.getByLabel("收款方").fill(`广州电竞教育场馆-${suffix}`);
  await expect(actionDialog.getByLabel("金额（元）")).toHaveValue("5000");
  await actionDialog.getByLabel("动作说明").fill("电竞教育试点场地首款");
  await actionDialog.getByLabel("申请理由").fill(approvalReason);
  const actionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/external-actions" &&
      response.request().method() === "POST",
  );
  await actionDialog.getByRole("button", { name: "提交审批" }).click();
  const actionPayload = (await (await actionResponse).json()) as {
    data: { id: string; status: string; adapter: string; approvalId?: string };
  };
  expect(actionPayload.data).toMatchObject({ status: "pending_approval", adapter: "manual" });
  expect(actionPayload.data.approvalId).toBeTruthy();
  const actionCard = page.locator("article.approval-item").filter({ hasText: approvalReason });
  await expect(actionCard).toContainText("待审批");
  await expect(actionCard).toContainText("适配器 manual");
  await expect(actionCard.getByRole("button", { name: "登记进展" })).toHaveCount(0);

  await page.getByRole("tab", { name: "待我审批" }).click();
  const pendingApproval = page.locator("article.approval-item").filter({ hasText: approvalReason });
  await expect(pendingApproval).toContainText("关键");
  await pendingApproval.getByRole("button", { name: "详情", exact: true }).click();
  const approvalDetails = page.getByRole("dialog", { name: "审批详情" });
  await expect(approvalDetails).toContainText(
    "批准后仍需人工执行并上传外部回执，系统不会自动标记成功。",
  );
  await expect(approvalDetails.getByText("外部执行状态", { exact: true })).toBeVisible();
  await expect(approvalDetails.getByText("待审批", { exact: true })).toBeVisible();
  await expect(approvalDetails.getByText("执行适配器", { exact: true })).toBeVisible();
  await expect(approvalDetails.getByText("manual", { exact: true })).toBeVisible();
  await expect(approvalDetails.getByText("未执行", { exact: true })).toHaveCount(0);
  await approvalDetails.getByRole("button", { name: "关闭" }).click();
  await pendingApproval.getByRole("button", { name: "批准" }).click();
  const approveDialog = page.getByRole("dialog", { name: "批准事项" });
  await expect(approveDialog).toContainText("不会替代外部实际操作");
  await approveDialog.getByLabel("审批意见").fill("已核对金额与收款信息，仅批准后续人工执行");
  await approveDialog.getByLabel("本人同时为申请人；我明确确认并承担自批责任").check();
  await approveDialog.getByRole("button", { name: "确认批准" }).click();
  await expect(page.getByText("已批准，等待执行凭证")).toBeVisible();
  await page.getByRole("tab", { name: "外部执行" }).click();
  const approvedAction = page.locator("article.approval-item").filter({ hasText: approvalReason });
  await expect(approvedAction).toContainText("已批准");
  await expect(approvedAction).toContainText("适配器 manual");
  await approvedAction.getByRole("button", { name: "详情", exact: true }).click();
  const approvedActionDetails = page.getByRole("dialog", { name: "关键动作详情" });
  await expect(approvedActionDetails).toContainText("已批准");
  await expect(approvedActionDetails.getByRole("heading", { name: "外部凭证" })).toHaveCount(0);
  await approvedActionDetails.getByRole("button", { name: "关闭" }).click();

  await approvedAction.getByRole("button", { name: "登记进展" }).click();
  const submittedDialog = page.getByRole("dialog", { name: "登记外部执行进展" });
  await expect(submittedDialog.getByLabel("目标状态")).toHaveValue("submitted");
  await submittedDialog.getByLabel("外部提交参考号").fill(submissionReference);
  await submittedDialog.getByLabel("执行记录").fill("已在人工银行渠道提交，等待可核验回执");
  await submittedDialog.getByRole("button", { name: "确认登记" }).click();
  await expect(page.getByText("执行进展已留痕")).toBeVisible();
  await expect(approvedAction.getByText("已提交", { exact: true })).toBeVisible();

  await approvedAction.getByRole("button", { name: "登记进展" }).click();
  const confirmedDialog = page.getByRole("dialog", { name: "登记外部执行进展" });
  await expect(confirmedDialog.getByLabel("目标状态")).toHaveValue("confirmed");
  await confirmedDialog.getByLabel("外部回执编号").fill(receiptReference);
  await confirmedDialog.getByLabel("执行记录").fill("人工核对外部回执与已批准金额一致");
  await confirmedDialog.getByRole("button", { name: "确认登记" }).click();
  await expect(page.getByText("外部结果已凭证确认")).toBeVisible();
  await expect(approvedAction.getByText("已确认", { exact: true })).toBeVisible();
  await expect(approvedAction.getByRole("button", { name: "登记进展" })).toHaveCount(0);

  await page.getByRole("tab", { name: "审批记录" }).click();
  const historicalApproval = page
    .locator("article.approval-item")
    .filter({ hasText: approvalReason });
  await historicalApproval.getByRole("button", { name: "详情", exact: true }).click();
  const historicalApprovalDetails = page.getByRole("dialog", { name: "审批详情" });
  await expect(historicalApprovalDetails.getByText("审批状态", { exact: true })).toBeVisible();
  await expect(historicalApprovalDetails.getByText("已批准", { exact: true })).toBeVisible();
  await expect(historicalApprovalDetails.getByText("外部执行状态", { exact: true })).toBeVisible();
  await expect(historicalApprovalDetails.getByText("已确认", { exact: true })).toBeVisible();
  await expect(historicalApprovalDetails.getByText("外部回执引用", { exact: true })).toBeVisible();
  await expect(
    historicalApprovalDetails.getByText(receiptReference, { exact: true }),
  ).toBeVisible();
  await historicalApprovalDetails.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("link", { name: "收支", exact: true }).click();
  const postedExpense = page.getByRole("row").filter({ hasText: expenseDescription });
  await expect(postedExpense).toContainText("已入账");
  await expect(postedExpense).toContainText(actionPayload.data.id);

  await page.getByRole("link", { name: "AI 顾问", exact: true }).click();
  const advisorCard = page.locator("article.advisor-card").filter({ hasText: "总经理顾问" });
  await advisorCard.getByRole("button", { name: "运行分析" }).click();
  const advisorDialog = page.getByRole("dialog", { name: "运行总经理顾问" });
  await advisorDialog.getByLabel("分析目标").fill(advisorQuestion);
  const advisorResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/advisor-runs" &&
      response.request().method() === "POST",
  );
  await advisorDialog.getByRole("button", { name: "开始分析" }).click();
  expect((await advisorResponse).status()).toBe(201);
  const advisorRow = page.getByRole("row").filter({ hasText: advisorQuestion });
  await expect(advisorRow).toBeVisible();
  await expect(advisorRow.getByText("已完成", { exact: true })).toBeVisible({ timeout: 45_000 });
  await advisorRow.getByRole("button", { name: "查看", exact: true }).click();
  const advisorResult = page.getByRole("dialog", { name: "顾问分析结果" });
  await expect(advisorResult).toContainText("simulated-advisor-v1");
  await expect(advisorResult).toContainText(
    "This is a simulated advisor run; no real model analysis was performed.",
  );
  await expect(advisorResult.getByRole("heading", { name: "风险" })).toBeVisible();
  await expect(advisorResult.getByRole("heading", { name: "缺失信息" })).toBeVisible();
  await advisorResult.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("link", { name: "审计日志", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审计日志", exact: true })).toBeVisible();
  const workerAudit = page
    .getByRole("row")
    .filter({ hasText: "advisor-run" })
    .filter({ hasText: "complete" })
    .first();
  await expect(workerAudit).toContainText("worker:");
  await workerAudit.getByRole("button", { name: "查看详情" }).click();
  const auditDetails = page.getByRole("dialog", { name: "查看审计事件" });
  await expect(auditDetails).toContainText('"actorType": "system"');
  await expect(auditDetails).toContainText('"modelCallId"');
});

test("@mobile-core 真实移动端登录并通过 API 创建可审计任务", async ({ page }) => {
  const taskTitle = `移动端真实任务-${Date.now().toString(36)}`;
  await loginThroughRealApi(page);
  await page.getByRole("link", { name: "执行", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建任务" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建任务" });
  await dialog.locator("#resource-field-title").fill(taskTitle);
  await dialog.getByLabel("状态").selectOption("in_progress");
  await dialog.getByLabel("优先级").selectOption("high");
  await dialog
    .getByLabel("说明")
    .fill("真实移动端 Chromium 到 Fastify 与 PostgreSQL 的核心烟雾测试");
  await saveResource(dialog, taskTitle, page);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  await expect(page.getByRole("navigation", { name: "移动导航" })).toBeVisible();
});
