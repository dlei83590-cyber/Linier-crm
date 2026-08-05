"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function DepartmentsPage() {
  return (
    <PermissionGuard permission={PERMISSIONS.USER_READ}>
      <PlaceholderPage title="部门管理" description="维护组织架构与部门层级关系。" />
    </PermissionGuard>
  );
}
