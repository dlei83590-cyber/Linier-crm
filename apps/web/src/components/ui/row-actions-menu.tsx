"use client";

/**
 * RowActionsMenu — 表格行操作省略号菜单（FE 2.0：行操作收进 ⋯）
 *
 * - 轻量 dropdown（零依赖）：点击 ⋯ 展开，点击外部 / Esc / 选择后关闭
 * - danger 动作红字强调（删除/作废等），disabled 动作置灰 + tooltip 说明
 * - 动效复用 globals.css animate-fade-in（UI-01 统一补 prefers-reduced-motion）
 */
import { useEffect, useRef, useState } from "react";

export interface RowMenuAction {
  key: string;
  label: string;
  /** danger 动作（删除/作废/反冲等破坏性）红字强调 */
  tone?: "default" | "danger";
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

interface RowActionsMenuProps {
  actions: RowMenuAction[];
  /** 自定义 aria-label（默认「行操作」） */
  ariaLabel?: string;
}

export function RowActionsMenu({ actions, ariaLabel = "行操作" }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-ink-secondary transition-colors hover:bg-canvas hover:text-ink-primary"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="animate-fade-in border-border bg-surface shadow-elevation-lg absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-md border py-1"
        >
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              title={a.disabled ? a.disabledReason : undefined}
              onClick={() => {
                setOpen(false);
                if (!a.disabled) a.onSelect();
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                a.tone === "danger"
                  ? "text-status-danger-text hover:bg-status-danger-bg/40"
                  : "text-ink-primary hover:bg-canvas"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
