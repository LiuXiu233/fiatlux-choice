import { expect, test } from "@playwright/test";

import { installMockApi, login } from "./mock-api";

test("desktop and mobile professional review requires evidence and exposes immutable history", async ({
  page,
}) => {
  await installMockApi(page);
  await login(page);
  await page.goto("/resources/compliance-items");

  const sourceRow = page.getByRole("row").filter({ hasText: "中华人民共和国公司法" });
  await expect(sourceRow).toContainText("需更新");
  await sourceRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "登记专业复核" }).click();

  const dialog = page.getByRole("dialog", { name: /登记专业复核：中华人民共和国公司法/ });
  await expect(dialog.getByText(/不会批量把 73 条来源标记为已复核/)).toBeVisible();
  await dialog.getByLabel("专业结论").selectOption("applicable");
  await dialog.getByLabel("来源生命周期").selectOption("active");
  await dialog.getByLabel("复核人姓名").fill("张复核");
  await dialog.getByLabel("专业角色").fill("公司治理法律顾问");
  await dialog.getByLabel("所在机构 / 内部组织").fill("示例法律服务机构");
  await dialog.getByLabel("胜任依据").fill("基于公司治理与商事合规执业经验完成本次适用性复核");
  await dialog.getByLabel("已上传复核证据").selectOption("file-member-evidence-1");
  await dialog.getByLabel("对耀光的适用条件").fill("适用于当前公司治理、决策权限和会议记录维护。");
  await dialog.getByLabel("复核摘要").fill("已核对官方来源、施行状态和耀光当前治理事实。");
  await dialog.getByLabel("缺失信息").fill("暂无已知缺失信息；如公司章程变化需重新复核。");
  await dialog.getByLabel("下次专业复核日").fill("2026-10-20");
  await dialog
    .getByLabel("本次登记原因")
    .fill("登记可追溯专业意见，供义务、日历和法务顾问后续使用。");

  const [bounds, viewport] = await Promise.all([dialog.boundingBox(), page.viewportSize()]);
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);

  const request = page.waitForRequest(
    (candidate) =>
      new URL(candidate.url()).pathname ===
        "/api/v1/compliance-items/compliance-source-1/reviews" && candidate.method() === "POST",
  );
  await dialog.getByRole("button", { name: "登记专业复核" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    expectedVersion: 2,
    reviewOutcome: "applicable",
    resultingStatus: "active",
    reviewerName: "张复核",
    reviewerRole: "公司治理法律顾问",
    reviewerOrganization: "示例法律服务机构",
    missingInformation: "暂无已知缺失信息；如公司章程变化需重新复核。",
    evidenceFileId: "file-member-evidence-1",
    nextReviewAt: "2026-10-20",
  });
  await expect(page.getByText("专业复核已写入追加审计；来源状态已按结论更新")).toBeVisible();
  await expect(sourceRow).toContainText("已复核");

  await sourceRow.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("button", { name: "查看专业复核" }).click();
  const history = page.getByRole("dialog", { name: /专业复核记录：中华人民共和国公司法/ });
  await expect(history.getByText("适用于当前业务")).toBeVisible();
  await expect(history.getByText("张复核")).toBeVisible();
  await expect(history.getByText("公司治理法律顾问 · 示例法律服务机构")).toBeVisible();
  await expect(history.getByText("暂无已知缺失信息；如公司章程变化需重新复核。")).toBeVisible();
  await expect(history.getByText(/只证明谁在何时登记/)).toBeVisible();
  await expect(history.getByRole("link", { name: "下载复核证据" })).toHaveAttribute(
    "href",
    "/api/v1/files/file-member-evidence-1/download",
  );

  const bodyWidth = await page.locator("body").evaluate((body) => body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(page.viewportSize()?.width ?? bodyWidth);
});
