/**
 * KpiCard — KPI 数字卡片（FE 2.0 UI-01）
 *
 * 仪表盘/模块页数字卡片：标题 + 大数字（24-28px tabular-nums）+ 趋势/说明 + 可选图标。
 * loading 骨架；onClick 可选（联动筛选）。
 */
'use client';

import type { ReactNode } from 'react';
import { Skeleton } from './skeleton';
import { Icon } from './icon';
import type { IconName } from './icon';

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** 副文案（趋势/说明；示例：+12.5% 较上月） */
  sub?: ReactNode;
  /** 图标（右侧，Lucide 风格） */
  icon?: IconName;
  /** 图标底色：domain 强调色用 Tailwind domain-* 类（如 "bg-domain-sales-50 text-domain-sales-600"） */
  iconClass?: string;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

function KpiBody({ label, value, sub, icon, iconClass, loading }: Omit<KpiCardProps, 'onClick' | 'className'>) {
  return (
    <>
      <div className="min-w-0">
        <p className="text-ink-secondary truncate text-xs font-medium">{label}</p>
        {loading ? (
          <Skeleton className="mt-1.5 h-7 w-16" />
        ) : (
          <p className="text-ink-primary mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        )}
        {sub ? <p className="text-ink-muted mt-1 text-xs">{sub}</p> : null}
      </div>
      {icon ? (
        <span className={['flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', iconClass].join(' ')}>
          <Icon name={icon} size={18} />
        </span>
      ) : null}
    </>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  iconClass = 'bg-canvas text-ink-secondary',
  loading = false,
  onClick,
  className = '',
}: KpiCardProps) {
  const body = <KpiBody label={label} value={value} sub={sub} icon={icon} iconClass={iconClass} loading={loading} />;
  const baseClass = [
    'border-border bg-surface shadow-elevation-sm flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-left',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClass + ' transition-colors duration-150 ease-out hover:border-brand-200 hover:bg-canvas/60'}
      >
        {body}
      </button>
    );
  }
  return <div className={baseClass}>{body}</div>;
}
