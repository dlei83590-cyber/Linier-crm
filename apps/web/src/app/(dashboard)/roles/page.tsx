"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function RolesPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.ROLE_READ}>
      <PlaceholderPage title="角色权限" description="维护角色定义与权限映射关系。" />
    </PermissionGuard>
  );
}
