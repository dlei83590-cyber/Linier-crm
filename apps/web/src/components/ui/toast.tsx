'use client';

/**
 * Toast — 全局操作反馈系统（Sprint8 U2.1 / FE 2.0 UI-01 升级）
 *
 * - ToastProvider 挂载于 RootLayout；页面通过 useToast() 消费
 * - success/error/info/warning 四态；右上堆叠、自动消失（error 6s，其余 4s）
 * - 点击关闭；aria-live 播报（error → assertive，其余 → polite）
 * - 进出场动画（animate-toast-in）；prefers-reduced-motion 由 globals.css 全局降级
 * - API 签名不变（UI-01 只做视觉/无障碍升级，零行为破坏）
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icon';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
}

export interface ToastContextValue {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLE: Record<
  ToastVariant,
  { accent: string; iconBg: string; iconColor: string; icon: IconName }
> = {
  success: {
    accent: 'bg-status-success-text',
    iconBg: 'bg-status-success-bg',
    iconColor: 'text-status-success-text',
    icon: 'check-circle',
  },
  error: {
    accent: 'bg-status-danger-text',
    iconBg: 'bg-status-danger-bg',
    iconColor: 'text-status-danger-text',
    icon: 'x-circle',
  },
  info: {
    accent: 'bg-status-info-text',
    iconBg: 'bg-status-info-bg',
    iconColor: 'text-status-info-text',
    icon: 'info',
  },
  warning: {
    accent: 'bg-status-warning-text',
    iconBg: 'bg-status-warning-bg',
    iconColor: 'text-status-warning-text',
    icon: 'alert-triangle',
  },
};

const DURATION: Record<ToastVariant, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
  warning: 5000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-4), { id, variant, title, description }]);
      window.setTimeout(() => dismiss(id), DURATION[variant]);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (title: string, description?: string) => push('success', title, description),
      error: (title: string, description?: string) => push('error', title, description),
      info: (title: string, description?: string) => push('info', title, description),
      warning: (title: string, description?: string) => push('warning', title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 top-16 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((t) => {
          const s = VARIANT_STYLE[t.variant];
          return (
            <div
              key={t.id}
              role={t.variant === 'error' ? 'alert' : 'status'}
              className="animate-toast-in pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border border-border bg-surface py-3 pl-4 pr-9 shadow-elevation-lg"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${s.accent}`} aria-hidden="true" />
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.iconBg} ${s.iconColor}`}
                aria-hidden="true"
              >
                <Icon name={s.icon} size={14} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink-primary text-sm font-medium">{t.title}</p>
                {t.description ? (
                  <p className="text-ink-secondary mt-0.5 break-words text-xs">{t.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="关闭提示"
                className="text-ink-muted hover:text-ink-primary absolute right-2 top-2 rounded p-1 transition-colors hover:bg-slate-100"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return ctx;
}
