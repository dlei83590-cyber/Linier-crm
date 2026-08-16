"use client";

import { actionPermission } from "@nilier-crm/shared";
import { PermissionGuard } from "@/components/guard/permission-guard";
import { PlaceholderPage } from "@/components/ui/placeholder-page";

export default function AuditLogsPage() {
  return (
    <PermissionGuard permission={actionPermission("audit", "view")}>
      <PlaceholderPage title="操作日志" description="查看安全敏感与破坏性操作的审计记录。" />
    </PermissionGuard>
  );
}
