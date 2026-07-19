import { expect, test } from "@playwright/test";
import { installMockApi, login } from "./mock-api";

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("审批历史区分批准状态与已确认的外部执行回执", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "审批", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "审批中心" }).click();
  }

  await page.getByRole("tab", { name: "审批记录" }).click();
  await expect(page.getByText("支付电竞教育试点场租尾款")).toBeVisible();
  await page.getByRole("button", { name: "详情" }).click();

  const dialog = page.getByRole("dialog", { name: "审批详情" });
  await expect(dialog.getByText("审批状态")).toBeVisible();
  await expect(dialog.getByText("已批准", { exact: true })).toBeVisible();
  await expect(dialog.getByText("外部执行状态")).toBeVisible();
  await expect(dialog.getByText("已确认")).toBeVisible();
  await expect(dialog.getByText("执行适配器")).toBeVisible();
  await expect(dialog.getByText("manual", { exact: true })).toBeVisible();
  await expect(dialog.getByText("外部回执引用")).toBeVisible();
  await expect(dialog.getByText("manual-receipt-training-20260717", { exact: true })).toBeVisible();
});
