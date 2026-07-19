import { expect, test } from "@playwright/test";

import { installMockApi, login } from "./mock-api";

test("mobile compliance source history exposes change evidence and archive boundary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockApi(page);
  await login(page);
  await page.goto("/resources/compliance-items");

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

  const bodyWidth = await page.locator("body").evaluate((body) => body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(390);
});
