/**
 * Combobox — 可搜索下拉选择（FE 2.0 UI-01）
 *
 * 轻量零依赖实现：input 输入即过滤 + 键盘导航（↑/↓/Enter/Escape/Home/End）。
 * ARIA：combobox → listbox → option（aria-selected / aria-activedescendant）。
 * 受控：value（选中项 value）/ onValueChange；search 可选受控（外部过滤时传 options 已过滤）。
 */
'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CONTROL_CLASS } from '@/components/design-system';
import { Icon } from './icon';

export interface ComboboxOption {
  value: string;
  label: string;
  /** 可选副文案（右对齐） */
  hint?: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** 选中项 value（null = 未选） */
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  /** 允许一键清空 */
  clearable?: boolean;
  /** 搜索词受控（外部过滤）；缺省内部过滤 */
  search?: string;
  onSearchChange?: (search: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** 无匹配文案 */
  emptyText?: string;
  className?: string;
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-8 pl-2.5 pr-8 text-sm',
  md: 'h-10 pl-3 pr-9 text-sm',
};

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  clearable = false,
  search: searchProp,
  onSearchChange,
  invalid = false,
  disabled = false,
  size = 'md',
  emptyText = '无匹配选项',
  className = '',
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [internalSearch, setInternalSearch] = useState('');
  const search = searchProp !== undefined ? searchProp : internalSearch;

  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  useEffect(() => setActiveIndex(0), [filtered.length]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const setSearch = (next: string) => {
    if (searchProp === undefined) setInternalSearch(next);
    onSearchChange?.(next);
    setOpen(true);
  };

  const selectOption = (opt: ComboboxOption) => {
    onValueChange(opt.value);
    setOpen(false);
    setSearch('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setOpen(true);
        if (e.key !== 'Enter') e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        const opt = filtered[activeIndex];
        if (opt) selectOption(opt);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const activeId = open && filtered[activeIndex] ? listboxId + '-opt-' + activeIndex : undefined;

  return (
    <div ref={rootRef} className={['relative', className].filter(Boolean).join(' ')}>
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={open ? search : (selected?.label ?? search)}
          placeholder={placeholder}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={[
            CONTROL_CLASS,
            'transition-colors duration-150 ease-out',
            invalid
              ? 'border-status-danger-border focus:border-status-danger-text'
              : 'focus:border-brand-500',
            SIZE_CLASS[size],
            'pr-9',
          ]
            .filter(Boolean)
            .join(' ')}
        />
        <span className="text-ink-muted pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
          {clearable && (selected || search) ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label="清空"
              onClick={(e) => {
                e.stopPropagation();
                onValueChange(null);
                setSearch('');
                inputRef.current?.focus();
              }}
              className="text-ink-muted hover:text-ink-primary pointer-events-auto rounded p-0.5 transition-colors"
            >
              <Icon name="x" size={14} />
            </button>
          ) : (
            <Icon name="chevron-down" size={16} />
          )}
        </span>
      </div>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="animate-dropdown-in border-border bg-surface shadow-elevation-md absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border py-1"
        >
          {filtered.length === 0 ? (
            <li className="text-ink-muted px-3 py-2 text-sm">{emptyText}</li>
          ) : (
            filtered.map((opt, i) => {
              const isActive = i === activeIndex;
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value}
                  id={listboxId + '-opt-' + i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => selectOption(opt)}
                  className={[
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors duration-100',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-primary',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected ? (
                    <span className="text-brand-600 shrink-0">
                      <Icon name="check" size={14} />
                    </span>
                  ) : opt.hint ? (
                    <span className="text-ink-muted shrink-0 text-xs">{opt.hint}</span>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
