/**
 * EmptyState — 空态（Sprint8 U2.3 / FE 2.0 UI-01 升级）
 * 图标 + 标题 + 描述 + 可选操作；列表 EmptyRow 与页面级空态统一复用。
 * 签名向后兼容；新增 compact（紧凑内嵌于卡片/表格）与 tone（图标底色语义）。
 */
'use client';

import type { ReactNode } from 'react';
import type { StatusTone } from '@/components/design-system';
import { STATUS_COLORS } from '@/components/design-system';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  /** 自定义图标（推荐 h-6 w-6 的 SVG 或 <Icon name />）；缺省为「文档」图标 */
  icon?: ReactNode;
  action?: ReactNode;
  /** 图标底色语义（默认 neutral；仅改底色，不改文案语义） */
  tone?: StatusTone;
  /** 紧凑模式（嵌入卡片/表格内使用，缩小内边距与图标） */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title = "暂无数据",
  description,
  icon,
  action,
  tone = 'neutral',
  compact = false,
  className = "",
}: EmptyStateProps) {
  const c = STATUS_COLORS[tone];
  return (
    <div
      className={
        'flex flex-col items-center justify-center text-center ' +
        (compact ? 'px-4 py-6 ' : 'px-4 py-12 ') +
        className
      }
    >
      <div
        className={[
          'flex items-center justify-center rounded-full',
          compact ? 'mb-2 h-9 w-9' : 'mb-3 h-12 w-12',
        ].join(' ')}
        style={{ backgroundColor: c.bg, color: c.text }}
      >
        {icon ?? (
          <svg
            className={compact ? 'h-4 w-4' : 'h-6 w-6'}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        )}
      </div>
      <p className={compact ? 'text-sm font-medium text-ink-primary' : 'text-sm font-medium text-ink-primary'}>
        {title}
      </p>
      {description ? (
        <p className={'max-w-sm text-xs text-ink-muted ' + (compact ? 'mt-0.5 ' : 'mt-1 ')}>{description}</p>
      ) : null}
      {action ? <div className={compact ? 'mt-2.5' : 'mt-4'}>{action}</div> : null}
    </div>
  );
}
