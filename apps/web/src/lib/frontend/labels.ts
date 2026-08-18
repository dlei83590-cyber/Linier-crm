/**
 * Frontend 中文显示标签（中文化审计）— minimal 诊断版
 */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
};
export function roleLabel(code: string, fallback?: string | null): string {
  return ROLE_LABELS[code] || fallback || code;
}
export const ACTION_LABELS: Record<string, string> = {
  view: "查看",
};
export const MODULE_LABELS: Record<string, string> = {
  item: "物料",
};
export function moduleLabel(slug: string): string {
  return MODULE_LABELS[slug] || slug;
}
export function permissionLabel(code: string): string {
  const idx = code.indexOf(":");
  if (idx <= 0) return code;
  return moduleLabel(code.slice(0, idx)) + "·" + (ACTION_LABELS[code.slice(idx + 1)] || code.slice(idx + 1));
}