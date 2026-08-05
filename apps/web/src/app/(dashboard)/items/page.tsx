"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.ITEM_READ}>
      <PlaceholderPage title="物料管理" description="统一物料主数据（成品/原材料/配件/外购件/服务/包装物），含直线导轨规格扩展。" />
    </PermissionGuard>
  );
}
