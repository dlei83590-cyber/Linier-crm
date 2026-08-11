"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.INVENTORY_TRANSFER_READ}>
      <PlaceholderPage title="库存调拨" description="双边原子事实（SOURCE_OUT + DESTINATION_IN 同一 movementGroupId）；同仓同库位自调拨拒绝。" />
    </PermissionGuard>
  );
}
