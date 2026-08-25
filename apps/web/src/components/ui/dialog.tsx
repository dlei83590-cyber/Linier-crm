/**
 * Dialog — 通用模态对话框（FE 2.0 UI-01）
 *
 * 能力：ESC 关闭 / 点击遮罩关闭（可禁用）/ focus trap / body 滚动锁 /
 * 关闭后焦点还原 / busy 禁用态 / sm-md-lg-xl 四档宽度。
 * 动效：遮罩 fade-in + 面板 dialog-in（globals.css；prefers-reduced-motion 自动降级）。
 * 用法：footer 传动作区（配合 Button / ConfirmDialog）。
 */
'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from './icon-button';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 底部操作区（右对齐按钮组） */
  footer?: ReactNode;
  size?: DialogSize;
  /** 点击遮罩关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** 隐藏右上角关闭按钮（如强制确认流程） */
  hideCloseButton?: boolean;
  /** busy：禁用面板内全部 button（防止重复提交） */
  busy?: boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  hideCloseButton = false,
  busy = false,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开：记录焦点 + body 滚动锁；关闭：还原焦点
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    // 面板内首个可聚焦元素优先，否则面板本身
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel)?.focus?.();
    return () => {
      document.body.style.overflow = '';
      prevActive?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // ESC / Tab 循环（focus trap）
  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
      onClick={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={[
          'animate-dialog-in border-border bg-surface shadow-elevation-lg flex max-h-[85vh] w-full flex-col rounded-lg border outline-none',
          SIZE_CLASS[size],
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 id={titleId} className="text-ink-primary text-base font-semibold">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id={descId} className="text-ink-secondary mt-1 text-sm">
                {description}
              </p>
            ) : null}
          </div>
          {!hideCloseButton ? (
            <IconButton
              icon="x"
              size="sm"
              variant="ghost"
              aria-label="关闭"
              disabled={busy}
              onClick={onClose}
              className="-mr-1 -mt-1 shrink-0"
            />
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-canvas/50 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
