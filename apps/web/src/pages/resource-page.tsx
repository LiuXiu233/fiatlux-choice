import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BadgeCheck,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UserCheck,
  UserMinus,
  UserX,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import {
  ConfirmForm,
  EmptyState,
  ErrorState,
  Modal,
  Spinner,
  StatusBadge,
  useToast,
} from "../components/ui";
import { ApiError, api, apiUrl, normalizeMeta, queryString } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatChinaDateInput, formatChinaDateTimeInput } from "../lib/china-time";
import { formatDateTime, recordLabel } from "../lib/format";
import { buildResourcePayload } from "../lib/resource-form";
import { type FieldConfig, getResourceConfig } from "../lib/resources";
import type { ApiEnvelope, BusinessRecord } from "../lib/types";

const MAX_FILE_SIZE_BYTES = 50_000_000;
type MembershipLifecycleAction = "deactivate" | "offboard" | "reactivate";

export interface ComplianceSnapshotRecord {
  id: string;
  sourceId: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  sizeBytes: number;
  rawHash: string | null;
  normalizedHash: string | null;
  previousContentHash: string | null;
  normalizedExcerpt: string | null;
  changed: boolean;
  notModified: boolean;
  fetcherVersion: string;
  fetchedAt: string;
}

export interface ComplianceReviewHistoryRecord {
  id: string;
  sourceId: string;
  recordedByUserId: string | null;
  recordedByDisplayName: string | null;
  recordedAt: string;
  reviewOutcome: "applicable" | "not_applicable" | "changes_required" | "insufficient_information";
  resultingStatus: "active" | "superseded" | "repealed" | "uncertain";
  reviewerName: string;
  reviewerRole: string;
  reviewerOrganization: string;
  reviewerQualification: string;
  evidenceFileId: string;
  applicability: string;
  summary: string;
  missingInformation: string;
  reason: string;
  reviewedAt: string;
  nextReviewAt: string;
  reviewedSourceVersion: number;
  reviewedContentHash: string | null;
  reviewedMetadataHash: string | null;
}

const complianceReviewOutcomeLabels = {
  applicable: "适用于当前业务",
  not_applicable: "经复核不适用",
  changes_required: "需要修改后复核",
  insufficient_information: "信息不足",
} satisfies Record<ComplianceReviewHistoryRecord["reviewOutcome"], string>;

const complianceLifecycleStatusLabels = {
  active: "现行",
  superseded: "已被替代",
  repealed: "已废止",
  uncertain: "待确认",
} satisfies Record<ComplianceReviewHistoryRecord["resultingStatus"], string>;

function valueForInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function valueForField(field: FieldConfig, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.key.endsWith("Cents") && typeof value === "number") return String(value / 100);
  if (field.kind === "date") return formatChinaDateInput(value);
  if (field.kind === "datetime-local") return formatChinaDateTimeInput(value);
  if (field.kind === "json")
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return valueForInput(value);
}

