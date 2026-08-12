/**
 * Track A Frontend Iteration 1 — Frontend Error Contract（CTO Scale-Out Gate Required Hardening）
 *
 * 统一 API 响应/错误规范化：
 * - apiFetch<T>()：parse success envelope + parse structured error + 保留 HTTP status /
 *   后端 error.code / message + AbortSignal 支持。
 * - ApiClientError：结构化错误契约（status/code/message），禁止失败只降级为字符串。
 *
 * 原则：一套错误契约，两种调用模式（useListQuery 列表 / Detail Page 单条）。
 * 前端不自行发明业务错误码；后端 error.code 原样保留。
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
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
  error?: { code?: string; message?: string };
}

/**
 * 统一 fetch 包装：
 * - 非 2xx 或 success=false → throw ApiClientError（status/code/message 全保留）
 * - 成功 → 返回完整 envelope（data + meta，列表分页信息不丢失）
 */
export async function apiFetch<T>(
  input: string | URL,
  init?: RequestInit,
): Promise<ApiSuccessEnvelope<T>> {
  const res = await fetch(input, init);

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
    );
  }

  return body as ApiSuccessEnvelope<T>;
}
