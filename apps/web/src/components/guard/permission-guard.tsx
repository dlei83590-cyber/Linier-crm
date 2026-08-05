"use client";

import type { ReactNode } from "react";
import { hasPermission, type PermissionCode, type RoleCode } from "@nilier-crm/shared";
import { useSession } from "@/lib/session-context";
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

  if (permission !== null && !hasPermission(state.user.roles as RoleCode[], permission)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
