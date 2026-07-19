import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CircleAlert,
  FileCheck2,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Spinner, StatusBadge } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  formatConfidence,
  formatDate,
  formatDateTime,
  formatMoney,
  recordLabel,
} from "../lib/format";
import type { BusinessRecord, DashboardData } from "../lib/types";

interface ApiDashboardData {
  summary: {
    activeObjectives: number | null;
    openTasks: number | null;
    overdueObligations: number | null;
    openRisks: number | null;
    pendingApprovals: number | null;
    activeContracts: number | null;
  };
  cashFlow: { inCents: number; outCents: number; netCents: number; currency: string } | null;
  urgentTasks: BusinessRecord[];
  upcomingObligations: BusinessRecord[];
  generatedAt: string;
}

function normalizeDashboard(data: DashboardData | ApiDashboardData): DashboardData {
  if ("metrics" in data) return data;
  const metrics: DashboardData["metrics"] = [];
  const addMetric = (
    value: number | null,
    metric: Omit<DashboardData["metrics"][number], "value">,
  ) => {
    if (value !== null) metrics.push({ ...metric, value });
  };
  addMetric(data.summary.activeObjectives, {
    key: "active_objectives",
    label: "进行中目标",
    tone: "neutral",
  });
  addMetric(data.summary.openTasks, {
    key: "open_tasks",
    label: "未完成任务",
    tone: "neutral",
  });
  addMetric(data.summary.pendingApprovals, {
    key: "pending_approvals",
    label: "待审批",
    tone: data.summary.pendingApprovals ? "warning" : "positive",
  });
  addMetric(data.summary.overdueObligations, {
    key: "overdue_obligations",
    label: "逾期义务",
    tone: data.summary.overdueObligations ? "danger" : "positive",
  });
  addMetric(data.summary.openRisks, {
    key: "open_risks",
    label: "开放风险",
    tone: data.summary.openRisks ? "warning" : "positive",
  });
  addMetric(data.summary.activeContracts, {
    key: "active_contracts",
    label: "履行中合同",
    tone: "neutral",
  });
  if (data.cashFlow) {
    metrics.push(
      {
        key: "cash_in",
        label: "累计流入",
        value: formatMoney(data.cashFlow.inCents / 100),
        tone: "positive",
      },
      {
        key: "cash_out",
        label: "累计流出",
        value: formatMoney(data.cashFlow.outCents / 100),
        tone: "neutral",
      },
    );
  }
  return {
    metrics,
    priorities: data.urgentTasks.map((item) => ({
      ...item,
      ...(item.dueDate
        ? { dueDate: item.dueDate }
        : typeof item.dueAt === "string"
          ? { dueDate: item.dueAt }
          : {}),
    })),
    deadlines: data.upcomingObligations.map((item) => ({
      ...item,
      ...(item.dueDate
        ? { dueDate: item.dueDate }
        : typeof item.dueAt === "string"
          ? { dueDate: item.dueAt }
          : {}),
    })),
    cashflow: data.cashFlow
      ? [
          {
            label: "当前",
            inflow: data.cashFlow.inCents / 100,
            outflow: data.cashFlow.outCents / 100,
          },
        ]
      : [],
    riskSummary: [
      ...(data.summary.openRisks === null
        ? []
        : [
            {
              label: "开放风险",
              value: data.summary.openRisks,
              tone: data.summary.openRisks ? "warning" : "positive",
            },
          ]),
      ...(data.summary.overdueObligations === null
        ? []
        : [
            {
              label: "逾期义务",
              value: data.summary.overdueObligations,
              tone: data.summary.overdueObligations ? "danger" : "positive",
            },
          ]),
    ],
    advisorBriefs: [],
  };
}

