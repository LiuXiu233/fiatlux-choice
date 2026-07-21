import { expect, test } from "@playwright/test";

import { installMockApi } from "./mock-api";

test("密码通过后必须完成 MFA 挑战才创建工作区会话", async ({ page }) => {
  await installMockApi(page, {
    mfaEnabled: true,
    mfaRequired: true,
    mfaChallengeOnLogin: true,
  });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("owner@fiatlux.local");
  await page.getByLabel("密码", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "进入工作区" }).click();

  await expect(page.getByRole("heading", { name: "安全验证" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("验证器代码或恢复码").fill("000000");
  await page.getByRole("button", { name: "验证并进入工作区" }).click();
  await expect(page.getByRole("alert")).toContainText("MFA verification code is invalid");

  await page.getByLabel("验证器代码或恢复码").fill("123456");
  await page.getByRole("button", { name: "验证并进入工作区" }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole("heading", { name: /经营负责人/ })).toBeVisible();
});

test("强制登记展示二维码并要求确认恢复码已离线保存", async ({ page }) => {
  await installMockApi(page, {
    mfaRequired: true,
    mustSetupMfa: true,
  });
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("owner@fiatlux.local");
  await page.getByLabel("密码", { exact: true }).fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "进入工作区" }).click();

  await page.waitForURL("**/settings");
  await expect(page.getByRole("heading", { name: "多因素认证安全设置" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "集成适配器" })).toHaveCount(0);
  await page.getByRole("button", { name: "开始登记" }).click();
  await expect(page.getByRole("img", { name: "验证器登记二维码" })).toBeVisible();
  await expect(page.getByText("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBeVisible();

  await page.getByLabel(/输入验证器当前显示的 6 位代码/).fill("123456");
  await page.getByRole("button", { name: "确认并启用" }).click();
  await expect(page.getByRole("heading", { name: "立即离线保存恢复码" })).toBeVisible();
  await expect(page.getByText("FLX-AAAA-BBBB-CCCC-AAAA")).toBeVisible();
  await expect(page.getByRole("button", { name: "完成并隐藏恢复码" })).toBeDisabled();

  await page.getByLabel(/我已将恢复码保存到独立/).check();
  await page.getByRole("button", { name: "完成并隐藏恢复码" }).click();
  await expect(page.getByRole("heading", { name: "集成适配器" })).toBeVisible();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
});
