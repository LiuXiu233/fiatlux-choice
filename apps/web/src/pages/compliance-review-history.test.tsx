import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { ComplianceReviewHistory } from "./resource-page";

describe("ComplianceReviewHistory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders reviewer identity, locked source hashes, evidence, and audit boundary", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/auth/me") {
        return {
          data: {
            user: {
              id: "00000000-0000-4000-8000-000000000011",
              email: "owner@example.test",
              displayName: "经营负责人",
            },
            orgId: "00000000-0000-4000-8000-000000000012",
            permissions: ["*"],
            role: "owner",
            mustChangePassword: false,
          },
        } as never;
      }
      if (
        path === "/compliance-items/00000000-0000-4000-8000-000000000001/reviews?page=1&pageSize=10"
      ) {
        return {
          data: [
            {
              id: "00000000-0000-4000-8000-000000000101",
              sourceId: "00000000-0000-4000-8000-000000000001",
              recordedByUserId: "00000000-0000-4000-8000-000000000011",
              recordedByDisplayName: "经营负责人",
              recordedAt: "2026-07-20T02:00:00.000Z",
              reviewOutcome: "applicable",
              resultingStatus: "active",
              reviewerName: "张复核",
              reviewerRole: "公司治理法律顾问",
              reviewerOrganization: "示例法律服务机构",
              reviewerQualification: "基于公司治理与商事合规执业经验完成本次复核。",
              evidenceFileId: "00000000-0000-4000-8000-000000000201",
              applicability: "适用于当前公司治理、决策权限和会议记录维护。",
              summary: "已核对官方来源、施行状态和耀光当前治理事实。",
              missingInformation: "暂无已知缺失信息；章程变化后需要重新复核。",
              reason: "登记可追溯专业意见，供义务和法务顾问后续使用。",
              reviewedAt: "2026-07-20T02:00:00.000Z",
              nextReviewAt: "2027-01-20T00:00:00.000Z",
              reviewedSourceVersion: 3,
              reviewedContentHash: "a".repeat(64),
              reviewedMetadataHash: "b".repeat(64),
            },
          ],
          meta: { page: 1, pageSize: 10, total: 1, pageCount: 1 },
        } as never;
      }
      throw new Error(`Unexpected API path: ${path}`);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ComplianceReviewHistory
            source={{
              id: "00000000-0000-4000-8000-000000000001",
              title: "中华人民共和国公司法",
              status: "active",
            }}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("适用于当前业务")).not.toBeNull();
    expect(screen.getByText("张复核")).not.toBeNull();
    expect(screen.getByText("公司治理法律顾问 · 示例法律服务机构")).not.toBeNull();
    expect(screen.getByText(/商事合规执业经验/)).not.toBeNull();
    expect(screen.getByText(/章程变化后需要重新复核/)).not.toBeNull();
    expect(screen.getByText("v3")).not.toBeNull();
    expect(screen.getByText("a".repeat(64))).not.toBeNull();
    expect(screen.getByText(/只证明谁在何时登记/)).not.toBeNull();
    expect(screen.getByRole("link", { name: "下载复核证据" }).getAttribute("href")).toBe(
      "/api/v1/files/00000000-0000-4000-8000-000000000201/download",
    );
  });
});
