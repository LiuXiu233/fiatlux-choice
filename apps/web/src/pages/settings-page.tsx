import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudCog,
  DatabaseBackup,
  HardDriveDownload,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  Settings,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/page-header";
import { EmptyState, ErrorState, Spinner, StatusBadge, useToast } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";

interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  mode: "manual" | "mock" | "real" | "disabled";
  status: string;
  lastCheckedAt?: string;
  capabilities: string[];
}

interface BackupRecord {
  id: string;
  status: string;
  scope: string;
  createdAt: string;
  completedAt?: string;
  sizeBytes?: number;
  checksumSha256?: string;
}

export function SettingsPage() {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const mustChangePassword = auth.user?.mustChangePassword === true;
  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await api.get<IntegrationStatus[]>("/settings/integrations")).data,
    enabled: !mustChangePassword,
  });
  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: async () => (await api.get<BackupRecord[]>("/backups")).data,
    refetchInterval: (query) =>
      query.state.data?.some((backup) => ["queued", "running"].includes(backup.status))
        ? 2500
        : false,
    enabled: !mustChangePassword,
  });
  const backupMutation = useMutation({
    mutationFn: () => api.post<BackupRecord>("/backups", { scope: "database" }),
    onSuccess: async () => {
      toast.push("备份任务已进入后台队列", "success");
      await queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法创建备份任务", "error"),
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => api.post<IntegrationStatus>(`/settings/integrations/${id}/test`),
    onSuccess: async (response) => {
      toast.push(
        response.data.status === "healthy" ? "连接验证成功" : "验证已完成，请检查状态",
        response.data.status === "healthy" ? "success" : "info",
      );
      await queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "连接验证失败", "error"),
  });
  const integrationItems = integrations.data ?? [];
  const backupItems = backups.data ?? [];

  if (mustChangePassword) {
    return (
      <>
        <PageHeader
          title="首次登录安全设置"
          description="更换临时密码后才能进入公司工作区"
          icon={LockKeyhole}
        />
        <p className="restore-boundary" role="status">
          <LockKeyhole aria-hidden="true" />
          当前账号使用临时凭据。除改密、查看会话和退出登录外，服务端已暂停其他操作。
        </p>
        <PasswordChangePanel />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="集成与备份"
        description="外部适配器状态、人工边界和恢复资产"
        icon={Settings}
      />
      <section className="settings-section">
        <header>
          <div>
            <PlugZap aria-hidden="true" />
            <h2>集成适配器</h2>
          </div>
          <span>模式与验证状态</span>
        </header>
        {integrations.isLoading ? (
          <Spinner />
        ) : integrations.isError ? (
          <ErrorState
            message={
              integrations.error instanceof ApiError
                ? integrations.error.message
                : "无法读取集成状态"
            }
            onRetry={() => void integrations.refetch()}
          />
        ) : (
          <div className="integration-list">
            {integrationItems.map((integration) => (
              <article key={integration.id}>
                <span className="integration-icon">
                  {integration.category === "storage" ? (
                    <CloudCog aria-hidden="true" />
                  ) : (
                    <PlugZap aria-hidden="true" />
                  )}
                </span>
                <div>
                  <div>
                    <h3>{integration.name}</h3>
                    <StatusBadge status={integration.status} />
                  </div>
                  <p>{integration.capabilities.join(" · ")}</p>
                  <small>
                    模式：{integration.mode} · 最近验证 {formatDateTime(integration.lastCheckedAt)}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => testMutation.mutate(integration.id)}
                  disabled={testMutation.isPending}
                  aria-label={`验证${integration.name}`}
                  title={`验证${integration.name}`}
                >
                  <RefreshCw aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <PasswordChangePanel />

      <section className="settings-section backup-section">
        <header>
          <div>
            <DatabaseBackup aria-hidden="true" />
            <h2>备份记录</h2>
          </div>
          <button
            type="button"
            className="button primary"
            onClick={() => backupMutation.mutate()}
            disabled={backupMutation.isPending}
          >
            <HardDriveDownload aria-hidden="true" />
            {backupMutation.isPending ? "正在入队…" : "创建数据库备份"}
          </button>
        </header>
        {backups.isLoading ? (
          <Spinner />
        ) : backups.isError ? (
          <ErrorState
            message={backups.error instanceof ApiError ? backups.error.message : "无法读取备份记录"}
          />
        ) : backupItems.length === 0 ? (
          <EmptyState title="暂无备份记录" />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>创建时间</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>完成时间</th>
                  <th>大小</th>
                  <th>校验和</th>
                </tr>
              </thead>
              <tbody>
                {backupItems.map((backup) => (
                  <tr key={backup.id}>
                    <td className="primary-cell">{formatDateTime(backup.createdAt)}</td>
                    <td>{backup.scope}</td>
                    <td>
                      <StatusBadge status={backup.status} />
                    </td>
                    <td>{formatDateTime(backup.completedAt)}</td>
                    <td>
                      {backup.sizeBytes ? `${(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"}
                    </td>
                    <td className="checksum">{backup.checksumSha256 ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="restore-boundary">
          <DatabaseBackup aria-hidden="true" />
          恢复必须由管理员在隔离环境运行恢复演练脚本；Web 端不直接覆盖当前数据库。
        </p>
      </section>
    </>
  );
}

function PasswordChangePanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ changed: boolean }>("/auth/change-password", {
        currentPassword,
        newPassword,
      }),
    onSuccess: async () => {
      const wasRequired = auth.user?.mustChangePassword === true;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.push("密码已更新，其他会话已撤销", "success");
      if (wasRequired) navigate("/", { replace: true });
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法更新密码", "error"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) {
      toast.push("两次输入的新密码不一致", "error");
      return;
    }
    mutation.mutate();
  };

  return (
    <section className="settings-section password-section">
      <header>
        <div>
          <LockKeyhole aria-hidden="true" />
          <h2>登录密码</h2>
        </div>
        <span>更新后撤销其他登录会话</span>
      </header>
      <form className="resource-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="current-password">当前密码</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label htmlFor="new-password">新密码</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={14}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>
          <div className="form-field full-width">
            <label htmlFor="confirm-password">确认新密码</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={14}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="button primary"
            disabled={mutation.isPending || newPassword.length < 14}
          >
            {mutation.isPending ? "正在更新…" : "更新密码"}
          </button>
        </div>
      </form>
    </section>
  );
}
