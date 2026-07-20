import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Modal, Spinner, useToast } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";

type OperationalIncidentType = "advisor-run" | "workflow-run" | "backup";
type OperationalIncidentStatus = "open" | "resolved";
type OperationalIncidentResolutionType =
  | "no_partial_effects_found"
  | "manual_compensation_completed";

interface OperationalIncidentResolution {
  auditEventId: string;
  resolution: OperationalIncidentResolutionType;
  reviewSummary: string;
  evidenceReferences: string[];
  compensationReference: string | null;
  resolvedAt: string;
  resolvedByUserId: string | null;
  resolvedByDisplayName: string | null;
}

export interface OperationalIncident {
  incidentId: string;
  sourceType: OperationalIncidentType;
  sourceId: string;
  detectedAt: string;
  title: string;
  currentStatus: string | null;
  currentVersion: number | null;
  sourceError: string | null;
  sourceExists: boolean;
  possiblePartialEffects: true;
  recordedPartialEffects: boolean;
  recordedPartialCount: number;
  status: OperationalIncidentStatus;
  resolution: OperationalIncidentResolution | null;
}

interface IncidentPageMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  status: OperationalIncidentStatus;
  type?: OperationalIncidentType;
}

export interface ResolutionInput {
  resolution: OperationalIncidentResolutionType;
  reviewSummary: string;
  evidenceReferences: string[];
  compensationReference?: string;
  acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED";
}

const typePresentation: Record<
  OperationalIncidentType,
  { label: string; destination: string; destinationLabel: string }
> = {
  "advisor-run": { label: "AI 顾问", destination: "/advisors", destinationLabel: "查看顾问运行" },
  "workflow-run": {
    label: "工作流",
    destination: "/resources/workflows",
    destinationLabel: "查看工作流记录",
  },
  backup: { label: "数据库备份", destination: "/settings", destinationLabel: "查看备份记录" },
};

const resolutionLabels: Record<OperationalIncidentResolutionType, string> = {
  no_partial_effects_found: "调查后未发现部分副作用",
  manual_compensation_completed: "已完成并核对人工补偿",
};

function shortId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function OperationalIncidentResolutionForm({
  incident,
  busy,
  onSubmit,
  onCancel,
}: {
  incident: OperationalIncident;
  busy: boolean;
  onSubmit: (input: ResolutionInput) => void;
  onCancel: () => void;
}) {
  const [resolution, setResolution] = useState<OperationalIncidentResolutionType>(
    incident.recordedPartialEffects ? "manual_compensation_completed" : "no_partial_effects_found",
  );
  const [reviewSummary, setReviewSummary] = useState("");
  const [evidence, setEvidence] = useState("");
  const [compensationReference, setCompensationReference] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const evidenceReferences = [...new Set(evidence.split("\n").map((item) => item.trim()))].filter(
      Boolean,
    );
    onSubmit({
      resolution,
      reviewSummary: reviewSummary.trim(),
      evidenceReferences,
      ...(compensationReference.trim()
        ? { compensationReference: compensationReference.trim() }
        : {}),
      acknowledgement: "NO_AUTOMATIC_REPLAY_ACKNOWLEDGED",
    });
  };

  return (
    <form className="resource-form incident-resolution-form" onSubmit={submit}>
      <p className="incident-resolution-boundary">
        这个动作只追加人工调查审计，不会修改失败运行、自动重放模型或工作流，也不会重新执行备份命令。
      </p>
      {incident.recordedPartialEffects ? (
        <p className="incident-recorded-warning" role="alert">
          系统已记录 {incident.recordedPartialCount || "至少一项"}{" "}
          个部分结果，不能选择“未发现部分副作用”。
        </p>
      ) : null}
      <div className="form-grid">
        <div className="form-field full-width">
          <label htmlFor="incident-resolution">调查结论</label>
          <select
            id="incident-resolution"
            value={resolution}
            onChange={(event) =>
              setResolution(event.target.value as OperationalIncidentResolutionType)
            }
          >
            {!incident.recordedPartialEffects ? (
              <option value="no_partial_effects_found">调查后未发现部分副作用</option>
            ) : null}
            <option value="manual_compensation_completed">已完成并核对人工补偿</option>
          </select>
        </div>
        <div className="form-field full-width">
          <label htmlFor="incident-review-summary">调查与核对说明</label>
          <textarea
            id="incident-review-summary"
            rows={5}
            minLength={20}
            maxLength={5_000}
            value={reviewSummary}
            onChange={(event) => setReviewSummary(event.target.value)}
            placeholder="说明检查了哪些运行、对象、日志或外部状态，以及结论依据。"
            required
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="incident-evidence">证据引用（每行一项）</label>
          <textarea
            id="incident-evidence"
            rows={4}
            maxLength={10_000}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            placeholder={`audit:${incident.incidentId}\nlog:worker-YYYYMMDD\n任务或归档引用`}
            required
          />
          <small>至少一项；可填写审计事件、日志、任务、归档或经批准外部凭证的稳定引用。</small>
        </div>
        {resolution === "manual_compensation_completed" ? (
          <div className="form-field full-width">
            <label htmlFor="incident-compensation-reference">补偿主记录引用</label>
            <input
              id="incident-compensation-reference"
              value={compensationReference}
              onChange={(event) => setCompensationReference(event.target.value)}
              maxLength={500}
              placeholder="例如任务 ID 或新备份运行 ID"
              required
            />
          </div>
        ) : null}
        <label className="incident-acknowledgement full-width">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            required
          />
          <span>我已确认旧运行不会自动重放；如需重做，将创建一个具有明确原因的新运行。</span>
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={busy || !acknowledged || reviewSummary.trim().length < 20 || !evidence.trim()}
        >
          {busy ? "正在记录…" : "记录调查结论"}
        </button>
      </div>
    </form>
  );
}

