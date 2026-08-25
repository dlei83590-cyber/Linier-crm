/**
 * Timeline — 时间线（FE 2.0 UI-01，图标节点版）
 *
 * 竖线 + 图标节点（图标底色按 tone 语义）；审计/流程/历史呈现统一载体。
 * 业务审计请继续使用 workspace AuditTimeline（保留真实 action key）；本组件服务图标节点需求。
 */
'use client';

import type { ReactNode } from 'react';
import type { StatusTone } from '@/components/design-system';
import { STATUS_COLORS } from '@/components/design-system';
import { Icon } from './icon';
import type { IconName } from './icon';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** 时间（已格式化文本） */
  time?: ReactNode;
  /** 节点图标（默认 check） */
  icon?: IconName;
  tone?: StatusTone;
}

export interface TimelineProps {
  items: TimelineItem[];
  emptyText?: string;
  className?: string;
}

export function Timeline({ items, emptyText = '暂无记录', className = '' }: TimelineProps) {
  if (items.length === 0) {
    return <p className="text-ink-muted text-sm">{emptyText}</p>;
  }
  return (
    <ol className={'relative space-y-5 ' + className}>
      {items.map((item, i) => {
        const c = STATUS_COLORS[item.tone ?? 'neutral'];
        const isLast = i === items.length - 1;
        return (
          <li key={item.id} className="relative flex gap-3">
            {/* 连接竖线 */}
            {!isLast ? (
              <span
                className="absolute left-[13px] top-8 bottom-[-0.5rem] w-px"
                style={{ backgroundColor: c.border }}
                aria-hidden="true"
              />
            ) : null}
            {/* 图标节点 */}
            <span
              className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
              style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
            >
              <Icon name={item.icon ?? 'check'} size={14} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-ink-primary text-sm font-medium">{item.title}</span>
                {item.time ? <span className="text-ink-muted text-xs">{item.time}</span> : null}
              </div>
              {item.description ? (
                <p className="text-ink-secondary mt-0.5 text-sm">{item.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
