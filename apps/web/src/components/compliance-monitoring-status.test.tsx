import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ComplianceMonitoringStatus,
  ComplianceMonitoringStatusView,
} from "./compliance-monitoring-status";

const status: ComplianceMonitoringStatus = {
  generatedAt: "2026-07-20T02:31:00.000+08:00",
  sourceCount: 73,
  dueAvailableCount: 61,
  inFlightCount: 12,
  pendingFetchCount: 73,
  failedCount: 2,
  changedCount: 1,
  staleReviewCount: 3,
  overdueReviewCount: 1,
  oldestDueAt: "2026-07-19T02:30:00.000+08:00",
  nextFutureMonitorAt: "2026-07-21T02:30:00.000+08:00",
  latestDispatch: {
    occurredAt: "2026-07-20T02:30:00.000+08:00",
    batchLimit: 12,
    dueCount: 12,
    queuedCount: 12,
    hasMoreDue: true,
  },
};

afterEach(cleanup);

function metric(label: string) {
  const element = screen.getByText(label).closest<HTMLElement>(".compliance-monitoring-metric");
  if (!element) throw new Error(`Missing monitoring metric: ${label}`);
  return within(element);
}

describe("compliance monitoring status", () => {
  it("shows scoped workload and keeps machine state separate from legal review", () => {
    render(
      <ComplianceMonitoringStatusView status={status} refreshing={false} onRefresh={() => {}} />,
    );

    expect(screen.getByRole("heading", { name: "官方来源监控状态" })).not.toBeNull();
    expect(metric("来源总数").getByText("73")).not.toBeNull();
    expect(metric("待后台领取").getByText("61")).not.toBeNull();
    expect(metric("执行中").getByText("12")).not.toBeNull();
    expect(metric("最近检查失败").getByText("2")).not.toBeNull();
    expect(metric("复核关注").getByText("4")).not.toBeNull();
    expect(screen.getByText("仍有来源等待后台批次或处置")).not.toBeNull();
    expect(screen.getByText(/批次上限 12，当时仍有后续积压/)).not.toBeNull();
    expect(screen.getByText(/不表示法规有效、适用或已获专业批准/)).not.toBeNull();
  });

  it("explains missing dispatch history and exposes an explicit refresh", () => {
    const onRefresh = vi.fn();
    render(
      <ComplianceMonitoringStatusView
        status={{
          ...status,
          dueAvailableCount: 0,
          inFlightCount: 0,
          pendingFetchCount: 0,
          failedCount: 0,
          changedCount: 0,
          staleReviewCount: 0,
          overdueReviewCount: 0,
          oldestDueAt: null,
          latestDispatch: null,
        }}
        refreshing={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText("当前未发现待领取来源")).not.toBeNull();
    expect(screen.getByText(/尚无可解析的定时派发审计/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "刷新监控状态" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not present historical dispatch backlog as current backlog", () => {
    render(
      <ComplianceMonitoringStatusView
        status={{
          ...status,
          dueAvailableCount: 0,
          oldestDueAt: null,
        }}
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("当前未发现待领取来源")).not.toBeNull();
    expect(screen.getByText(/当时仍有后续积压/)).not.toBeNull();
  });
});