export function OperationalIncidentCard({
  incident,
  canResolve,
  onResolve,
}: {
  incident: OperationalIncident;
  canResolve: boolean;
  onResolve: (incident: OperationalIncident) => void;
}) {
  const presentation = typePresentation[incident.sourceType];
  return (
    <article className={`operational-incident-card incident-${incident.status}`}>
      <header>
        <div>
          {incident.status === "open" ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <CheckCircle2 aria-hidden="true" />
          )}
          <span>{presentation.label}</span>
        </div>
        <span className={`incident-status incident-status-${incident.status}`}>
          {incident.status === "open" ? "待人工处置" : "已记录处置"}
        </span>
      </header>
      <div className="operational-incident-body">
        <div className="operational-incident-heading">
          <div>
            <h2>{incident.title}</h2>
            <p>发现于 {formatDateTime(incident.detectedAt)}</p>
          </div>
          <span title={incident.incidentId}>事件 {shortId(incident.incidentId)}</span>
        </div>
        <dl className="operational-incident-facts">
          <div>
            <dt>失败记录</dt>
            <dd title={incident.sourceId}>{shortId(incident.sourceId)}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{incident.currentStatus ?? "记录缺失"}</dd>
          </div>
          <div>
            <dt>记录版本</dt>
            <dd>{incident.currentVersion ?? "—"}</dd>
          </div>
          <div>
            <dt>已记录部分结果</dt>
            <dd>
              {incident.recordedPartialEffects
                ? incident.recordedPartialCount > 0
                  ? `${incident.recordedPartialCount} 项`
                  : "有"
                : "未记录（仍须调查）"}
            </dd>
          </div>
        </dl>
        <p className="operational-incident-error">
          {incident.sourceError ?? "失败记录没有可显示的脱敏错误信息。"}
        </p>
        {incident.resolution ? (
          <section className="incident-resolution-record" aria-label="人工处置记录">
            <strong>{resolutionLabels[incident.resolution.resolution]}</strong>
            <p>{incident.resolution.reviewSummary}</p>
            <small>
              {formatDateTime(incident.resolution.resolvedAt)} ·{" "}
              {incident.resolution.resolvedByDisplayName ??
                incident.resolution.resolvedByUserId ??
                "未知复核人"}
            </small>
            <ul>
              {incident.resolution.evidenceReferences.map((reference) => (
                <li key={reference}>{reference}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="incident-no-replay-note">
            可能已有部分副作用。先核对审计、输出、目标对象、归档和外部状态；不要重放旧运行。
          </p>
        )}
      </div>
      <footer>
        <div>
          <Link to={presentation.destination} className="button secondary">
            {presentation.destinationLabel}
            <ExternalLink aria-hidden="true" />
          </Link>
          <Link to="/resources/audit-events" className="button secondary">
            查看审计日志
          </Link>
        </div>
        {incident.status === "open" && canResolve ? (
          <button type="button" className="button primary" onClick={() => onResolve(incident)}>
            调查并记录处置
          </button>
        ) : null}
      </footer>
    </article>
  );
}

export function OperationsPage() {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<OperationalIncidentStatus>("open");
  const [type, setType] = useState<OperationalIncidentType | "">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<OperationalIncident | null>(null);
  const params = new URLSearchParams({ status, page: String(page), pageSize: "20" });
  if (type) params.set("type", type);
  const incidents = useQuery({
    queryKey: ["operational-incidents", status, type, page],
    queryFn: () =>
      api.get<OperationalIncident[]>(`/operations/incidents?${params.toString()}`) as Promise<{
        data: OperationalIncident[];
        meta: IncidentPageMeta;
      }>,
  });
  const resolveMutation = useMutation({
    mutationFn: ({ incidentId, input }: { incidentId: string; input: ResolutionInput }) =>
      api.post(`/operations/incidents/${incidentId}/resolve`, input),
    onSuccess: async () => {
      setSelected(null);
      toast.push("人工调查结论已追加到审计日志；原失败运行保持不变", "success");
      await queryClient.invalidateQueries({ queryKey: ["operational-incidents"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法记录运行异常处置", "error"),
  });
  const items = incidents.data?.data ?? [];
  const meta = incidents.data?.meta;
  const canResolve = auth.can("operations-incidents:update");

  const changeStatus = (next: OperationalIncidentStatus) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="运行异常处置"
        description="调查可能已有部分副作用的顾问、工作流和备份租约失效"
        icon={ShieldAlert}
        actions={
          <button
            type="button"
            className="icon-button"
            onClick={() => void incidents.refetch()}
            disabled={incidents.isFetching}
            aria-label="刷新运行异常"
            title="刷新运行异常"
          >
            <RefreshCw aria-hidden="true" className={incidents.isFetching ? "spin" : undefined} />
          </button>
        }
      />
      <section className="operations-boundary" aria-label="处置边界">
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>租约失效不等于安全重试</strong>
          <p>
            本页只记录人工调查与补偿证据，不会把失败改成成功，也不会调用模型、执行工作流或运行备份命令。
          </p>
        </div>
      </section>
      <section className="operations-toolbar" aria-label="运行异常筛选">
        <div className="operations-tabs" role="tablist" aria-label="处置状态">
          <button
            type="button"
            role="tab"
            aria-selected={status === "open"}
            onClick={() => changeStatus("open")}
          >
            待人工处置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={status === "resolved"}
            onClick={() => changeStatus("resolved")}
          >
            已记录处置
          </button>
        </div>
        <label>
          <span>运行类型</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as OperationalIncidentType | "");
              setPage(1);
            }}
          >
            <option value="">全部</option>
            <option value="advisor-run">AI 顾问</option>
            <option value="workflow-run">工作流</option>
            <option value="backup">数据库备份</option>
          </select>
        </label>
        <span className="operations-total" aria-live="polite">
          {meta ? `${meta.total} 条` : "正在统计"}
        </span>
      </section>
      {incidents.isLoading ? (
        <div className="resource-loading">
          <Spinner label="正在读取运行异常" />
        </div>
      ) : incidents.isError ? (
        <ErrorState
          message={
            incidents.error instanceof ApiError ? incidents.error.message : "无法读取运行异常"
          }
          onRetry={() => void incidents.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={status === "open" ? "当前没有待人工处置的运行异常" : "暂无已记录处置"}
          detail={
            status === "open"
              ? "这里只汇总 lease_expired；一般失败仍在各运行记录和审计日志中查看。"
              : "处置完成后会保留原失败状态和追加式人工审计。"
          }
        />
      ) : (
        <div className="operational-incident-list">
          {items.map((incident) => (
            <OperationalIncidentCard
              key={incident.incidentId}
              incident={incident}
              canResolve={canResolve}
              onResolve={setSelected}
            />
          ))}
        </div>
      )}
      {(meta?.pageCount ?? 0) > 1 ? (
        <nav className="pagination" aria-label="运行异常分页">
          <button
            type="button"
            className="button secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span>
            第 {page} / {meta?.pageCount ?? 1} 页
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page >= (meta?.pageCount ?? 1)}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
      <Modal
        open={Boolean(selected)}
        title="调查并记录运行异常处置"
        onClose={() => {
          if (!resolveMutation.isPending) setSelected(null);
        }}
        size="medium"
      >
        {selected ? (
          <OperationalIncidentResolutionForm
            key={selected.incidentId}
            incident={selected}
            busy={resolveMutation.isPending}
            onCancel={() => setSelected(null)}
            onSubmit={(input) => resolveMutation.mutate({ incidentId: selected.incidentId, input })}
          />
        ) : null}
      </Modal>
    </>
  );
}
