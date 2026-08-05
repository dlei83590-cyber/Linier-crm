"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function PriceListsPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.PRICE_LIST_READ}>
      <PlaceholderPage title="价格表管理" description="维护价格表主数据，后续报价与订单定价的基础。" />
    </PermissionGuard>
  );
}
