"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.TECHNICAL_STANDARD_READ}>
      <PlaceholderPage title="技术标准" description="维护行业/企业技术标准，供物料引用。" />
    </PermissionGuard>
  );
}
