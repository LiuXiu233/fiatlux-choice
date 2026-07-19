import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Clock3, ExternalLink, ShieldAlert, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Modal, Spinner, StatusBadge, useToast } from "../components/ui";
import { ApiError, api, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatMoney, recordLabel } from "../lib/format";
import type { ApprovalRequest } from "../lib/types";
import { ExternalActionsPanel } from "./external-actions-panel";

interface LinkedExternalAction {
  id: string;
  status: string;
  adapter: string;
  evidence: Record<string, unknown> | null;
  externalReference: string | null;
}

type ApprovalRecord = ApprovalRequest & {
  linkedExternalAction?: LinkedExternalAction | null;
};

const actionLabels: Record<string, string> = {
  bank_payment: "银行付款",
  tax_filing: "税务申报",
  invoice_reversal: "发票红冲",
  invoice_red: "发票红冲",
  contract_signature: "合同正式签署",
  contract_sign: "合同正式签署",
  contract_terminate: "合同终止",
  personnel_discipline: "人事处分",
  hr_discipline: "人事处分",
  critical_permission_change: "关键权限修改",
  permission_change: "关键权限修改",
  membership_deactivate: "停用组织成员",
  membership_offboard: "成员离职",
  membership_reactivate: "重新启用组织成员",
  external_legal_commitment: "对外法律承诺",
};

function isMembershipLifecycleApproval(approval: ApprovalRequest) {
  return (
    approval.operation === "membership_deactivate" ||
    approval.operation === "membership_offboard" ||
    approval.operation === "membership_reactivate"
  );
}

function isMembershipReactivation(approval: ApprovalRequest) {
  return approval.operation === "membership_reactivate";
}

