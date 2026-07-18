import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Upload,
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
import { formatDateTime, recordLabel } from "../lib/format";
import { type FieldConfig, getResourceConfig } from "../lib/resources";
import type { ApiEnvelope, BusinessRecord } from "../lib/types";

const MAX_FILE_SIZE_BYTES = 50_000_000;

function valueForInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && value.includes("T")) return value.slice(0, 16);
  return String(value);
}

function valueForField(field: FieldConfig, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (field.key.endsWith("Cents") && typeof value === "number") return String(value / 100);
  if (field.kind === "date") return String(value).slice(0, 10);
  if (field.kind === "datetime-local") return String(value).slice(0, 16);
  if (field.kind === "json")
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return valueForInput(value);
}

function fieldPayload(field: FieldConfig, value: string): unknown {
  if (value === "") return null;
  if (field.kind === "number") {
    const parsed = Number(value);
    return field.key.endsWith("Cents") ? Math.round(parsed * 100) : parsed;
  }
  if (field.kind === "date" || field.kind === "datetime-local") {
    return new Date(value).toISOString();
  }
  if (field.kind === "boolean") return value === "true";
  if (field.kind === "json") return JSON.parse(value) as unknown;
  return value === "" ? null : value;
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
  const canCreate = Boolean(config && !config.readOnly && auth.can(`${config.permission}:create`));
  const canUpdate = Boolean(config && !config.readOnly && auth.can(`${config.permission}:update`));
  const canRunWorkflow = Boolean(config?.key === "workflows" && auth.can("workflow-runs:create"));

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
                    {canUpdate || (canRunWorkflow && record.enabled !== false) ? (
                      <RowMenu
                        {...(canUpdate ? { onEdit: () => setEditing(record) } : {})}
                        {...(canRunWorkflow && record.enabled !== false
                          ? { onRun: () => runWorkflowMutation.mutate(record) }
                          : {})}
                        {...(config.key === "files" && record.uploadStatus === "uploaded"
                          ? { downloadHref: apiUrl(`/files/${record.id}/download`) }
                          : {})}
                        {...(config.archivable === false
                          ? {}
                          : { onArchive: () => setArchiving(record) })}
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
        <ResourceForm config={config} onClose={() => setCreating(false)} />
      </Modal>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`${canUpdate ? "编辑" : "查看"}${config.singular}`}
      >
        {editing ? (
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
    </>
  );
}

function RowMenu({
  onEdit,
  onRun,
  onArchive,
  downloadHref,
}: {
  onEdit?: () => void;
  onRun?: () => void;
  onArchive?: () => void;
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
      const payload = Object.fromEntries(
        fields.map((field) => [field.key, fieldPayload(field, values[field.key] ?? "")]),
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
          `${field.referenceEndpoint}${queryString({ pageSize: 100 })}`,
        )
      ).data,
    enabled: Boolean(field.referenceEndpoint),
  });
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={field.required}
      disabled={options.isLoading}
    >
      <option value="">{options.isLoading ? "正在加载…" : "未指定"}</option>
      {options.data?.map((option) => (
        <option key={option.id} value={option.id}>
          {String(
            option[field.referenceLabelKey ?? "name"] ?? option.title ?? option.name ?? option.id,
          )}
        </option>
      ))}
    </select>
  );
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
