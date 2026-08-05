"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function UsersPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.USER_READ}>
      <PlaceholderPage title="用户管理" description="管理平台用户账号、启用状态与部门归属。" />
    </PermissionGuard>
  );
}
