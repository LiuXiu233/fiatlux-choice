import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { Spinner } from "./ui";

export interface ComplianceMonitoringStatus {
  generatedAt: string;
  sourceCount: number;
  dueAvailableCount: number;
  inFlightCount: number;
  pendingFetchCount: number;
  failedCount: number;
  changedCount: number;
  staleReviewCount: number;
  overdueReviewCount: number;
  oldestDueAt: string | null;
  nextFutureMonitorAt: string | null;
  latestDispatch: {
    occurredAt: string;
    batchLimit: number;
    dueCount: number;
    queuedCount: number;
    hasMoreDue: boolean;
  } | null;
}

function metricTone(value: number, severity: "neutral" | "warning" | "danger") {
  return value > 0 ? severity : "neutral";
}

export function ComplianceMonitoringStatusView({
  status,
  refreshing,
  onRefresh,
}: {
  status: ComplianceMonitoringStatus;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const reviewAttentionCount = status.staleReviewCount + status.overdueReviewCount;
  const metrics = [
    {
      label: "来源总数",
      value: status.sourceCount,
      detail: "本组织未归档来源",
      tone: "neutral" as const,
    },
    {
      label: "待后台领取",
      value: status.dueAvailableCount,
      detail: status.oldestDueAt
        ? `最早到期 ${formatDateTime(status.oldestDueAt)}`
        : "当前无到期积压",
      tone: metricTone(status.dueAvailableCount, "warning"),
    },
    {
      label: "执行中",
      value: status.inFlightCount,
      detail: "仍处于有效租约",
      tone: "neutral" as const,
    },
    {
      label: "首次未抓取",
      value: status.pendingFetchCount,
      detail: "尚无正文哈希基线",
      tone: metricTone(status.pendingFetchCount, "warning"),
    },
    {
      label: "最近检查失败",
      value: status.failedCount,
      detail: "不等于官方文件失效",
      tone: metricTone(status.failedCount, "danger"),
    },
    {
      label: "复核关注",
      value: reviewAttentionCount,
      detail: `${status.staleReviewCount} 条 stale，${status.overdueReviewCount} 条已过人工复核日`,
      tone: metricTone(reviewAttentionCount, "danger"),
    },
  ];
  const latest = status.latestDispatch;
  const hasCurrentBacklog = status.dueAvailableCount > 0;

  return (
    <section className="compliance-monitoring-panel" aria-label="官方来源监控状态">
      <header>
        <div>
          <span className="compliance-monitoring-icon">
            <ShieldCheck aria-hidden="true" />
          </span>
          <div>
            <h2>官方来源监控状态</h2>
            <p>只汇总机器检查与人工复核工作量，不表示法规有效、适用或已获专业批准。</p>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="刷新监控状态"
          title="刷新监控状态"
        >
          <RefreshCw aria-hidden="true" className={refreshing ? "spin" : undefined} />
        </button>
      </header>

      <div className="compliance-monitoring-grid">
        {metrics.map((metric) => (
          <div
            className={`compliance-monitoring-metric monitoring-tone-${metric.tone}`}
            key={metric.label}
          >
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>

      <footer className={hasCurrentBacklog ? "monitoring-backlog" : "monitoring-current"}>
        {hasCurrentBacklog ? (
          <AlertTriangle aria-hidden="true" />
        ) : (
          <ShieldCheck aria-hidden="true" />
        )}
        <div aria-live="polite">
          <strong>
            {hasCurrentBacklog ? "仍有来源等待后台批次或处置" : "当前未发现待领取来源"}
          </strong>
          {latest ? (
            <p>
              上次定时派发 {formatDateTime(latest.occurredAt)}：选中 {latest.dueCount} 条，成功排队{" "}
              {latest.queuedCount} 条，批次上限 {latest.batchLimit}
              {latest.hasMoreDue ? "，当时仍有后续积压。" : "，当时没有更多可领取积压。"}
            </p>
          ) : (
            <p>尚无可解析的定时派发审计；首次每日扫描完成后才会显示批次记录。</p>
          )}
          <p>
            正文变化 {status.changedCount} 条；下一条未来计划检查：
            {status.nextFutureMonitorAt ? formatDateTime(status.nextFutureMonitorAt) : "暂无"}
            。状态生成于 {formatDateTime(status.generatedAt)}。
          </p>
        </div>
      </footer>
    </section>
  );
}

export function ComplianceMonitoringStatusPanel() {
  const query = useQuery({
    queryKey: ["compliance-monitoring-status"],
    queryFn: async () =>
      (await api.get<ComplianceMonitoringStatus>("/compliance-items/monitoring-status")).data,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <section
        className="compliance-monitoring-panel monitoring-loading"
        aria-label="官方来源监控状态"
      >
        <Spinner label="正在汇总监控状态" />
      </section>
    );
  }
  if (query.isError || !query.data) {
    return (
      <section
        className="compliance-monitoring-panel monitoring-error"
        aria-label="官方来源监控状态"
      >
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>无法读取官方来源监控状态</strong>
          <p>{query.error instanceof ApiError ? query.error.message : "请稍后重试"}</p>
        </div>
        <button type="button" className="button secondary" onClick={() => void query.refetch()}>
          重试
        </button>
      </section>
    );
  }

  return (
    <ComplianceMonitoringStatusView
      status={query.data}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  );
}
