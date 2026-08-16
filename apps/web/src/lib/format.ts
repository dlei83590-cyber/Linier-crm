/**
 * Track A Frontend Iteration 1 — 日期格式化横切工具（reference 实现）
 * 服务端 ISO 字符串 → 本地化展示；null/undefined/非法输入返回占位符。
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * F2-6A — 金额格式化（Prisma Decimal 经 JSON 序列化为字符串；null/NaN 返回占位符）
 * 例：formatMoney("12345.6789", "CNY") → "CNY 12,345.68"
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  const formatted = n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}
