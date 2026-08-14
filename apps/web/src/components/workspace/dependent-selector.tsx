'use client';

/**
 * DependentSelector — 级联选择器（F2-1 UI System Foundation）
 *
 * 用于依赖关系选择（如 仓库 → 库位、类别 → 物料 → UOM）。
 * - levels 按顺序渲染；上级未选时下级禁用
 * - 上级变更时自动清空所有下级值（onChange 回调携带清空后的完整 values）
 * - 数据加载（options/loading）由业务层提供，本组件不发起请求
 */
import { CONTROL_CLASS } from '@/components/design-system';
import type { ReferenceOption } from './reference-selector';

export interface DependentLevel {
  key: string;
  label: string;
  options: ReferenceOption[];
  loading?: boolean;
  placeholder?: string;
}

interface DependentSelectorProps {
  levels: DependentLevel[];
  values: Record<string, string>;
  /** 任一级变化时回调完整 values（上级变更已自动清空下级） */
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}

export function DependentSelector({
  levels,
  values,
  onChange,
  disabled = false,
}: DependentSelectorProps) {
  const handleChange = (index: number, key: string, value: string) => {
    const next: Record<string, string> = { ...values, [key]: value };
    // 上级变化：清空所有下级
    for (let i = index + 1; i < levels.length; i += 1) {
      next[levels[i].key] = '';
    }
    onChange(next);
  };

  return (
    <div className="flex flex-wrap items-start gap-3">
      {levels.map((level, index) => {
        // 上级是否有值（第一级恒可用）
        const parentValue = index === 0 ? 'ok' : values[levels[index - 1].key];
        const enabled = Boolean(parentValue) && !disabled && !level.loading;
        const value = values[level.key] ?? '';
        return (
          <div key={level.key} className="flex min-w-48 flex-col gap-1">
            <label className="text-ink-secondary text-sm font-medium">{level.label}</label>
            <select
              value={value}
              onChange={(e) => handleChange(index, level.key, e.target.value)}
              disabled={!enabled}
              className={CONTROL_CLASS}
            >
              <option value="">
                {level.loading ? '加载中…' : (level.placeholder ?? '请选择')}
              </option>
              {level.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.hint ? `（${opt.hint}）` : ''}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
