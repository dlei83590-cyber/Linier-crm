'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 返回列表链接（提供则显示返回入口） */
  backHref?: string;
  backLabel?: string;
  /**
   * 返回点击确认（返回 false 阻止导航；Dirty-State Guard 用）。
   * CC-10：支持异步（Promise）确认——同步 preventDefault 拦截后，
   * 确认放行时由组件内部 router.push(backHref) 完成导航。
   */
  onBackClick?: () => boolean | Promise<boolean>;
  /** 右侧操作区（动作按钮等） */
  actions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  backHref,
  backLabel = '返回列表',
  onBackClick,
  actions,
}: PageHeaderProps) {
  const router = useRouter();
  return (
    <div className="border-border bg-surface flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 md:px-6">
      <div className="min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            onClick={(e) => {
              if (!onBackClick) return;
              const result = onBackClick();
              if (result === false) {
                e.preventDefault();
              } else if (result instanceof Promise) {
                // 异步确认：必须同步拦截默认导航，确认放行后再手动跳转
                e.preventDefault();
                void result.then((ok) => {
                  if (ok) router.push(backHref);
                });
              }
            }}
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
