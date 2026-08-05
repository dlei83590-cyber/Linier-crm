"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.UNIT_OF_MEASURE_READ}>
      <PlaceholderPage title="计量单位" description="维护计量单位主数据。" />
    </PermissionGuard>
  );
}