export function ResourcePage() {
  const { resourceKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const config = getResourceConfig(resourceKey);
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<BusinessRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<BusinessRecord | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<BusinessRecord | null>(null);
  const [reviewSource, setReviewSource] = useState<BusinessRecord | null>(null);
  const [reviewHistorySource, setReviewHistorySource] = useState<BusinessRecord | null>(null);
  const [lifecycleRequest, setLifecycleRequest] = useState<{
    record: BusinessRecord;
    action: MembershipLifecycleAction;
  } | null>(null);
  const [roleMember, setRoleMember] = useState<BusinessRecord | null>(null);
  const canCreate = Boolean(config && !config.readOnly && auth.can(`${config.permission}:create`));
  const canUpdate = Boolean(config && !config.readOnly && auth.can(`${config.permission}:update`));
  const canArchive = Boolean(
    config && config.archivable !== false && auth.can(`${config.permission}:delete`),
  );
  const canDownloadFile = Boolean(config?.key === "files" && auth.can("files:read"));
  const canManageRoles = Boolean(
    config?.key === "users" && auth.can("roles:read") && auth.can("role-assignments:create"),
  );
  const canRunWorkflow = Boolean(config?.key === "workflows" && auth.can("workflow-runs:create"));
  const canMonitorCompliance = Boolean(
    config?.key === "compliance-items" && auth.can("compliance-items:update"),
  );
  const canViewComplianceSnapshots = Boolean(
    config?.key === "compliance-items" && auth.can("compliance-items:read"),
  );
  const canRecordComplianceReview = Boolean(
    config?.key === "compliance-items" &&
      auth.can("compliance-items:update") &&
      auth.can("files:read"),
  );
  const canViewComplianceReviews = Boolean(
    config?.key === "compliance-items" && auth.can("compliance-items:read"),
  );
  const canMarkNotificationRead = Boolean(
    config?.key === "notifications" && auth.can("notifications:read"),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const currentResource = config?.key;
  useEffect(() => {
    if (!currentResource) return;
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setStatus("");
    setEditing(null);
    setCreating(false);
    setSnapshotSource(null);
    setReviewSource(null);
    setReviewHistorySource(null);
    setLifecycleRequest(null);
    setRoleMember(null);
  }, [currentResource]);

  useEffect(() => {
    if (searchParams.get("create") === "1" && canCreate) {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [canCreate, searchParams, setSearchParams]);

  const listQuery = useQuery({
    queryKey: ["resource", config?.key, page, debouncedSearch, status],
    queryFn: async () => {
      if (!config) throw new Error("未知资源");
      return api.get<BusinessRecord[]>(
        `${config.endpoint}${queryString({ page, pageSize: 20, search: debouncedSearch, status })}`,
      );
    },
    enabled: Boolean(config),
  });

  const archiveMutation = useMutation({
    mutationFn: async (record: BusinessRecord) => {
      if (!config) throw new Error("未知资源");
      return api.delete<BusinessRecord>(
        `${config.endpoint}/${record.id}?expectedVersion=${Number(record.version ?? 1)}`,
      );
    },
    onSuccess: async () => {
      toast.push("记录已归档", "success");
      setArchiving(null);
      await queryClient.invalidateQueries({ queryKey: ["resource", config?.key] });
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : "归档失败", "error"),
  });

  const runWorkflowMutation = useMutation({
    mutationFn: (definition: BusinessRecord) =>
      api.post<BusinessRecord>("/workflow-runs", {
        definitionId: definition.id,
        input: { trigger: "manual", requestedAt: new Date().toISOString() },
      }),
    onSuccess: async () => {
      toast.push("工作流已进入后台队列", "success");
      await queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法运行工作流", "error"),
  });

  const monitorComplianceMutation = useMutation({
    mutationFn: (source: BusinessRecord) =>
      api.post<{ sourceId: string; jobId: string; status: "queued" }>(
        `/compliance-items/${source.id}/monitor`,
        { reason: "从合规知识库人工触发官方来源检查" },
      ),
    onSuccess: async () => {
      toast.push("官方来源检查已进入受控后台队列", "success");
      await queryClient.invalidateQueries({ queryKey: ["resource", "compliance-items"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法触发官方来源检查", "error"),
  });

  const markNotificationReadMutation = useMutation({
    mutationFn: (notification: BusinessRecord) =>
      api.post<BusinessRecord>(`/notifications/${notification.id}/read`, {
        expectedVersion: Number(notification.version ?? 1),
      }),
    onSuccess: async () => {
      toast.push("通知已标记为已读", "success");
      await queryClient.invalidateQueries({ queryKey: ["resource", "notifications"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法标记通知", "error"),
  });

  const meta = normalizeMeta(listQuery.data?.meta, listQuery.data?.data.length ?? 0);
  const listItems = listQuery.data?.data ?? [];
  if (!config) {
    return <ErrorState message="该模块不存在或尚未启用" />;
  }

  const Icon = config.icon;
  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        icon={Icon}
        actions={
          canCreate ? (
            <button type="button" className="button primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              新建{config.singular}
            </button>
          ) : undefined
        }
      />

      <section className="resource-toolbar" aria-label="筛选">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`搜索${config.title}`}
            aria-label={`搜索${config.title}`}
          />
        </label>
        {config.statuses.length ? (
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            aria-label="状态筛选"
          >
            <option value="">全部状态</option>
            {config.statuses.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        <span className="record-count">{meta.total} 条记录</span>
      </section>

      {listQuery.isLoading ? (
        <div className="resource-loading">
          <Spinner />
        </div>
      ) : listQuery.isError ? (
        <ErrorState
          message={listQuery.error instanceof ApiError ? listQuery.error.message : "无法读取数据"}
          onRetry={() => void listQuery.refetch()}
        />
      ) : listItems.length === 0 ? (
        <EmptyState
          title={debouncedSearch || status ? "没有符合条件的记录" : `暂无${config.title}`}
          action={
            canCreate && !debouncedSearch && !status ? (
              <button type="button" className="button primary" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" />
                新建{config.singular}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {config.columns.map((column) => (
                  <th key={column.key}>{column.label}</th>
                ))}
                <th className="action-column">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listItems.map((record) => (
                <tr key={record.id}>
                  {config.columns.map((column, index) => {
                    const value = record[column.key];
                    return (
                      <td
                        key={column.key}
                        data-label={column.label}
                        className={index === 0 ? "primary-cell" : undefined}
                      >
                        {column.key.toLowerCase().includes("status") ? (
                          <StatusBadge status={String(value ?? "draft")} />
                        ) : column.format ? (
                          column.format(value)
                        ) : (
                          String(value ?? "—")
                        )}
                      </td>
                    );
                  })}
                  <td className="row-actions">
                    {canUpdate ||
                    canArchive ||
                    canManageRoles ||
                    (canDownloadFile && record.uploadStatus === "uploaded") ||
                    canMonitorCompliance ||
                    canViewComplianceSnapshots ||
                    canRecordComplianceReview ||
                    canViewComplianceReviews ||
                    (canMarkNotificationRead && !record.readAt) ||
                    (canRunWorkflow && record.enabled !== false) ? (
                      <RowMenu
                        {...(canUpdate ? { onEdit: () => setEditing(record) } : {})}
                        {...(canRunWorkflow && record.enabled !== false
                          ? { onRun: () => runWorkflowMutation.mutate(record) }
                          : {})}
                        {...(canMonitorCompliance
                          ? { onMonitor: () => monitorComplianceMutation.mutate(record) }
                          : {})}
                        {...(canViewComplianceSnapshots
                          ? { onViewSnapshots: () => setSnapshotSource(record) }
                          : {})}
                        {...(canRecordComplianceReview
                          ? { onRecordReview: () => setReviewSource(record) }
                          : {})}
                        {...(canViewComplianceReviews
                          ? { onViewReviews: () => setReviewHistorySource(record) }
                          : {})}
                        {...(config.key === "notifications"
                          ? { onView: () => setEditing(record) }
                          : {})}
                        {...(canMarkNotificationRead &&
                        !record.readAt &&
                        record.channel === "in_app" &&
                        ["queued", "sent"].includes(String(record.status))
                          ? {
                              onMarkRead: () => markNotificationReadMutation.mutate(record),
                            }
                          : {})}
                        {...(canDownloadFile && record.uploadStatus === "uploaded"
                          ? { downloadHref: apiUrl(`/files/${record.id}/download`) }
                          : {})}
                        {...(canArchive ? { onArchive: () => setArchiving(record) } : {})}
                        {...(canManageRoles ? { onManageRoles: () => setRoleMember(record) } : {})}
                        {...(config.key === "users" &&
                        canUpdate &&
                        record.membershipStatus === "active" &&
                        !record.pendingLifecycleAction
                          ? {
                              onDeactivate: () =>
                                setLifecycleRequest({ record, action: "deactivate" }),
                              onOffboard: () => setLifecycleRequest({ record, action: "offboard" }),
                            }
                          : {})}
                        {...(config.key === "users" &&
                        canUpdate &&
                        record.membershipStatus === "inactive" &&
                        !record.pendingLifecycleAction
                          ? {
                              onReactivate: () =>
                                setLifecycleRequest({ record, action: "reactivate" }),
                            }
                          : {})}
                      />
                    ) : (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setEditing(record)}
                        aria-label="查看详情"
                        title="查看详情"
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta.total > meta.pageSize ? (
        <nav className="pagination" aria-label="分页">
          <button
            type="button"
            className="icon-button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            aria-label="上一页"
            title="上一页"
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>
            第 {meta.page} / {meta.totalPages ?? Math.ceil(meta.total / meta.pageSize)} 页
          </span>
          <button
            type="button"
            className="icon-button"
            disabled={page >= (meta.totalPages ?? Math.ceil(meta.total / meta.pageSize))}
            onClick={() => setPage((current) => current + 1)}
            aria-label="下一页"
            title="下一页"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>
      ) : null}

      {config.key === "workflows" ? <WorkflowRunHistory /> : null}

      <Modal open={creating} onClose={() => setCreating(false)} title={`新建${config.singular}`}>
        {config.key === "workflows" ? (
          <WorkflowDefinitionForm onClose={() => setCreating(false)} />
        ) : (
          <ResourceForm config={config} onClose={() => setCreating(false)} />
        )}
      </Modal>
      <Modal
        open={Boolean(roleMember)}
        onClose={() => setRoleMember(null)}
        title={`管理角色：${roleMember ? recordLabel(roleMember) : ""}`}
        size="small"
      >
        {roleMember ? (
          <RoleAssignmentForm member={roleMember} onClose={() => setRoleMember(null)} />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`${canUpdate ? "编辑" : "查看"}${config.singular}`}
      >
        {editing && config.key === "workflows" && canUpdate ? (
          <WorkflowDefinitionForm record={editing} onClose={() => setEditing(null)} />
        ) : editing ? (
          <ResourceForm
            config={config}
            record={editing}
            readOnly={!canUpdate}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`归档${config.singular}`}
        size="small"
      >
        {archiving ? (
          <ConfirmForm
            description={`归档“${recordLabel(archiving)}”后，它将从默认列表中移除，操作会写入审计日志。`}
            confirmLabel="确认归档"
            danger
            busy={archiveMutation.isPending}
            onCancel={() => setArchiving(null)}
            onConfirm={() => archiveMutation.mutate(archiving)}
          />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(snapshotSource)}
        onClose={() => setSnapshotSource(null)}
        title={`来源快照：${snapshotSource ? recordLabel(snapshotSource) : ""}`}
        size="large"
      >
        {snapshotSource ? <ComplianceSnapshotHistory source={snapshotSource} /> : null}
      </Modal>
      <Modal
        open={Boolean(reviewSource)}
        onClose={() => setReviewSource(null)}
        title={`登记专业复核：${reviewSource ? recordLabel(reviewSource) : ""}`}
        size="large"
      >
        {reviewSource ? (
          <ComplianceReviewForm source={reviewSource} onClose={() => setReviewSource(null)} />
        ) : null}
      </Modal>
      <Modal
        open={Boolean(reviewHistorySource)}
        onClose={() => setReviewHistorySource(null)}
        title={`专业复核记录：${reviewHistorySource ? recordLabel(reviewHistorySource) : ""}`}
        size="large"
      >
        {reviewHistorySource ? <ComplianceReviewHistory source={reviewHistorySource} /> : null}
      </Modal>
      <Modal
        open={Boolean(lifecycleRequest)}
        onClose={() => setLifecycleRequest(null)}
        title={
          lifecycleRequest?.action === "deactivate"
            ? "申请停用成员"
            : lifecycleRequest?.action === "offboard"
              ? "申请成员离职"
              : "申请重新启用成员"
        }
        size="small"
      >
        {lifecycleRequest ? (
          <MemberLifecycleForm
            record={lifecycleRequest.record}
            action={lifecycleRequest.action}
            onClose={() => setLifecycleRequest(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

function WorkflowDefinitionForm({
  record,
  onClose,
}: {
  record?: BusinessRecord;
  onClose: () => void;
}) {
  const firstNotifyStep = Array.isArray(record?.steps)
    ? record.steps.find(
        (step) =>
          typeof step === "object" &&
          step !== null &&
          "type" in step &&
          step.type === "notify" &&
          "config" in step &&
          typeof step.config === "object" &&
          step.config !== null,
      )
    : undefined;
  const notifyConfig =
    firstNotifyStep && "config" in firstNotifyStep
      ? (firstNotifyStep.config as Record<string, unknown>)
      : {};
  const [name, setName] = useState(String(record?.name ?? ""));
  const [enabled, setEnabled] = useState(record?.enabled === false ? "false" : "true");
  const [recipientId, setRecipientId] = useState(String(notifyConfig.recipientId ?? ""));
  const [title, setTitle] = useState(String(notifyConfig.title ?? ""));
  const [body, setBody] = useState(String(notifyConfig.body ?? ""));
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        trigger: "manual",
        enabled: enabled === "true",
        steps: [
          {
            type: "notify",
            config: { recipientId, title, body, channel: "in_app", status: "queued" },
          },
        ],
      };
      return record
        ? api.patch<BusinessRecord>(`/workflow-definitions/${record.id}`, {
            ...payload,
            expectedVersion: Number(record.version ?? 1),
          })
        : api.post<BusinessRecord>("/workflow-definitions", payload);
    },
    onSuccess: async () => {
      toast.push(record ? "手动通知工作流已更新" : "手动通知工作流已创建", "success");
      await queryClient.invalidateQueries({ queryKey: ["resource", "workflows"] });
      onClose();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法保存工作流", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form className="resource-form" onSubmit={submit}>
      <p className="confirm-description">
        V1 工作流仅支持人工运行。步骤会在每次点击运行时冻结，后续编辑不会改变已排队任务。
      </p>
      <div className="form-grid">
        <div className="form-field full-width">
          <label htmlFor="workflow-name">工作流名称</label>
          <input
            id="workflow-name"
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="workflow-enabled">启用</label>
          <select
            id="workflow-enabled"
            value={enabled}
            onChange={(event) => setEnabled(event.target.value)}
          >
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="workflow-recipient">通知接收人</label>
          <ReferenceSelect
            id="workflow-recipient"
            field={{
              key: "recipientId",
              label: "通知接收人",
              kind: "reference",
              required: true,
              referenceEndpoint: "/users",
              referenceLabelKey: "displayName",
            }}
            value={recipientId}
            onChange={setRecipientId}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="workflow-notification-title">通知主题</label>
          <input
            id="workflow-notification-title"
            required
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="workflow-notification-body">通知内容</label>
          <textarea
            id="workflow-notification-body"
            required
            maxLength={10_000}
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={
            mutation.isPending || !name.trim() || !recipientId || !title.trim() || !body.trim()
          }
        >
          {mutation.isPending ? "正在保存…" : "保存"}
        </button>
      </div>
    </form>
  );
}

function RowMenu({
  onView,
  onEdit,
  onRun,
  onMonitor,
  onViewSnapshots,
  onRecordReview,
  onViewReviews,
  onArchive,
  onDeactivate,
  onOffboard,
  onReactivate,
  onMarkRead,
  onManageRoles,
  downloadHref,
}: {
  onView?: () => void;
  onEdit?: () => void;
  onRun?: () => void;
  onMonitor?: () => void;
  onViewSnapshots?: () => void;
  onRecordReview?: () => void;
  onViewReviews?: () => void;
  onArchive?: () => void;
  onDeactivate?: () => void;
  onOffboard?: () => void;
  onReactivate?: () => void;
  onMarkRead?: () => void;
  onManageRoles?: () => void;
  downloadHref?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row-menu">
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        aria-label="更多操作"
        title="更多操作"
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open ? (
        <div className="row-menu-popover">
          {onView ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onView();
              }}
            >
              <Eye aria-hidden="true" />
              查看
            </button>
          ) : null}
          {downloadHref ? (
            <a href={downloadHref} onClick={() => setOpen(false)}>
              <Download aria-hidden="true" />
              下载
            </a>
          ) : null}
          {onRun ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRun();
              }}
            >
              <Play aria-hidden="true" />
              运行
            </button>
          ) : null}
          {onMonitor ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onMonitor();
              }}
            >
              <RefreshCw aria-hidden="true" />
              检查官方来源
            </button>
          ) : null}
          {onRecordReview ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onRecordReview();
              }}
            >
              <BadgeCheck aria-hidden="true" />
              登记专业复核
            </button>
          ) : null}
          {onViewReviews ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewReviews();
              }}
            >
              <History aria-hidden="true" />
              查看专业复核
            </button>
          ) : null}
          {onViewSnapshots ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onViewSnapshots();
              }}
            >
              <History aria-hidden="true" />
              查看监控快照
            </button>
          ) : null}
          {onMarkRead ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onMarkRead();
              }}
            >
              <CheckCheck aria-hidden="true" />
              标记已读
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <Pencil aria-hidden="true" />
              编辑
            </button>
          ) : null}
          {onManageRoles ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManageRoles();
              }}
            >
              <ShieldCheck aria-hidden="true" />
              管理角色
            </button>
          ) : null}
          {onReactivate ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReactivate();
              }}
            >
              <UserCheck aria-hidden="true" />
              申请重新启用
            </button>
          ) : null}
          {onDeactivate ? (
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                setOpen(false);
                onDeactivate();
              }}
            >
              <UserMinus aria-hidden="true" />
              申请停用
            </button>
          ) : null}
          {onOffboard ? (
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                setOpen(false);
                onOffboard();
              }}
            >
              <UserX aria-hidden="true" />
              申请离职
            </button>
          ) : null}
          {onArchive ? (
            <button
              type="button"
              className="danger-text"
              onClick={() => {
                setOpen(false);
                onArchive();
              }}
            >
              <Archive aria-hidden="true" />
              归档
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface RoleOption extends BusinessRecord {
  name: string;
  systemKey?: string | null;
}

function RoleAssignmentForm({ member, onClose }: { member: BusinessRecord; onClose: () => void }) {
  const currentRoles = Array.isArray(member.roles)
    ? (member.roles.filter(
        (role): role is RoleOption =>
          typeof role === "object" && role !== null && "id" in role && "name" in role,
      ) as RoleOption[])
    : [];
  const [mode, setMode] = useState<"assign" | "remove">("assign");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const toast = useToast();
  const roleQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get<RoleOption[]>("/roles")).data,
  });
  const currentRoleIds = new Set(currentRoles.map((role) => role.id));
  const availableRoles = (roleQuery.data ?? []).filter((role) =>
    mode === "assign" ? !currentRoleIds.has(role.id) : currentRoleIds.has(role.id),
  );
  const mutation = useMutation({
    mutationFn: () =>
      api.post<BusinessRecord>("/role-assignments", {
        membershipId: member.membershipId,
        roleId,
        mode,
        reason,
        expectedVersion: Number(member.version ?? 1),
        idempotencyKey,
      }),
    onSuccess: async () => {
      toast.push("角色变更已提交人工审批，当前权限尚未改变", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
      ]);
      onClose();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法提交角色变更", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form className="resource-form" onSubmit={submit}>
      <p className="confirm-description">
        当前角色：{currentRoles.map((role) => role.name).join("、") || "无角色"}
        。审批完成前，成员权限不会改变。
      </p>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="role-assignment-mode">变更方式</label>
          <select
            id="role-assignment-mode"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as "assign" | "remove");
              setRoleId("");
            }}
          >
            <option value="assign">新增角色</option>
            <option value="remove">移除角色</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="role-assignment-role">角色</label>
          <select
            id="role-assignment-role"
            value={roleId}
            required
            disabled={roleQuery.isLoading || roleQuery.isError || availableRoles.length === 0}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">
              {roleQuery.isLoading
                ? "正在加载…"
                : roleQuery.isError
                  ? "角色加载失败"
                  : availableRoles.length === 0
                    ? "没有可选角色"
                    : "请选择"}
            </option>
            {availableRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field full-width">
          <label htmlFor="role-assignment-reason">申请理由</label>
          <textarea
            id="role-assignment-reason"
            required
            maxLength={5000}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明业务需要、权限最小化依据和复核安排"
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={mutation.isPending || !roleId || !reason.trim()}
        >
          {mutation.isPending ? "正在提交…" : "提交审批"}
        </button>
      </div>
    </form>
  );
}

