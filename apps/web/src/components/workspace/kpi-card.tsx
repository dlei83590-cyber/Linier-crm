'use client';

/**
 * KpiCard — 现代 KPI 数字卡片（UI-03 Dashboard & Reports 共用，FE 2.0）
 *
 * - 数字（count）用 AnimatedNumber 缓动滚动；金额（money）用 AnimatedMoney
 * - 数值一律 tabular-nums 等宽数字（对齐设计语言「数字 tabular-nums」）
 * - 可选 Lucide 风格线性图标 + soft 底色块（图标底由调用方传 iconClass）
 * - hover 轻量 elevation 提升（fast 档 150ms ease-out；支持 prefers-reduced-motion）
 * - 纯展示，不负责数据获取；loading 骨架由页面侧渲染
 */
import { AnimatedNumber, AnimatedMoney } from "@/components/ui/animated-number";

export interface KpiCardProps {
  label: string;
  /** 数字（count）或金额字符串（money=true 时传 Decimal 字符串） */
  value: number | string;
  /** 金额模式：2 位小数 + 千分位 */
  money?: boolean;
  /** 金额前缀（如 ¥），紧贴数字无空格（中国金额习惯） */
  prefix?: string;
  hint?: string;
  /** Lucide 风格图标节点（h-4 w-4 起） */
  icon?: React.ReactNode;
  /** 图标底 soft 色类（如 bg-brand-50 text-brand-600） */
  iconClass?: string;
  className?: string;
  /** 数字滚动时长 ms（默认 500，FE 2.0 normal 档） */
  duration?: number;
}

export function KpiCard({
  label,
  value,
  money = false,
  prefix,
  hint,
  icon,
  iconClass,
  className = "",
  duration = 500,
}: KpiCardProps) {
  return (
    <div
      className={
        "rounded-xl border border-border bg-surface p-5 shadow-elevation-sm transition-shadow duration-150 ease-out hover:shadow-elevation-md motion-reduce:transition-none " +
        className
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-muted">{label}</p>
        {icon ? (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass ?? "bg-slate-100 text-slate-500"}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums text-ink-primary">
        {money ? (
          <>
            {prefix ? <span>{prefix}</span> : null}
            <AnimatedMoney value={value} />
          </>
        ) : typeof value === "number" ? (
          <AnimatedNumber value={value} duration={duration} />
        ) : (
          value
        )}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-secondary">{hint}</p> : null}
    </div>
  );
}
