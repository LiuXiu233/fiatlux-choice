import type { ApiEnvelope, PageMeta, UserSession } from "./types";

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
    throw new ApiError(
      errorPayload?.error?.message ?? errorPayload?.message ?? "请求未能完成",
      response.status,
      errorPayload?.error?.code,
      errorPayload?.error?.details,
    );
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
};

export async function login(email: string, password: string): Promise<UserSession> {
  const response = await api.post<AuthPayload>("/auth/login", { email, password });
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
  mustChangePassword?: boolean;
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
    ...(payload.mustChangePassword !== undefined
      ? { mustChangePassword: payload.mustChangePassword }
      : {}),
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
