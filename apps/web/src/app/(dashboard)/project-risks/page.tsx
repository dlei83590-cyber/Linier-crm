"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_RISK_READ}>
      <PlaceholderPage title="项目风险" description="项目风险登记、应对方案、责任人与关闭状态。" />
    </PermissionGuard>
  );
}
