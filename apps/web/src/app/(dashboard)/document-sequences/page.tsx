"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.DOCUMENT_SEQUENCE_READ}>
      <PlaceholderPage title="单据序列" description="维护报价/订单/项目等单据编号序列规则。" />
    </PermissionGuard>
  );
}
