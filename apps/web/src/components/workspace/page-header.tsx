'use client';

/**
 * PageHeader — 页面头部（F2-1 UI System Foundation）
 *
 * 列表/详情/表单页统一头部：返回链接（可选）→ 标题 → 描述 → 右侧操作区。
 * 结构规则：Header 在最上方，紧随其后是 Toolbar / Actions。
 */
import Link from 'next/link';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 返回列表链接（提供则显示返回入口） */
  backHref?: string;
  backLabel?: string;
  /** 右侧操作区（动作按钮等） */
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  backHref,
  backLabel = '返回列表',
  actions,
}: PageHeaderProps) {
  return (
    <div className="border-border bg-surface flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 md:px-6">
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="text-brand-600 mb-1 inline-block text-sm hover:underline"
          >
            ← {backLabel}
          </Link>
        ) : null}
        <h1 className="text-ink-primary text-lg font-semibold md:text-xl">{title}</h1>
        {description ? <p className="text-ink-secondary mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
