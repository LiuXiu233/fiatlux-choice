import type { ApiEnvelope, LoginResult, MfaLoginChallenge, PageMeta, UserSession } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export interface DownloadResult {
  blob: Blob;
  filename: string;
  contentSha256: string;
  itemCount: number;
}

function apiErrorFromPayload(
  payload: {
    error?: { message?: string; code?: string; details?: unknown };
    message?: string;
  } | null,
  status: number,
) {
  return new ApiError(
    payload?.error?.message ?? payload?.message ?? "请求未能完成",
    status,
    payload?.error?.code,
    payload?.error?.details,
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Requested-With", "FIAT-LUX-CHOICE");
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const init: RequestInit = {
    ...requestOptions,
    credentials: "include",
    headers,
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const response = await fetch(apiUrl(path), init);

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; code?: string; details?: unknown }; message?: string }
    | T
    | null;

  if (!response.ok) {
    const errorPayload = payload as {
      error?: { message?: string; code?: string; details?: unknown };
      message?: string;
    } | null;
    throw apiErrorFromPayload(errorPayload, response.status);
  }

  return payload as T;
}

export const api = {
  get<T>(path: string): Promise<ApiEnvelope<T>> {
    return request<ApiEnvelope<T>>(path);
  },
  post<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
    return request<ApiEnvelope<T>>(path, { method: "POST", body });
  },
  patch<T>(path: string, body?: unknown): Promise<ApiEnvelope<T>> {
    return request<ApiEnvelope<T>>(path, { method: "PATCH", body });
  },
  delete<T>(path: string): Promise<ApiEnvelope<T>> {
    return request<ApiEnvelope<T>>(path, { method: "DELETE" });
  },
  upload<T>(path: string, formData: FormData): Promise<ApiEnvelope<T>> {
    return request<ApiEnvelope<T>>(path, { method: "POST", body: formData });
  },
  async download(path: string, body: unknown): Promise<DownloadResult> {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "text/csv, application/x-ndjson",
        "Content-Type": "application/json",
        "X-Requested-With": "FIAT-LUX-CHOICE",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string; code?: string; details?: unknown };
        message?: string;
      } | null;
      throw apiErrorFromPayload(payload, response.status);
    }

    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filenameMatch = /filename="([^"\\/]+)"/i.exec(disposition);
    const itemCountHeader = response.headers.get("X-Audit-Event-Count");
    const itemCount = itemCountHeader === null ? undefined : Number(itemCountHeader);
    const contentSha256 = response.headers.get("X-Content-SHA256");
    if (!Number.isSafeInteger(itemCount) || (itemCount ?? -1) < 0) {
      throw new ApiError("导出响应缺少有效记录数", 502, "INTEGRITY_CHECK_FAILED");
    }
    if (!contentSha256 || !/^[a-f0-9]{64}$/.test(contentSha256)) {
      throw new ApiError("导出响应缺少有效 SHA-256", 502, "INTEGRITY_CHECK_FAILED");
    }
    if (!globalThis.crypto?.subtle) {
      throw new ApiError("当前浏览器无法验证导出文件完整性", 500, "INTEGRITY_CHECK_UNAVAILABLE");
    }
    const blob = await response.blob();
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const actualSha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (actualSha256 !== contentSha256) {
      throw new ApiError("导出文件 SHA-256 校验失败，文件未保存", 502, "INTEGRITY_CHECK_FAILED");
    }
    return {
      blob,
      filename: filenameMatch?.[1] ?? "fiatlux-export",
      contentSha256,
      itemCount: itemCount as number,
    };
  },
};

export function saveDownload(result: Pick<DownloadResult, "blob" | "filename">) {
  const href = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = result.filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await api.post<AuthPayload | MfaLoginChallenge>("/auth/login", {
    email,
    password,
  });
  if (!("user" in response.data)) {
    return { kind: "mfa_challenge", challenge: response.data };
  }
  return { kind: "session", session: normalizeSession(response.data) };
}

export async function verifyMfaLogin(code: string): Promise<UserSession> {
  const response = await api.post<AuthPayload>("/auth/mfa/verify", { code });
  return normalizeSession(response.data);
}

export async function logout(): Promise<void> {
  await api.post<void>("/auth/logout");
}

export async function getSession(): Promise<UserSession> {
  const response = await api.get<AuthPayload>("/auth/me");
  return normalizeSession(response.data);
}

interface AuthPayload {
  user: { id: string; email: string; displayName: string; status?: string };
  orgId: string;
  permissions: string[];
  role?: string;
  mustChangePassword: boolean;
  mfaEnabled?: boolean;
  mfaRequired?: boolean;
  mustSetupMfa?: boolean;
}

function normalizeSession(payload: AuthPayload): UserSession {
  const role = payload.role ?? (payload.permissions.includes("*") ? "owner" : "member");
  return {
    id: payload.user.id,
    orgId: payload.orgId,
    email: payload.user.email,
    displayName: payload.user.displayName,
    role,
    permissions: payload.permissions,
    mustChangePassword: payload.mustChangePassword,
    mfaEnabled: payload.mfaEnabled ?? false,
    mfaRequired: payload.mfaRequired ?? false,
    mustSetupMfa: payload.mustSetupMfa ?? false,
  };
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  category?: string;
}

export function queryString(query: ListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function normalizeMeta(meta: PageMeta | undefined, itemCount: number): PageMeta {
  if (!meta) return { page: 1, pageSize: itemCount || 20, total: itemCount, totalPages: 1 };
  return {
    ...meta,
    totalPages:
      meta.totalPages ?? meta.pageCount ?? Math.max(1, Math.ceil(meta.total / meta.pageSize)),
  };
}
