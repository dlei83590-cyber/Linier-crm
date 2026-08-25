"use client";

/**
 * FormField — 统一表单字段容器（UI 批次3 / FE 2.0 UI-01 升级）
 *
 * 结构：label（可选 required 标记）→ children（输入控件）→ hint / error。
 * 升级（UI-01）：error 状态（错误在 field 下方，danger 色 + role=alert）；
 * hint 与 error 互斥展示（error 优先）；支持 className 透传。
 * 签名向后兼容：label / required / htmlFor / hint / children 全部保留。
 */
import type { ReactNode } from "react";

export interface FormFieldProps {
  label: string;
  required?: boolean;
  htmlFor?: string;
  /** 帮助文案（正常态；与 error 互斥展示） */
  hint?: string;
  /** 校验错误文案（错误在 field 下方） */
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  required,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <label htmlFor={htmlFor} className={"flex flex-col gap-1 " + className}>
      <span className="text-ink-secondary text-sm font-medium">
        {label}
        {required ? <span className="ml-0.5 text-status-danger-text">*</span> : null}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-status-danger-text text-xs">
          {error}
        </span>
      ) : hint ? (
        <span className="text-ink-muted text-xs">{hint}</span>
      ) : null}
    </label>
  );
}
