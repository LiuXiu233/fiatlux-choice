import { expect, test } from "@playwright/test";
import { installMockApi, login } from "./mock-api";

test.beforeEach(async ({ page }) => {
  await installMockApi(page, { membershipStatus: "inactive" });
});

test("已停用成员只能申请重新启用且旧会话不恢复", async ({ page }) => {
  await login(page);
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    await page.getByRole("link", { name: "更多" }).click();
  }
  await page.getByRole("link", { name: "成员与权限" }).click();
  await expect(page.getByText("试点运营成员")).toBeVisible();
  const memberRow = page.locator(".data-table tbody tr").filter({ hasText: "试点运营成员" });
  await expect(memberRow.getByText("已停用", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("button", { name: "申请重新启用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请停用" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "申请离职" })).toHaveCount(0);
  await page.getByRole("button", { name: "申请重新启用" }).click();

  const dialog = page.getByRole("dialog", { name: "申请重新启用成员" });
  await expect(dialog.getByText(/旧会话保持撤销.*必须重新登录/)).toBeVisible();
  await dialog.getByLabel("申请理由").fill("身份与职责已复核，恢复试点运营访问");
  const submit = dialog.getByRole("button", { name: "提交重新启用审批" });
  await expect(submit).toBeVisible();
  if ((page.viewportSize()?.width ?? 1024) <= 720) {
    const [bounds, viewport] = await Promise.all([dialog.boundingBox(), page.viewportSize()]);
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      (viewport?.height ?? 0) + 1,
    );
  }
  await submit.click();

  await expect(page.getByText("重新启用申请已进入人工审批，成员状态尚未改变")).toBeVisible();
  await expect(page.getByText("待审批：重新启用")).toBeVisible();
  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("button", { name: "申请重新启用" })).toHaveCount(0);
});
