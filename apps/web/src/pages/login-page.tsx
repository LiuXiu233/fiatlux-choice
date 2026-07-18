import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { SessionConnectionState, useAuth } from "../lib/auth";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      await auth.login(email.trim(), password);
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
            <LockKeyhole aria-hidden="true" />
          </span>
          <h1>登录</h1>
          <p>仅限获授权成员</p>
        </div>
        <form onSubmit={submit} className="login-form">
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
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="button primary login-submit" disabled={busy}>
            {busy ? "正在验证…" : "进入工作区"}
          </button>
        </form>
        <footer>耀光（广州）电子竞技有限公司</footer>
      </section>
    </main>
  );
}
