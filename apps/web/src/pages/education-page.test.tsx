import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { EducationPage } from "./education-page";

describe("EducationPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns the public-site audit into a governed content and launch plan", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ data: [] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EducationPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "电竞教育" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "公开内容重建" })).not.toBeNull();
    expect(screen.getByText("9 篇公开博文中 7 篇仍是模板占位文")).not.toBeNull();
    expect(screen.getByText("竞技训练方法", { exact: true })).not.toBeNull();
    expect(screen.getByText("健康与数字安全", { exact: true })).not.toBeNull();
    expect(screen.getByText("官网、广告、销售话术、案例和合同表述一致且有证据")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "版本化内部内容库" })).not.toBeNull();
    expect(screen.getByText("12 篇 · v1.0.0")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "查看文章：如何设定 4 周竞技训练目标" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "查看文章：一次有效回放复盘怎么做" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "查看文章：团队语音沟通的最小协议" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "查看文章：人体工学与休息自查" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "查看文章：从玩家到教练：技能与责任边界" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "查看文章：电竞职业路径的概率、成本与备选方案" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "查看文章：游戏账号、设备与社群安全" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "查看文章：成人团队赛训试点复盘" })).not.toBeNull();
    expect(screen.getAllByText("WordPress 未发布").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: /建立内容任务/ }).getAttribute("href")).toBe(
      "/resources/tasks?create=1",
    );

    fireEvent.click(screen.getByRole("button", { name: "查看文章：如何设定 4 周竞技训练目标" }));
    let dialog = screen.getByRole("dialog", { name: "如何设定 4 周竞技训练目标" });
    expect(within(dialog).getByRole("heading", { name: "四周竞技训练目标卡" })).not.toBeNull();
    expect(within(dialog).getByText("中华人民共和国广告法")).not.toBeNull();
    expect(within(dialog).getByText(/站内任务完成视为外部发布成功/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "查看文章：人体工学与休息自查" }));
    dialog = screen.getByRole("dialog", { name: "人体工学与休息自查" });
    expect(within(dialog).getByText(/不是医疗建议、诊断、治疗、康复/)).not.toBeNull();
    expect(within(dialog).getByText("中国公民健康素养——基本知识与技能（2024年版）")).not.toBeNull();
    expect(within(dialog).getByText(/不设统一休息分钟数/)).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "查看文章：游戏账号、设备与社群安全" }));
    dialog = screen.getByRole("dialog", { name: "游戏账号、设备与社群安全" });
    expect(
      within(dialog).getByRole("heading", { name: "账号、设备与社群安全基线" }),
    ).not.toBeNull();
    expect(within(dialog).getByText("中华人民共和国网络安全法")).not.toBeNull();
    expect(within(dialog).getByText(/不要共享密码、验证码、恢复码/)).not.toBeNull();

    await vi.waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/products?pageSize=100&category=online_education");
      expect(api.get).toHaveBeenCalledWith(
        "/compliance-events?pageSize=100&search=%E6%95%99%E8%82%B2",
      );
    });
  });
});
