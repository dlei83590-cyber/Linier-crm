'use client';

/**
 * AuditTimeline — 审计时间线（F2-1 UI System Foundation）
 *
 * 详情页底部 Audit 区：按时间倒序展示审计/状态流转事件。
 * - action 保留真实后端 action key（禁止前端压缩为模糊文案）
 * - 时间统一走 formatDate（无效输入 → "—"）
 */
import { formatDate } from '@/lib/format';
import { STATUS_COLORS, type StatusTone } from '@/components/design-system';

export interface AuditEvent {
  id: string;
  /** 动作 key（保留真实后端值） */
  action: string;
  actor?: string | null;
  /** ISO 时间 */
  at: string;
  note?: string | null;
  /** 事件语义色，缺省 neutral */
  tone?: StatusTone;
}

interface AuditTimelineProps {
  events: AuditEvent[];
  emptyText?: string;
}

export function AuditTimeline({ events, emptyText = '暂无审计记录' }: AuditTimelineProps) {
  if (events.length === 0) {
    return <p className="text-ink-muted text-sm">{emptyText}</p>;
  }
  return (
    <ol className="border-border relative space-y-4 border-l pl-4">
      {events.map((event) => {
        const c = STATUS_COLORS[event.tone ?? 'neutral'];
        return (
          <li key={event.id} className="relative">
            <span
              className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border"
              style={{ backgroundColor: c.bg, borderColor: c.text }}
            />
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-ink-primary text-sm font-medium">{event.action}</span>
              <span className="text-ink-muted text-xs">{formatDate(event.at)}</span>
              {event.actor ? (
                <span className="text-ink-secondary text-xs">操作人：{event.actor}</span>
              ) : null}
            </div>
            {event.note ? <p className="text-ink-secondary mt-0.5 text-sm">{event.note}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
