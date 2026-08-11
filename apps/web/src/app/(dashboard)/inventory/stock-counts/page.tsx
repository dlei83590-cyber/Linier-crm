"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.STOCK_COUNT_READ}>
      <PlaceholderPage title="库存盘点" description="实盘事实；行录入冻结账面数/差异，完成盘点不直接修改库存账（差异经调整单落账）。" />
    </PermissionGuard>
  );
}
