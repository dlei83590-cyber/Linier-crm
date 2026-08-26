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
  // Sprint 4A/4B：销售报价/订单（前端 Registry 消费层对齐真实 endpoint 码；与 seed SEED_ACTION_MODULES 一致）
  QUOTATION_READ: "quotation:view",
  SALES_ORDER_READ: "sales-order:view",
  // Sprint 4C/4D/4E：销售执行域（Delivery / Invoice / AR / Receipt-Allocation / CN-DN，与 seed 模块一致）
  DELIVERY_READ: "delivery:view",
  INVOICE_READ: "invoice:view",
  ACCOUNTS_RECEIVABLE_READ: "accounts-receivable:view",
  RECEIPT_READ: "receipt:view",
  CREDIT_DEBIT_NOTE_READ: "credit-debit-note:view",
  // Sprint 5C-1：供应商发票
  SUPPLIER_INVOICE_READ: "supplier-invoice:view",
  // Master-Data Read API（D1）：warehouse / warehouse-location 主数据只读（read API 用 warehouse:view / warehouse-location:view）
  WAREHOUSE_READ: "warehouse:view",
  // 生产入库（P-1/ProductionInbound）：view 只读；create/edit/delete/post 由 PERMISSION_MODULES × ACTIONS 生成
  PRODUCTION_INBOUND_READ: "production-inbound:view",
  WAREHOUSE_LOCATION_READ: "warehouse-location:view",
  // Sprint 6A/6B：库存工作台（前端消费层对齐 FINAL 契约）
  // Sprint 6A Read Model（Inventory Read Model Gate FINAL，2026-08-18）：新增只读 Query API
  // GET /api/stock-projections + GET /api/inventory-movements（+ /:id 详情）——权限码为正式生产事实；
  // **CTO #8845 Contract Blocking 解除**（原 inventory-ledger:view 非生产权限的声明作废，
  // 由 stock-projection:view / inventory-movement:view 取代；consume 仍为 SYSTEM_PERMISSIONS）。
  INVENTORY_TRANSFER_READ: "inventory-transfer:view",
  INVENTORY_TRANSFER_WRITE: "inventory-transfer:write",
  STOCK_COUNT_READ: "stock-count:view",
  STOCK_COUNT_WRITE: "stock-count:write",
  INVENTORY_ADJUSTMENT_READ: "inventory-adjustment:view",
  INVENTORY_ADJUSTMENT_WRITE: "inventory-adjustment:write",
  INVENTORY_CONVERSION_READ: "inventory-conversion:view",
  INVENTORY_CONVERSION_WRITE: "inventory-conversion:write",
  // Sprint 6A Read Model：库存只读查询（Stock Projection 余额投影 / Inventory Movement 流水追溯）
  STOCK_PROJECTION_READ: "stock-projection:view",
  INVENTORY_MOVEMENT_READ: "inventory-movement:view",
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
  // Sprint 3C-5 / F2-4B2：Project subresource modules；必须与 prisma/seed.ts 注册保持一致，避免 static RBAC 与 DB permission catalog 漂移。
  "project-stakeholder",
  "project-member",
  "project-milestone",
  "project-task",
  "project-budget",
  "project-expense",
  "project-product",
  "project-progress",
  "project-acceptance",
  "project-closure",
  "project-tag",
  "project-attachment",
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
  // Pending Pages Completion Gate（Batch 2）：部门管理 API requirePermission("department:view/create/edit/delete")
  // 必须 ∈ ALL_ACTION_PERMISSIONS（ADR-0028：API referenced permission ⊆ ALL_ACTION_PERMISSIONS）
  "department",
  "audit",
  "item",
  "business-partner",
  "price-list",
  // Sprint 3C-4：Price Foundation 模块（与 prisma/seed.ts SEED_ACTION_MODULES 保持一致，避免 static RBAC 与 DB permission catalog 漂移；
  // F2-6B Batch 1 Runtime Hotfix：Quotation Edit 依赖 tax-profiles API → 必须注册 tax-profile:view）
  "tax-profile",
  // Sprint 3C-4：Price Foundation 其余模块（与 prisma/seed.ts SEED_ACTION_MODULES 保持一致——F2-4B2 Runtime Hotfix：
  // 补齐 exchange-rate / partner-price / price-policy / price-rule / price-list-version / promotion / tax-rate / pricing-engine / price-audit，
  // 消除 static RBAC 与已上线 API requirePermission 的漂移（SUPER_ADMIN 静态授权缺失 → 403））
  "exchange-rate",
  "partner-price",
  "price-policy",
  "price-rule",
  "price-list-version",
  "promotion",
  "tax-rate",
  "pricing-engine",
  "price-audit",
  "technical-standard",
  "unit-of-measure",
  "commercial-term",
  "document-sequence",
  "project-opportunity",
  "project",
  "project-visit",
  "project-risk",
  // Sprint 3C-5 / F2-4B2：Project subresource modules；必须与 prisma/seed.ts 注册保持一致，避免 static RBAC 与 DB permission catalog 漂移。
  "project-stakeholder",
  "project-member",
  "project-milestone",
  "project-task",
  // Sprint 3C-5 / F2-4B2（B2-2A/B2-2B Runtime Hotfix）：补齐 project 子资源模块——seed 已注册、API requirePermission 已引用，
  // 但 PERMISSION_MODULES 缺失 → ALL_ACTION_PERMISSIONS 不生成 → SUPER_ADMIN 静态授权缺失 → hasPermission/requirePermission/capabilities 全部 fail-closed（403）。
  // 与 prisma/seed.ts SEED_ACTION_MODULES 保持一致；不改权限命名、不改 seed 语义。
  "project-budget",
  "project-expense",
  "project-product",
  "project-progress",
  "project-acceptance",
  "project-closure",
  "project-tag",
  "project-attachment",
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
  // Sprint 4A：Quotation Foundation（动作映射：create→quotation:create（创建即取号）；submit→quotation:edit；approve→quotation:approve（Workflow）；cancel DRAFT→quotation:close；line/revision/snapshot 仅 view/edit——与 seed.ts SEED_ACTION_MODULES 保持一致）
  "quotation",
  "quotation-line",
  "quotation-revision",
  "quotation-snapshot",
  "approval-policy",
  "approval-policy-rule",
  // Sprint 4B：Sales Order Foundation（动作映射：create→sales-order:create；submit→sales-order:edit；approve→sales-order:approve（Workflow）；cancel DRAFT→sales-order:close；line/revision/snapshot 仅 view/edit）
  "sales-order",
  "sales-order-line",
  "sales-order-revision",
  "sales-order-snapshot",
  // Sprint 4C：Delivery Foundation（动作映射：ready/dispatch→delivery:edit；confirm-delivery→delivery:approve；cancel→delivery:close；line/revision/snapshot 仅 view/edit）
  "delivery",
  "delivery-line",
  "delivery-revision",
  "delivery-snapshot",
  // Sprint 4D：Invoice Foundation（动作映射：create→invoice:create；issue→invoice:approve；cancel draft→invoice:close；line 系统生成仅 view/edit；revision/snapshot 只读）
  "invoice",
  "invoice-line",
  "invoice-revision",
  "invoice-snapshot",
  // Sprint 4E-1：Accounts Receivable Foundation（动作映射：view→accounts-receivable:view；revision/snapshot 只读 view；金额由 4E-2/4E-3 动作驱动）
  "accounts-receivable",
  "accounts-receivable-revision",
  "accounts-receivable-snapshot",
  // Sprint 4E-2：Receipt & Payment Allocation（动作映射：create→receipt:create（创建即取号）；allocate/reverse→receipt:edit；void→receipt:close；write-off create/submit/approve/apply→write-off:create/edit/approve；revision/snapshot 只读 view）
  "receipt",
  "receipt-allocation",
  "receipt-revision",
  "receipt-snapshot",
  "write-off",
  "write-off-allocation",
  // Sprint 4E-3：Credit Note / Debit Note（动作映射：create→credit-debit-note:create（创建即取号）；submit→credit-debit-note:edit；apply→credit-debit-note:approve（APPROVED≠APPLIED）；cancel DRAFT→credit-debit-note:close；line 仅 view/edit、adjustment 系统事实层仅 view）
  "credit-debit-note",
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
  // P-1 生产入库（ProductionInbound）：create→production-inbound:create；submit/post→:edit（post→:edit 对齐 supplier-invoice 先例）；cancel→:close；line 仅 view/edit——与 seed.ts SEED_ACTION_MODULES 保持一致
  "production-inbound",
  // P-1 Item Sourcing（2026-08-24 Design Gate）：bom（配方：create→bom:create；activate→bom:approve；PATCH/DELETE→bom:edit/delete）
  "bom",
  // P-1 Item Sourcing：production-order（生产/外协工单：create→production-order:create；submit→:edit；post→:edit（对齐 5B post→:edit 先例）；cancel→:close）
  "production-order",
  // Sprint 6A Read Model：库存只读查询模块（stock-projection / inventory-movement——只读 Query API 用 :view；
  // 与 prisma/seed.ts SEED_ACTION_MODULES 保持一致，避免 static RBAC 与 DB permission catalog 漂移（ADR-0028））
  "stock-projection",
  "inventory-movement",
  // Sprint 5C-1：Supplier Invoice 供应商发票（动作映射：create→supplier-invoice:create（创建即取号 SINV，P1 Final）；submit→supplier-invoice:edit；cancel→supplier-invoice:close；line 仅 view/edit——见 SEED_RESTRICTED_ACTION_PERMISSIONS；**5C-1A 状态机 DRAFT→SUBMITTED（Match/POST 属 5C-1B/1C，本阶段不到达）；SUBMITTED ≠ POSTED**）
  "supplier-invoice",
  // AP Open Item 只读查询（5C-1C1 POST 产生的会计投影；ADR-0028：ap-open-item:view ∈ ALL_ACTION_PERMISSIONS）
  "ap-open-item",
  // 5C-2（CTO 解锁 2026-08-19）：Supplier CN/DN（动作映射：create→supplier-credit-debit-note:create（创建即取号）；submit→:edit；apply→:edit（maker-checker 业务层强制，不新造 apply 权限）；cancel DRAFT→:close）
  "supplier-credit-debit-note",
  // 5C-2：Supplier Payment（动作映射：create→supplier-payment:create（创建即取号）；apply→supplier-payment:edit；void→supplier-payment:close）
  "supplier-payment",
  // 5C-2：Payment Allocation 核销行（reversal→supplier-payment-allocation:edit）
  "supplier-payment-allocation",
  // 成本核算（CTO 授权解除 D9 HOLD 2026-08-20，ADR-0038）：inventory-cost（首版 view 查询；成本敏感仅 SUPER_ADMIN/ADMIN）
  "inventory-cost",
  // Sprint 7 Finance 首块（CTO 解锁 2026-08-20，ADR-0033）：GL 会计科目/记账凭证（view/create/edit/close——过账动作映射 create→gl:create；会计敏感仅 SUPER_ADMIN/ADMIN 静态授权，与 supplier-invoice 一致；MANAGER 无）
  "gl",
  // Phase 2C 客户公海（ADR-0053 APPROVED + CTO OQ 裁决；Migration 0049）：customer-pool 模块
  // 动作映射：池/规则配置→:create/:edit/:delete；查看池/条目→:view；claim/release/reclaim→:assign（PERMISSION_ACTIONS 已有 assign，不塞进 :edit）；
  // 后台 sweep→customer-pool:consume（SYSTEM_PERMISSIONS，仅 SUPER_ADMIN/ADMIN）；与 prisma/seed.ts SEED_ACTION_MODULES 保持同步（ADR-0028 防漂移）
  "customer-pool",
  // 经营数据固定看板（feat(crm) operations-report）：GET /api/reports/operations 只读聚合用 reports:view；
  // 与 prisma/seed.ts SEED_ACTION_MODULES 保持一致（ADR-0028：static RBAC 与 DB permission catalog 不漂移）
  "reports",
  // cc-06 客户等级→供应商评级匹配（Contract Close）：CustomerSupplierRatingRule 专用配置模块（view/create/edit/delete；
  // 与 prisma/seed.ts SEED_ACTION_MODULES 保持一致；系统设置简单表格维护，仅 SUPER_ADMIN/ADMIN 静态授权——MANAGER 不放开）
  "customer-supplier-rating-rule",
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
  // Sprint 5C-2/事件总线：Domain Event Consumer 触发（通用领域事件可靠消费；后台执行动作，不开放给普通角色）
  "domain-event:consume",
  // Sprint 6B-3：Inventory Adjustment Apply 受限系统权限（P8/P9 Final：Adjustment 直接动库存账且 Manual 高风险——apply 仅 SUPER_ADMIN/ADMIN 静态授权（见 rbac SYSTEM_PERMISSIONS）；Manager/Member/Viewer 默认无权限 → 403；seed 同步注册（见 prisma/seed.ts SEED_SYSTEM_ACTION_PERMISSIONS））
  "inventory-adjustment:apply",
  // Phase 2C：Customer Pool 后台 sweep / 规则回流执行（后台动作不进通用 PERMISSION_ACTIONS；仅 SUPER_ADMIN/ADMIN 静态授权，seed 同步注册）
  "customer-pool:consume",
] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
