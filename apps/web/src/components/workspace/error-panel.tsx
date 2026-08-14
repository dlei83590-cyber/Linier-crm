'use client';

/**
 * ErrorPanel — 统一错误面板（F2-1 UI System Foundation）
 *
 * 错误呈现契约（CTO Frontend Full UI Productization）：
 * - 400 → 校验错误
 * - 401 → Session（会话过期）
 * - 403 → 权限不足
 * - 404 → 不存在
 * - 409 → 冲突 / 版本过期
 * - 500 → 系统错误 + requestId
 * - 0 → 网络错误
 * 禁止显示 Prisma / SQL / stack；后端 error.code / requestId 原样透出。
 */
import type { ApiClientError } from '@/lib/api-client';
import { STATUS_COLORS } from '@/components/design-system';

export const ERROR_STATUS_MESSAGES: Record<number, string> = {
  400: '校验错误',
  401: '会话已过期，请重新登录',
  403: '权限不足',
  404: '资源不存在',
  409: '冲突或版本过期，请刷新后重试',
  500: '系统错误',
  0: '网络错误，请检查连接',
};

interface ErrorPanelProps {
  error: ApiClientError | null;
  /** 自定义标题（覆盖默认状态文案） */
  title?: string;
  onRetry?: () => void;
}

export function ErrorPanel({ error, title, onRetry }: ErrorPanelProps) {
  if (!error) return null;
  const message =
    title ?? ERROR_STATUS_MESSAGES[error.status] ?? `请求失败（HTTP ${error.status}）`;
  const c = STATUS_COLORS.danger;
  const showMeta = Boolean(error.code || error.requestId);

  return (
    <div
      role="alert"
      className="rounded-md border p-4"
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <p className="text-sm font-medium" style={{ color: c.text }}>
        {message}
      </p>
      {error.message && error.message !== message ? (
        <p className="mt-1 text-sm" style={{ color: c.text }}>
          {error.message}
        </p>
      ) : null}
      {showMeta ? (
        <p className="mt-1 text-xs opacity-80" style={{ color: c.text }}>
          {error.code ? `错误码：${error.code}` : null}
          {error.code && error.requestId ? '　' : null}
          {error.requestId ? `requestId：${error.requestId}` : null}
        </p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="border-border bg-surface text-ink-primary mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
