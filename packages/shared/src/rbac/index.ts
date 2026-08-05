import { ALL_ACTION_PERMISSIONS, PERMISSIONS, type ROLES } from "../constants";

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export type PermissionCode = string;

const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: [...Object.values(PERMISSIONS), ...ALL_ACTION_PERMISSIONS],
  ADMIN: [...Object.values(PERMISSIONS), ...ALL_ACTION_PERMISSIONS],
  MANAGER: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.ITEM_READ,
    PERMISSIONS.ITEM_WRITE,
    PERMISSIONS.BUSINESS_PARTNER_READ,
    PERMISSIONS.BUSINESS_PARTNER_WRITE,
    PERMISSIONS.PRICE_LIST_READ,
    PERMISSIONS.PRICE_LIST_WRITE,
    PERMISSIONS.TECHNICAL_STANDARD_READ,
    PERMISSIONS.TECHNICAL_STANDARD_WRITE,
    PERMISSIONS.UNIT_OF_MEASURE_READ,
    PERMISSIONS.UNIT_OF_MEASURE_WRITE,
    PERMISSIONS.COMMERCIAL_TERM_READ,
    PERMISSIONS.COMMERCIAL_TERM_WRITE,
    PERMISSIONS.DOCUMENT_SEQUENCE_READ,
    PERMISSIONS.DOCUMENT_SEQUENCE_WRITE,
    PERMISSIONS.PROJECT_OPPORTUNITY_READ,
    PERMISSIONS.PROJECT_OPPORTUNITY_WRITE,
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_WRITE,
    PERMISSIONS.PROJECT_VISIT_READ,
    PERMISSIONS.PROJECT_VISIT_WRITE,
    PERMISSIONS.PROJECT_RISK_READ,
    PERMISSIONS.PROJECT_RISK_WRITE,
    // 动作级：主数据与项目模块 view/create/edit/delete/approve/audit/export/import/assign/close
    "item:view", "item:create", "item:edit", "item:delete", "item:approve", "item:audit", "item:export", "item:import", "item:assign", "item:close",
    "business-partner:view", "business-partner:create", "business-partner:edit", "business-partner:delete", "business-partner:approve", "business-partner:audit", "business-partner:export", "business-partner:import", "business-partner:assign", "business-partner:close",
    "price-list:view", "price-list:create", "price-list:edit", "price-list:delete", "price-list:approve", "price-list:audit", "price-list:export", "price-list:import", "price-list:assign", "price-list:close",
    "project-opportunity:view", "project-opportunity:create", "project-opportunity:edit", "project-opportunity:delete", "project-opportunity:approve", "project-opportunity:audit", "project-opportunity:export", "project-opportunity:import", "project-opportunity:assign", "project-opportunity:close",
    "project:view", "project:create", "project:edit", "project:delete", "project:approve", "project:audit", "project:export", "project:import", "project:assign", "project:close",
    "project-visit:view", "project-visit:create", "project-visit:edit", "project-visit:delete", "project-visit:approve", "project-visit:audit", "project-visit:export", "project-visit:import", "project-visit:assign", "project-visit:close",
    "project-risk:view", "project-risk:create", "project-risk:edit", "project-risk:delete", "project-risk:approve", "project-risk:audit", "project-risk:export", "project-risk:import", "project-risk:assign", "project-risk:close",
  ],
  MEMBER: [
    PERMISSIONS.USER_READ,
    PERMISSIONS.ITEM_READ,
    PERMISSIONS.BUSINESS_PARTNER_READ,
    PERMISSIONS.PROJECT_OPPORTUNITY_READ,
    PERMISSIONS.PROJECT_READ,
    PERMISSIONS.PROJECT_VISIT_READ,
    PERMISSIONS.PROJECT_RISK_READ,
    "item:view", "business-partner:view", "project-opportunity:view", "project:view", "project-visit:view", "project-risk:view",
  ],
  VIEWER: [],
};

export function permissionsForRole(role: RoleCode): PermissionCode[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(roles: RoleCode[], required: PermissionCode): boolean {
  return roles.some((role) => permissionsForRole(role).includes(required));
}
