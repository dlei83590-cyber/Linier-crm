/**
 * Drawer — 侧滑面板（FE 2.0 UI-01）
 *
 * 宽度 420/480/560 三档（FE 2.0 规范 420-560px）；
 * ESC / 点击遮罩 / focus trap / body 滚动锁 / 关闭后焦点还原 / busy 禁用。
 * side=right（默认，表单/详情浮层）/ left（导航类）。
 */
'use client';

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from './icon-button';

export type DrawerSide = 'left' | 'right';
export type DrawerSize = 'sm' | 'md' | 'lg';

const WIDTH_CLASS: Record<DrawerSize, string> = {
  sm: 'w-[420px] max-w-[92vw]',
  md: 'w-[480px] max-w-[92vw]',
  lg: 'w-[560px] max-w-[92vw]',
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 底部操作区（右对齐按钮组） */
  footer?: ReactNode;
  side?: DrawerSide;
  size?: DrawerSize;
  /** 点击遮罩关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** busy：禁用面板内全部 button（防止重复提交） */
  busy?: boolean;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = 'right',
  size = 'md',
  closeOnBackdrop = true,
  busy = false,
}: DrawerProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // 打开：记录焦点 + body 滚动锁；关闭：还原焦点
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? panel)?.focus?.();
    return () => {
      document.body.style.overflow = '';
      prevActive?.focus?.();
    };
  }, [open]);

  if (!open) return null;

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
      className="animate-fade-in fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px]"
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
          'border-border bg-surface shadow-elevation-lg absolute inset-y-0 flex flex-col border-l',
          side === 'right' ? 'animate-drawer-in-right right-0' : 'animate-drawer-in left-0 border-l-0 border-r',
          WIDTH_CLASS[size],
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
          <IconButton
            icon="x"
            size="sm"
            variant="ghost"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
            className="-mr-1 -mt-1 shrink-0"
          />
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
