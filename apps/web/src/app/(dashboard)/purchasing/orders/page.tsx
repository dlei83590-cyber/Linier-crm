"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_ORDER_READ}>
      <PlaceholderPage title="采购订单" description="采购承诺事实源（PO）；APPROVED ≠ CONFIRMED，Confirm 后进入收货链。" />
    </PermissionGuard>
  );
}
