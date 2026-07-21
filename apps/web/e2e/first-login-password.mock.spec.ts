import { expect, test } from "@playwright/test";
import { installMockApi } from "./mock-api";

test("首次登录只能改密并在完成后进入工作区", async ({ page }) => {
  await installMockApi(page, { mustChangePassword: true });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("owner@fiatlux.local");
  await page.getByLabel("密码", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "进入工作区" }).click();

  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { name: "首次登录安全设置" })).toBeVisible();
  await expect(page.getByText(/服务端已暂停其他操作/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "集成适配器" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "备份记录" })).toHaveCount(0);

  await page.goto("/");
  await page.waitForURL("**/settings");
  await page.getByLabel("当前密码").fill("correct-horse-battery-staple");
  await page.getByLabel("新密码", { exact: true }).fill("replacement-password-2026");
  await page.getByLabel("确认新密码").fill("replacement-password-2026");
  await page.getByRole("button", { name: "更新密码" }).click();

  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toBeVisible();
  await expect(page.getByText("密码已更新，其他会话已撤销")).toBeVisible();
});
