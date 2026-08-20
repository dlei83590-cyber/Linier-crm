'use client';

/**
 * ConfirmActionDialog — 动作确认对话框（F2-1 UI System Foundation）
 *
 * 破坏性/不可逆动作（取消、过账、删除等）的二次确认。
 * - 支持 Esc 取消
 * - busy 期间确认/取消禁用
 */
import { useEffect } from 'react';
import { Spinner } from "@/components/ui/skeleton";

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="animate-dialog-in border-border bg-surface shadow-elevation-lg w-full max-w-md rounded-lg border p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-ink-primary text-base font-semibold">{title}</h2>
        {description ? <p className="text-ink-secondary mt-2 text-sm">{description}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
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
