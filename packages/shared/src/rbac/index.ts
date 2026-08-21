import { ALL_ACTION_PERMISSIONS, PERMISSIONS, SYSTEM_PERMISSIONS, type ROLES } from "../constants";

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];
export type PermissionCode = string;

const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  SUPER_ADMIN: [...Object.values(PERMISSIONS), ...ALL_ACTION_PERMISSIONS, ...SYSTEM_PERMISSIONS],
  ADMIN: [...Object.values(PERMISSIONS), ...ALL_ACTION_PERMISSIONS, ...SYSTEM_PERMISSIONS],
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
    "department:view", // Pending Pages Completion Gate（Batch 2）：部门树只读（部门维护仅 ADMIN/SUPER_ADMIN）
    "item:view", "item:create", "item:edit", "item:delete", "item:approve", "item:audit", "item:export", "item:import", "item:assign", "item:close",
    "business-partner:view", "business-partner:create", "business-partner:edit", "business-partner:delete", "business-partner:approve", "business-partner:audit", "business-partner:export", "business-partner:import", "business-partner:assign", "business-partner:close",
    "price-list:view", "price-list:create", "price-list:edit", "price-list:delete", "price-list:approve", "price-list:audit", "price-list:export", "price-list:import", "price-list:assign", "price-list:close",
    "technical-standard:view", "technical-standard:create", "technical-standard:edit", "technical-standard:delete", "technical-standard:approve", "technical-standard:audit", "technical-standard:export", "technical-standard:import", "technical-standard:assign", "technical-standard:close",
    "unit-of-measure:view", "unit-of-measure:create", "unit-of-measure:edit", "unit-of-measure:delete", "unit-of-measure:approve", "unit-of-measure:audit", "unit-of-measure:export", "unit-of-measure:import", "unit-of-measure:assign", "unit-of-measure:close",
    "commercial-term:view", "commercial-term:create", "commercial-term:edit", "commercial-term:delete", "commercial-term:approve", "commercial-term:audit", "commercial-term:export", "commercial-term:import", "commercial-term:assign", "commercial-term:close",
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
    // Sprint 3B：File Center
    "file:view", "file:create", "file:edit", "file:delete", "file:approve", "file:audit", "file:export", "file:import", "file:assign", "file:close",
    "file-folder:view", "file-folder:create", "file-folder:edit", "file-folder:delete", "file-folder:approve", "file-folder:audit", "file-folder:export", "file-folder:import", "file-folder:assign", "file-folder:close",
    "file-version:view", "file-version:create", "file-version:edit", "file-version:delete", "file-version:approve", "file-version:audit", "file-version:export", "file-version:import", "file-version:assign", "file-version:close",
    "file-attachment:view", "file-attachment:create", "file-attachment:edit", "file-attachment:delete", "file-attachment:approve", "file-attachment:audit", "file-attachment:export", "file-attachment:import", "file-attachment:assign", "file-attachment:close",
    // Sprint 3C：业务底座（Customer Foundation）
    "customer:view", "customer:create", "customer:edit", "customer:delete", "customer:approve", "customer:audit", "customer:export", "customer:import", "customer:assign", "customer:close",
    "customer-contact:view", "customer-contact:create", "customer-contact:edit", "customer-contact:delete", "customer-contact:approve", "customer-contact:audit", "customer-contact:export", "customer-contact:import", "customer-contact:assign", "customer-contact:close",
    "customer-address:view", "customer-address:create", "customer-address:edit", "customer-address:delete", "customer-address:approve", "customer-address:audit", "customer-address:export", "customer-address:import", "customer-address:assign", "customer-address:close",
    "customer-tag:view", "customer-tag:create", "customer-tag:edit", "customer-tag:delete", "customer-tag:approve", "customer-tag:audit", "customer-tag:export", "customer-tag:import", "customer-tag:assign", "customer-tag:close",
    "customer-credit:view", "customer-credit:create", "customer-credit:edit", "customer-credit:delete", "customer-credit:approve", "customer-credit:audit", "customer-credit:export", "customer-credit:import", "customer-credit:assign", "customer-credit:close",
    "industry:view", "industry:create", "industry:edit", "industry:delete", "industry:approve", "industry:audit", "industry:export", "industry:import", "industry:assign", "industry:close",
    "tag:view", "tag:create", "tag:edit", "tag:delete", "tag:approve", "tag:audit", "tag:export", "tag:import", "tag:assign", "tag:close",
    // Sprint 3C-2：Supplier Foundation + Partner 共享（BusinessPartner 唯一主体）
    "supplier:view", "supplier:create", "supplier:edit", "supplier:delete", "supplier:approve", "supplier:audit", "supplier:export", "supplier:import", "supplier:assign", "supplier:close",
    "supplier-qualification:view", "supplier-qualification:create", "supplier-qualification:edit", "supplier-qualification:delete", "supplier-qualification:approve", "supplier-qualification:audit", "supplier-qualification:export", "supplier-qualification:import", "supplier-qualification:assign", "supplier-qualification:close",
    "supplier-certificate:view", "supplier-certificate:create", "supplier-certificate:edit", "supplier-certificate:delete", "supplier-certificate:approve", "supplier-certificate:audit", "supplier-certificate:export", "supplier-certificate:import", "supplier-certificate:assign", "supplier-certificate:close",
    "supplier-settlement:view", "supplier-settlement:create", "supplier-settlement:edit", "supplier-settlement:delete", "supplier-settlement:approve", "supplier-settlement:audit", "supplier-settlement:export", "supplier-settlement:import", "supplier-settlement:assign", "supplier-settlement:close",
    "business-partner-role:view", "business-partner-role:create", "business-partner-role:edit", "business-partner-role:delete", "business-partner-role:approve", "business-partner-role:audit", "business-partner-role:export", "business-partner-role:import", "business-partner-role:assign", "business-partner-role:close",
    "partner-contact:view", "partner-contact:create", "partner-contact:edit", "partner-contact:delete", "partner-contact:approve", "partner-contact:audit", "partner-contact:export", "partner-contact:import", "partner-contact:assign", "partner-contact:close",
    "partner-address:view", "partner-address:create", "partner-address:edit", "partner-address:delete", "partner-address:approve", "partner-address:audit", "partner-address:export", "partner-address:import", "partner-address:assign", "partner-address:close",
    "partner-tag:view", "partner-tag:create", "partner-tag:edit", "partner-tag:delete", "partner-tag:approve", "partner-tag:audit", "partner-tag:export", "partner-tag:import", "partner-tag:assign", "partner-tag:close",
    "partner-bank-account:view", "partner-bank-account:create", "partner-bank-account:edit", "partner-bank-account:delete", "partner-bank-account:approve", "partner-bank-account:audit", "partner-bank-account:export", "partner-bank-account:import", "partner-bank-account:assign", "partner-bank-account:close",
    "partner-credit:view", "partner-credit:create", "partner-credit:edit", "partner-credit:delete", "partner-credit:approve", "partner-credit:audit", "partner-credit:export", "partner-credit:import", "partner-credit:assign", "partner-credit:close",
    // Sprint 3C-3：Item Master Foundation（item 动作级已存在，新增 8 子模块）
    "item-category:view", "item-category:create", "item-category:edit", "item-category:delete", "item-category:approve", "item-category:audit", "item-category:export", "item-category:import", "item-category:assign", "item-category:close",
    "item-specification:view", "item-specification:create", "item-specification:edit", "item-specification:delete", "item-specification:approve", "item-specification:audit", "item-specification:export", "item-specification:import", "item-specification:assign", "item-specification:close",
    "item-uom:view", "item-uom:create", "item-uom:edit", "item-uom:delete", "item-uom:approve", "item-uom:audit", "item-uom:export", "item-uom:import", "item-uom:assign", "item-uom:close",
    "item-cost:view", "item-cost:create", "item-cost:edit", "item-cost:delete", "item-cost:approve", "item-cost:audit", "item-cost:export", "item-cost:import", "item-cost:assign", "item-cost:close",
    "item-supplier:view", "item-supplier:create", "item-supplier:edit", "item-supplier:delete", "item-supplier:approve", "item-supplier:audit", "item-supplier:export", "item-supplier:import", "item-supplier:assign", "item-supplier:close",
    "item-revision:view", "item-revision:create", "item-revision:edit", "item-revision:delete", "item-revision:approve", "item-revision:audit", "item-revision:export", "item-revision:import", "item-revision:assign", "item-revision:close",
    "item-tag:view", "item-tag:create", "item-tag:edit", "item-tag:delete", "item-tag:approve", "item-tag:audit", "item-tag:export", "item-tag:import", "item-tag:assign", "item-tag:close",
    "item-attachment:view", "item-attachment:create", "item-attachment:edit", "item-attachment:delete", "item-attachment:approve", "item-attachment:audit", "item-attachment:export", "item-attachment:import", "item-attachment:assign", "item-attachment:close",
  ],
  MEMBER: [
    PERMISSIONS.USER_READ,
    "department:view", // Pending Pages Completion Gate（Batch 2）：部门树只读（MANAGER/MEMBER），部门维护仅 ADMIN/SUPER_ADMIN
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
