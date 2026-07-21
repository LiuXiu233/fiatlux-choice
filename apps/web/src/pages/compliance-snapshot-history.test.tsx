import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { ComplianceSnapshotHistory } from "./resource-page";

describe("ComplianceSnapshotHistory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders change evidence and the raw-archive boundary", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: [
        {
          id: "00000000-0000-4000-8000-000000000101",
          sourceId: "00000000-0000-4000-8000-000000000001",
          requestedUrl: "https://www.gov.cn/policy",
          finalUrl: "https://www.gov.cn/policy-v2",
          httpStatus: 200,
          contentType: "text/html; charset=utf-8",
          sizeBytes: 256,
          rawHash: "3".repeat(64),
          normalizedHash: "4".repeat(64),
          previousContentHash: "2".repeat(64),
          normalizedExcerpt: "第二版发生变化的官方正文摘录",
          changed: true,
          notModified: false,
          fetcherVersion: "official-source-fetcher-v1",
          fetchedAt: "2026-07-18T00:00:00.000Z",
        },
      ],
      meta: { page: 1, pageSize: 10, total: 1, pageCount: 1 },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <ComplianceSnapshotHistory
          source={{
            id: "00000000-0000-4000-8000-000000000001",
            title: "测试官方来源",
            status: "uncertain",
          }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("内容已变化")).not.toBeNull();
    expect(screen.getByText("text/html; charset=utf-8")).not.toBeNull();
    expect(screen.getByText("256 字节")).not.toBeNull();
    expect(screen.getByText("4".repeat(64))).not.toBeNull();
    expect(screen.getByText("2".repeat(64))).not.toBeNull();
    expect(screen.getByText("第二版发生变化的官方正文摘录")).not.toBeNull();
    expect(screen.getByText(/不代表完整原始/)).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith(
      "/compliance-items/00000000-0000-4000-8000-000000000001/snapshots?page=1&pageSize=10",
    );
  });
});
