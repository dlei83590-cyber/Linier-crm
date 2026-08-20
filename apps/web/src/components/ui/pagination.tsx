/**
 * Track A Frontend Iteration 1 — 分页组件（reference 实现）
 * 纯展示 + 页码回调；与 useListQuery 配合使用。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="border-border bg-surface flex items-center justify-between border-t px-4 py-3">
      <p className="text-sm text-ink-muted">共 {total} 条</p>
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