function MemberLifecycleForm({
  record,
  action,
  onClose,
}: {
  record: BusinessRecord;
  action: MembershipLifecycleAction;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const queryClient = useQueryClient();
  const toast = useToast();
  const actionLabel =
    action === "deactivate" ? "停用" : action === "offboard" ? "离职" : "重新启用";
  const mutation = useMutation({
    mutationFn: () =>
      api.post<BusinessRecord>(`/users/${record.id}/lifecycle`, {
        action,
        reason,
        expectedVersion: Number(record.version ?? 1),
        idempotencyKey,
      }),
    onSuccess: async () => {
      toast.push(`${actionLabel}申请已进入人工审批，成员状态尚未改变`, "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource", "users"] }),
        queryClient.invalidateQueries({ queryKey: ["approvals"] }),
      ]);
      onClose();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : `无法提交${actionLabel}申请`, "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form onSubmit={submit} className="resource-form">
      <p className="confirm-description">
        {action === "reactivate" ? (
          `申请批准前，“${recordLabel(record)}”仍保持“已停用”。批准后系统才会重新启用本组织成员关系；旧会话保持撤销，成员必须重新登录生成新会话，其他组织不会受影响。`
        ) : (
          <>
            申请批准前，“{recordLabel(record)}”仍保持有效。批准后系统才会将本组织成员状态改为
            {action === "deactivate" ? "“已停用”" : "“已离职”"}
            ，并撤销该成员在本组织的全部会话；其他组织不会受影响。
          </>
        )}
      </p>
      <div className="form-grid">
        <div className="form-field full-width">
          <label htmlFor="membership-lifecycle-reason">
            申请理由<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="membership-lifecycle-reason"
            rows={4}
            required
            maxLength={5000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              action === "deactivate"
                ? "说明停用原因、预计复核时间和业务交接安排"
                : action === "offboard"
                  ? "说明离职日期、交接完成情况和外部权限回收安排"
                  : "说明身份复核、重新授权依据和恢复访问的业务需要"
            }
          />
        </div>
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          取消
        </button>
        <button
          type="submit"
          className={`button ${action === "reactivate" ? "primary" : "danger"}`}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "正在提交…" : `提交${actionLabel}审批`}
        </button>
      </div>
    </form>
  );
}

