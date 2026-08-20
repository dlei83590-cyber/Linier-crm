'use client';

/**
 * AnimatedNumber / AnimatedMoney — 数字滚动（Sprint8 U7）
 *
 * - 数值变化时 requestAnimationFrame 缓动滚动（ease-out cubic）
 * - AnimatedMoney 兼容 formatMoney 语义（null/NaN → "—"；currency 前缀；2 位小数）
 * 用于财务大数字卡片（利润表等），强化高饱和仪表盘观感。
 */
import { useEffect, useRef, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 700,
  decimals = 0,
  className = "",
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (value - from) * eased;
      setDisplay(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className}>
      {display.toLocaleString("zh-CN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}

interface AnimatedMoneyProps {
  value: string | number | null | undefined;
  currency?: string | null;
  className?: string;
}

export function AnimatedMoney({ value, currency, className = "" }: AnimatedMoneyProps) {
  if (value === null || value === undefined || value === "") {
    return <span className={className}>—</span>;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return <span className={className}>—</span>;
  return (
    <span className={className}>
      {currency ? `${currency} ` : ""}
      <AnimatedNumber value={n} decimals={2} />
    </span>
  );
}
