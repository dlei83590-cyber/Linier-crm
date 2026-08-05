"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_VISIT_READ}>
      <PlaceholderPage title="客户走访" description="客户走访与沟通记录，含下次行动与提醒。" />
    </PermissionGuard>
  );
}
