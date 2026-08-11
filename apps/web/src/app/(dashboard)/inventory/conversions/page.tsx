"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_CONVERSION_READ}>
      <PlaceholderPage title="转换 / 重包装" description="同物料 Repack / UOM Conversion；基准数量服务端计算，消耗与产出守恒强制。" />
    </PermissionGuard>
  );
}
