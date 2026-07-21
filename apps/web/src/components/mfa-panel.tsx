import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, RotateCcw, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";

import { ApiError, api } from "../lib/api";
import { useToast } from "./ui";

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  mustSetup: boolean;
  setupPending: boolean;
  setupExpiresAt: string | null;
  recoveryCodesRemaining: number;
  canDisable: boolean;
}

interface MfaSetup {
  secret: string;
  otpAuthUri: string;
  algorithm: "SHA256";
  digits: 6;
  periodSeconds: 30;
  setupExpiresAt: string;
}

interface RecoveryCodeResult {
  recoveryCodes: string[];
  revokedOtherSessions: number;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function recoveryCodeDocument(codes: string[]) {
  return [
    "FIAT LUX CHOICE — MFA 恢复码",
    `生成时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    ...codes,
    "",
    "每枚恢复码只能使用一次。请离线保存，不要上传到公司文件库或聊天工具。",
  ].join("\n");
}

export function MfaPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesSaved, setRecoveryCodesSaved] = useState(false);

  useEffect(() => {
    if (recoveryCodes.length === 0) return;
    const protectOneTimeCodes = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectOneTimeCodes);
    return () => window.removeEventListener("beforeunload", protectOneTimeCodes);
  }, [recoveryCodes.length]);

  const status = useQuery({
    queryKey: ["mfa-status"],
    queryFn: async () => (await api.get<MfaStatus>("/auth/mfa/status")).data,
  });
  const startSetup = useMutation({
    mutationFn: async () =>
      (
        await api.post<MfaSetup>("/auth/mfa/setup", {
          confirmation: "START_MFA_ENROLLMENT",
        })
      ).data,
    onSuccess: async (result) => {
      const dataUrl = await QRCode.toDataURL(result.otpAuthUri, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      });
      setSetup(result);
      setQrDataUrl(dataUrl);
      setConfirmationCode("");
      toast.push("已生成新的验证器密钥，请在有效期内完成确认", "info");
      await queryClient.invalidateQueries({ queryKey: ["mfa-status"] });
    },
    onError: (error) => toast.push(errorMessage(error, "无法开始 MFA 登记"), "error"),
  });
  const confirmSetup = useMutation({
    mutationFn: async () =>
      (
        await api.post<RecoveryCodeResult & { enabled: true }>("/auth/mfa/confirm", {
          code: confirmationCode,
        })
      ).data,
    onSuccess: async (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesSaved(false);
      setConfirmationCode("");
      setSetup(null);
      setQrDataUrl("");
      toast.push("多因素认证已启用，其他会话已撤销", "success");
      await queryClient.invalidateQueries({ queryKey: ["mfa-status"] });
    },
    onError: (error) => toast.push(errorMessage(error, "无法确认 MFA 登记"), "error"),
  });
  const regenerateCodes = useMutation({
    mutationFn: async () =>
      (
        await api.post<RecoveryCodeResult>("/auth/mfa/recovery-codes", {
          code: stepUpCode,
          confirmation: "REPLACE_MFA_RECOVERY_CODES",
        })
      ).data,
    onSuccess: async (result) => {
      setRecoveryCodes(result.recoveryCodes);
      setRecoveryCodesSaved(false);
      setStepUpCode("");
      toast.push("旧恢复码已全部失效，其他会话已撤销", "success");
      await queryClient.invalidateQueries({ queryKey: ["mfa-status"] });
    },
    onError: (error) => toast.push(errorMessage(error, "无法重新生成恢复码"), "error"),
  });
  const disableMfa = useMutation({
    mutationFn: () =>
      api.post<{ disabled: true }>("/auth/mfa/disable", {
        currentPassword: disablePassword,
        code: stepUpCode,
        confirmation: "DISABLE_MFA",
      }),
    onSuccess: async () => {
      setDisablePassword("");
      setStepUpCode("");
      setRecoveryCodes([]);
      toast.push("多因素认证已停用，其他会话已撤销", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mfa-status"] }),
        queryClient.invalidateQueries({ queryKey: ["session"] }),
      ]);
    },
    onError: (error) => toast.push(errorMessage(error, "无法停用 MFA"), "error"),
  });

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.push(message, "success");
    } catch {
      toast.push("浏览器未允许复制，请手动选择文本", "error");
    }
  };
  const downloadRecoveryCodes = () => {
    const blob = new Blob([recoveryCodeDocument(recoveryCodes)], {
      type: "text/plain;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `fiatlux-choice-mfa-recovery-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(href);
    setRecoveryCodesSaved(true);
  };
  const finishRecoveryCodeHandoff = async () => {
    setRecoveryCodes([]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mfa-status"] }),
      queryClient.invalidateQueries({ queryKey: ["session"] }),
    ]);
  };

  if (status.isLoading) {
    return (
      <section className="settings-section mfa-section" aria-busy="true">
        <header>
          <div>
            <ShieldCheck aria-hidden="true" />
            <h2>多因素认证</h2>
          </div>
          <span>正在读取安全状态…</span>
        </header>
      </section>
    );
  }
  if (status.isError || !status.data) {
    return (
      <section className="settings-section mfa-section">
        <header>
          <div>
            <ShieldCheck aria-hidden="true" />
            <h2>多因素认证</h2>
          </div>
        </header>
        <p className="form-error" role="alert">
          {errorMessage(status.error, "无法读取 MFA 状态")}
        </p>
        <button type="button" className="button secondary" onClick={() => void status.refetch()}>
          重试
        </button>
      </section>
    );
  }

