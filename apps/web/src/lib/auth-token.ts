/**
 * Frontend Auth Transport Contract Repair（P0，CTO 16:02 指令）
 *
 * 统一认证来源：Session（session-context）与统一 API transport（apiFetch）
 * 共用同一个 localStorage token key 与读写/清除 helper。
 * - 禁止各页面自行 localStorage.getItem() 复制认证逻辑；
 * - 禁止 silent retry 401；
 * - 401 统一收敛：apiFetch 只 dispatch AUTH_UNAUTHORIZED_EVENT，
 *   SessionProvider 统一监听并清 token + 置 unauthenticated ——
 *   收敛集中处理，不让每个 List/Edit 页各自实现。
 */

export const TOKEN_KEY = "linier_crm_token";

export const AUTH_UNAUTHORIZED_EVENT = "auth:unauthorized";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

/** 401 统一收敛信号：由 apiFetch 发出，SessionProvider 监听后清 token + 置 unauthenticated */
export function notifyUnauthorized(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}
