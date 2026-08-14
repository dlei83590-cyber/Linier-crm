'use client';

/**
 * PageToolbar — 页面工具条（F2-1 UI System Foundation）
 *
 * 列表页 Filters 行：左侧筛选控件（children），右侧操作按钮（actions）。
 * 结构规则：Header → Toolbar（Filters）→ Table → Pagination。
 */
interface PageToolbarProps {
  /** 筛选控件区（左） */
  children?: React.ReactNode;
  /** 操作按钮区（右） */
  actions?: React.ReactNode;
}

export function PageToolbar({ children, actions }: PageToolbarProps) {
  return (
    <div className="border-border bg-surface flex flex-wrap items-center gap-2 border-b px-4 py-3 md:px-6">
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
