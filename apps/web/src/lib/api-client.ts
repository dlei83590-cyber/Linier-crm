/**
 * Track A Frontend Iteration 1 — Frontend Error Contract（CTO Scale-Out Gate Required Hardening）
 *
 * 统一 API 响应/错误规范化：
 * - apiFetch<T>()：parse success envelope + parse structured error + 保留 HTTP status /
 *   后端 error.code / message + AbortSignal 支持。
 * - ApiClientError：结构化错误契约（status/code/message），禁止失败只降级为字符串。
 * - 统一认证传输（CTO 16:02 P0 Auth Transport Contract Repair）：same-origin /api/* 请求
 *   自动附加当前 Bearer token（同一来源 lib/auth-token）；401 → dispatch
 *   AUTH_UNAUTHORIZED_EVENT（由 SessionProvider 统一收敛），不 silent retry。
 *
 * 原则：一套错误契约，两种调用模式（useListQuery 列表 / Detail Page 单条）。
 * 前端不自行发明业务错误码；后端 error.code 原样保留。
 */

import { getAuthToken, notifyUnauthorized } from "@/lib/auth-token";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** 共享层必须能区分的 HTTP 状态分类（401/403/404/409/422/500；0=网络层失败） */
export const HTTP_STATUS_LABELS: Record<number, string> = {
  0: "网络错误",
  401: "未认证或会话已过期",
  403: "无权限访问",
  404: "资源不存在",
  409: "业务/状态/版本冲突",
  422: "输入校验失败",
  500: "系统故障",
};

export function describeStatus(status: number): string {
  return HTTP_STATUS_LABELS[status] ?? `HTTP ${status}`;
}

export interface ApiPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** 成功 envelope：{ success: true, data, meta? }（与后端 lib/api/response.ts ok() 对齐） */
export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: ApiPaginationMeta;
}

interface ApiFailureShape {
  success?: boolean;
  error?: { code?: string; message?: string; details?: { requestId?: string } };
}

/** 判断是否 same-origin /api/* 请求（仅这类请求统一附加 Bearer token） */
function isSameOriginApiRequest(input: string | URL): boolean {
  if (typeof window === "undefined") return false;
  const url = typeof input === "string" ? new URL(input, window.location.origin) : input;
  return url.origin === window.location.origin && url.pathname.startsWith("/api/");
}

/**
 * 统一 fetch 包装：
 * - 非 2xx 或 success=false → throw ApiClientError（status/code/message 全保留）
 * - 成功 → 返回完整 envelope（data + meta，列表分页信息不丢失）
 * - same-origin /api/* 请求自动附加当前 Bearer token（同一认证来源 lib/auth-token）
 * - 401 → dispatch AUTH_UNAUTHORIZED_EVENT（SessionProvider 统一清 token + 置 unauthenticated），
 *   不 silent retry、不在此清 token
 */
export async function apiFetch<T>(
  input: string | URL,
  init?: RequestInit,
): Promise<ApiSuccessEnvelope<T>> {
  const headers = new Headers(init?.headers);
  const token = getAuthToken();
  if (token && isSameOriginApiRequest(input) && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    notifyUnauthorized();
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    // 非 JSON 响应（代理错误等）：raw 保持 null
  }

  const body = raw as (ApiFailureShape & { data?: T; meta?: ApiPaginationMeta }) | null;

  if (!res.ok || !body || body.success !== true) {
    throw new ApiClientError(
      res.status,
      body?.error?.message ?? `请求失败（${res.status}）`,
      body?.error?.code,
      body?.error?.details?.requestId,
    );
  }

  return body as ApiSuccessEnvelope<T>;
}

/**
 * F2-2 UX Hardening ②（CTO #11660）— 版本冲突（CAS）判定
 *
 * 409 VERSION_CONFLICT ≠ 普通 400：当前页面数据已 stale，
 * 继续在旧表单上编辑可能再次失败。禁止 silent retry / 自动覆盖 / 自动重新 PATCH。
 */
export function isVersionConflict(error: ApiClientError | null | undefined): boolean {
  return error?.status === 409;
}
