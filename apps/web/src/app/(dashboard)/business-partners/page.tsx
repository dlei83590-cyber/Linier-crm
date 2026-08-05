"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.BUSINESS_PARTNER_READ}>
      <PlaceholderPage title="往来单位管理" description="客户/供应商/客户兼供应商统一管理，含统一社会信用代码、开票与结算信息。" />
    </PermissionGuard>
  );
}
