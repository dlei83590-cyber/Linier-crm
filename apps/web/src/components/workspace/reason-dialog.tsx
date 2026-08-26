'use client';

/**
 * ReasonDialog — 必填原因表单对话框（FE2.0 UI-10 新增 workspace 原语）
 *
 * 用于需要用户填写原因的二次确认动作（报销驳回 / 付款整体冲销 / 期间重开等），
 * 替换 window.prompt 与手写内联模态，统一 ConfirmActionDialog 的视觉语言：
 * - 必填校验：确认按钮在无有效原因（空白/纯空格）时禁用
 * - Esc / 遮罩点击取消；busy 期间确认/取消禁用
 * - 错误回显区（服务端 4xx/409/5xx 失败直接展示，不伪装成空态）
 */
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/skeleton';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** textarea 标签文案（如「驳回原因」「冲销原因」） */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** 必填（默认 true）：无有效原因时确认按钮禁用 */
  required?: boolean;
  maxLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** 服务端/业务错误回显 */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  value,
  onChange,
  required = true,
  maxLength,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ReasonDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const valid = !required || value.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="animate-dialog-in border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink-primary text-base font-semibold">{title}</h2>
        {description ? <p className="text-ink-secondary mt-2 text-sm">{description}</p> : null}
        <label className="text-ink-secondary mt-4 block text-xs font-medium">
          {label}
          {required ? <span className="text-status-danger-text ml-0.5">*</span> : null}
        </label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={3}
          placeholder={placeholder}
          disabled={busy}
          aria-required={required}
          className="focus:border-brand-500 text-ink-primary placeholder:text-ink-muted mt-1 w-full rounded-md border border-border px-3 py-1.5 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        {required && value.trim().length === 0 ? (
          <p className="text-status-danger-text mt-1 text-xs">请填写原因（必填）</p>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="border-status-danger-border bg-status-danger-bg text-status-danger-text mt-3 rounded-md border p-2 text-sm"
          >
            {error}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !valid}
            className={
              tone === 'danger'
                ? 'rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'
                : 'bg-brand-600 hover:bg-brand-700 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner />
                处理中…
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
