/**
 * Track A Frontend Iteration 1 — 状态徽章（纯展示组件）
 *
 * 只负责展示，不负责业务状态映射（禁止 APPROVED→"完成"类跨状态语义压缩）。
 * 显示文案可中文化，但内部 key 必须保留真实 enum（CTO Scale-Out Gate §11）。
 * 新枚举按模块随 Scale-Out 增量补充。
 */
const STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "草稿", className: "bg-slate-100 text-slate-700" },
  SUBMITTED: { label: "已提交", className: "bg-blue-100 text-blue-700" },
  APPROVED: { label: "已批准", className: "bg-green-100 text-green-700" },
  CONVERTED: { label: "已转单", className: "bg-violet-100 text-violet-700" },
  EXECUTED: { label: "已执行", className: "bg-teal-100 text-teal-700" },
  CANCELLED: { label: "已取消", className: "bg-red-100 text-red-700" },
  // PurchaseOrder（5A）
  CONFIRMED: { label: "已确认", className: "bg-emerald-100 text-emerald-700" },
  PARTIALLY_RECEIVED: { label: "部分收货", className: "bg-amber-100 text-amber-700" },
  RECEIVED: { label: "已收货", className: "bg-teal-100 text-teal-700" },
  // WarehouseReceipt（5B）
  POSTED: { label: "已过账", className: "bg-teal-100 text-teal-700" },
  // PurchaseReturn（5B）
  RETURNED: { label: "已退货", className: "bg-rose-100 text-rose-700" },
  // Inspection（5B，result 枚举）
  QUALIFIED: { label: "合格", className: "bg-green-100 text-green-700" },
  PARTIAL: { label: "部分合格", className: "bg-amber-100 text-amber-700" },
  REJECTED: { label: "拒收", className: "bg-red-100 text-red-700" },
  PENDING: { label: "待检", className: "bg-blue-100 text-blue-700" },
  // StockCount（6B）
  COUNTING: { label: "盘点中", className: "bg-blue-100 text-blue-700" },
  COMPLETED: { label: "已完成", className: "bg-teal-100 text-teal-700" },
  ADJUSTED: { label: "已调整", className: "bg-violet-100 text-violet-700" },
  // InventoryAdjustment（6B）
  APPLIED: { label: "已应用", className: "bg-teal-100 text-teal-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, className: "bg-slate-100 text-slate-700" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
