'use client';

/**
 * DetailTable — 详情/报表只读表格（FE2.0 UI-10 新增 workspace 原语）
 *
 * 统一详情页明细表格规范（对齐 EntityListWorkspace 的表头/行交互基线）：
 * - sticky header（overflow 容器内吸顶，长表滚动不丢表头）
 * - hover 行高亮
 * - 金额/数量列右对齐 + tabular-nums（财务读数规范）
 * - 空态行（非大 EmptyState，保持详情区紧凑）
 */
export interface DetailColumn<T> {
  key: string;
  header: string;
  /** right 用于金额/数量列（右对齐 + tabular-nums） */
  align?: 'left' | 'right';
  width?: string;
  render?: (row: T) => React.ReactNode;
}

interface DetailTableProps<T> {
  columns: DetailColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  /** 表格下方合计/统计区（如 Σ 借方/贷方） */
  footer?: React.ReactNode;
  /** compact 密度（小号行高/字号） */
  dense?: boolean;
}

export function DetailTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = '暂无数据',
  footer,
  dense = false,
}: DetailTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="divide-border min-w-full divide-y text-sm">
        <thead className="text-ink-secondary bg-canvas sticky top-0 z-10 text-left text-xs font-medium">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`px-3 py-2 font-semibold ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-sm text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-brand-50/40">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`text-ink-primary whitespace-nowrap px-3 ${col.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${dense ? 'py-1.5 text-[13px]' : 'py-2'}`}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {footer ? <div className="border-border border-t px-3 py-2">{footer}</div> : null}
    </div>
  );
}
