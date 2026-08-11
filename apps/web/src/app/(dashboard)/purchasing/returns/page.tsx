"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RETURN_READ}>
      <PlaceholderPage title="采购退货" description="独立退货事实；来源可退余额 Gate，REPLACE_REQUIRED 重开 PO 履约。" />
    </PermissionGuard>
  );
}
