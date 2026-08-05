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
    // Sprint 3A：工作流平台（Workflow/Approval/Notification/Dictionary/Settings）
    "workflow-definition:view", "workflow-definition:create", "workflow-definition:edit", "workflow-definition:delete", "workflow-definition:approve", "workflow-definition:audit", "workflow-definition:export", "workflow-definition:import", "workflow-definition:assign", "workflow-definition:close",
    "workflow-step:view", "workflow-step:create", "workflow-step:edit", "workflow-step:delete", "workflow-step:approve", "workflow-step:audit", "workflow-step:export", "workflow-step:import", "workflow-step:assign", "workflow-step:close",
    "workflow-condition:view", "workflow-condition:create", "workflow-condition:edit", "workflow-condition:delete", "workflow-condition:approve", "workflow-condition:audit", "workflow-condition:export", "workflow-condition:import", "workflow-condition:assign", "workflow-condition:close",
    "workflow-instance:view", "workflow-instance:create", "workflow-instance:edit", "workflow-instance:delete", "workflow-instance:approve", "workflow-instance:audit", "workflow-instance:export", "workflow-instance:import", "workflow-instance:assign", "workflow-instance:close",
    "workflow-action:view", "workflow-action:create", "workflow-action:edit", "workflow-action:delete", "workflow-action:approve", "workflow-action:audit", "workflow-action:export", "workflow-action:import", "workflow-action:assign", "workflow-action:close",
    "workflow-history:view", "workflow-history:create", "workflow-history:edit", "workflow-history:delete", "workflow-history:approve", "workflow-history:audit", "workflow-history:export", "workflow-history:import", "workflow-history:assign", "workflow-history:close",
    "approver:view", "approver:create", "approver:edit", "approver:delete", "approver:approve", "approver:audit", "approver:export", "approver:import", "approver:assign", "approver:close",
    "approver-group:view", "approver-group:create", "approver-group:edit", "approver-group:delete", "approver-group:approve", "approver-group:audit", "approver-group:export", "approver-group:import", "approver-group:assign", "approver-group:close",
    "approval-delegate:view", "approval-delegate:create", "approval-delegate:edit", "approval-delegate:delete", "approval-delegate:approve", "approval-delegate:audit", "approval-delegate:export", "approval-delegate:import", "approval-delegate:assign", "approval-delegate:close",
    "approval-escalation:view", "approval-escalation:create", "approval-escalation:edit", "approval-escalation:delete", "approval-escalation:approve", "approval-escalation:audit", "approval-escalation:export", "approval-escalation:import", "approval-escalation:assign", "approval-escalation:close",
    "approval-timeout:view", "approval-timeout:create", "approval-timeout:edit", "approval-timeout:delete", "approval-timeout:approve", "approval-timeout:audit", "approval-timeout:export", "approval-timeout:import", "approval-timeout:assign", "approval-timeout:close",
    "approval-reminder:view", "approval-reminder:create", "approval-reminder:edit", "approval-reminder:delete", "approval-reminder:approve", "approval-reminder:audit", "approval-reminder:export", "approval-reminder:import", "approval-reminder:assign", "approval-reminder:close",
    "notification-template:view", "notification-template:create", "notification-template:edit", "notification-template:delete", "notification-template:approve", "notification-template:audit", "notification-template:export", "notification-template:import", "notification-template:assign", "notification-template:close",
    "notification-message:view", "notification-message:create", "notification-message:edit", "notification-message:delete", "notification-message:approve", "notification-message:audit", "notification-message:export", "notification-message:import", "notification-message:assign", "notification-message:close",
    "notification-channel:view", "notification-channel:create", "notification-channel:edit", "notification-channel:delete", "notification-channel:approve", "notification-channel:audit", "notification-channel:export", "notification-channel:import", "notification-channel:assign", "notification-channel:close",
    "notification-log:view", "notification-log:create", "notification-log:edit", "notification-log:delete", "notification-log:approve", "notification-log:audit", "notification-log:export", "notification-log:import", "notification-log:assign", "notification-log:close",
    "dictionary-type:view", "dictionary-type:create", "dictionary-type:edit", "dictionary-type:delete", "dictionary-type:approve", "dictionary-type:audit", "dictionary-type:export", "dictionary-type:import", "dictionary-type:assign", "dictionary-type:close",
    "dictionary-item:view", "dictionary-item:create", "dictionary-item:edit", "dictionary-item:delete", "dictionary-item:approve", "dictionary-item:audit", "dictionary-item:export", "dictionary-item:import", "dictionary-item:assign", "dictionary-item:close",
    "system-setting:view", "system-setting:create", "system-setting:edit", "system-setting:delete", "system-setting:approve", "system-setting:audit", "system-setting:export", "system-setting:import", "system-setting:assign", "system-setting:close",
    "tenant-setting:view", "tenant-setting:create", "tenant-setting:edit", "tenant-setting:delete", "tenant-setting:approve", "tenant-setting:audit", "tenant-setting:export", "tenant-setting:import", "tenant-setting:assign", "tenant-setting:close",
    "user-setting:view", "user-setting:create", "user-setting:edit", "user-setting:delete", "user-setting:approve", "user-setting:audit", "user-setting:export", "user-setting:import", "user-setting:assign", "user-setting:close",
    // Sprint 3B：菜单平台
    "menu:view", "menu:create", "menu:edit", "menu:delete", "menu:approve", "menu:audit", "menu:export", "menu:import", "menu:assign", "menu:close",
    "menu-group:view", "menu-group:create", "menu-group:edit", "menu-group:delete", "menu-group:approve", "menu-group:audit", "menu-group:export", "menu-group:import", "menu-group:assign", "menu-group:close",
    // Sprint 3B：Dashboard API
    "dashboard-widget:view", "dashboard-widget:create", "dashboard-widget:edit", "dashboard-widget:delete", "dashboard-widget:approve", "dashboard-widget:audit", "dashboard-widget:export", "dashboard-widget:import", "dashboard-widget:assign", "dashboard-widget:close",
    "dashboard-layout:view", "dashboard-layout:create", "dashboard-layout:edit", "dashboard-layout:delete", "dashboard-layout:approve", "dashboard-layout:audit", "dashboard-layout:export", "dashboard-layout:import", "dashboard-layout:assign", "dashboard-layout:close",
    "dashboard-kpi:view", "dashboard-kpi:create", "dashboard-kpi:edit", "dashboard-kpi:delete", "dashboard-kpi:approve", "dashboard-kpi:audit", "dashboard-kpi:export", "dashboard-kpi:import", "dashboard-kpi:assign", "dashboard-kpi:close",
    "dashboard-chart:view", "dashboard-chart:create", "dashboard-chart:edit", "dashboard-chart:delete", "dashboard-chart:approve", "dashboard-chart:audit", "dashboard-chart:export", "dashboard-chart:import", "dashboard-chart:assign", "dashboard-chart:close",
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
