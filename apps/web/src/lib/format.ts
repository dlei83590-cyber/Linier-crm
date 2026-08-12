/**
 * Track A Frontend Iteration 1 — 日期格式化横切工具（reference 实现）
 * 服务端 ISO 字符串 → 本地化展示；null/undefined/非法输入返回占位符。
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}
