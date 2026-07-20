import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api, saveDownload } from "../lib/api";
import { formatChinaDateInput } from "../lib/china-time";
import { useToast } from "./ui";

export const AUDIT_EXPORT_ACKNOWLEDGEMENT = "INTERNAL_AUDIT_EXPORT_ACKNOWLEDGED";

function initialDateRange(now = new Date()) {
  return {
    from: formatChinaDateInput(new Date(now.getTime() - 6 * 86_400_000)),
    to: formatChinaDateInput(now),
  };
}

export function AuditExportForm({ onClose }: { onClose: () => void }) {
  const defaults = initialDateRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [format, setFormat] = useState<"csv" | "ndjson">("csv");
  const [resourceType, setResourceType] = useState("");
  const [action, setAction] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      api.download("/audit-events/export", {
        from,
        to,
        format,
        ...(resourceType.trim() ? { resourceType: resourceType.trim() } : {}),
        ...(action.trim() ? { action: action.trim() } : {}),
        acknowledgement: AUDIT_EXPORT_ACKNOWLEDGEMENT,
      }),
    onSuccess: async (result) => {
      saveDownload(result);
      toast.push(
        `已生成并校验 ${result.itemCount} 条审计记录；文件 SHA-256 已写入审计日志`,
        "success",
      );
      await queryClient.invalidateQueries({ queryKey: ["resource", "audit-events"] });
      onClose();
    },
    onError: (error) =>
      toast.push(error instanceof ApiError ? error.message : "无法生成审计导出", "error"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!acknowledged) return;
    mutation.mutate();
  };

  return (
    <form className="resource-form" onSubmit={submit}>
      <p className="confirm-description">
        导出包含操作者、前后值、IP 和浏览器标识等内部数据。单次最多 31 个北京时间自然日、10,000 条和
        25 MB；超过任一上限会整体拒绝，不会静默截断。
      </p>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="audit-export-from">开始日期（北京时间）</label>
          <input
            id="audit-export-from"
            type="date"
            required
            max={to}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="audit-export-to">结束日期（北京时间，含当天）</label>
          <input
            id="audit-export-to"
            type="date"
            required
            min={from}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="audit-export-format">文件格式</label>
          <select
            id="audit-export-format"
            value={format}
            onChange={(event) => setFormat(event.target.value as "csv" | "ndjson")}
          >
            <option value="csv">CSV（电子表格兼容）</option>
            <option value="ndjson">NDJSON（逐行机器处理）</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="audit-export-resource-type">对象类型（可选）</label>
          <input
            id="audit-export-resource-type"
            maxLength={100}
            value={resourceType}
            onChange={(event) => setResourceType(event.target.value)}
            placeholder="例如 contracts"
          />
        </div>
        <div className="form-field full-width">
          <label htmlFor="audit-export-action">动作（可选）</label>
          <input
            id="audit-export-action"
            maxLength={100}
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="例如 update"
          />
        </div>
        <label className="checkbox-field full-width" htmlFor="audit-export-acknowledgement">
          <input
            id="audit-export-acknowledgement"
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>我确认只在获授权的内部范围保存和传递该文件，并按公司规则保护及销毁副本。</span>
        </label>
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
          disabled={mutation.isPending || !from || !to || from > to || !acknowledged}
        >
          {mutation.isPending ? "正在生成…" : "生成并下载"}
        </button>
      </div>
    </form>
  );
}
