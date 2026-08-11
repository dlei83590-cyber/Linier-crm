"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.WAREHOUSE_RECEIPT_READ}>
      <PlaceholderPage title="采购入库" description="采购入库事实；Posted 触发 6A InventoryMovement(IN)，Created ≠ Posted。" />
    </PermissionGuard>
  );
}
