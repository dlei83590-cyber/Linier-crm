/**
 * Track A Frontend Iteration 1 — 状态徽章（reference 实现）
 * 状态枚举 → 中文标签 + 颜色。采购/库存模块共用，新枚举按需扩展。
 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "bg-slate-100 text-slate-700" },
  SUBMITTED: { label: "已提交", className: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "已批准", className: "bg-green-100 text-green-700" },
  CONVERTED: { label: "已转单", className: "bg-violet-100 text-violet-700" },
  EXECUTED: { label: "已执行", className: "bg-teal-100 text-teal-700" },
  CANCELLED: { label: "已取消", className: "bg-red-100 text-red-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
