import { PERMISSIONS, type ROLES } from "../constants";

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: Object.values(PERMISSIONS),
  ADMIN: Object.values(PERMISSIONS),
  MANAGER: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.SUPPLIER_READ,
    PERMISSIONS.MATERIAL_READ,
    PERMISSIONS.PRICE_LIST_READ,
  ],
  MEMBER: [PERMISSIONS.USER_READ, PERMISSIONS.PRODUCT_READ, PERMISSIONS.MATERIAL_READ],
  VIEWER: [],
};

export function permissionsForRole(role: RoleCode): PermissionCode[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(roles: RoleCode[], required: PermissionCode): boolean {
  return roles.some((role) => permissionsForRole(role).includes(required));
}
