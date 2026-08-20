'use client';

/**
 * EntityListWorkspace — 列表工作区（F2-1 UI System Foundation）
 *
 * 统一列表页结构：Header → Toolbar(Filters) → Table → Pagination。
 * - 数据/分页状态由业务层通过 useListQuery 或等价 hook 提供
 * - loading / error / empty 三态内置（ErrorRow 消费结构化 ApiClientError）
 * - 复用既有 components/ui 的 Pagination / list-states，保证与存量页面观感一致
 */
import { useMemo, useState } from 'react';
import type { ApiClientError } from '@/lib/api-client';
import { Pagination } from '@/components/ui/pagination';
import { LoadingRow, EmptyRow, ErrorRow } from '@/components/ui/list-states';
import { PageHeader } from './page-header';
import { useTableDensity } from "@/lib/table-density-context";
import { PageToolbar } from './page-toolbar';

export interface ListColumn<T> {
  key: string;
  header: string;
  width?: string;
  /** 对齐：right 用于金额/数量列（右对齐 + tabular-nums，财务读数规范） */
  align?: "left" | "right";
  /** 可排序（客户端，仅当前页；服务端排序 backlog）——点击表头循环 升序→降序→清除 */
  sortable?: boolean;
  /** 单元格渲染；缺省输出 row[key] 原始值 */
  render?: (row: T) => React.ReactNode;
}

interface EntityListWorkspaceProps<T> {
  title: string;
  description?: string;
  /** Header 右侧操作区（如「新建」） */
  headerActions?: React.ReactNode;
  /** Toolbar 筛选控件（children 传入 PageToolbar 左侧） */
  filters?: React.ReactNode;
  /** Toolbar 右侧操作按钮（如「查询」「重置」） */
  toolbarActions?: React.ReactNode;
  columns: ListColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error: ApiClientError | null;
  onRetry: () => void;
  emptyMessage?: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 行内操作区（最右侧固定列；tr hover 时浮现，现代表格交互） */
  rowActions?: (row: T) => React.ReactNode;
  /** 表格密度：compact 缩小行高/字号；默认 default */
  density?: "default" | "compact";
  /** 表格下方扩展区（如统计行） */
  footer?: React.ReactNode;
}

export function EntityListWorkspace<T>({
  title,
  description,
  headerActions,
  filters,
  toolbarActions,
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyMessage,
  page,
  pageSize,
  total,
  onPageChange,
  rowActions,
  density = "default",
  footer,
}: EntityListWorkspaceProps<T>) {
  // U5：全局密度（组件自身 density prop 优先于 DensityContext）
  const { density: ctxDensity } = useTableDensity();
  const effectiveDensity = density ?? ctxDensity;

  // U6：列排序（客户端，仅当前页数据；服务端排序 backlog）
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sort.key];
      const bv = (b as Record<string, unknown>)[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = typeof av === "number" ? av : Number(av);
      const bn = typeof bv === "number" ? bv : Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) {
        return sort.dir === "asc" ? an - bn : bn - an;
      }
      const cmp = String(av).localeCompare(String(bv), "zh-CN");
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sort]);

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };
  return (
    <div className="border-border bg-surface shadow-elevation-sm overflow-hidden rounded-lg border">
      <PageHeader title={title} description={description} actions={headerActions} />
      {filters || toolbarActions ? (
        <PageToolbar actions={toolbarActions}>{filters}</PageToolbar>
      ) : null}
      <div className="overflow-x-auto">
        <table className="divide-border min-w-full divide-y text-sm">
          <thead className="text-ink-secondary bg-canvas sticky top-0 z-10 text-left text-xs font-medium">
            <tr>
              {columns.map((col) => {
                const activeSort = sort !== null && sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={activeSort ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                    className={`px-4 py-3 font-semibold ${col.align === "right" ? "text-right" : "text-left"} ${
                      col.sortable ? "cursor-pointer select-none transition-colors hover:bg-slate-100" : ""
                    }`}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && (
                        <span className={`text-xs ${activeSort ? "text-brand-600" : "text-ink-muted/60"}`} aria-hidden="true">
                          {activeSort ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
              {rowActions ? <th scope="col" className="px-4 py-3 text-right font-semibold">操作</th> : null}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {loading ? (
              <LoadingRow colSpan={columns.length + (rowActions ? 1 : 0)} />
            ) : error ? (
              <ErrorRow colSpan={columns.length + (rowActions ? 1 : 0)} error={error} onRetry={onRetry} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={columns.length + (rowActions ? 1 : 0)} message={emptyMessage} />
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="group transition-colors hover:bg-brand-50/40"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 text-ink-primary ${
                        col.align === "right" ? "text-right tabular-nums" : "text-left"
                      } ${effectiveDensity === "compact" ? "py-2 text-[13px]" : "py-3 text-sm"}`}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '—')}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="whitespace-nowrap px-4 py-2 text-right opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <div className="flex justify-end gap-1">{rowActions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
      {footer}
    </div>
  );
}