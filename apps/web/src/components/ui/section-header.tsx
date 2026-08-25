/**
 * SectionHeader — 区块标题（FE 2.0 UI-01）
 *
 * 表单/详情页 Section 分组标题：14-16px semibold + 可选描述/右侧动作。
 * 规范：页面标题用 PageHeader（workspace），Section 内分组用本组件。
 */
'use client';

import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧操作区（新增行、批量动作等） */
  actions?: ReactNode;
  /** 标题档位：sm=14px / base=16px（默认 base） */
  size?: 'sm' | 'base';
  className?: string;
}

export function SectionHeader({
  title,
  description,
  actions,
  size = 'base',
  className = '',
}: SectionHeaderProps) {
  return (
    <div
      className={[
        'flex flex-wrap items-center justify-between gap-2',
        size === 'base' ? 'mb-3' : 'mb-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0">
        <h3
          className={
            size === 'base'
              ? 'text-ink-primary text-base font-semibold'
              : 'text-ink-primary text-sm font-semibold'
          }
        >
          {title}
        </h3>
        {description ? (
          <p className="text-ink-secondary mt-0.5 text-xs">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
