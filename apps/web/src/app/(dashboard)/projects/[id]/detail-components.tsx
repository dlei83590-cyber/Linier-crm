"use client";

/**
 * Project Detail — 子资源 Tab 统一容器（UI-06 Opportunity + Project 现代重构）
 *
 * 项目详情 12 个子资源 Tab（关系人/成员/里程碑/任务/风险/走访/产品/预算/费用/进度/验收/标签）共用：
 * - SubresourceCard：统一卡片容器（标题 + 计数 + 右侧动作）
 * - DetailTable：统一表格（sticky header + hover row + 金额右对齐 tabular-nums + 长文本 truncate/tooltip）
 * - RowActionButtons：行操作紧凑图标按钮（hover 浮现，替代内联文本链接）
 *
 * 纯展示层：不感知任何资源字段语义；权限/动作回调由页面层传入。
 * 行操作图标为 Lucide 风格内联 SVG（禁止 emoji 当产品图标）。
 */

interface DetailTableHeader {
  text: string;
  /** right = 金额/数量列（右对齐 + tabular-nums，财务读数规范） */
  align?: "left" | "right";
}

interface DetailTableProps {
  headers: Array<DetailTableHeader | string>;
  children: React.ReactNode;
  /** 空态文案（提供则渲染空态单元格） */
  emptyText?: string;
  /** 空态单元格 colSpan */
  colSpan: number;
}

/** 统一子资源卡片容器 */
export function SubresourceCard({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-primary">
          {title}
          {typeof count === "number" ? (
            <span className="ml-1.5 text-xs font-normal text-ink-muted">{count}</span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 统一子资源表格（sticky header + hover row + 右对齐 tabular-nums） */
export function DetailTable({ headers, children, emptyText, colSpan }: DetailTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-canvas sticky top-0 z-10 text-left text-xs font-medium text-ink-secondary">
          <tr>
            {headers.map((h) => {
              const text = typeof h === "string" ? h : h.text;
              const align = typeof h === "string" ? "left" : (h.align ?? "left");
              return (
                <th
                  key={text}
                  scope="col"
                  className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : "text-left"}`}
                >
                  {text}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {children}
          {emptyText ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center">
                <p className="text-sm text-ink-muted">{emptyText}</p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** 长文本单元格：truncate + 原生 tooltip（title） */
export function TruncatedCell({
  text,
  maxWidth = "max-w-[16rem]",
}: {
  text: React.ReactNode;
  maxWidth?: string;
}) {
  if (text === null || text === undefined || text === "—") {
    return <span className="text-ink-muted">—</span>;
  }
  const raw = typeof text === "string" ? text : "";
  return (
    <span
      title={raw || undefined}
      className={`inline-block ${maxWidth} truncate align-bottom`}
    >
      {text}
    </span>
  );
}

/** 行操作紧凑图标按钮（tr hover 浮现；编辑/删除两态） */
export function RowActionButtons({
  onEdit,
  onDelete,
  editLabel = "编辑",
  deleteLabel = "删除",
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel?: string;
  deleteLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          title={editLabel}
          aria-label={editLabel}
          className="rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-slate-100 hover:text-brand-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"
            />
          </svg>
        </button>
      ) : null}
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          title={deleteLabel}
          aria-label={deleteLabel}
          className="rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-red-50 hover:text-status-danger-text"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
