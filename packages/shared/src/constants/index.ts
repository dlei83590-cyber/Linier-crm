export const APP_NAME = "Linier CRM Management System";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  MEMBER: "MEMBER",
  VIEWER: "VIEWER",
} as const;

export const PERMISSIONS = {
  USER_READ: "user:read",
  USER_WRITE: "user:write",
  ROLE_READ: "role:read",
  ROLE_WRITE: "role:write",
  AUDIT_READ: "audit:read",
  AUDIT_WRITE: "audit:write",
  ITEM_READ: "item:read",
  ITEM_WRITE: "item:write",
  BUSINESS_PARTNER_READ: "business-partner:read",
  BUSINESS_PARTNER_WRITE: "business-partner:write",
  PRICE_LIST_READ: "price-list:read",
  PRICE_LIST_WRITE: "price-list:write",
  TECHNICAL_STANDARD_READ: "technical-standard:read",
  TECHNICAL_STANDARD_WRITE: "technical-standard:write",
  UNIT_OF_MEASURE_READ: "unit-of-measure:read",
  UNIT_OF_MEASURE_WRITE: "unit-of-measure:write",
  COMMERCIAL_TERM_READ: "commercial-term:read",
  COMMERCIAL_TERM_WRITE: "commercial-term:write",
  DOCUMENT_SEQUENCE_READ: "document-sequence:read",
  DOCUMENT_SEQUENCE_WRITE: "document-sequence:write",
  PROJECT_OPPORTUNITY_READ: "project-opportunity:read",
  PROJECT_OPPORTUNITY_WRITE: "project-opportunity:write",
  PROJECT_READ: "project:read",
  PROJECT_WRITE: "project:write",
  PROJECT_VISIT_READ: "project-visit:read",
  PROJECT_VISIT_WRITE: "project-visit:write",
  PROJECT_RISK_READ: "project-risk:read",
  PROJECT_RISK_WRITE: "project-risk:write",
  // Sprint 5A/5B：采购执行工作台（前端消费层对齐 FINAL 契约——权限码与 seed 注册一致）
  PURCHASE_REQUISITION_READ: "purchase-requisition:view",
  PURCHASE_REQUISITION_WRITE: "purchase-requisition:write",
  PURCHASE_ORDER_READ: "purchase-order:view",
  PURCHASE_ORDER_WRITE: "purchase-order:write",
  PURCHASE_RECEIPT_READ: "purchase-receipt:view",
  PURCHASE_RECEIPT_WRITE: "purchase-receipt:write",
  INSPECTION_READ: "inspection:view",
  INSPECTION_WRITE: "inspection:write",
  WAREHOUSE_RECEIPT_READ: "warehouse-receipt:view",
  WAREHOUSE_RECEIPT_WRITE: "warehouse-receipt:write",
  PURCHASE_RETURN_READ: "purchase-return:view",
  PURCHASE_RETURN_WRITE: "purchase-return:write",
  // Sprint 6A/6B：库存工作台（前端消费层对齐 FINAL 契约）
  // 注：Inventory Ledger / Stock Projection **无 FINAL Read API**（6A 只暴露 Consumer contract，
  //     未发布 InventoryMovement/StockProjection 只读端点）——inventory-ledger:view **不是已存在的
  //     生产权限事实**（CTO #8845 Contract Blocking）。正式 Query API Gate 前不声明该权限码。
  INVENTORY_TRANSFER_READ: "inventory-transfer:view",
  INVENTORY_TRANSFER_WRITE: "inventory-transfer:write",
  STOCK_COUNT_READ: "stock-count:view",
  STOCK_COUNT_WRITE: "stock-count:write",
  INVENTORY_ADJUSTMENT_READ: "inventory-adjustment:view",
  INVENTORY_ADJUSTMENT_WRITE: "inventory-adjustment:write",
  INVENTORY_CONVERSION_READ: "inventory-conversion:view",
  INVENTORY_CONVERSION_WRITE: "inventory-conversion:write",
} as const;

