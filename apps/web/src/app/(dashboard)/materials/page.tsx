"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function MaterialsPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.MATERIAL_READ}>
      <PlaceholderPage title="物料管理" description="维护物料主数据，后续库存与采购的基础。" />
    </PermissionGuard>
  );
}
