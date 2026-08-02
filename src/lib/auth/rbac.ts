import { ForbiddenError } from "@/src/lib/http/errors";

export const Permission = {
  SYSTEM_READ: "system:read",
  SYSTEM_ADMIN: "system:admin",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export interface Principal {
  subject: string;
  roles: string[];
  permissions: Permission[];
}

export function hasPermission(
  principal: Principal,
  required: Permission,
): boolean {
  return principal.permissions.includes(required);
}

export function requirePermission(
  principal: Principal,
  required: Permission,
): void {
  if (!hasPermission(principal, required)) throw new ForbiddenError();
}