/** 主数据模块（供菜单/权限路由复用） */
export const MASTER_DATA_MODULES = [
  "item",
  "business-partner",
  "price-list",
  "technical-standard",
  "unit-of-measure",
  "commercial-term",
  "document-sequence",
] as const;

/** 项目领域模块（供菜单/权限路由复用） */
export const PROJECT_MODULES = [
  "project-opportunity",
  "project",
  "project-visit",
  "project-risk",
] as const;

/** 细粒度权限动作（Sprint 3 审批流/工作流直接复用） */
export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "audit",
  "export",
  "import",
  "assign",
  "close",
] as const;

/** 全部权限模块（含系统模块） */
export const PERMISSION_MODULES = [
  "user",
  "role",
  "audit",
  "item",
  "business-partner",
  "price-list",
  "technical-standard",
  "unit-of-measure",
  "commercial-term",
  "document-sequence",
  "project-opportunity",
  "project",
  "project-visit",
  "project-risk",
  // Sprint 3A：平台底座模块
  "workflow-definition",
  "workflow-step",
  "workflow-condition",
  "workflow-instance",
  "workflow-action",
  "workflow-history",
  "approver",
  "approver-group",
  "approval-delegate",
  "approval-escalation",
  "approval-timeout",
  "approval-reminder",
  "notification-template",
  "notification-message",
  "notification-channel",
  "notification-log",
  "dictionary-type",
  "dictionary-item",
  "system-setting",
  "tenant-setting",
  "user-setting",
  // Sprint 3B：平台能力模块
  "menu",
  "menu-group",
  // Sprint 3B：Dashboard API
  "dashboard-widget",
  "dashboard-layout",
  "dashboard-kpi",
  "dashboard-chart",
  // Sprint 3B：File Center
  "file",
  "file-folder",
  "file-version",
  "file-attachment",
  // Sprint 3C：业务底座模块
  "customer",
  "customer-contact",
  "customer-address",
  "customer-tag",
  "customer-credit",
  "industry",
  "tag",
  // Sprint 3C-2：Supplier Foundation + Partner 共享模块
  "supplier",
  "supplier-qualification",
  "supplier-certificate",
  "supplier-settlement",
  "business-partner-role",
  "partner-contact",
  "partner-address",
  "partner-tag",
  "partner-bank-account",
  "partner-credit",
  // Sprint 3C-3：Item Master Foundation（CTO #2075：item 动作级 + 子模块）
  "item-category",
  "item-specification",
  "item-uom",
  "item-cost",
  "item-supplier",
  "item-revision",
  "item-tag",
  "item-attachment",
  // Sprint 5A：Purchase Requisition 业务事实（动作映射：create→purchase-requisition:create（创建即取号）；submit→purchase-requisition:edit（复用统一 RBAC，不新造 submit 体系——对齐 5A/5B 拍板）；approve→purchase-requisition:approve（Workflow 审批）；cancel DRAFT→purchase-requisition:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；与 seed.ts SEED_ACTION_MODULES 保持一致）
  "purchase-requisition",
  // Sprint 5A：Purchase Order 业务事实（动作映射：create→purchase-order:create（创建即取号）；submit→purchase-order:edit（复用统一 RBAC，不新造 submit 体系——对齐 5A/5B 拍板）；approve→purchase-order:approve（Workflow 审批）；cancel DRAFT→purchase-order:close；line 仅 view/edit、revision/snapshot 只读 view——见 SEED_RESTRICTED_ACTION_PERMISSIONS；与 seed.ts SEED_ACTION_MODULES 保持一致）
  "purchase-order",
  // Sprint 5B：Goods Receipt Inbound 业务事实（动作映射：create→purchase-receipt:create / inspection:create / warehouse-receipt:create / purchase-return:create（创建即取号）；普通收货/退货不走审批（P1b Final）；approve→purchase-receipt:approve / purchase-return:approve（超收/特殊退货审批）；cancel DRAFT→*:close；warehouse-location 与各 line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；与 seed.ts SEED_ACTION_MODULES 保持一致）
  "purchase-receipt",
  "inspection",
  "warehouse-receipt",
  "purchase-return",
  // Master-Data Read API（D1）：warehouse / warehouse-location 主数据只读模块（seed SEED_ACTION_MODULES/SEED_RESTRICTED_ACTION_PERMISSIONS 已注册；read API 用 warehouse:view / warehouse-location:view）
  "warehouse",
  "warehouse-location",
  // Sprint 6B：Inventory Operations 模块（Transfer 业务事实——动作映射：create→inventory-transfer:create（创建即取号）；submit→inventory-transfer:edit（复用统一 RBAC，不新造 submit 体系——对齐 5A/5B 拍板）；approve→inventory-transfer:approve（Workflow 审批）；execute→inventory-transfer:edit（对齐 5B post→:edit 先例）；cancel DRAFT/SUBMITTED→inventory-transfer:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS）
  "inventory-transfer",
  // Sprint 6B-3：Stock Count 业务事实（动作映射：create→stock-count:create（创建即取号）；录入行/complete→stock-count:edit（对齐 execute→:edit 先例）；cancel→stock-count:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；**Count 本身不产生 Movement，差异经 Adjustment 审批后落账**）
  "stock-count",
  // Sprint 6B-3：Inventory Adjustment 受控库存账事实（动作映射：create→inventory-adjustment:create；submit→inventory-adjustment:edit；approve→inventory-adjustment:approve（Workflow 审批）；apply→**inventory-adjustment:apply 受限权限**（P8/P9 Final：MANUAL 需高权限角色，仅 SUPER_ADMIN/ADMIN——见 SYSTEM_PERMISSIONS）；cancel→inventory-adjustment:close；line 仅 view/edit）
  "inventory-adjustment",
  // Sprint 6B-4：Inventory Conversion 同 item Repack/UOM Conversion（动作映射：create→inventory-conversion:create（创建即取号 CVT）；submit→inventory-conversion:edit；execute→inventory-conversion:edit（对齐 5B post→:edit 先例）；cancel→inventory-conversion:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；**首版无审批状态机（DRAFT→SUBMITTED→EXECUTED/CANCELLED），计量事实不发明审批流**）
  "inventory-conversion",
  // Sprint 5C-1：Supplier Invoice 供应商发票（动作映射：create→supplier-invoice:create（创建即取号 SINV，P1 Final）；submit→supplier-invoice:edit；cancel→supplier-invoice:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；**5C-1A 状态机 DRAFT→SUBMITTED（Match/POST 属 5C-1B/1C，本阶段不到达）；SUBMITTED ≠ POSTED**）
  "supplier-invoice",
] as const;

