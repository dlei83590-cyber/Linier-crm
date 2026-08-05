"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_OPPORTUNITY_READ}>
      <PlaceholderPage title="项目机会" description="线索→准入→方案→报价阶段的商机管理，含客户投入、预计营收、毛利与回款状态。" />
    </PermissionGuard>
  );
}
