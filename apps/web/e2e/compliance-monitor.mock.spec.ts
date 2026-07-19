import { expect, test } from "@playwright/test";

import { installMockApi, login } from "./mock-api";

test("responsive compliance operations expose monitoring truth and source evidence", async ({
  page,
}) => {
  await installMockApi(page);
  await login(page);
  await page.goto("/resources/compliance-items");

  const monitoring = page.getByRole("region", { name: "官方来源监控状态" });
  await expect(monitoring.getByRole("heading", { name: "官方来源监控状态" })).toBeVisible();
  await expect(monitoring.getByText(/不表示法规有效、适用或已获专业批准/)).toBeVisible();
  await expect(monitoring.getByText("当前未发现待领取来源")).toBeVisible();
  await expect(monitoring.getByText(/选中 1 条，成功排队 1 条，批次上限 12/)).toBeVisible();
  const refreshResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/compliance-items/monitoring-status" &&
      response.request().method() === "GET",
  );
  await monitoring.getByRole("button", { name: "刷新监控状态" }).click();
  expect((await refreshResponse).status()).toBe(200);

  await expect(page.getByText("中华人民共和国公司法")).toBeVisible();
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "查看监控快照" }).click();

  await expect(page.getByRole("heading", { name: /来源快照/ })).toBeVisible();
  await expect(page.getByText("内容已变化")).toBeVisible();
  await expect(page.getByText("text/html; charset=utf-8")).toBeVisible();
  await expect(page.getByText("256 字节")).toBeVisible();
  await expect(page.getByText("4".repeat(64))).toBeVisible();
  await expect(page.getByText("2".repeat(64))).toBeVisible();
  await expect(page.getByText("第二版发生变化的官方正文摘录")).toBeVisible();
  await expect(page.getByText(/不代表完整原始 HTML\/PDF 已归档/)).toBeVisible();

  const [bodyWidth, viewport] = await Promise.all([
    page.locator("body").evaluate((body) => body.scrollWidth),
    page.viewportSize(),
  ]);
  expect(viewport).not.toBeNull();
  expect(bodyWidth).toBeLessThanOrEqual(viewport?.width ?? bodyWidth);
});
