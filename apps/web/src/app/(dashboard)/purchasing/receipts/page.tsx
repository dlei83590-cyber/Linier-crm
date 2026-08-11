"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_RECEIPT_READ}>
      <PlaceholderPage title="到货收货" description="供应商送货事实；现场拒收与质检分离，只有 CONFIRMED/部分收货 PO 可收。" />
    </PermissionGuard>
  );
}
