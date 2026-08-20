'use client';

/**
 * EntityListWorkspace — 列表工作区（F2-1 UI System Foundation）
 *
 * 统一列表页结构：Header → Toolbar(Filters) → Table → Pagination。
 * - 数据/分页状态由业务层通过 useListQuery 或等价 hook 提供
 * - loading / error / empty 三态内置（ErrorRow 消费结构化 ApiClientError）
 * - 复用既有 components/ui 的 Pagination / list-states，保证与存量页面观感一致
 */
import type { ApiClientError } from '@/lib/api-client';
import { Pagination } from '@/components/ui/pagination';
import { LoadingRow, EmptyRow, ErrorRow } from '@/components/ui/list-states';
import { PageHeader } from './page-header';
import { PageToolbar } from './page-toolbar';

export interface ListColumn<T> {
  key: string;
  header: string;
  width?: string;
  /** 对齐：right 用于金额/数量列（右对齐 + tabular-nums，财务读数规范） */
  align?: "left" | "right";
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
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-3 font-semibold ${col.align === "right" ? "text-right" : "text-left"}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
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
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="group transition-colors hover:bg-brand-50/40"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`whitespace-nowrap px-4 text-ink-primary ${
                        col.align === "right" ? "text-right tabular-nums" : "text-left"
                      } ${density === "compact" ? "py-2 text-[13px]" : "py-3 text-sm"}`}
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