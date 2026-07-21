import { ArrowLeft, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { SessionConnectionState, useAuth } from "../lib/auth";
import { buildInfo, formatBuildIdentity } from "../lib/build-info";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (auth.isOffline || auth.needsSessionRefresh || auth.hasSessionConnectionError) {
    return <SessionConnectionState />;
  }

  if (auth.isLoading) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <img src="/fiatlux-logo.jpg" alt="FIAT LUX" />
        <span>正在验证会话…</span>
      </div>
    );
  }

  if (auth.user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (auth.mfaChallenge) {
        await auth.verifyMfa(verificationCode.trim());
      } else {
        const result = await auth.login(email.trim(), password);
        if (result.kind === "mfa_challenge") {
          setPassword("");
          return;
        }
      }
      const state = location.state as { from?: string } | null;
      navigate(state?.from ?? "/", { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "暂时无法登录，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand" aria-label="FIAT LUX CHOICE">
        <img src="/fiatlux-logo.jpg" alt="FIAT LUX 标志" />
        <div>
          <span>FIAT LUX</span>
          <strong>CHOICE</strong>
          <p>耀光电竞经营工作区</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-heading">
          <span className="login-lock">
            {auth.mfaChallenge ? (
              <ShieldCheck aria-hidden="true" />
            ) : (
              <LockKeyhole aria-hidden="true" />
            )}
          </span>
          <h1>{auth.mfaChallenge ? "安全验证" : "登录"}</h1>
          <p>{auth.mfaChallenge ? "完成第二重身份验证" : "仅限获授权成员"}</p>
        </div>
        <form onSubmit={submit} className="login-form">
          {auth.mfaChallenge ? (
            <>
              <p className="mfa-login-guidance">
                输入验证器生成的 6 位代码；无法使用验证器时，可输入一枚未使用的恢复码。
              </p>
              <div className="login-field">
                <label htmlFor="login-mfa-code">验证器代码或恢复码</label>
                <input
                  id="login-mfa-code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.toUpperCase())}
                  required
                />
              </div>
              <small className="mfa-challenge-expiry">
                本次验证窗口截至
                {new Date(auth.mfaChallenge.challengeExpiresAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </small>
            </>
          ) : (
            <>
              <div className="login-field">
                <label htmlFor="login-email">邮箱</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="login-field">
                <label htmlFor="login-password">密码</label>
                <span className="password-input">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    title={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </span>
              </div>
            </>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="button primary login-submit" disabled={busy}>
            {busy ? "正在验证…" : auth.mfaChallenge ? "验证并进入工作区" : "进入工作区"}
          </button>
          {auth.mfaChallenge ? (
            <button
              type="button"
              className="button secondary mfa-login-back"
              onClick={() => {
                auth.cancelMfaChallenge();
                setVerificationCode("");
                setError("");
              }}
              disabled={busy}
            >
              <ArrowLeft aria-hidden="true" />
              重新输入邮箱和密码
            </button>
          ) : null}
        </form>
        <footer>
          <span>耀光（广州）电子竞技有限公司</span>
          <span className="login-build-identity" data-testid="login-build-identity">
            {formatBuildIdentity(buildInfo)}
          </span>
        </footer>
      </section>
    </main>
  );
}
