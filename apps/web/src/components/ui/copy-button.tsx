'use client';

/**
 * CopyButton — 复制按钮（FE 2.0 UI 补齐）
 * 单据编号/金额等高频复制场景；navigator.clipboard + 成功 Toast 反馈，
 * 成功后图标切换 check 1.5s 回弹；失败 Toast 提示，不静默。
 */
import { useState } from "react";
import { Icon } from "./icon";
import { useToast } from "./toast";

interface CopyButtonProps {
  /** 要复制的文本 */
  text: string;
  /** 无障碍标签（默认「复制」） */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export function CopyButton({ text, label = "复制", size = "sm", className = "" }: CopyButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("已复制");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-surface text-ink-secondary transition-colors hover:bg-slate-50 hover:text-ink-primary ${
        size === "sm" ? "h-6 w-6" : "h-8 w-8"
      } ${className}`}
    >
      <Icon name={copied ? "check" : "copy"} className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}
