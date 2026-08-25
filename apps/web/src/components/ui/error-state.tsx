/**
 * ErrorState — 错误态（FE 2.0 UI-01）
 *
 * 图标 + 标题 + 描述 + Retry（页面级/区块级错误呈现）。
 * 规范：错误不伪装成空态——ErrorState 与 EmptyState 语义分离；
 * 结构化错误（status/code/requestId）建议用 workspace ErrorPanel。
 */
'use client';

import type { ReactNode } from 'react';
import { Button } from './button';
import { Icon } from './icon';

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** 自定义图标（默认 alert-circle） */
  icon?: ReactNode;
  /** 重试回调（提供则显示 Retry 按钮） */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = '加载失败',
  description,
  icon,
  onRetry,
  retryLabel = '重试',
  className = '',
}: ErrorStateProps) {
  return (
    <div className={'flex flex-col items-center justify-center px-4 py-12 text-center ' + className}>
      <div className="text-status-danger-text mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-status-danger-bg">
        {icon ?? <Icon name="alert-circle" size={24} strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-medium text-ink-primary">{title}</p>
      {description ? <p className="text-ink-secondary mt-1 max-w-sm text-xs">{description}</p> : null}
      {onRetry ? (
        <div className="mt-4">
          <Button variant="secondary" size="md" onClick={onRetry} icon={<Icon name="refresh" size={14} />}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
