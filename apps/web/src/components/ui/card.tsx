/**
 * Card — 卡片容器（FE 2.0 UI-01）
 *
 * Surface 白底 + 轻边框 + 可选 elevation；header/content/footer 三段式。
 * 列表/详情/表单区块统一载体（替代散落的 rounded-md border 重复）。
 */
'use client';

import type { HTMLAttributes, ReactNode } from 'react';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** 阴影：sm=轻（默认）/ md / none（内容内边距由 CardContent 的 padding 控制） */
  elevation?: 'sm' | 'md' | 'none';
}

export function Card({
  elevation = 'sm',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={[
        'border-border overflow-hidden rounded-xl border bg-surface',
        elevation === 'none' ? '' : elevation === 'md' ? 'shadow-elevation-md' : 'shadow-elevation-sm',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'size'> {
  title?: ReactNode;
  /** 标题下方说明 */
  description?: ReactNode;
  /** 右侧操作区 */
  actions?: ReactNode;
  /** 标题字号：sm=14px semibold / base=16px semibold（默认 base） */
  size?: 'sm' | 'base';
}

export function CardHeader({
  title,
  description,
  actions,
  size = 'base',
  className = '',
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={[
        'flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 md:px-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <div className="min-w-0">
        {title ? (
          <h3
            className={
              size === 'sm'
                ? 'text-ink-primary text-sm font-semibold'
                : 'text-ink-primary text-base font-semibold'
            }
          >
            {title}
          </h3>
        ) : null}
        {description ? <p className="text-ink-secondary mt-0.5 text-xs">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export function CardContent({ padding = 'md', className = '', children, ...rest }: CardContentProps) {
  return (
    <div className={[PADDING_CLASS[padding], className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** 右侧对齐操作区（默认）；传 children 时左对齐 */
  children?: ReactNode;
  /** 右侧操作区（推荐，避免撑满布局） */
  actions?: ReactNode;
}

export function CardFooter({ children, actions, className = '', ...rest }: CardFooterProps) {
  return (
    <div
      className={[
        'border-border flex flex-wrap items-center justify-end gap-2 border-t bg-canvas/50 px-4 py-3 md:px-6',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
