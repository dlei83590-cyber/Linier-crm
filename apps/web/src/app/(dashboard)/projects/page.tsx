"use client";

import { PERMISSIONS } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function Page() {
  return (
    <PermissionGuard permission={PERMISSIONS.PROJECT_READ}>
      <PlaceholderPage title="项目管理" description="试样/测试/小批量/批量供货阶段项目，含里程碑、任务、风险、走访、验收与结项。" />
    </PermissionGuard>
  );
}
