/**
 * Input — 统一文本输入框（FE 2.0 UI-01）
 *
 * 消费 CONTROL_CLASS（tokens.ts）；error 态 danger 边框；sm/md 两档；可选前后缀图标。
 * 与 FormField（error 在 field 下方）配合：error 仅改边框，不重复文案。
 */
'use client';

import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { CONTROL_CLASS } from '@/components/design-system';

export type InputSize = 'sm' | 'md';

const SIZE_CLASS: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-sm',
  md: 'h-10 px-3 text-sm',
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  /** 校验失败：danger 边框（文案由 FormField error 负责） */
  invalid?: boolean;
  /** 前置元素（图标等） */
  leading?: ReactNode;
  /** 后置元素（单位、按钮等） */
  trailing?: ReactNode;
  /** 撑满父容器（默认 true） */
  block?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid = false, leading, trailing, block = true, className = '', ...rest },
  ref,
) {
  const base = [
    CONTROL_CLASS,
    'transition-colors duration-150 ease-out',
    invalid
      ? 'border-status-danger-border focus:border-status-danger-text'
      : 'focus:border-brand-500',
    !block ? 'w-auto' : '',
    SIZE_CLASS[size],
  ]
    .filter(Boolean)
    .join(' ');

  if (!leading && !trailing) {
    return <input ref={ref} className={[base, className].filter(Boolean).join(' ')} aria-invalid={invalid || undefined} {...rest} />;
  }

  return (
    <div className={['relative flex items-center', block ? 'w-full' : 'w-auto', className].filter(Boolean).join(' ')}>
      {leading ? <span className="text-ink-muted pointer-events-none absolute left-2.5 flex items-center">{leading}</span> : null}
      <input
        ref={ref}
        className={[base, leading ? 'pl-8' : '', trailing ? 'pr-8' : ''].filter(Boolean).join(' ')}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {trailing ? <span className="text-ink-secondary pointer-events-none absolute right-2.5 flex items-center">{trailing}</span> : null}
    </div>
  );
});