/** 生成模块×动作权限码（如 "item:view"） */
export function actionPermission(module: string, action: string): string {
  return `${module}:${action}`;
}

/** 全部动作级权限码（供 seed 与 RBAC 全量授权使用） */
export const ALL_ACTION_PERMISSIONS: string[] = PERMISSION_MODULES.flatMap((m) =>
  PERMISSION_ACTIONS.map((a) => actionPermission(m, a)),
);

/** 受限系统权限（Sprint 6A：inventory-ledger:consume 为后台执行动作——**不进入全局 PERMISSION_ACTIONS/PERMISSION_MODULES**（consume 非通用 CRUD action）；仅 SUPER_ADMIN/ADMIN 静态授权，seed 同步注册（见 prisma/seed.ts SEED_SYSTEM_ACTION_PERMISSIONS）；Manager/Member/Viewer 默认无权限 → 403） */
export const SYSTEM_PERMISSIONS = [
  "inventory-ledger:consume",
  // Sprint 6B-3：Inventory Adjustment Apply 受限系统权限（P8/P9 Final：Adjustment 直接动库存账且 Manual 高风险——apply 仅 SUPER_ADMIN/ADMIN 静态授权（见 rbac SYSTEM_PERMISSIONS）；Manager/Member/Viewer 默认无权限 → 403；seed 同步注册（见 prisma/seed.ts SEED_SYSTEM_ACTION_PERMISSIONS））
  "inventory-adjustment:apply",
] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
