"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function ProductsPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.PRODUCT_READ}>
      <PlaceholderPage title="产品管理" description="维护产品主数据，后续报价与销售订单的基础。" />
    </PermissionGuard>
  );
}
