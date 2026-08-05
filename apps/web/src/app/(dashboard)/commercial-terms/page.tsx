"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.COMMERCIAL_TERM_READ}>
      <PlaceholderPage title="商业条款" description="维护 EXW/FOB/CIF 等贸易术语与结算条款。" />
    </PermissionGuard>
  );
}