export function ApprovalsPage() {
  const [view, setView] = useState<"pending" | "history" | "execution">("pending");
  const [selected, setSelected] = useState<ApprovalRecord | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const approvals = useQuery({
    queryKey: ["approvals", view],
    queryFn: async () => {
      const items = (
        await api.get<ApprovalRecord[]>(
          `/approvals${queryString({ pageSize: 50, ...(view === "pending" ? { status: "pending" } : {}) })}`,
        )
      ).data;
      return view === "history" ? items.filter((item) => item.status !== "pending") : items;
    },
    enabled: view !== "execution",
  });
  const approvalItems = approvals.data ?? [];

  return (
    <>
      <PageHeader
        title="审批中心"
        description="高风险动作必须由人工作出，并保留依据与执行凭证"
        icon={CheckCheck}
      />
      <div className="segmented-control" role="tablist" aria-label="审批视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === "pending"}
          onClick={() => setView("pending")}
        >
          <Clock3 aria-hidden="true" />
          待我审批
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "history"}
          onClick={() => setView("history")}
        >
          <CheckCheck aria-hidden="true" />
          审批记录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "execution"}
          onClick={() => setView("execution")}
        >
          <ExternalLink aria-hidden="true" />
          外部执行
        </button>
      </div>

      {view === "execution" ? (
        <ExternalActionsPanel />
      ) : approvals.isLoading ? (
        <div className="resource-loading">
          <Spinner />
        </div>
      ) : approvals.isError ? (
        <ErrorState
          message={approvals.error instanceof ApiError ? approvals.error.message : "无法读取审批"}
          onRetry={() => void approvals.refetch()}
        />
      ) : approvalItems.length === 0 ? (
        <EmptyState title={view === "pending" ? "没有待审批事项" : "暂无审批记录"} />
      ) : (
        <section
          className="approval-list"
          aria-label={view === "pending" ? "待审批事项" : "审批记录"}
        >
          {approvalItems.map((approval) => (
            <article key={approval.id} className="approval-item">
              <div className={`risk-flag risk-${approval.riskLevel}`}>
                <ShieldAlert aria-hidden="true" />
                <span>
                  {approval.riskLevel === "critical"
                    ? "关键"
                    : approval.riskLevel === "high"
                      ? "高"
                      : "一般"}
                </span>
              </div>
              <div className="approval-main">
                <div className="approval-title">
                  <span>
                    {actionLabels[approval.actionType ?? approval.operation ?? ""] ??
                      approval.actionType ??
                      approval.operation ??
                      "审批事项"}
                  </span>
                  <StatusBadge status={approval.status} />
                </div>
                <h2>{recordLabel(approval)}</h2>
                <p>{approval.reason}</p>
                <div className="approval-meta">
                  <span>申请人 {approval.requestedByName ?? approval.requestedBy ?? "—"}</span>
                  <span>{formatDateTime(approval.requestedAt ?? approval.createdAt)}</span>
                  {approval.amount ? <span>{formatMoney(approval.amount)}</span> : null}
                </div>
              </div>
              <div className="approval-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setSelected(approval)}
                >
                  详情
                </button>
                {view === "pending" ? (
                  <>
                    <button
                      type="button"
                      className="icon-button reject-button"
                      onClick={() => {
                        setSelected(approval);
                        setDecision("reject");
                      }}
                      aria-label="驳回"
                      title="驳回"
                    >
                      <X aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-button approve-button"
                      onClick={() => {
                        setSelected(approval);
                        setDecision("approve");
                      }}
                      aria-label="批准"
                      title="批准"
                    >
                      <Check aria-hidden="true" />
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}

      <Modal
        open={Boolean(selected) && !decision}
        onClose={() => setSelected(null)}
        title="审批详情"
        size="large"
      >
        {selected ? <ApprovalDetails approval={selected} /> : null}
      </Modal>
      <Modal
        open={Boolean(selected && decision)}
        onClose={() => setDecision(null)}
        title={decision === "approve" ? "批准事项" : "驳回事项"}
        size="small"
      >
        {selected && decision ? (
          <DecisionForm
            approval={selected}
            decision={decision}
            onDone={() => {
              setSelected(null);
              setDecision(null);
            }}
            onCancel={() => setDecision(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

export function ApprovalDetails({ approval }: { approval: ApprovalRecord }) {
  return (
    <div className="approval-details">
      <dl>
        <div>
          <dt>动作类型</dt>
          <dd>
            {actionLabels[approval.actionType ?? approval.operation ?? ""] ??
              approval.actionType ??
              approval.operation ??
              "审批事项"}
          </dd>
        </div>
        <div>
          <dt>风险等级</dt>
          <dd>{approval.riskLevel}</dd>
        </div>
        <div>
          <dt>申请人</dt>
          <dd>{approval.requestedByName ?? approval.requestedBy ?? "—"}</dd>
        </div>
        <div>
          <dt>申请时间</dt>
          <dd>{formatDateTime(approval.requestedAt ?? approval.createdAt)}</dd>
        </div>
        <div>
          <dt>审批状态</dt>
          <dd>
            <StatusBadge status={approval.status} />
          </dd>
        </div>
        {approval.linkedExternalAction ? (
          <>
            <div>
              <dt>外部执行状态</dt>
              <dd>
                <StatusBadge status={approval.linkedExternalAction.status} />
              </dd>
            </div>
            <div>
              <dt>执行适配器</dt>
              <dd>{approval.linkedExternalAction.adapter}</dd>
            </div>
            {approval.linkedExternalAction.externalReference ? (
              <div>
                <dt>外部回执引用</dt>
                <dd>{approval.linkedExternalAction.externalReference}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      <section>
        <h3>申请理由</h3>
        <p>{approval.reason}</p>
      </section>
      <section>
        <h3>执行边界</h3>
        <p>
          {isMembershipLifecycleApproval(approval)
            ? isMembershipReactivation(approval)
              ? "批准后系统将在同一事务中重新启用本组织成员关系；旧会话保持撤销，成员必须重新登录。驳回不会改变成员或会话。"
              : "批准后系统将在同一事务中更新本组织成员状态并撤销该成员在本组织的全部会话；驳回不会改变成员或会话。"
            : approval.resourceType === "external-action"
              ? "批准后仍需人工执行并上传外部回执，系统不会自动标记成功。"
              : "批准仅授权系统内动作，执行结果仍写入审计日志。"}
        </p>
      </section>
    </div>
  );
}

function DecisionForm({
  approval,
  decision,
  onDone,
  onCancel,
}: {
  approval: ApprovalRequest;
  decision: "approve" | "reject";
  onDone: () => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const auth = useAuth();
  const selfApproval = approval.requestedBy === auth.user?.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<ApprovalRequest>(`/approvals/${approval.id}/${decision}`, {
        comment,
        ...(decision === "approve" && selfApproval
          ? { acknowledgement: "SELF_APPROVAL_ACKNOWLEDGED" }
          : {}),
      }),
    onSuccess: async () => {
      toast.push(
        decision === "approve"
          ? isMembershipLifecycleApproval(approval)
            ? isMembershipReactivation(approval)
              ? "已重新启用成员；旧会话仍已撤销，需重新登录"
              : "已批准并应用成员状态，会话已按组织撤销"
            : "已批准，等待执行凭证"
          : isMembershipLifecycleApproval(approval)
            ? "已驳回，成员状态未改变"
            : "已驳回",
        "success",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["resource", "users"] }),
      ]);
      onDone();
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : "审批失败", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="decision-form">
      <p>
        {decision === "approve"
          ? isMembershipLifecycleApproval(approval)
            ? isMembershipReactivation(approval)
              ? `批准“${recordLabel(approval)}”会重新启用成员，但不会恢复旧会话。`
              : `批准“${recordLabel(approval)}”会立即更新本组织成员状态并撤销其本组织会话。`
            : `批准“${recordLabel(approval)}”不会替代外部实际操作。`
          : `驳回“${recordLabel(approval)}”。`}
      </p>
      <label>
        <span>审批意见</span>
        <textarea
          rows={4}
          required
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      {decision === "approve" ? (
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            {selfApproval ? "本人同时为申请人；我明确确认并承担自批责任" : "我已核对申请内容与附件"}
          </span>
        </label>
      ) : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="submit"
          className={decision === "reject" ? "button danger" : "button primary"}
          disabled={mutation.isPending || (decision === "approve" && !confirmed)}
        >
          {mutation.isPending ? "正在提交…" : decision === "approve" ? "确认批准" : "确认驳回"}
        </button>
      </div>
    </form>
  );
}
