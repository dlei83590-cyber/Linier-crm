"use client";

/**
 * Customer 360 — 详情页轻量数据表（FE 2.0）
 *
 * 统一 Tab 内表格：sticky header / hover row / 金额右对齐 tabular-nums /
 * 行操作收进省略号菜单（RowMenu）/ 长文本 truncate + tooltip / 三态（loading/error/empty）。
 * 页面级列表仍用 EntityListWorkspace（本组件只服务详情 Tab 聚合展示）。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlertCircle, IconChevronRight, IconEllipsis, IconRefreshCw } from "./icons";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  width?: string;
  render: (row: T) => React.ReactNode;
}

export interface RowMenuItem {
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

/** 行操作省略号菜单（点击外部 / Esc 关闭） */
export function RowMenu({
  items,
  ariaLabel = "行操作",
}: {
  items: RowMenuItem[];
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1.5 text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink-primary"
      >
        <IconEllipsis className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-surface py-1 shadow-elevation-lg"
        >
          {items.map((item, i) => {
            const cls =
              "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150 " +
              (item.danger
                ? "text-status-danger-text hover:bg-status-danger-bg"
                : "text-ink-primary hover:bg-surface-hover");
            return item.href ? (
              <Link
                key={i}
                href={item.href}
                role="menuitem"
                className={cls}
                onClick={() => setOpen(false)}
              >
                {item.label}
                <IconChevronRight className="h-3.5 w-3.5 opacity-60" />
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cls}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 长文本截断 + 原生 tooltip（title） */
export function TruncateCell({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={"block max-w-[240px] truncate " + className} title={text}>
      {text}
    </span>
  );
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title?: string; description?: string };
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  empty,
  className = "",
}: DataTableProps<T>) {
  const colSpan = columns.length;

  return (
    <div className={"overflow-x-auto " + className}>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="sticky top-0 z-10 bg-canvas text-left text-xs font-medium text-ink-secondary">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={
                  "px-4 py-2.5 font-semibold " + (col.align === "right" ? "text-right" : "text-left")
                }
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-3">
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-5 w-full" />
                  ))}
                </div>
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-6 text-center">
                <div className="flex flex-col items-center gap-2 text-sm">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger-bg text-status-danger-text">
                    <IconAlertCircle className="h-5 w-5" />
                  </span>
                  <p className="text-status-danger-text">{error}</p>
                  {onRetry ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface-hover"
                    >
                      <IconRefreshCw className="h-3.5 w-3.5" />
                      重试
                    </button>
                  ) : null}
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-4">
                <EmptyState title={empty?.title} description={empty?.description} />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="group transition-colors duration-150 hover:bg-brand-50/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      "whitespace-nowrap px-4 py-2.5 text-ink-primary " +
                      (col.align === "right" ? "text-right tabular-nums" : "text-left")
                    }
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
