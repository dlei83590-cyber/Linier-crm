"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_ADJUSTMENT_READ}>
      <PlaceholderPage title="库存调整" description="受控库存账事实；maker-checker（Apply 人 ≠ 创建人）；Apply 为唯一落账入口（受限权限）。" />
    </PermissionGuard>
  );
}
