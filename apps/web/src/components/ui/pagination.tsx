/**
 * Track A Frontend Iteration 1 — 分页组件（reference 实现）
 * 纯展示 + 页码回调；与 useListQuery 配合使用。
 * FE 2.0 UI 补齐：可选 pageSize 选择器（onPageSizeChange 传入时显示；向后兼容）。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 传入则显示每页条数选择器（切换后回到第 1 页由调用方决定） */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="border-border bg-surface flex items-center justify-between border-t px-4 py-3">
      <div className="flex items-center gap-3">
        <p className="text-sm text-ink-muted">共 {total} 条</p>
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
            <span className="hidden sm:inline">每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink-primary focus:border-brand-500 focus:outline-none"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">条</span>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <span className="text-sm text-ink-secondary">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="border-border text-ink-secondary rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
