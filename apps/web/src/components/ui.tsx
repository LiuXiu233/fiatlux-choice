import { clsx } from "clsx";
import { AlertTriangle, Inbox, LoaderCircle, X } from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { statusLabels } from "../lib/resources";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx("status-badge", `status-${status}`)}>
      {statusLabels[status] ?? status}
    </span>
  );
}

export function Spinner({ label = "正在加载" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox aria-hidden="true" />
      <h3>{title}</h3>
      {detail ? <p>{detail}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <strong>加载失败</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="button secondary" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  size = "medium",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "small" | "medium" | "large";
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={clsx("modal", `modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

interface ToastContextValue {
  push: (message: string, tone?: ToastItem["tone"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: ToastItem["tone"] = "info") => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setItems((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <div key={item.id} className={clsx("toast", `toast-${item.tone}`)}>
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}

export function ConfirmForm({
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm();
  };
  return (
    <form onSubmit={submit}>
      <p className="confirm-description">{description}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button type="submit" className={clsx("button", danger && "danger")} disabled={busy}>
          {busy ? "处理中…" : confirmLabel}
        </button>
      </div>
    </form>
  );
}
