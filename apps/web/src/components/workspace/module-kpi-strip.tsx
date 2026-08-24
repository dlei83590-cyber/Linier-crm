'use client';

/**
 * ModuleKpiStrip — 模块页仪表盘 KPI 数字卡片条
 *
 * 每个业务单据模块列表页顶部展示该页面的仪表盘：
 * - 「全部」+ 各状态计数卡片（点击联动列表状态筛选，active 高亮）
 * - 可选金额汇总卡片（展示，不联动筛选）
 *
 * 纯展示 + 轻交互：数据由页面负责拉取（GET /api/<module>/summary），
 * 组件不自行 fetch；loading 骨架 / 无数据隐藏。
 */
import type { ModuleKpiStatusDef, ModuleSummaryData } from '@/lib/module-summary/types';

export interface ModuleKpiStripProps {
  /** 状态卡片定义（顺序即展示顺序） */
  statuses: ModuleKpiStatusDef[];
  /** summary 数据（null = 未加载/失败 → 隐藏） */
  data: ModuleSummaryData | null;
  /** 首屏加载且无数据时显示骨架 */
  loading?: boolean;
  /** 当前列表筛选状态（null = 全部） */
  activeStatus: string | null;
  /** 点击状态卡片（null = 全部） */
  onSelectStatus: (status: string | null) => void;
}

export function ModuleKpiStrip({
  statuses,
  data,
  loading = false,
  activeStatus,
  onSelectStatus,
}: ModuleKpiStripProps) {
  if (loading && !data) {
    return (
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[4.5rem] animate-pulse rounded-lg border border-border bg-surface" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const cards = [
    {
      key: '__all__',
      label: '全部',
      count: data.total,
      active: activeStatus === null,
    },
    ...statuses.map((s) => ({
      key: s.value,
      label: s.label,
      count: data.byStatus[s.value] ?? 0,
      active: activeStatus === s.value,
    })),
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelectStatus(c.key === '__all__' ? null : c.key)}
          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
            c.active
              ? 'border-brand-300 bg-brand-50'
              : 'border-border bg-surface hover:border-brand-200 hover:bg-canvas'
          }`}
        >
          <div
            className={`text-xl font-semibold tabular-nums ${
              c.active ? 'text-brand-700' : 'text-ink-primary'
            }`}
          >
            {c.count}
          </div>
          <div className={`mt-0.5 text-xs ${c.active ? 'text-brand-600' : 'text-ink-secondary'}`}>
            {c.label}
          </div>
        </button>
      ))}
      {data.amount ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <div className="text-xl font-semibold tabular-nums text-ink-primary">
            {data.amount.value}
          </div>
          <div className="mt-0.5 text-xs text-ink-secondary">{data.amount.label}</div>
        </div>
      ) : null}
    </div>
  );
}