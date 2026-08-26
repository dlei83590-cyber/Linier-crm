/**
 * Button — 统一按钮（FE 2.0 UI-01）
 *
 * variants: primary（每页最多 1 个视觉 Primary）/ secondary / ghost / danger / link
 * sizes: sm / md / lg；loading 内置转圈；icon 前置插槽。
 * 兼容：旧常量（lib/ui-classes.ts BUTTON_*_CLASS）继续保留，存量页面迁移期不受影响。
 */
'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './skeleton';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700',
  secondary:
    'border border-border bg-surface text-ink-primary hover:bg-surface-hover active:bg-surface-active',
  ghost:
    'text-ink-secondary hover:bg-surface-hover hover:text-ink-primary active:bg-surface-active',
  danger:
    'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-700',
  link:
    'text-brand-600 underline-offset-4 hover:underline active:text-brand-700',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-md px-2.5 text-xs',
  md: 'h-10 gap-2 rounded-md px-4 text-sm',
  lg: 'h-11 gap-2 rounded-lg px-5 text-base',
};

const BASE_CLASS =
  'inline-flex items-center justify-center font-medium transition-colors duration-150 ease-out ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'select-none whitespace-nowrap';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 提交中：内置转圈 + 禁用，防止重复提交 */
  loading?: boolean;
  /** 前置图标（推荐 <Icon name="..." />） */
  icon?: ReactNode;
  /** 撑满父容器 */
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const resolvedDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={resolvedDisabled}
      className={[
        BASE_CLASS,
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth ? 'w-full' : '',
        loading ? 'cursor-wait' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4 shrink-0" /> : icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </button>
  );
}
