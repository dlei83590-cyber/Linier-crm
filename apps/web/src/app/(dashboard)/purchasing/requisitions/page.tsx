"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PURCHASE_REQUISITION_READ}>
      <PlaceholderPage title="采购申请" description="内部需求事实源（PR）；创建即取号，可转采购订单。" />
    </PermissionGuard>
  );
}
