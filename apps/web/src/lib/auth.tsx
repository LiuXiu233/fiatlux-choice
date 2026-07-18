import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, RefreshCw } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError, getSession, login, logout } from "./api";
import type { UserSession } from "./types";

interface AuthContextValue {
  user: UserSession | null;
  isLoading: boolean;
  isOffline: boolean;
  isRetryingSession: boolean;
  needsSessionRefresh: boolean;
  hasSessionConnectionError: boolean;
  login: (email: string, password: string) => Promise<UserSession>;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const initiallyOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const [isOffline, setIsOffline] = useState(initiallyOffline);
  const [needsSessionRefresh, setNeedsSessionRefresh] = useState(initiallyOffline);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    retry: (attempt, error) => !(error instanceof ApiError && error.status === 401) && attempt < 2,
    staleTime: 60_000,
  });
  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
  });
  const logoutMutation = useMutation({ mutationFn: logout });
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;
  const hasSessionConnectionError = session.isError && !unauthorized;

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setNeedsSessionRefresh(true);
    };
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const value: AuthContextValue = {
    user: unauthorized ? null : (session.data ?? null),
    isLoading: session.isLoading,
    isOffline,
    isRetryingSession: session.isFetching,
    needsSessionRefresh,
    hasSessionConnectionError,
    async login(email, password) {
      const user = await loginMutation.mutateAsync({ email, password });
      queryClient.setQueryData(["session"], user);
      setNeedsSessionRefresh(false);
      return user;
    },
    async logout() {
      await logoutMutation.mutateAsync();
      queryClient.clear();
    },
    async retrySession() {
      if (!navigator.onLine) {
        setIsOffline(true);
        return;
      }

      const result = await session.refetch();
      const isUnauthorized = result.error instanceof ApiError && result.error.status === 401;
      if (result.isSuccess || isUnauthorized) {
        setNeedsSessionRefresh(false);
      }
    },
    can(permission) {
      const user = unauthorized ? null : session.data;
      const separator = permission.indexOf(":");
      const wildcard = separator === -1 ? "" : `${permission.slice(0, separator)}:*`;
      return Boolean(
        user &&
          (user.role === "owner" ||
            user.permissions.includes("*") ||
            user.permissions.includes(permission) ||
            (wildcard && user.permissions.includes(wildcard))),
      );
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}

export function SessionConnectionState() {
  const auth = useAuth();
  const title = auth.isOffline
    ? "当前无网络连接"
    : auth.hasSessionConnectionError
      ? "暂时无法连接服务"
      : "需要重新验证会话";
  const description = auth.isOffline
    ? "工作区内容与登录表单已隐藏。网络恢复后，请重新验证会话。"
    : auth.hasSessionConnectionError
      ? "会话状态无法确认，工作区内容与登录表单将继续隐藏。"
      : "网络已恢复，请确认当前会话后继续。";

  return (
    <main className="session-connection-page">
      <section className="session-connection-panel" aria-live="polite">
        <div className="session-connection-brand">
          <img src="/fiatlux-logo.jpg" alt="FIAT LUX" />
          <strong>FIAT LUX CHOICE</strong>
        </div>
        <span className="session-connection-icon" aria-hidden="true">
          <CloudOff />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <button
          type="button"
          className="button primary session-retry"
          onClick={() => void auth.retrySession()}
          disabled={auth.isOffline || auth.isRetryingSession}
        >
          <RefreshCw aria-hidden="true" />
          {auth.isRetryingSession ? "正在重试…" : "重试"}
        </button>
      </section>
    </main>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isOffline || auth.needsSessionRefresh || auth.hasSessionConnectionError) {
    return <SessionConnectionState />;
  }

  if (auth.isLoading) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <img src="/fiatlux-logo.jpg" alt="FIAT LUX" />
        <span>正在连接工作区…</span>
      </div>
    );
  }

  if (!auth.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
