"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INSPECTION_READ}>
      <PlaceholderPage title="质检" description="质量合格事实；SKIP/SPOT/FULL，qualifiedQty + rejectedQty = inspectableQty。" />
    </PermissionGuard>
  );
}
