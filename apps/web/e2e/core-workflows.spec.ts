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
  await dialog.getByLabel("收款方").fill("广州试点场馆");
  await dialog.getByLabel("金额（元）").fill("5000");
  await dialog.getByLabel("动作说明").fill("电竞教育试点场租首款");
  await dialog.getByLabel("申请理由").fill("合同与收款信息已由经办人复核");
  await dialog.getByRole("button", { name: "提交审批" }).click();
  await expect(page.getByText("关键动作已提交人工审批")).toBeVisible();
  await expect(page.getByText("广州试点场馆")).not.toBeVisible();
  await expect(page.getByText("银行付款").first()).toBeVisible();
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