export function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () =>
      normalizeDashboard((await api.get<DashboardData | ApiDashboardData>("/dashboard")).data),
    refetchInterval: 120_000,
  });

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date()),
    [],
  );

  if (dashboard.isLoading) {
    return (
      <div className="dashboard-loading">
        <Spinner label="正在汇总经营数据" />
      </div>
    );
  }
  if (dashboard.isError) {
    return (
      <ErrorState
        message={dashboard.error instanceof ApiError ? dashboard.error.message : "无法读取经营汇总"}
        onRetry={() => void dashboard.refetch()}
      />
    );
  }

  const data = dashboard.data;
  if (!data) {
    return <ErrorState message="经营汇总为空" onRetry={() => void dashboard.refetch()} />;
  }
  return (
    <>
      <PageHeader
        title={`${auth.user?.displayName ?? ""}，${today}`}
        description="经营工作台"
        actions={
          <div className="dashboard-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => void dashboard.refetch()}
              aria-label="刷新"
              title="刷新"
            >
              <RefreshCw aria-hidden="true" />
            </button>
            {auth.can("tasks:create") ? (
              <button
                type="button"
                className="button primary"
                onClick={() => navigate("/resources/tasks?create=1")}
              >
                <Plus aria-hidden="true" />
                新建任务
              </button>
            ) : null}
          </div>
        }
      />

      <section className="metric-grid" aria-label="经营指标">
        {data.metrics.map((metric) => (
          <article className={`metric-card metric-${metric.tone ?? "neutral"}`} key={metric.key}>
            <span>{metric.label}</span>
            <strong>
              {typeof metric.value === "number" && metric.key.toLowerCase().includes("cash")
                ? formatMoney(metric.value)
                : metric.value}
            </strong>
            {metric.delta ? <small>{metric.delta}</small> : null}
          </article>
        ))}
      </section>

      <div className="dashboard-grid primary-grid">
        <section className="dashboard-section priority-section">
          <header>
            <div>
              <CircleAlert aria-hidden="true" />
              <h2>今日重点</h2>
            </div>
            <Link to="/resources/tasks">
              全部任务
              <ArrowRight aria-hidden="true" />
            </Link>
          </header>
          {data.priorities.length ? (
            <div className="priority-list">
              {data.priorities.map((item) => (
                <Link to={`/resources/tasks?selected=${item.id}`} key={item.id}>
                  <span className={`priority-marker priority-${item.priority ?? "medium"}`} />
                  <div>
                    <strong>{recordLabel(item)}</strong>
                    <small>
                      {item.ownerName ?? item.assigneeName ?? "未分配"} ·{" "}
                      {formatDate(item.dueDate ?? item.deadline)}
                    </small>
                  </div>
                  <StatusBadge status={item.status} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="今日无待处理重点" />
          )}
        </section>

        <section className="dashboard-section deadline-section">
          <header>
            <div>
              <CalendarDays aria-hidden="true" />
              <h2>近期到期</h2>
            </div>
            <Link to="/resources/compliance-events">
              合规日历
              <ArrowRight aria-hidden="true" />
            </Link>
          </header>
          {data.deadlines.length ? (
            <ol className="deadline-list">
              {data.deadlines.map((item) => (
                <li key={item.id}>
                  <time>{formatDate(item.dueDate ?? item.deadline)}</time>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{recordLabel(item)}</strong>
                    <small>{item.category ?? "公司事项"}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="近期无到期事项" />
          )}
        </section>
      </div>

      <div className="dashboard-grid secondary-grid">
        {auth.can("cash-flow:read") ? (
          <section className="dashboard-section cashflow-section">
            <header>
              <div>
                <WalletCards aria-hidden="true" />
                <h2>现金流预测</h2>
              </div>
              <Link to="/resources/cashflow-forecasts">
                查看明细
                <ArrowRight aria-hidden="true" />
              </Link>
            </header>
            <CashflowBars values={data.cashflow} />
          </section>
        ) : null}

        <section className="dashboard-section risk-section">
          <header>
            <div>
              <FileCheck2 aria-hidden="true" />
              <h2>风险分布</h2>
            </div>
            <Link to="/resources/risks">
              风险台账
              <ArrowRight aria-hidden="true" />
            </Link>
          </header>
          <div className="risk-summary">
            {data.riskSummary.map((item) => (
              <div key={item.label}>
                <span className={`risk-dot risk-${item.tone}`} />
                <strong>{item.value}</strong>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="dashboard-section advisor-section">
        <header>
          <div>
            <Bot aria-hidden="true" />
            <h2>顾问简报</h2>
          </div>
          <Link to="/advisors">
            全部顾问
            <ArrowRight aria-hidden="true" />
          </Link>
        </header>
        {data.advisorBriefs.length ? (
          <div className="advisor-brief-list">
            {data.advisorBriefs.map((brief) => (
              <Link to="/advisors" key={`${brief.advisor}-${brief.createdAt}`}>
                <span className="advisor-avatar">{brief.advisor.slice(0, 1)}</span>
                <div>
                  <strong>{brief.title}</strong>
                  <small>
                    {brief.advisor} · {formatDateTime(brief.createdAt)}
                  </small>
                </div>
                <span className="confidence">置信度 {formatConfidence(brief.confidence)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无顾问简报" />
        )}
      </section>
    </>
  );
}

function CashflowBars({ values }: { values: DashboardData["cashflow"] }) {
  const max = Math.max(1, ...values.flatMap((value) => [value.inflow, value.outflow]));
  if (!values.length) return <EmptyState title="暂无现金流预测" />;
  return (
    <div className="cashflow-chart" role="img" aria-label="现金流入与流出预测">
      <div className="chart-legend">
        <span>
          <i className="legend-inflow" />
          流入
        </span>
        <span>
          <i className="legend-outflow" />
          流出
        </span>
      </div>
      <div className="chart-bars">
        {values.map((value) => (
          <div className="chart-period" key={value.label}>
            <div className="bar-pair">
              <span
                className="bar bar-inflow"
                style={{ height: `${Math.max(4, (value.inflow / max) * 100)}%` }}
                title={`流入 ${formatMoney(value.inflow)}`}
              />
              <span
                className="bar bar-outflow"
                style={{ height: `${Math.max(4, (value.outflow / max) * 100)}%` }}
                title={`流出 ${formatMoney(value.outflow)}`}
              />
            </div>
            <small>{value.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
