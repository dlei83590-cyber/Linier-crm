/**
 * Badge — 通用徽章（FE 2.0 UI-01）
 *
 * 纯展示标签（非业务状态）；业务状态请用 workspace StatusBadge（保留真实 enum key）。
 * tone 对齐 status-* tokens：neutral/info/success/warning/danger；可选前置圆点/图标。
 */
'use client';

import type { ReactNode } from 'react';
import type { StatusTone } from '@/components/design-system';
import { STATUS_COLORS } from '@/components/design-system';

export type BadgeTone = StatusTone;

export type BadgeSize = 'sm' | 'md';

const SIZE_CLASS: Record<BadgeSize, string> = {
  sm: 'gap-1 px-2 py-0.5 text-xs',
  md: 'gap-1.5 px-2.5 py-0.5 text-xs',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  /** 前置状态圆点 */
  dot?: boolean;
  /** 前置图标 */
  icon?: ReactNode;
  className?: string;
}

export function Badge({
  children,
  tone = 'neutral',
  size = 'sm',
  dot = false,
  icon,
  className = '',
}: BadgeProps) {
  const c = STATUS_COLORS[tone];
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border font-medium',
        SIZE_CLASS[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {dot ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: c.text }}
          aria-hidden="true"
        />
      ) : null}
      {icon ? <span className="shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}
