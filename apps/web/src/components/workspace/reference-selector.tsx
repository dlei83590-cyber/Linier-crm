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
  /** 加载失败时的字段级「重试」（引用源独立取数：一个源失败不影响其他源，可单独重试） */
  onRetry?: () => void;
  disabled?: boolean;
  required?: boolean;
}

/**
 * ReferenceErrorNote — 引用源加载失败提示（字段级「重试」）
 *
 * 与 ReferenceSelector 的 error 渲染同源：原生 select（供应商 / 付款条款等）也能复用同一
 * 「失败必须可见 + 可单独重试」语义，不各自造提示。
 */
export function ReferenceErrorNote({
  message,
  onRetry,
}: {
  message: string | null | undefined;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <p className="text-status-danger-text text-xs" role="alert">
      {message}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 underline underline-offset-2 hover:no-underline"
        >
          重试
        </button>
      ) : null}
    </p>
  );
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
  onRetry,
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
        <option value="">{loading ? '加载中…' : error ? '加载失败，请重试' : placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
            {opt.hint ? `（${opt.hint}）` : ''}
          </option>
        ))}
      </select>
      <ReferenceErrorNote message={error} onRetry={onRetry} />
    </div>
  );
}
