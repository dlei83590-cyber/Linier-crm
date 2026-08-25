/**
 * Tabs — 标签页（FE 2.0 UI-01）
 *
 * variant: underline（列表页 Tab）/ pill（轻量分段控件）；
 * 受控 value/onChange；键盘 ←/→ 切换 + Home/End；roving tabindex。
 */
'use client';

import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export type TabsVariant = 'underline' | 'pill';
export type TabsSize = 'sm' | 'md';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** 可选徽标计数 */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  variant?: TabsVariant;
  size?: TabsSize;
  className?: string;
  /** 无障碍标签（无可见 label 时） */
  'aria-label'?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className = '',
  'aria-label': ariaLabel = '标签页',
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const focusIndex = (from: number, dir: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const idx = enabledIndexes.indexOf(from);
    const next = enabledIndexes[(idx + dir + enabledIndexes.length) % enabledIndexes.length];
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusIndex(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusIndex(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        tabRefs.current[enabledIndexes[0]]?.focus();
        break;
      case 'End':
        e.preventDefault();
        tabRefs.current[enabledIndexes[enabledIndexes.length - 1]]?.focus();
        break;
    }
  };

  const underlineCls =
    size === 'sm'
      ? 'border-b border-border gap-1 text-sm'
      : 'border-b border-border gap-2 text-sm';

  const pillWrapCls =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded-lg bg-canvas p-1'
      : 'inline-flex items-center gap-1 rounded-lg bg-canvas p-1';

  const underlineTab = (active: boolean, disabled: boolean) =>
    [
      'border-b-2 px-1 pb-2 pt-1 font-medium transition-colors duration-150 ease-out -mb-px',
      active
        ? 'border-brand-600 text-brand-700'
        : 'border-transparent text-ink-secondary hover:border-border hover:text-ink-primary',
      disabled ? 'pointer-events-none opacity-50' : '',
      size === 'sm' ? 'text-xs' : 'text-sm',
    ]
      .filter(Boolean)
      .join(' ');

  const pillTab = (active: boolean, disabled: boolean) =>
    [
      'rounded-md px-3 font-medium transition-colors duration-150 ease-out',
      active
        ? 'bg-surface text-ink-primary shadow-elevation-sm border border-border'
        : 'text-ink-secondary hover:text-ink-primary border border-transparent',
      disabled ? 'pointer-events-none opacity-50' : '',
      size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={(variant === 'underline' ? underlineCls : pillWrapCls) + ' ' + className}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        const tabCls = variant === 'underline' ? underlineTab(active, item.disabled) : pillTab(active, item.disabled);
        return (
          <button
            key={item.value}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={baseId + '-tab-' + i}
            aria-selected={active}
            aria-controls={baseId + '-panel-' + i}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={tabCls + ' inline-flex items-center gap-1.5'}
          >
            {item.label}
            {typeof item.count === 'number' ? (
              <span
                className={
                  'min-w-[1.25rem] rounded-full px-1 text-center text-xs leading-4 ' +
                  (active
                    ? variant === 'underline'
                      ? 'bg-brand-50 text-brand-700'
                      : 'bg-canvas text-ink-secondary'
                    : 'bg-canvas text-ink-muted')
                }
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
