"use client";

import type { ReactNode } from "react";
import type { PermissionCode } from "@nilier-crm/shared";
import { can, useSession } from "@/lib/session-context";
import { Forbidden } from "@/components/ui/forbidden";

export function PermissionGuard({
  permission,
  children,
}: {
  permission: PermissionCode | null;
  children: ReactNode;
}) {
  const { state } = useSession();

  if (state.status !== "authenticated" || !state.user) {
    return null;
  }

  // ADR-0057：按会话有效权限集判定（DB 权威；fail-closed，不回退静态角色映射）
  if (!can(state.user, permission)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
