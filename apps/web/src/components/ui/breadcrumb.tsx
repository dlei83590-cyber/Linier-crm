/**
 * Breadcrumb — 面包屑（FE 2.0 UI-01）
 *
 * 层级导航：首页 / 模块 / 详情；最后一项为当前页（aria-current="page"）。
 */
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './icon';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  /** 分隔图标（默认 chevron-right） */
  separator?: ReactNode;
  className?: string;
}

export function Breadcrumb({ items, separator, className = '' }: BreadcrumbProps) {
  const sep = separator ?? <Icon name="chevron-right" size={14} />;
  return (
    <nav aria-label="面包屑" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 ? <span className="text-ink-muted">{sep}</span> : null}
              {item.href && !isLast ? (
                <Link href={item.href} className="text-ink-secondary hover:text-brand-600 rounded transition-colors hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'text-ink-primary font-medium' : 'text-ink-secondary'}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