  const mfa = status.data;
  return (
    <section className="settings-section mfa-section">
      <header>
        <div>
          <ShieldCheck aria-hidden="true" />
          <h2>多因素认证</h2>
        </div>
        <span className={mfa.enabled ? "mfa-status-enabled" : "mfa-status-disabled"}>
          {mfa.enabled ? "已启用" : mfa.required ? "必须登记" : "未启用"}
        </span>
      </header>

      {recoveryCodes.length > 0 ? (
        <div className="mfa-recovery-sheet" role="status" aria-live="polite">
          <h3>立即离线保存恢复码</h3>
          <p>
            这是服务器唯一一次显示这些明文恢复码。每枚只能使用一次，请勿保存到本系统、聊天工具或未加密云盘。
          </p>
          <ol>
            {recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
          <div className="mfa-recovery-actions">
            <button type="button" className="button secondary" onClick={downloadRecoveryCodes}>
              <Download aria-hidden="true" />
              下载文本文件
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                void copyText(recoveryCodeDocument(recoveryCodes), "恢复码已复制，请立即离线保存")
              }
            >
              <Copy aria-hidden="true" />
              复制全部
            </button>
          </div>
          <label className="mfa-saved-confirmation">
            <input
              type="checkbox"
              checked={recoveryCodesSaved}
              onChange={(event) => setRecoveryCodesSaved(event.target.checked)}
            />
            我已将恢复码保存到独立、离线且受保护的位置
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!recoveryCodesSaved}
            onClick={() => void finishRecoveryCodeHandoff()}
          >
            完成并隐藏恢复码
          </button>
        </div>
      ) : null}

      {!mfa.enabled && !setup ? (
        <div className="mfa-introduction">
          <p>
            使用支持 SHA-256 TOTP 的验证器（如 2FAS、Aegis、Microsoft Authenticator 或
            1Password）为密码登录增加第二道保护。
          </p>
          {mfa.setupPending ? (
            <p className="field-hint">上一次登记尚未确认；重新开始会立即替换旧密钥。</p>
          ) : null}
          <button
            type="button"
            className="button primary"
            disabled={startSetup.isPending}
            onClick={() => startSetup.mutate()}
          >
            <KeyRound aria-hidden="true" />
            {startSetup.isPending ? "正在生成…" : mfa.setupPending ? "重新开始登记" : "开始登记"}
          </button>
        </div>
      ) : null}

      {setup ? (
        <div className="mfa-setup-grid">
          <div className="mfa-qr-card">
            {qrDataUrl ? <img src={qrDataUrl} alt="验证器登记二维码" /> : null}
            <small>
              算法 {setup.algorithm} · {setup.digits} 位 · 每 {setup.periodSeconds} 秒
            </small>
          </div>
          <div className="mfa-setup-instructions">
            <h3>1. 扫描二维码或手动输入密钥</h3>
            <div className="mfa-secret-row">
              <code>{setup.secret}</code>
              <button
                type="button"
                className="icon-button"
                aria-label="复制验证器密钥"
                title="复制验证器密钥"
                onClick={() => void copyText(setup.secret, "验证器密钥已复制")}
              >
                <Copy aria-hidden="true" />
              </button>
            </div>
            <p className="field-hint">
              登记窗口将在 {new Date(setup.setupExpiresAt).toLocaleString("zh-CN")} 失效。
            </p>
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                confirmSetup.mutate();
              }}
            >
              <label htmlFor="mfa-confirm-code">2. 输入验证器当前显示的 6 位代码</label>
              <input
                id="mfa-confirm-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={confirmationCode}
                onChange={(event) =>
                  setConfirmationCode(event.target.value.replace(/\D/gu, "").slice(0, 6))
                }
                required
              />
              <button
                type="submit"
                className="button primary"
                disabled={confirmSetup.isPending || confirmationCode.length !== 6}
              >
                {confirmSetup.isPending ? "正在确认…" : "确认并启用"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {mfa.enabled && recoveryCodes.length === 0 ? (
        <div className="mfa-enabled-controls">
          <p>
            当前还有 <strong>{mfa.recoveryCodesRemaining}</strong>{" "}
            枚未使用恢复码。重新生成后，旧恢复码将全部立即失效。
          </p>
          <form
            className="mfa-step-up-form"
            onSubmit={(event) => {
              event.preventDefault();
              regenerateCodes.mutate();
            }}
          >
            <div className="form-field">
              <label htmlFor="mfa-step-up-code">验证器代码或未使用的恢复码</label>
              <input
                id="mfa-step-up-code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value.toUpperCase())}
                required
              />
            </div>
            <button type="submit" className="button secondary" disabled={regenerateCodes.isPending}>
              <RotateCcw aria-hidden="true" />
              {regenerateCodes.isPending ? "正在替换…" : "替换全部恢复码"}
            </button>
          </form>

          {mfa.canDisable ? (
            <details className="mfa-disable-details">
              <summary>停用多因素认证</summary>
              <p>停用会删除密钥和恢复码，并撤销其他会话。</p>
              <form
                className="mfa-step-up-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  disableMfa.mutate();
                }}
              >
                <div className="form-field">
                  <label htmlFor="mfa-disable-password">当前密码</label>
                  <input
                    id="mfa-disable-password"
                    type="password"
                    autoComplete="current-password"
                    value={disablePassword}
                    onChange={(event) => setDisablePassword(event.target.value)}
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="button danger"
                  disabled={disableMfa.isPending || !stepUpCode || !disablePassword}
                >
                  <ShieldOff aria-hidden="true" />
                  {disableMfa.isPending ? "正在停用…" : "确认停用"}
                </button>
              </form>
            </details>
          ) : mfa.required ? (
            <p className="restore-boundary">
              <ShieldCheck aria-hidden="true" />
              当前角色强制使用 MFA，不能在 Web 端停用；紧急恢复必须走离线 owner 恢复与人工审批流程。
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
