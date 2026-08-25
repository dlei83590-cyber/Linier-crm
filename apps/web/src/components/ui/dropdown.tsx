/**
 * Dropdown — 下拉菜单（FE 2.0 UI-01）
 *
 * 行操作省略号 / 工具栏菜单；trigger 渲染为 Button 或 IconButton；
 * 菜单键盘导航（↑/↓/Enter/Escape/Home/End）+ 点击外部关闭 + 选中关闭。
 * 对齐：start（左）/ end（右）。
 */
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icon';
import type { IconName } from './icon';

export interface DropdownItem {
  key: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DropdownSeparator {
  type: 'separator';
  key: string;
}

export type DropdownEntry = DropdownItem | DropdownSeparator;

function isDropdownItem(entry: DropdownEntry): entry is DropdownItem {
  return !('type' in entry);
}

export interface DropdownProps {
  /** 触发器（按钮/IconButton/自定义节点） */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: DropdownEntry[];
  /** 菜单对齐（默认 end） */
  align?: 'start' | 'end';
  /** 菜单宽度（默认 10rem） */
  menuWidth?: string;
  className?: string;
}

export function Dropdown({ trigger, items, align = 'end', menuWidth = 'w-40', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setActiveIndex(0), [open]);

  // 点击外部 / ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const enabledIndexes = items
    .map((it, i) => (isDropdownItem(it) && it.disabled ? -1 : i))
    .filter((i) => i >= 0);

  const runAction = (item: DropdownItem) => {
    setOpen(false);
    item.onClick?.();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => {
          const pos = enabledIndexes.indexOf(i);
          return enabledIndexes[(pos + 1) % enabledIndexes.length];
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => {
          const pos = enabledIndexes.indexOf(i);
          return enabledIndexes[(pos - 1 + enabledIndexes.length) % enabledIndexes.length];
        });
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(enabledIndexes[0]);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items[activeIndex];
        if (item && isDropdownItem(item)) runAction(item);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className={'relative inline-flex ' + className}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}

      {open ? (
        <div
          role="menu"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          className={[
            'animate-dropdown-in border-border bg-surface shadow-elevation-md absolute top-full z-40 mt-1 overflow-hidden rounded-md border py-1',
            align === 'end' ? 'right-0' : 'left-0',
            menuWidth,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {items.map((entry, i) => {
            if (!isDropdownItem(entry)) {
              return <div key={entry.key} role="separator" className="border-border my-1 border-t" />;
            }
            const active = i === activeIndex;
            return (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={entry.disabled}
                onClick={() => runAction(entry)}
                onMouseEnter={() => setActiveIndex(i)}
                className={[
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-100',
                  active ? 'bg-brand-50 text-brand-700' : '',
                  entry.danger ? 'text-status-danger-text' : 'text-ink-primary',
                  entry.disabled ? 'pointer-events-none opacity-50' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {entry.icon ? (
                  <span className="shrink-0">
                    <Icon name={entry.icon} size={14} />
                  </span>
                ) : null}
                {entry.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
