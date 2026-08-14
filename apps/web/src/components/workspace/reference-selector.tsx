'use client';

/**
 * ReferenceSelector — 引用选择器（F2-1 UI System Foundation）
 *
 * 用于选择被引用实体（Item / Supplier / Warehouse / UOM / PO 等）。
 * - 纯受控组件：options 由业务层提供（数据加载不在此处，防止各页自造取数）
 * - 原生 <select>：无 portal / 焦点管理复杂度，全场景可靠
 */
import { CONTROL_CLASS } from '@/components/design-system';

export interface ReferenceOption {
  value: string;
  label: string;
  /** 次要信息（编码等），渲染在 label 后 */
  hint?: string;
}

interface ReferenceSelectorProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReferenceOption[];
  placeholder?: string;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  required?: boolean;
}

export function ReferenceSelector({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = '请选择',
  loading = false,
  error,
  disabled = false,
  required = false,
}: ReferenceSelectorProps) {
  const blocked = disabled || loading;
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label htmlFor={id} className="text-ink-secondary text-sm font-medium">
          {label}
          {required ? <span className="text-status-danger-text ml-0.5">*</span> : null}
        </label>
      ) : null}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={blocked}
        required={required}
        className={CONTROL_CLASS}
      >
        <option value="">{loading ? '加载中…' : placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
            {opt.hint ? `（${opt.hint}）` : ''}
          </option>
        ))}
      </select>
      {error ? <p className="text-status-danger-text text-xs">{error}</p> : null}
    </div>
  );
}
