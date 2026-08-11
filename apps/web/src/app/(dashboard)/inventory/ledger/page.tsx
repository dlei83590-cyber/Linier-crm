"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_LEDGER_READ}>
      <PlaceholderPage title="库存流水" description="InventoryMovement 不可变账本只读追溯；库存数量唯一事实源（SSOT）。" />
    </PermissionGuard>
  );
}
