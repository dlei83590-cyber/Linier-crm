"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function SuppliersPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.SUPPLIER_READ}>
      <PlaceholderPage title="供应商管理" description="维护供应商主数据，后续采购订单的基础。" />
    </PermissionGuard>
  );
}
