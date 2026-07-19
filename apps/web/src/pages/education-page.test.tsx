import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: /建立内容任务/ }).getAttribute("href")).toBe(
      "/resources/tasks?create=1",
    );

    await vi.waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/products?pageSize=100&category=online_education");
      expect(api.get).toHaveBeenCalledWith(
        "/compliance-events?pageSize=100&search=%E6%95%99%E8%82%B2",
      );
    });
  });
});
