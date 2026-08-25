/**
 * Select — 统一下拉选择（FE 2.0 UI-01）
 *
 * 原生 select 包装（轻量、零依赖、键盘/读屏无障碍由原生保证）；
 * error 态 danger 边框；sm/md 两档；内置 chevron-down 指示图标。
 */
'use client';

import { forwardRef } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { CONTROL_CLASS } from '@/components/design-system';
import { Icon } from './icon';

export type SelectSize = 'sm' | 'md';

const SIZE_CLASS: Record<SelectSize, string> = {
  sm: 'h-8 pl-2.5 pr-8 text-sm',
  md: 'h-10 pl-3 pr-9 text-sm',
};

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
  /** 校验失败：danger 边框 */
  invalid?: boolean;
  /** 撑满父容器（默认 true） */
  block?: boolean;
  /** 自定义下拉图标（默认 chevron-down） */
  chevronIcon?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', invalid = false, block = true, chevronIcon, className = '', children, ...rest },
  ref,
) {
  return (
    <div className={['relative', block ? 'w-full' : 'inline-block w-auto', className].filter(Boolean).join(' ')}>
      <select
        ref={ref}
        className={[
          CONTROL_CLASS,
          'appearance-none transition-colors duration-150 ease-out',
          invalid
            ? 'border-status-danger-border focus:border-status-danger-text'
            : 'focus:border-brand-500',
          SIZE_CLASS[size],
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <span className="text-ink-muted pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
        {chevronIcon ?? <Icon name="chevron-down" size={16} />}
      </span>
    </div>
  );
});
