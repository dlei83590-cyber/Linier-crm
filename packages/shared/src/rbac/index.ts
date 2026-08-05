import { PERMISSIONS, type ROLES } from "../constants";

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  ADMIN: Object.values(PERMISSIONS),
  MANAGER: [PERMISSIONS.USER_READ, PERMISSIONS.ROLE_READ],
  MEMBER: [PERMISSIONS.USER_READ],
  VIEWER: [],
};

export function permissionsForRole(role: RoleCode): PermissionCode[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(roles: RoleCode[], required: PermissionCode): boolean {
  return roles.some((role) => permissionsForRole(role).includes(required));
}