export function ComplianceReviewForm({
  source,
  onClose,
}: {
  source: BusinessRecord;
  onClose: () => void;
}) {
  const [reviewOutcome, setReviewOutcome] = useState<
    "" | ComplianceReviewHistoryRecord["reviewOutcome"]
  >("");
  const [resultingStatus, setResultingStatus] = useState<
    "" | ComplianceReviewHistoryRecord["resultingStatus"]
  >("");
  const [reviewerName, setReviewerName] = useState("");
  const [reviewerRole, setReviewerRole] = useState("");
  const [reviewerOrganization, setReviewerOrganization] = useState("");
  const [reviewerQualification, setReviewerQualification] = useState("");
  const [evidenceFileId, setEvidenceFileId] = useState("");
  const [applicability, setApplicability] = useState(String(source.applicability ?? ""));
  const [summary, setSummary] = useState(String(source.summary ?? ""));
  const [missingInformation, setMissingInformation] = useState("");
  const [nextReviewAt, setNextReviewAt] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<BusinessRecord>(`/compliance-items/${source.id}/reviews`, {
        expectedVersion: Number(source.version ?? 1),
        reviewOutcome,
        resultingStatus,
        reviewerName,
        reviewerRole,
        reviewerOrganization,
        reviewerQualification,
        evidenceFileId,
        applicability,
        summary,
        missingInformation,
        nextReviewAt,
        reason,
      }),
    onSuccess: async () => {
      toast.push("专业复核已写入追加审计；来源状态已按结论更新", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource", "compliance-items"] }),
        queryClient.invalidateQueries({ queryKey: ["compliance-reviews", source.id] }),
      ]);
      onClose();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法登记专业复核", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  const complete =
    reviewOutcome &&
    resultingStatus &&
    reviewerName.trim() &&
    reviewerRole.trim() &&
    reviewerOrganization.trim() &&
    reviewerQualification.trim() &&
    evidenceFileId &&
    applicability.trim() &&
    summary.trim() &&
    missingInformation.trim() &&
    nextReviewAt &&
    reason.trim();
  const unresolvedOutcome =
    reviewOutcome === "changes_required" || reviewOutcome === "insufficient_information";
  const lifecycleOptions = Object.entries(complianceLifecycleStatusLabels).filter(([value]) =>
    reviewOutcome ? (unresolvedOutcome ? value === "uncertain" : value !== "uncertain") : true,
  );

  return (
    <form className="resource-form" onSubmit={submit}>
      <p className="compliance-snapshot-boundary">
        每次提交都会锁定来源版本、当前内容/元数据哈希、证据文件和站内登记人，并写入不可修改的审计历史。
        系统不会判断复核人的专业资格，也不会批量把 73
        条来源标记为已复核；请先核对官方原文和公司实际事实。
      </p>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="compliance-review-outcome">
            专业结论<b aria-hidden="true">*</b>
          </label>
          <select
            id="compliance-review-outcome"
            required
            value={reviewOutcome}
            onChange={(event) => {
              const outcome = event.target.value as
                | ""
                | ComplianceReviewHistoryRecord["reviewOutcome"];
              setReviewOutcome(outcome);
              if (outcome === "changes_required" || outcome === "insufficient_information") {
                setResultingStatus("uncertain");
              } else if (resultingStatus === "uncertain") {
                setResultingStatus("");
              }
            }}
          >
            <option value="">请选择</option>
            {Object.entries(complianceReviewOutcomeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="compliance-review-status">
            来源生命周期<b aria-hidden="true">*</b>
          </label>
          <select
            id="compliance-review-status"
            required
            value={resultingStatus}
            onChange={(event) =>
              setResultingStatus(
                event.target.value as "" | ComplianceReviewHistoryRecord["resultingStatus"],
              )
            }
          >
            <option value="">请选择</option>
            {lifecycleOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="compliance-reviewer-name">
            复核人姓名<b aria-hidden="true">*</b>
          </label>
          <input
            id="compliance-reviewer-name"
            required
            maxLength={200}
            value={reviewerName}
            onChange={(event) => setReviewerName(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="compliance-reviewer-role">
            专业角色<b aria-hidden="true">*</b>
          </label>
          <input
            id="compliance-reviewer-role"
            required
            maxLength={200}
            value={reviewerRole}
            onChange={(event) => setReviewerRole(event.target.value)}
            placeholder="例如：劳动用工律师、税务顾问、隐私负责人"
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-reviewer-organization">
            所在机构 / 内部组织<b aria-hidden="true">*</b>
          </label>
          <input
            id="compliance-reviewer-organization"
            required
            maxLength={300}
            value={reviewerOrganization}
            onChange={(event) => setReviewerOrganization(event.target.value)}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-reviewer-qualification">
            胜任依据<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="compliance-reviewer-qualification"
            required
            minLength={10}
            maxLength={5_000}
            rows={3}
            value={reviewerQualification}
            onChange={(event) => setReviewerQualification(event.target.value)}
            placeholder="记录与本条来源相关的执业、岗位、项目经验或内部授权依据；不要录入证件号码。"
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-review-evidence">
            已上传复核证据<b aria-hidden="true">*</b>
          </label>
          <ReferenceSelect
            id="compliance-review-evidence"
            field={{
              key: "evidenceFileId",
              label: "已上传复核证据",
              kind: "reference",
              required: true,
              referenceEndpoint: "/files?status=uploaded",
              referenceLabelKey: "filename",
            }}
            value={evidenceFileId}
            onChange={setEvidenceFileId}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-review-applicability">
            对耀光的适用条件<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="compliance-review-applicability"
            required
            minLength={10}
            maxLength={20_000}
            rows={4}
            value={applicability}
            onChange={(event) => setApplicability(event.target.value)}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-review-summary">
            复核摘要<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="compliance-review-summary"
            required
            minLength={10}
            maxLength={30_000}
            rows={5}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-review-missing-information">
            缺失信息<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="compliance-review-missing-information"
            required
            minLength={5}
            maxLength={20_000}
            rows={4}
            value={missingInformation}
            onChange={(event) => setMissingInformation(event.target.value)}
            placeholder="如无已知缺失信息，请明确填写“暂无已知缺失信息”；不要留空。"
          />
        </div>
        <div className="form-field">
          <label htmlFor="compliance-review-next-at">
            下次专业复核日<b aria-hidden="true">*</b>
          </label>
          <input
            id="compliance-review-next-at"
            type="date"
            required
            value={nextReviewAt}
            onChange={(event) => setNextReviewAt(event.target.value)}
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="compliance-review-reason">
            本次登记原因<b aria-hidden="true">*</b>
          </label>
          <textarea
            id="compliance-review-reason"
            required
            minLength={10}
            maxLength={5_000}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={`说明为何在来源版本 ${Number(source.version ?? 1)} 上形成或暂缓结论。`}
          />
        </div>
      </div>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="button primary" disabled={mutation.isPending || !complete}>
          {mutation.isPending ? "正在登记…" : "登记专业复核"}
        </button>
      </div>
    </form>
  );
}

export function ComplianceReviewHistory({ source }: { source: BusinessRecord }) {
  const [page, setPage] = useState(1);
  const auth = useAuth();
  const reviews = useQuery({
    queryKey: ["compliance-reviews", source.id, page],
    queryFn: async () =>
      api.get<ComplianceReviewHistoryRecord[]>(
        `/compliance-items/${source.id}/reviews?page=${page}&pageSize=10`,
      ),
  });
  const meta = normalizeMeta(reviews.data?.meta, reviews.data?.data.length ?? 0);
  const pageCount = meta.totalPages ?? meta.pageCount ?? 1;

  if (reviews.isLoading) {
    return (
      <div className="resource-loading" role="status" aria-label="正在加载专业复核记录">
        <Spinner />
      </div>
    );
  }
  if (reviews.isError) {
    return (
      <ErrorState
        message={reviews.error instanceof ApiError ? reviews.error.message : "无法读取专业复核记录"}
        onRetry={() => void reviews.refetch()}
      />
    );
  }
  if (!reviews.data?.data.length) {
    return (
      <EmptyState
        title="尚无专业复核记录"
        detail="不能用通用编辑或批量操作代替专业复核；请先上传真实意见证据。"
      />
    );
  }

  return (
    <section className="compliance-snapshot-history" aria-label="专业复核历史">
      <p className="compliance-snapshot-boundary">
        下列记录来自追加写审计，只证明谁在何时登记了哪份意见和证据，不自动证明复核人的资质、意见正确或外部机构已经批准。
        来源内容变化或复核到期后，系统会继续把结论降为需更新。
      </p>
      <div className="compliance-snapshot-list">
        {reviews.data.data.map((review) => (
          <article className="compliance-snapshot-card" key={review.id}>
            <header>
              <strong>{complianceReviewOutcomeLabels[review.reviewOutcome]}</strong>
              <time className="compliance-snapshot-time" dateTime={review.recordedAt}>
                {formatDateTime(review.recordedAt)}
              </time>
            </header>
            <dl className="compliance-snapshot-meta">
              <div>
                <dt>专业复核人</dt>
                <dd>{review.reviewerName}</dd>
              </div>
              <div>
                <dt>角色 / 机构</dt>
                <dd>
                  {review.reviewerRole}
                  {` · ${review.reviewerOrganization}`}
                </dd>
              </div>
              <div>
                <dt>来源生命周期</dt>
                <dd>{complianceLifecycleStatusLabels[review.resultingStatus]}</dd>
              </div>
              <div>
                <dt>站内登记人</dt>
                <dd>{review.recordedByDisplayName ?? "账号已删除或不可识别"}</dd>
              </div>
              <div>
                <dt>锁定来源版本</dt>
                <dd>v{review.reviewedSourceVersion}</dd>
              </div>
              <div>
                <dt>下次专业复核</dt>
                <dd>{formatDateTime(review.nextReviewAt)}</dd>
              </div>
            </dl>
            <dl className="compliance-snapshot-hashes">
              <div>
                <dt>锁定内容哈希</dt>
                <dd>
                  <code>{review.reviewedContentHash ?? "当时没有可用的自动抓取哈希"}</code>
                </dd>
              </div>
              <div>
                <dt>锁定元数据哈希</dt>
                <dd>
                  <code>{review.reviewedMetadataHash ?? "当时没有元数据哈希"}</code>
                </dd>
              </div>
            </dl>
            <div>
              <h3>胜任依据</h3>
              <p>{review.reviewerQualification}</p>
            </div>
            <div>
              <h3>适用条件</h3>
              <p>{review.applicability}</p>
            </div>
            <div>
              <h3>复核摘要</h3>
              <p>{review.summary}</p>
            </div>
            <div>
              <h3>缺失信息</h3>
              <p>{review.missingInformation}</p>
            </div>
            <div>
              <h3>登记原因</h3>
              <p>{review.reason}</p>
            </div>
            <p>
              证据文件：
              {auth.can("files:read") ? (
                <a href={apiUrl(`/files/${review.evidenceFileId}/download`)}>下载复核证据</a>
              ) : (
                "已记录；当前账号无文件读取权限"
              )}
            </p>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className="pagination" aria-label="专业复核分页">
          <button
            type="button"
            className="button secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span>
            第 {page} / {pageCount} 页
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function snapshotState(snapshot: ComplianceSnapshotRecord) {
  if (snapshot.changed) return "内容已变化";
  if (snapshot.notModified) return "HTTP 未修改";
  return "已抓取";
}

export function ComplianceSnapshotHistory({ source }: { source: BusinessRecord }) {
  const [page, setPage] = useState(1);
  const snapshots = useQuery({
    queryKey: ["compliance-snapshots", source.id, page],
    queryFn: async () =>
      api.get<ComplianceSnapshotRecord[]>(
        `/compliance-items/${source.id}/snapshots?page=${page}&pageSize=10`,
      ),
  });
  const meta = normalizeMeta(snapshots.data?.meta, snapshots.data?.data.length ?? 0);
  const pageCount = meta.totalPages ?? meta.pageCount ?? 1;

  if (snapshots.isLoading) {
    return (
      <div className="resource-loading" role="status" aria-label="正在加载来源快照">
        <Spinner />
      </div>
    );
  }
  if (snapshots.isError) {
    return (
      <ErrorState
        message={snapshots.error instanceof ApiError ? snapshots.error.message : "无法读取来源快照"}
        onRetry={() => void snapshots.refetch()}
      />
    );
  }
  if (!snapshots.data?.data.length) {
    return (
      <EmptyState
        title="尚无来源快照"
        detail="首次后台检查成功后会在这里显示哈希、HTTP 元数据和规范化摘录。"
      />
    );
  }

  return (
    <section className="compliance-snapshot-history" aria-label="官方来源快照历史">
      <p className="compliance-snapshot-boundary">
        此处保存哈希、HTTP 元数据和最多 100,000 UTF-8 字节的规范化摘录；不代表完整原始 HTML/PDF
        已归档。人工复核必须同时查看官方原文。
      </p>
      <div className="compliance-snapshot-list">
        {snapshots.data.data.map((snapshot) => (
          <article className="compliance-snapshot-card" key={snapshot.id}>
            <header>
              <strong>{snapshotState(snapshot)}</strong>
              <time className="compliance-snapshot-time" dateTime={snapshot.fetchedAt}>
                {formatDateTime(snapshot.fetchedAt)}
              </time>
            </header>
            <dl className="compliance-snapshot-meta">
              <div>
                <dt>HTTP 状态</dt>
                <dd>{snapshot.httpStatus}</dd>
              </div>
              <div>
                <dt>内容类型</dt>
                <dd>{snapshot.contentType ?? "未声明"}</dd>
              </div>
              <div>
                <dt>响应长度</dt>
                <dd>{snapshot.sizeBytes.toLocaleString("zh-CN")} 字节</dd>
              </div>
              <div>
                <dt>抓取器</dt>
                <dd>{snapshot.fetcherVersion}</dd>
              </div>
            </dl>
            <dl className="compliance-snapshot-hashes">
              <div>
                <dt>规范化哈希</dt>
                <dd>
                  <code>{snapshot.normalizedHash ?? "未提供（例如 HTTP 304）"}</code>
                </dd>
              </div>
              <div>
                <dt>前一内容哈希</dt>
                <dd>
                  <code>{snapshot.previousContentHash ?? "首次快照，无前一哈希"}</code>
                </dd>
              </div>
              <div>
                <dt>原始响应哈希</dt>
                <dd>
                  <code>{snapshot.rawHash ?? "未提供（例如 HTTP 304）"}</code>
                </dd>
              </div>
            </dl>
            <p>
              最终地址：
              <a href={snapshot.finalUrl} target="_blank" rel="noreferrer">
                {snapshot.finalUrl}
              </a>
            </p>
            <div>
              <h3>规范化摘录</h3>
              <pre className="record-json compliance-snapshot-excerpt">
                {snapshot.normalizedExcerpt ?? "本次快照没有正文摘录。"}
              </pre>
            </div>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className="pagination" aria-label="来源快照分页">
          <button
            type="button"
            className="button secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <span>
            第 {page} / {pageCount} 页
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function WorkflowRunHistory() {
  const runs = useQuery({
    queryKey: ["workflow-runs"],
    queryFn: async () =>
      (await api.get<BusinessRecord[]>(`/workflow-runs${queryString({ pageSize: 10 })}`)).data,
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "queued" || run.status === "running")
        ? 2500
        : false,
  });

  return (
    <section className="workflow-run-history" aria-label="工作流运行记录">
      <header>
        <h2>最近运行</h2>
        <span>{runs.data?.length ?? 0} 条</span>
      </header>
      {runs.isLoading ? (
        <div className="resource-loading">
          <Spinner />
        </div>
      ) : runs.isError ? (
        <ErrorState message="无法读取工作流运行记录" onRetry={() => void runs.refetch()} />
      ) : !runs.data?.length ? (
        <EmptyState title="暂无工作流运行记录" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>定义 ID</th>
                <th>状态</th>
                <th>开始时间</th>
                <th>完成时间</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((run) => (
                <tr key={run.id}>
                  <td className="primary-cell">{String(run.definitionId ?? "—")}</td>
                  <td>
                    <StatusBadge status={String(run.status ?? "queued")} />
                  </td>
                  <td>{formatDateTime(run.startedAt ?? run.createdAt)}</td>
                  <td>{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResourceForm({
  config,
  record,
  readOnly = false,
  onClose,
}: {
  config: NonNullable<ReturnType<typeof getResourceConfig>>;
  record?: BusinessRecord;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fields = record && config.updateFields ? config.updateFields : config.fields;
  const initialValues = Object.fromEntries(
    fields.map((field) => [
      field.key,
      record ? valueForField(field, record[field.key]) : (field.defaultValue ?? ""),
    ]),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        record ? valueForField(field, record[field.key]) : (field.defaultValue ?? ""),
      ]),
    ),
  );
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async (): Promise<ApiEnvelope<BusinessRecord>> => {
      if (config.key === "files" && file && !record) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new ApiError("单个文件不能超过 50 MB", 400, "FILE_TOO_LARGE");
        }
        const checksumSha256 = await sha256(file);
        const ticket = await api.post<{
          file: BusinessRecord;
          upload: { uploadUrl: string; requiredHeaders: Record<string, string> };
        }>(config.endpoint, {
          filename: values.filename || file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          checksumSha256,
          classification: values.classification || "internal",
        });
        const uploadResponse = await fetch(ticket.data.upload.uploadUrl, {
          method: "PUT",
          body: file,
          headers: ticket.data.upload.requiredHeaders,
          credentials: "include",
        });
        if (!uploadResponse.ok) throw new ApiError("文件内容上传失败", uploadResponse.status);
        return api.post<BusinessRecord>(`${config.endpoint}/${ticket.data.file.id}/complete`);
      }
      const payload = buildResourcePayload(
        fields,
        values,
        record ? "update" : "create",
        initialValues,
      );
      return record
        ? api.patch<BusinessRecord>(`${config.endpoint}/${record.id}`, {
            ...payload,
            expectedVersion: Number(record.version ?? 1),
          })
        : api.post<BusinessRecord>(config.endpoint, payload);
    },
    onSuccess: async () => {
      toast.push(record ? "记录已更新" : "记录已创建", "success");
      await queryClient.invalidateQueries({ queryKey: ["resource", config.key] });
      onClose();
    },
    onError: (error) => toast.push(error instanceof ApiError ? error.message : "保存失败", "error"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  if (readOnly) {
    if (fields.length === 0) {
      return <pre className="record-json">{JSON.stringify(record, null, 2)}</pre>;
    }
    return (
      <dl className="record-details">
        {fields.map((field) => (
          <div key={field.key}>
            <dt>{field.label}</dt>
            <dd>{valueForField(field, record?.[field.key]) || "—"}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <form onSubmit={submit} className="resource-form">
      <div className="form-grid">
        {config.key === "files" && !record ? (
          <label className="file-picker full-width">
            <Upload aria-hidden="true" />
            <span>{file?.name ?? "选择文件"}</span>
            <input
              type="file"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                if (nextFile)
                  setValues((current) => ({
                    ...current,
                    filename: current.filename || nextFile.name,
                  }));
              }}
              required
            />
          </label>
        ) : null}
        {fields.map((field) => {
          const fieldId = `resource-field-${field.key}`;
          return (
            <div
              key={field.key}
              className={field.width === "full" ? "form-field full-width" : "form-field"}
            >
              <label htmlFor={fieldId}>
                {field.label}
                {field.required ? <b aria-hidden="true">*</b> : null}
              </label>
              {field.kind === "textarea" || field.kind === "json" ? (
                <textarea
                  id={fieldId}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  required={field.required}
                  placeholder={field.placeholder}
                  rows={4}
                />
              ) : field.kind === "select" || field.kind === "boolean" ? (
                <select
                  id={fieldId}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  required={field.required}
                >
                  <option value="">请选择</option>
                  {(field.kind === "boolean"
                    ? [
                        { label: "是", value: "true" },
                        { label: "否", value: "false" },
                      ]
                    : field.options
                  )?.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.kind === "reference" && field.referenceEndpoint ? (
                <ReferenceSelect
                  id={fieldId}
                  field={field}
                  value={values[field.key] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                />
              ) : (
                <input
                  id={fieldId}
                  type={field.kind}
                  value={values[field.key] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  required={field.required}
                  placeholder={field.placeholder}
                  step={
                    field.kind === "number"
                      ? field.key.endsWith("Cents")
                        ? "0.01"
                        : "1"
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          取消
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={mutation.isPending || (config.key === "files" && !record && !file)}
        >
          {mutation.isPending ? "正在保存…" : "保存"}
        </button>
      </div>
    </form>
  );
}

function ReferenceSelect({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: FieldConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useQuery({
    queryKey: ["reference-options", field.referenceEndpoint],
    queryFn: async () =>
      (
        await api.get<BusinessRecord[]>(
          `${field.referenceEndpoint}${field.referenceEndpoint?.includes("?") ? "&" : "?"}pageSize=100`,
        )
      ).data,
    enabled: Boolean(field.referenceEndpoint),
  });
  return (
    <div className="reference-select">
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={field.required}
        disabled={options.isLoading || options.isError}
        aria-describedby={options.isError ? `${id}-error` : undefined}
      >
        <option value="">
          {options.isLoading ? "正在加载…" : options.isError ? "选项加载失败" : "未指定"}
        </option>
        {options.data?.map((option) => (
          <option key={option.id} value={option.id}>
            {String(
              option[field.referenceLabelKey ?? "name"] ?? option.title ?? option.name ?? option.id,
            )}
          </option>
        ))}
      </select>
      {options.isError ? (
        <p id={`${id}-error`} className="form-error" role="alert">
          引用选项加载失败，请重试或稍后再保存。
        </p>
      ) : null}
    </div>
  );
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
