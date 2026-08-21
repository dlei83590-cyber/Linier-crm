/**
 * 日期/金额格式化横切工具
 * 服务端 ISO 字符串 → 本地化展示；null/undefined/非法输入返回占位符。
 * U9 共性层：formatDateOnly（业务日期，无时分秒）/ formatMoneyValue（纯数值，无币种前缀）。
 */

/** 完整时间戳（审计/创建/更新时间等；含时分秒） */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 业务日期（开票/收货/到期/过账等单据日期；仅 YYYY/MM/DD，无时分秒）
 * 中国环境业务习惯：单据日期按自然日，不展示时间粒度。
 */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
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

/**
 * 纯数值金额（2 位小数、千分位；无币种前缀——单币种 CNY 决策下币种列/前缀冗余）
 * 例：formatMoneyValue("12345.6789") → "12,345.68"
 */
export function formatMoneyValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
