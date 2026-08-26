/**
 * IconButton — 纯图标按钮（FE 2.0 UI-01）
 *
 * 表格行操作 / 工具栏图标动作专用；方形、可 hover 底色、统一 focus ring。
 * 无障碍：必须提供 aria-label（或 title），否则 lint 报错。
 */
'use client';

import type { ButtonHTMLAttributes } from 'react';
import type { IconName } from './icon';
import { Icon } from './icon';
import { Spinner } from './skeleton';

export type IconButtonVariant = 'secondary' | 'ghost' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  secondary:
    'border border-border bg-surface text-ink-secondary hover:bg-surface-hover hover:text-ink-primary active:bg-surface-active',
  ghost: 'text-ink-secondary hover:bg-surface-hover hover:text-ink-primary active:bg-surface-active',
  danger: 'text-ink-secondary hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100',
};

const SIZE_CLASS: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-11 w-11',
};

const ICON_SIZE: Record<IconButtonSize, number> = { sm: 16, md: 18, lg: 20 };

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  loading?: boolean;
  /** 无障碍标签（必须） */
  'aria-label': string;
}

export function IconButton({
  icon,
  variant = 'ghost',
  size = 'sm',
  loading = false,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const resolvedDisabled = disabled || loading;
  return (
    <button
      type={type}
      disabled={resolvedDisabled}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 ease-out',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : <Icon name={icon} size={ICON_SIZE[size]} />}
    </button>
  );
}
