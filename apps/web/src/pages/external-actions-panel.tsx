import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDotDashed, FileSearch, Plus, Send, ShieldAlert } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { EmptyState, ErrorState, Modal, Spinner, StatusBadge, useToast } from "../components/ui";
import { ApiError, api, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatMoneyCents } from "../lib/format";
import type { BusinessRecord } from "../lib/types";

const actionKinds = [
  ["bank_payment", "银行付款"],
  ["tax_filing", "税务申报"],
  ["invoice_red", "发票红冲"],
  ["contract_sign", "合同正式签署"],
  ["contract_terminate", "合同终止"],
  ["hr_discipline", "人事处分"],
  ["permission_change", "关键权限变更"],
  ["external_legal_commitment", "对外法律承诺"],
] as const;

type ActionKind = (typeof actionKinds)[number][0];
type AdapterMode = "manual" | "mock";
type ActionStatus =
  | "pending_approval"
  | "approved"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "simulated";

interface ExternalAction {
  id: string;
  kind: ActionKind;
  adapter: AdapterMode | "real";
  status: ActionStatus;
  reason: string;
  payload: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  approvalId?: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const kindLabels = Object.fromEntries(actionKinds) as Record<ActionKind, string>;

function availableTargets(action: ExternalAction): ActionStatus[] {
  if (action.status === "approved") {
    return action.adapter === "mock" ? ["simulated", "cancelled"] : ["submitted", "cancelled"];
  }
  if (action.status === "submitted") return ["confirmed", "failed"];
  if (action.status === "failed") return ["submitted", "cancelled"];
  return [];
}

export function ExternalActionsPanel() {
  const auth = useAuth();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ExternalAction | null>(null);
  const [transitioning, setTransitioning] = useState<ExternalAction | null>(null);
  const actions = useQuery({
    queryKey: ["external-actions"],
    queryFn: async () =>
      (await api.get<ExternalAction[]>(`/external-actions${queryString({ pageSize: 50 })}`)).data,
    refetchInterval: (query) =>
      query.state.data?.some((action) => action.status === "pending_approval") ? 5000 : false,
  });
  const items = actions.data ?? [];

  return (
    <>
      <div className="external-action-toolbar">
        {auth.can("external-actions:create") ? (
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            发起关键动作
          </button>
        ) : null}
      </div>
      {actions.isLoading ? (
        <div className="resource-loading">
          <Spinner />
        </div>
      ) : actions.isError ? (
        <ErrorState
          message={actions.error instanceof ApiError ? actions.error.message : "无法读取执行记录"}
          onRetry={() => void actions.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="暂无关键动作记录" />
      ) : (
        <section className="approval-list" aria-label="关键动作执行记录">
          {items.map((action) => {
            const targets = availableTargets(action);
            return (
              <article key={action.id} className="approval-item">
                <div className="risk-flag risk-critical">
                  <ShieldAlert aria-hidden="true" />
                  <span>关键</span>
                </div>
                <div className="approval-main">
                  <div className="approval-title">
                    <span>{kindLabels[action.kind]}</span>
                    <StatusBadge status={action.status} />
                  </div>
                  <h2>{kindLabels[action.kind]}</h2>
                  <p>{action.reason}</p>
                  <div className="approval-meta">
                    <span>适配器 {action.adapter}</span>
                    <span>{formatDateTime(action.createdAt)}</span>
                    {action.approvalId ? <span>审批 {action.approvalId.slice(0, 8)}</span> : null}
                  </div>
                </div>
                <div className="approval-actions">
                  <button
                    type="button"
                    className="button secondary compact"
                    onClick={() => setSelected(action)}
                  >
                    <FileSearch aria-hidden="true" />
                    详情
                  </button>
                  {targets.length > 0 && auth.can("external-actions:update") ? (
                    <button
                      type="button"
                      className="button primary compact"
                      onClick={() => setTransitioning(action)}
                    >
                      <Send aria-hidden="true" />
                      登记进展
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="发起关键动作" size="large">
        <CreateActionForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
      </Modal>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="关键动作详情"
        size="large"
      >
        {selected ? <ActionDetails action={selected} /> : null}
      </Modal>
      <Modal
        open={Boolean(transitioning)}
        onClose={() => setTransitioning(null)}
        title="登记外部执行进展"
      >
        {transitioning ? (
          <TransitionForm
            action={transitioning}
            onDone={() => setTransitioning(null)}
            onCancel={() => setTransitioning(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

function ActionDetails({ action }: { action: ExternalAction }) {
  return (
    <div className="approval-details">
      <dl>
        <div>
          <dt>动作</dt>
          <dd>{kindLabels[action.kind]}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>
            <StatusBadge status={action.status} />
          </dd>
        </div>
        <div>
          <dt>适配器</dt>
          <dd>{action.adapter}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDateTime(action.updatedAt)}</dd>
        </div>
      </dl>
      <section>
        <h3>申请理由</h3>
        <p>{action.reason}</p>
      </section>
      <section>
        <h3>动作参数</h3>
        <pre className="record-json">{JSON.stringify(action.payload, null, 2)}</pre>
      </section>
      {action.evidence ? (
        <section>
          <h3>外部凭证</h3>
          <pre className="record-json">{JSON.stringify(action.evidence, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}

const referenceConfigs: Partial<
  Record<ActionKind, { endpoint: string; valueKey: string; label: string }>
> = {
  bank_payment: {
    endpoint: "/financial-entries?status=draft",
    valueKey: "id",
    label: "选择待付款费用",
  },
  invoice_red: { endpoint: "/invoices", valueKey: "id", label: "选择发票" },
  contract_sign: { endpoint: "/contracts", valueKey: "id", label: "选择合同" },
  contract_terminate: { endpoint: "/contracts", valueKey: "id", label: "选择有效合同" },
  hr_discipline: { endpoint: "/users", valueKey: "id", label: "选择成员" },
  permission_change: {
    endpoint: "/users",
    valueKey: "membershipId",
    label: "选择成员",
  },
};

function relatedLabel(record: BusinessRecord): string {
  const label = String(
    record.name ??
      record.title ??
      record.invoiceNumber ??
      record.counterparty ??
      record.displayName ??
      record.description ??
      record.id,
  );
  return amountCentsToYuan(record.amountCents)
    ? `${label} · ${formatMoneyCents(record.amountCents)}`
    : label;
}

export function amountCentsToYuan(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed / 100) : "";
}

function CreateActionForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<ActionKind>("bank_payment");
  const [adapter, setAdapter] = useState<AdapterMode>("manual");
  const [reference, setReference] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [detail, setDetail] = useState("");
  const [amountYuan, setAmountYuan] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => `ui-external-action-${crypto.randomUUID()}`);
  const referenceConfig = referenceConfigs[kind];
  const references = useQuery({
    queryKey: ["external-action-reference", referenceConfig?.endpoint],
    queryFn: async () =>
      (
        await api.get<BusinessRecord[]>(
          `${referenceConfig?.endpoint}${referenceConfig?.endpoint.includes("?") ? "&" : "?"}pageSize=100`,
        )
      ).data,
    enabled: Boolean(referenceConfig),
  });
  const toast = useToast();
  const queryClient = useQueryClient();
  const payload = useMemo(() => {
    if (kind === "bank_payment") {
      return {
        beneficiary: beneficiary.trim(),
        purpose: detail.trim(),
        amountCents: Math.round(Number(amountYuan) * 100),
        financialEntryId: reference,
      };
    }
    if (kind === "tax_filing") {
      return { filingPeriod: reference.trim(), taxType: detail.trim() };
    }
    if (kind === "invoice_red") return { invoiceId: reference, reason: detail.trim() };
    if (kind === "contract_sign") {
      return { contractId: reference, signingBasis: detail.trim() };
    }
    if (kind === "contract_terminate") {
      return { contractId: reference, terminationBasis: detail.trim() };
    }
    if (kind === "hr_discipline") {
      return { userId: reference, proposedMeasure: detail.trim() };
    }
    if (kind === "permission_change") {
      return { membershipId: reference, requestedChange: detail.trim() };
    }
    return { counterparty: reference.trim(), commitment: detail.trim() };
  }, [amountYuan, beneficiary, detail, kind, reference]);
  const mutation = useMutation({
    mutationFn: () =>
      api.post<ExternalAction>("/external-actions", {
        kind,
        adapter,
        payload,
        idempotencyKey,
        reason,
      }),
    onSuccess: async () => {
      toast.push("关键动作已提交人工审批", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["external-actions"] }),
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
      ]);
      onDone();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法发起关键动作", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form className="resource-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="external-action-kind">动作类型</label>
          <select
            id="external-action-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ActionKind);
              setReference("");
              setBeneficiary("");
              setDetail("");
              setAmountYuan("");
            }}
          >
            {actionKinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="external-action-adapter">执行边界</label>
          <select
            id="external-action-adapter"
            value={adapter}
            onChange={(event) => setAdapter(event.target.value as AdapterMode)}
          >
            <option value="manual">人工执行</option>
            <option value="mock">模拟演练</option>
          </select>
        </div>
        <div className="form-field full-width">
          <label htmlFor="external-action-reference">
            {referenceConfig?.label ??
              (kind === "tax_filing" ? "申报期间" : kind === "bank_payment" ? "收款方" : "相对方")}
          </label>
          {referenceConfig ? (
            <select
              id="external-action-reference"
              value={reference}
              onChange={(event) => {
                const nextReference = event.target.value;
                setReference(nextReference);
                if (kind === "bank_payment") {
                  const selected = references.data?.find(
                    (record) => String(record[referenceConfig.valueKey]) === nextReference,
                  );
                  setAmountYuan(amountCentsToYuan(selected?.amountCents));
                }
              }}
              required
            >
              <option value="">请选择</option>
              {(references.data ?? []).map((record) => {
                const value = String(record[referenceConfig.valueKey] ?? "");
                return value ? (
                  <option value={value} key={value}>
                    {relatedLabel(record)}
                  </option>
                ) : null;
              })}
            </select>
          ) : (
            <input
              id="external-action-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          )}
        </div>
        {kind === "bank_payment" ? (
          <div className="form-field">
            <label htmlFor="external-action-beneficiary">收款方</label>
            <input
              id="external-action-beneficiary"
              value={beneficiary}
              onChange={(event) => setBeneficiary(event.target.value)}
              required
            />
          </div>
        ) : null}
        {kind === "bank_payment" ? (
          <div className="form-field">
            <label htmlFor="external-action-amount">金额（元）</label>
            <input
              id="external-action-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amountYuan}
              onChange={(event) => setAmountYuan(event.target.value)}
              readOnly={Boolean(reference)}
              required
            />
          </div>
        ) : null}
        <div className={kind === "bank_payment" ? "form-field" : "form-field full-width"}>
          <label htmlFor="external-action-detail">
            {kind === "tax_filing"
              ? "税种"
              : kind === "hr_discipline"
                ? "拟采取措施"
                : kind === "contract_terminate"
                  ? "终止依据"
                  : kind === "permission_change"
                    ? "拟变更权限"
                    : "动作说明"}
          </label>
          <input
            id="external-action-detail"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            required
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="external-action-reason">申请理由</label>
          <textarea
            id="external-action-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={mutation.isPending || references.isLoading || references.isError}
        >
          {mutation.isPending ? "正在提交…" : "提交审批"}
        </button>
      </div>
    </form>
  );
}

const targetLabels: Record<ActionStatus, string> = {
  pending_approval: "待审批",
  approved: "已批准",
  submitted: "已向外部提交",
  confirmed: "外部已确认",
  failed: "执行失败",
  cancelled: "已取消",
  simulated: "模拟完成",
};

function TransitionForm({
  action,
  onDone,
  onCancel,
}: {
  action: ExternalAction;
  onDone: () => void;
  onCancel: () => void;
}) {
  const targets = availableTargets(action);
  const [targetStatus, setTargetStatus] = useState<ActionStatus>(targets[0] ?? "cancelled");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [note, setNote] = useState("");
  const needsEvidence = targetStatus === "submitted" || targetStatus === "confirmed";
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<ExternalAction>(`/external-actions/${action.id}/transition`, {
        targetStatus,
        ...(evidenceReference.trim()
          ? {
              evidence: {
                [targetStatus === "confirmed" ? "receiptReference" : "externalReference"]:
                  evidenceReference.trim(),
                recordedAt: new Date().toISOString(),
              },
            }
          : {}),
        note,
      }),
    onSuccess: async () => {
      toast.push(targetStatus === "confirmed" ? "外部结果已凭证确认" : "执行进展已留痕", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["external-actions"] }),
        queryClient.invalidateQueries({ queryKey: ["resource", "contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["resource", "invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["resource", "transactions"] }),
      ]);
      onDone();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法登记执行进展", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form className="resource-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="form-field full-width">
          <label htmlFor="external-action-target">目标状态</label>
          <select
            id="external-action-target"
            value={targetStatus}
            onChange={(event) => setTargetStatus(event.target.value as ActionStatus)}
          >
            {targets.map((target) => (
              <option value={target} key={target}>
                {targetLabels[target]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field full-width">
          <label htmlFor="external-action-evidence">
            {targetStatus === "confirmed" ? "外部回执编号" : "外部提交参考号"}
          </label>
          <input
            id="external-action-evidence"
            value={evidenceReference}
            onChange={(event) => setEvidenceReference(event.target.value)}
            required={needsEvidence}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="external-action-note">执行记录</label>
          <textarea
            id="external-action-note"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
          />
        </div>
      </div>
      <div className="advisor-boundary">
        <CircleDotDashed aria-hidden="true" />
        <p>此处只登记可核验的外部状态；“确认”必须附回执，模拟适配器只能产生模拟结果。</p>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="button primary" disabled={mutation.isPending}>
          {mutation.isPending ? "正在登记…" : "确认登记"}
        </button>
      </div>
    </form>
  );
}
