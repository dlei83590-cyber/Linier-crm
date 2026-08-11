"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_LEDGER_READ}>
      <PlaceholderPage title="库存余额投影" description="五维库存余额（物料/仓库/库位/批次/序列号）只读展示；余额全部来自后端，前端不自行计算。" />
    </PermissionGuard>
  );
}
