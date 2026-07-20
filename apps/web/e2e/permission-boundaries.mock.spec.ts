import { expect, test } from "@playwright/test";
import { installMockApi, login } from "./mock-api";

test("member 可从文件菜单发起真实下载请求但看不到编辑和归档", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "桌面项目执行文件权限验收");
  await installMockApi(page, {
    role: "member",
    displayName: "文件成员",
    permissions: ["dashboard:read", "files:read", "files:create"],
  });
  await login(page);
  await page.waitForLoadState("networkidle");
  await page.goto("/resources/files");
  await page.waitForLoadState("networkidle");

  const fileRow = page.getByRole("row").filter({ hasText: "member-evidence.txt" });
  await expect(fileRow).toBeVisible();
  await fileRow.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("link", { name: "下载", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "归档", exact: true })).toHaveCount(0);

  const [downloadRequest, download] = await Promise.all([
    page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/v1/files/file-member-evidence-1/download" &&
        request.method() === "GET",
    ),
    page.waitForEvent("download"),
    page.getByRole("link", { name: "下载", exact: true }).click(),
  ]);
  expect(downloadRequest.method()).toBe("GET");
  expect(download.suggestedFilename()).toBe("member-evidence.txt");
});

test("viewer 移动导航与更多菜单隐藏未授权模块", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "仅移动端项目执行");
  await installMockApi(page, {
    role: "viewer",
    displayName: "只读观察者",
    permissions: [
      "dashboard:read",
      "objectives:read",
      "projects:read",
      "tasks:read",
      "advisors:read",
      "advisor-runs:read",
      "notifications:read",
    ],
  });
  await login(page);
  await page.waitForLoadState("networkidle");

  const navigation = page.getByRole("navigation", { name: "移动导航" });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveText(["总览", "执行", "顾问", "更多"]);
  await expect(navigation.getByRole("link", { name: "审批", exact: true })).toHaveCount(0);

  await navigation.getByRole("link", { name: "更多", exact: true }).click();
  await page.waitForLoadState("networkidle");
  const menu = page.locator(".mobile-menu-groups");
  await expect(menu.getByRole("link", { name: "任务", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "AI 顾问", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "审批中心", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "文件", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "运行异常处置", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "集成与备份", exact: true })).toHaveCount(0);
});

test("member 移动导航保留授权入口并隐藏系统管理入口", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "仅移动端项目执行");
  await installMockApi(page, {
    role: "member",
    displayName: "运营成员",
    permissions: [
      "dashboard:read",
      "tasks:read",
      "approvals:read",
      "advisors:read",
      "files:read",
      "workflow-definitions:read",
      "notifications:read",
    ],
  });
  await login(page);
  await page.waitForLoadState("networkidle");

  const navigation = page.getByRole("navigation", { name: "移动导航" });
  await expect(navigation.getByRole("link")).toHaveText(["总览", "执行", "审批", "顾问", "更多"]);
  await navigation.getByRole("link", { name: "更多", exact: true }).click();
  await page.waitForLoadState("networkidle");
  const menu = page.locator(".mobile-menu-groups");
  await expect(menu.getByRole("link", { name: "文件", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "工作流", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "成员与权限", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "审计日志", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "运行异常处置", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "集成与备份", exact: true })).toHaveCount(0);
});

test("义务与合规日历表单明确提交官方来源和已上传证据文件", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "桌面项目执行合规表单验收");
  await installMockApi(page);
  await login(page);
  await page.waitForLoadState("networkidle");

  await page.goto("/resources/obligations");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "新建义务" }).first().click();
  const obligationDialog = page.getByRole("dialog", { name: "新建义务" });
  await obligationDialog
    .getByRole("textbox", { name: "义务", exact: true })
    .fill("保存电竞教育培训履约档案");
  await obligationDialog.getByLabel("领域").selectOption("archive");
  await expect(obligationDialog.getByLabel("关联合规来源")).toBeEnabled();
  await obligationDialog.getByLabel("关联合规来源").selectOption({ label: "中华人民共和国公司法" });
  await obligationDialog.getByLabel("履行证据文件").selectOption({ label: "member-evidence.txt" });
  await expect(obligationDialog.getByLabel("重复规则（仅元数据）")).toBeVisible();
  await obligationDialog.getByLabel("重复规则（仅元数据）").fill("FREQ=YEARLY");
  const obligationRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/obligations" && request.method() === "POST",
  );
  await obligationDialog.getByRole("button", { name: "保存" }).click();
  expect((await obligationRequest).postDataJSON()).toMatchObject({
    title: "保存电竞教育培训履约档案",
    category: "archive",
    status: "open",
    sourceId: "compliance-source-1",
    evidenceFileId: "file-member-evidence-1",
    recurrenceRule: "FREQ=YEARLY",
  });

  await page.goto("/resources/compliance-events");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "新建合规事项" }).first().click();
  const eventDialog = page.getByRole("dialog", { name: "新建合规事项" });
  await eventDialog
    .getByRole("textbox", { name: "事项", exact: true })
    .fill("年度培训档案人工复核");
  await eventDialog.locator("#resource-field-status").selectOption("active");
  await eventDialog.getByLabel("领域").fill("档案管理");
  await eventDialog.getByLabel("事项类型").selectOption("review");
  await eventDialog.getByLabel("到期日期").fill("2026-12-31");
  await eventDialog.locator("#resource-field-reviewStatus").selectOption("pending");
  await eventDialog.getByLabel("关联合规来源").selectOption({ label: "中华人民共和国公司法" });
  await eventDialog.getByLabel("完成证据文件").selectOption({ label: "member-evidence.txt" });
  const eventRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/v1/compliance-events" &&
      request.method() === "POST",
  );
  await eventDialog.getByRole("button", { name: "保存" }).click();
  expect((await eventRequest).postDataJSON()).toMatchObject({
    title: "年度培训档案人工复核",
    status: "active",
    category: "档案管理",
    eventType: "review",
    dueDate: "2026-12-31",
    reviewStatus: "pending",
    sourceId: "compliance-source-1",
    evidenceFileId: "file-member-evidence-1",
  });
});

test("advisor context picker 在移动端按单列排列且不横向溢出", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "仅移动端项目执行");
  await installMockApi(page);
  await login(page);
  await page.goto("/advisors");
  await page.waitForLoadState("networkidle");

  const card = page.locator("article.advisor-card").filter({ hasText: "总经理顾问" });
  await card.getByRole("button", { name: "运行分析" }).click();
  const dialog = page.getByRole("dialog", { name: "运行总经理顾问" });
  await page.waitForLoadState("networkidle");
  const picker = dialog.locator(".advisor-context-picker");
  const scopes = picker.locator(".advisor-context-scope");
  await expect(scopes).toHaveCount(3);
  const columns = await picker.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/),
  );
  expect(columns).toHaveLength(1);
  const [first, second] = await Promise.all([
    scopes.nth(0).boundingBox(),
    scopes.nth(1).boundingBox(),
  ]);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0));
  expect(Math.abs((second?.x ?? 0) - (first?.x ?? 0))).toBeLessThan(1);
  const dimensions = await dialog.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
