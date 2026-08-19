"use client";

/**
 * FormField — 统一表单字段容器（UI 批次3：消除页面级重复 Field 定义）
 * 结构：label（可选 required 标记）→ children（输入控件）。
 */
import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}

export function FormField({ label, required, htmlFor, hint, children }: FormFieldProps) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}
