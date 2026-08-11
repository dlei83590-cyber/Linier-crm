"use client";

import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

// ⚠️ QUERY CONTRACT GAP / HOLD（CTO #8845 Frontend Contract Blocking）：
// Inventory Ledger / Stock Projection 无 FINAL Read API——6A Final 只暴露 Consumer contract，
// 未发布 InventoryMovement/StockProjection 只读端点。正式 Backend Read Model Gate 前：
// ① 保留 Placeholder 骨架；② 不允许真实数据接线；③ 不声明 inventory-ledger:view 为生产权限。
export default function Page() {
  return (
    <PermissionGuard permission={null}>
      <PlaceholderPage title="库存流水" description="InventoryMovement 不可变账本只读追溯；库存数量唯一事实源（SSOT）。⚠️ 后端 Read Model Gate 前 HOLD。" />
    </PermissionGuard>
  );
}
