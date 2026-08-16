import { PERMISSIONS, actionPermission, type PermissionCode } from '@nilier-crm/shared';

/**
 * Frontend Module Registry（Frontend Productization Reset — F2-0 IA v2 + F2-1 Capability 双层模型）
 *
 * 唯一菜单事实来源：Sidebar / 移动菜单 / Dashboard 快捷入口一律消费本 Registry，
 * 禁止再维护多份 NAV_ITEMS 之类的一维菜单数组。
 *
 * 字段约定：
 * - id：稳定模块标识（与 route 语义一致）
 * - domain：一级业务域（见 MODULE_DOMAINS，顺序即导航顺序）
 * - label：业务名称（真实可用页面显示正常业务名；hold 项也显示业务名 + 视觉区分）
 * - route：现有 URL（本阶段不改 URL，避免 IA 重构制造 redirect 风险）
 * - permission：真实 endpoint 权限码；null = 所有登录用户可见
 * - availability：ready（真实可用）/ preview（预览）/ hold（未开放）
 * - capabilities：**双层能力模型（CTO F2-1 Review 94/100 修正）**
 *   - contract：Backend FINAL contract 是否存在（事实基线 = apps/web/src/app/api 实际路由）
 *   - ui：当前 main 上 Frontend 真正开放了什么（**唯一允许 Sidebar / Dashboard /
 *     Workspace / action rendering 消费的层**）
 *   禁止把两层合并判断；ui 层缺失的能力不允许前端声明为已开放。
 * - icon：预留图标名（可选）
 * - order：域内排序
 *
 * ui 层事实基线（2026-08-14 核验 apps/web/src/app/(dashboard) 实际页面；2026-08-17 F2-6B 修订）：
 * - 有列表页 + 详情页 → ui.list / ui.detail = true
 * - 有 new / [id]/edit 页面 → ui.create / ui.edit = true（Create/Edit 未入 main 的模块必须 false）
 * - Tier 2 workflow → ui 一律 false（HARD HOLD）；Tier 3 factActions 按真实开放逐模块核（F2-6B：
 *   quotations/sales-orders/deliveries 已开放 source-driven actions → factActions=true，其余仍 false）
 * - 占位页（PlaceholderPage「尚未开放」）不算开放 → ui 全 false
 */

export type ModuleAvailability = 'ready' | 'preview' | 'hold';

export type ModuleDomain =
  | 'workbench'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'supplier-ap'
  | 'master-data'
  | 'system'
  | 'reports'
  | 'customer-project';

export interface ModuleDomainDef {
  id: ModuleDomain;
  label: string;
  order: number;
}

/** F2-1 Capability 层：模块操作能力 */
export type ModuleCapability =
  | 'list' // 列表查询
  | 'detail' // 详情
  | 'create' // 创建
  | 'edit' // 编辑
  | 'workflow' // 审批/提交流（Tier 2 HARD HOLD）
  | 'factActions'; // 事实动作（post/confirm/execute/apply/convert 等，Tier 3 HARD HOLD）

export interface CapabilityFlags {
  list: boolean;
  detail: boolean;
  create: boolean;
  edit: boolean;
  workflow: boolean;
  factActions: boolean;
}

/** 双层能力模型：contract = 后端契约事实；ui = 前端已开放事实（CTO F2-1 Review） */
export interface ModuleCapabilities {
  contract: CapabilityFlags;
  ui: CapabilityFlags;
}

// ===== contract 层常量（Backend FINAL contract 事实，按 API routes 核验）=====
/** 无后端契约 */
const CONTRACT_NONE: CapabilityFlags = {
  list: false,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 主数据型：CRUD 无审批流无事实动作 */
const CONTRACT_CRUD: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: false,
  factActions: false,
};
/** 单据型：CRUD + 事实动作（无 submit 审批流） */
const CONTRACT_CRUD_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: false,
  factActions: true,
};
/** 单据型：CRUD + 提交审批流 + 事实动作 */
const CONTRACT_FULL: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: true,
  factActions: true,
};
/** 只读列表 */
const CONTRACT_LIST_ONLY: CapabilityFlags = {
  list: true,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 列表 + 详情（只读模型） */
const CONTRACT_LIST_DETAIL: CapabilityFlags = {
  list: true,
  detail: true,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 列表 + 详情 + 创建（收款：无编辑，有 allocate/void 事实动作） */
const CONTRACT_LIST_DETAIL_CREATE_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: false,
  workflow: false,
  factActions: true,
};
/** 列表 + 详情 + 编辑 + 事实动作（F2-6-0：SO/Delivery/Invoice——无直接 create POST，创建走上游单据链路；无 submit 审批流） */
const CONTRACT_LIST_DETAIL_EDIT_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: false,
  edit: true,
  workflow: false,
  factActions: true,
};
/** 列表 + 创建 + 提交流 + 事实动作（F2-6-0：Credit/Debit Note——无详情 GET、无 PATCH，[id] 仅 submit/apply） */
const CONTRACT_LIST_CREATE_WORKFLOW_ACTIONS: CapabilityFlags = {
  list: true,
  detail: false,
  create: true,
  edit: false,
  workflow: true,
  factActions: true,
};

// ===== ui 层常量（当前 main 前端实际开放，CTO F2-1 Review 语义锁死）=====
/** 前端未开放任何能力 */
const UI_NONE: CapabilityFlags = {
  list: false,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 仅列表页 */
const UI_LIST: CapabilityFlags = {
  list: true,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 列表页 + 详情页 */
const UI_LIST_DETAIL: CapabilityFlags = {
  list: true,
  detail: true,
  create: false,
  edit: false,
  workflow: false,
  factActions: false,
};
/** 列表 + 详情 + Create/Edit 页面（new + [id]/edit 已在 main） */
const UI_LIST_DETAIL_CRUD: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: false,
  factActions: false,
};
/** 列表 + 详情 + 状态动作按钮（F2-6B：Detail 已开放 source-driven factActions，无 Create/Edit 页） */
const UI_LIST_DETAIL_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: false,
  edit: false,
  workflow: false,
  factActions: true,
};
/** 列表 + 详情 + Edit 页 + 状态动作按钮（F2-6B 批 3：SO/Delivery 无直接 create，edit 头字段 + confirm/cancel/ready/dispatch 动作） */
const UI_LIST_DETAIL_EDIT_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: false,
  edit: true,
  workflow: false,
  factActions: true,
};
/** 列表 + 详情 + Create/Edit 页 + 状态动作按钮（F2-6B：Quotation 直建/编辑 + Convert→SO 等动作） */
const UI_LIST_DETAIL_CRUD_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: false,
  factActions: true,
};
/** 列表 + 详情 + Create（F2-6B 批 2 收款核销：无 Edit，有 allocate/void/reverse 事实动作） */
const UI_LIST_DETAIL_CREATE_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: false,
  workflow: false,
  factActions: true,
};
/** 列表 + Create + 提交流 + 事实动作（F2-6B 批 2 贷项/借项通知单：无详情 GET 端点，submit/apply 内联在列表） */
const UI_LIST_CREATE_WORKFLOW_ACTIONS: CapabilityFlags = {
  list: true,
  detail: false,
  create: true,
  edit: false,
  workflow: true,
  factActions: true,
};

export interface FrontendModule {
  id: string;
  domain: ModuleDomain;
  label: string;
  route: string;
  permission: PermissionCode | null;
  availability: ModuleAvailability;
  /** F2-1：双层能力模型（contract 与 ui 分离，禁止合并判断） */
  capabilities: ModuleCapabilities;
  /**
   * F2-5B：创建入口的权威元数据（仅 ui.create=true 的 ready 模块配置）。
   * Dashboard 快捷操作消费；禁止用 `route + '/new'` 之类的 URL convention 推导。
   * createPermission 必须是真实 create 权限码（`${module}:create`，与 shared
   * PERMISSION_MODULES × PERMISSION_ACTIONS 生成、seed 注册一致），
   * 不是模块的 read/view permission。
   */
  createRoute?: string;
  createPermission?: PermissionCode | null;
  icon?: string;
  order: number;
}

/** 一级域（顺序即导航顺序；CTO 22:30 锁定） */
export const MODULE_DOMAINS: ReadonlyArray<ModuleDomainDef> = [
  { id: 'workbench', label: '工作台', order: 1 },
  { id: 'customer-project', label: '客户与项目', order: 2 },
  { id: 'sales', label: '销售管理', order: 3 },
  { id: 'purchasing', label: '采购管理', order: 4 },
  { id: 'inventory', label: '库存管理', order: 5 },
  { id: 'supplier-ap', label: '采购财务', order: 6 },
  { id: 'master-data', label: '基础资料', order: 7 },
  { id: 'system', label: '系统管理', order: 8 },
  { id: 'reports', label: '分析与报表', order: 9 },
];

export const MODULES: ReadonlyArray<FrontendModule> = [
  // ===== 工作台 =====
  // dashboard：聚合页已在 main（ui.list）；contract 侧以 dashboard API 为准
  {
    id: 'dashboard',
    domain: 'workbench',
    label: '工作台',
    route: '/dashboard',
    permission: null,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 1,
  },

  // ===== 客户与项目（F2-4 开放）=====
  // project-opportunities：contract CRUD + convert（事实动作，无审批流）；ui CRUD（F2-4A2）；convert Tier 3 HOLD
  {
    id: 'project-opportunities',
    domain: 'customer-project',
    label: '项目机会',
    route: '/project-opportunities',
    permission: actionPermission('project-opportunity', 'view'), // F2-6-0: 对齐 API requirePermission("project-opportunity:view")（原 PERMISSIONS 值为 read 风格，与后端强制码不一致）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD },
    createRoute: '/project-opportunities/new',
    createPermission: actionPermission('project-opportunity', 'create'),
    order: 1,
  },
  // projects：contract CRUD + close/transition/acceptance；ui CRUD（F2-4A2）；transition/close Tier 3 HOLD
  {
    id: 'projects',
    domain: 'customer-project',
    label: '项目管理',
    route: '/projects',
    permission: actionPermission('project', 'view'), // F2-6-0: 对齐 API requirePermission("project:view")（原 PERMISSIONS 值为 read 风格）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD },
    createRoute: '/projects/new',
    createPermission: actionPermission('project', 'create'),
    order: 2,
  },
  // project-visits / project-risks：后端无 read API 路由（契约缺失）
  {
    id: 'project-visits',
    domain: 'customer-project',
    label: '客户走访',
    route: '/project-visits',
    permission: PERMISSIONS.PROJECT_VISIT_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 3,
  },
  {
    id: 'project-risks',
    domain: 'customer-project',
    label: '项目风险',
    route: '/project-risks',
    permission: PERMISSIONS.PROJECT_RISK_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 4,
  },

  // ===== 销售管理（F2-6A：List/Detail 只读产品化 → ready；create 严格按来源链，F2-6B 开放）=====
  // 权限码为真实 endpoint 码（quotation:view / sales-order:view / delivery:view / invoice:view / accounts-receivable:view / receipt:view / credit-debit-note:view）
  {
    id: 'quotations',
    domain: 'sales',
    label: '报价单',
    route: '/sales/quotations',
    permission: PERMISSIONS.QUOTATION_READ,
    availability: 'ready',
    // F2-6B 批 1：Direct Create 允许（POST /api/quotations + quotation:create）；Edit 已交付（DRAFT/REJECTED + version CAS）；
    // Detail 已开放 Convert→SO（quotation:approve）→ factActions=true
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/sales/quotations/new',
    createPermission: actionPermission('quotation', 'create'),
    order: 1,
  },
  // sales-orders：F2-6-0 contract 基线修正——/api/sales-orders 仅 GET（本阶段不开放 POST），唯一创建入口 Quotation convert；
  // [id]/route.ts 有 GET+PATCH（sales-order:edit）→ edit=true；confirm/cancel 为事实动作，无 submit 审批流
  {
    id: 'sales-orders',
    domain: 'sales',
    label: '销售订单',
    route: '/sales/orders',
    permission: PERMISSIONS.SALES_ORDER_READ,
    availability: 'ready',
    // F2-6B 批 1：Detail 已开放 Create Delivery（delivery:create，partial dialog）→ factActions=true；无 Direct Create
    // F2-6B 批 3：Edit 头字段（sales-order:edit，DRAFT）+ confirm/cancel 动作
    capabilities: { contract: CONTRACT_LIST_DETAIL_EDIT_ACTIONS, ui: UI_LIST_DETAIL_EDIT_ACTIONS },
    order: 2,
  },
  // deliveries：F2-6-0 contract 基线修正——/api/deliveries 仅 GET（Direct Delivery 不开放），创建来自 /sales-orders/{id}/deliveries；
  // [id]/route.ts 有 GET+PATCH（delivery:edit）→ edit=true
  {
    id: 'deliveries',
    domain: 'sales',
    label: '送货单',
    route: '/sales/deliveries',
    permission: PERMISSIONS.DELIVERY_READ,
    availability: 'ready',
    // F2-6B 批 1：Detail 已开放 Create Invoice（invoice:create，partial billing dialog）→ factActions=true；无 Direct Create
    // F2-6B 批 3：Edit 头字段（delivery:edit，DRAFT）+ ready/dispatch/confirm-delivery/cancel 动作
    capabilities: { contract: CONTRACT_LIST_DETAIL_EDIT_ACTIONS, ui: UI_LIST_DETAIL_EDIT_ACTIONS },
    order: 3,
  },
  // sales-invoices：F2-6-0 contract 基线修正——/api/invoices 仅 GET（Direct Invoice 禁止），唯一创建入口 Delivery → Invoice；
  // [id]/route.ts 有 GET+PATCH（invoice:edit）→ edit=true
  {
    id: 'sales-invoices',
    domain: 'sales',
    label: '销售发票',
    route: '/sales/invoices',
    permission: PERMISSIONS.INVOICE_READ,
    availability: 'ready',
    // F2-6B 批 3：issue/cancel 动作已开放（无 Edit 页——发票 edit 本轮不做）
    capabilities: { contract: CONTRACT_LIST_DETAIL_EDIT_ACTIONS, ui: UI_LIST_DETAIL_ACTIONS },
    order: 4,
  },
  // accounts-receivable：只读模型（list/detail/aging），无 create/edit
  {
    id: 'accounts-receivable',
    domain: 'sales',
    label: '应收账款',
    route: '/sales/accounts-receivable',
    permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL, ui: UI_LIST_DETAIL },
    order: 5,
  },
  // receipt-allocation：收款创建 + allocate/void/reverse 事实动作，无编辑（F2-6B 批 2 已交付）
  {
    id: 'receipt-allocation',
    domain: 'sales',
    label: '收款核销',
    route: '/sales/receipts',
    permission: PERMISSIONS.RECEIPT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL_CREATE_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/sales/receipts/new',
    createPermission: actionPermission('receipt', 'create'),
    order: 6,
  },
  // credit-debit-notes：F2-6-0 contract 基线修正——/api/credit-debit-notes/[id] 仅 submit/apply，无详情 GET/PATCH route → detail=false / edit=false；
  // root 有 GET+POST（list/create），submit（workflow）+ apply（factAction）→ CONTRACT_LIST_CREATE_WORKFLOW_ACTIONS（不再用 CONTRACT_FULL）
  {
    id: 'credit-debit-notes',
    domain: 'sales',
    label: '贷项/借项通知单',
    route: '/sales/credit-debit-notes',
    permission: PERMISSIONS.CREDIT_DEBIT_NOTE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_CREATE_WORKFLOW_ACTIONS, ui: UI_LIST_CREATE_WORKFLOW_ACTIONS },
    createRoute: '/sales/credit-debit-notes/new',
    createPermission: actionPermission('credit-debit-note', 'create'),
    order: 7,
  },

  // ===== 采购管理（现有最成熟工作台，ready）=====
  // requisitions：main 已有 list/detail/new/edit 页面 → ui create/edit true
  {
    id: 'purchase-requisitions',
    domain: 'purchasing',
    label: '采购申请',
    route: '/purchasing/requisitions',
    permission: PERMISSIONS.PURCHASE_REQUISITION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/requisitions/new',
    createPermission: actionPermission('purchase-requisition', 'create'),
    order: 1,
  },
  // purchase-orders：Batch A selective port 已交付 Create/DRAFT Edit（PR #38 业务逻辑入新 Workspace）→ ui create/edit true；Tier 2/3 保持 false
  {
    id: 'purchase-orders',
    domain: 'purchasing',
    label: '采购订单',
    route: '/purchasing/orders',
    permission: PERMISSIONS.PURCHASE_ORDER_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/orders/new',
    createPermission: actionPermission('purchase-order', 'create'),
    order: 2,
  },
  // purchase-receipts：Batch B1 selective port 已交付 Create/DRAFT Edit（来源链 purchaseOrderLineId 保留）→ ui create/edit true；Tier 2/3 保持 false
  {
    id: 'purchase-receipts',
    domain: 'purchasing',
    label: '到货收货',
    route: '/purchasing/receipts',
    permission: PERMISSIONS.PURCHASE_RECEIPT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/receipts/new',
    createPermission: actionPermission('purchase-receipt', 'create'),
    order: 3,
  },
  // inspections：main 已有 list/detail/new/edit → ui create/edit true
  {
    id: 'inspections',
    domain: 'purchasing',
    label: '质检记录',
    route: '/purchasing/inspections',
    permission: PERMISSIONS.INSPECTION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/inspections/new',
    createPermission: actionPermission('inspection', 'create'),
    order: 4,
  },
  // warehouse-receipts：Batch B2 selective port 已交付 Create/DRAFT Edit（双 source identity：purchaseReceiptLineId + inspectionId 保留）→ ui create/edit true；Tier 2/3 保持 false
  {
    id: 'warehouse-receipts',
    domain: 'purchasing',
    label: '仓库收货',
    route: '/purchasing/warehouse-receipts',
    permission: PERMISSIONS.WAREHOUSE_RECEIPT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/warehouse-receipts/new',
    createPermission: actionPermission('warehouse-receipt', 'create'),
    order: 5,
  },
  // purchase-returns：main 已有 list/detail/new/edit → ui create/edit true
  {
    id: 'purchase-returns',
    domain: 'purchasing',
    label: '采购退货',
    route: '/purchasing/returns',
    permission: PERMISSIONS.PURCHASE_RETURN_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/purchasing/returns/new',
    createPermission: actionPermission('purchase-return', 'create'),
    order: 6,
  },

  // ===== 库存管理（现有成熟工作台 ready；Read Model 类 hold 展示但不提供假入口——F2-7 后端 Read Model Gate 后开放）=====
  // transfers：main 已有 list/detail/new/edit；F2-6B 批 3 开放 submit/execute/cancel → factActions=true
  {
    id: 'inventory-transfers',
    domain: 'inventory',
    label: '库存调拨',
    route: '/inventory/transfers',
    permission: PERMISSIONS.INVENTORY_TRANSFER_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/inventory/transfers/new',
    createPermission: actionPermission('inventory-transfer', 'create'),
    order: 1,
  },
  // stock-counts：F2-6B 批 3 开放 create + 录入行/complete/cancel → factActions=true
  {
    id: 'stock-counts',
    domain: 'inventory',
    label: '库存盘点',
    route: '/inventory/stock-counts',
    permission: PERMISSIONS.STOCK_COUNT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/inventory/stock-counts/new',
    createPermission: actionPermission('stock-count', 'create'),
    order: 2,
  },
  // adjustments：F2-6B 批 3 开放 create/edit + submit/apply/cancel → factActions=true
  {
    id: 'inventory-adjustments',
    domain: 'inventory',
    label: '库存调整',
    route: '/inventory/adjustments',
    permission: PERMISSIONS.INVENTORY_ADJUSTMENT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/inventory/adjustments/new',
    createPermission: actionPermission('inventory-adjustment', 'create'),
    order: 3,
  },
  // conversions：F2-6B 批 3 开放 create + submit/execute/cancel → factActions=true（Edit 本轮不做）
  {
    id: 'inventory-conversions',
    domain: 'inventory',
    label: '库存转换',
    route: '/inventory/conversions',
    permission: PERMISSIONS.INVENTORY_CONVERSION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/inventory/conversions/new',
    createPermission: actionPermission('inventory-conversion', 'create'),
    order: 4,
  },
  // Read Model（页面已存在但无 FINAL Read API → hold；inventory-ledger:view / stock-projection:view **非已存在权限事实**（CTO #8845），permission=null 避免伪造权限码
  {
    id: 'stock-projection',
    domain: 'inventory',
    label: '库存展望',
    route: '/inventory/stock-projection',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 5,
  },
  {
    id: 'inventory-ledger',
    domain: 'inventory',
    label: '库存流水',
    route: '/inventory/ledger',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 6,
  },

  // ===== 采购财务（5C-1 已 Accounting Baseline → Supplier Invoice hold/后续 ready；5C-2 CN/DN+Payment 继续 HOLD，菜单可出现在分类下但不可点击——F2-6）=====
  {
    id: 'supplier-invoices',
    domain: 'supplier-ap',
    label: '供应商发票',
    route: '/supplier-invoices',
    permission: PERMISSIONS.SUPPLIER_INVOICE_READ,
    availability: 'ready',
    // F2-6B 批 3：list/detail/create + submit/match/post（Edit 本轮不做）
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/supplier-invoices/new',
    createPermission: actionPermission('supplier-invoice', 'create'),
    order: 1,
  },
  {
    id: 'ap-open-items',
    domain: 'supplier-ap',
    label: '应付未结项',
    route: '/supplier-ap/open-items',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 2,
  },
  // Supplier CN/DN（5C-2 HOLD）：不得复用 4E-3 销售 AR CN/DN 权限（CREDIT_DEBIT_NOTE_READ 对应销售侧事实）；
  // seed 尚无独立 supplier CN/DN permission，5C-2 未定义 → permission=null（与 AP Open Items / Payment 一致），
  // 待 5C-2 Design/Schema/API 定义后再换正式 permission constant（不虚构 supplier-credit-debit-note:view）
  {
    id: 'supplier-cn-dn',
    domain: 'supplier-ap',
    label: '供应商贷项/借项',
    route: '/supplier-ap/credit-debit-notes',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 3,
  },
  {
    id: 'payment-allocation',
    domain: 'supplier-ap',
    label: '付款核销',
    route: '/supplier-ap/payments',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 4,
  },

  // ===== 基础资料（F2-2 Wave 1 已交付 → ready；契约缺失项保持 hold）=====
  // items / price-lists：contract CRUD FINAL；main 已有 list/detail/new/edit → ui CRUD 开放
  {
    id: 'items',
    domain: 'master-data',
    label: '物料管理',
    route: '/items',
    permission: actionPermission('item', 'view'), // F2-6-0: 对齐 API requirePermission("item:view")（原 PERMISSIONS.ITEM_READ 值为 "item:read"，与后端强制码不一致）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_DETAIL_CRUD },
    createRoute: '/items/new',
    createPermission: actionPermission('item', 'create'),
    order: 1,
  },
  // business-partners：后端尚无统一 read/write API（仅 /{id}/roles 子资源）→ 契约缺失，保持 HOLD
  {
    id: 'business-partners',
    domain: 'master-data',
    label: '往来单位',
    route: '/business-partners',
    permission: PERMISSIONS.BUSINESS_PARTNER_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 2,
  },
  {
    id: 'price-lists',
    domain: 'master-data',
    label: '价格表',
    route: '/price-lists',
    permission: actionPermission('price-list', 'view'), // F2-6-0: 对齐 API requirePermission("price-list:view")（原 PERMISSIONS 值为 read 风格）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_DETAIL_CRUD },
    createRoute: '/price-lists/new',
    createPermission: actionPermission('price-list', 'create'),
    order: 3,
  },
  {
    id: 'technical-standards',
    domain: 'master-data',
    label: '技术标准',
    route: '/technical-standards',
    permission: PERMISSIONS.TECHNICAL_STANDARD_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 4,
  },
  // unit-of-measures：GET 列表 FINAL；main 已有列表页 → ui list 开放（无 detail/create/edit 路由）
  {
    id: 'unit-of-measures',
    domain: 'master-data',
    label: '计量单位',
    route: '/unit-of-measures',
    permission: actionPermission('unit-of-measure', 'view'), // F2-6-0: 对齐 API requirePermission("unit-of-measure:view")（原 PERMISSIONS 值为 read 风格）
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 5,
  },
  {
    id: 'commercial-terms',
    domain: 'master-data',
    label: '商业条款',
    route: '/commercial-terms',
    permission: PERMISSIONS.COMMERCIAL_TERM_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 6,
  },
  {
    id: 'document-sequences',
    domain: 'master-data',
    label: '单据序列',
    route: '/document-sequences',
    permission: PERMISSIONS.DOCUMENT_SEQUENCE_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 7,
  },
  // F2-2 Wave 1：仓库/库位（GET 列表 FINAL；main 已有列表页 → ui list 开放；Detail 待后端 /{id} 契约）
  {
    id: 'warehouses',
    domain: 'master-data',
    label: '仓库',
    route: '/warehouses',
    permission: PERMISSIONS.WAREHOUSE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 8,
  },
  {
    id: 'warehouse-locations',
    domain: 'master-data',
    label: '库位',
    route: '/warehouse-locations',
    permission: PERMISSIONS.WAREHOUSE_LOCATION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 9,
  },

  // ===== 系统管理（当前 Placeholder → hold；后续独立规划）=====
  {
    id: 'users',
    domain: 'system',
    label: '用户管理',
    route: '/users',
    permission: PERMISSIONS.USER_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 1,
  },
  {
    id: 'departments',
    domain: 'system',
    label: '部门管理',
    route: '/departments',
    permission: PERMISSIONS.USER_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 2,
  },
  {
    id: 'roles',
    domain: 'system',
    label: '角色权限',
    route: '/roles',
    permission: PERMISSIONS.ROLE_READ,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 3,
  },
  // audit-logs：F2-6B 批 3 已开放 list/detail（只读）
  {
    id: 'audit-logs',
    domain: 'system',
    label: '操作日志',
    route: '/audit-logs',
    permission: actionPermission('audit', 'view'), // F2-6-0: 对齐 API requirePermission("audit:view")（原 PERMISSIONS.AUDIT_READ 值为 "audit:read"，与后端强制码不一致）
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL, ui: UI_LIST_DETAIL },
    order: 4,
  },

  // ===== 分析与报表（信息架构先行：Catalog 见 docs/frontend/Report_Catalog.md；不实现指标）=====
  {
    id: 'reports',
    domain: 'reports',
    label: '报表中心',
    route: '/reports',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 1,
  },
];

/** 按 domain 分组后的模块（域顺序 + 域内 order） */
export function modulesByDomain(): Map<ModuleDomain, FrontendModule[]> {
  const map = new Map<ModuleDomain, FrontendModule[]>();
  for (const domain of MODULE_DOMAINS) {
    map.set(domain.id, []);
  }
  for (const m of MODULES) {
    const list = map.get(m.domain);
    if (list) list.push(m);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.order - b.order);
  }
  return map;
}

/**
 * F2-5A — 按域分组的 ready/preview/hold 三态投影（Sidebar / Mobile nav / Dashboard 业务入口消费）。
 * availability 三态（CTO #12686）：ready 正常可用；preview 只读预览（不得归入 hold）；hold 未开放。
 * hold 不污染主业务导航，由 UI 折叠为「规划中 · N」组；preview 与 ready 同为主导航，但保留视觉标记。
 * 过滤规则：无权限 item（permission 为 null 或 hasPermission 通过）由调用方过滤，
 * 本函数只做 availability 投影，不感知权限。
 */
export interface DomainModuleGroup {
  domain: ModuleDomainDef;
  ready: FrontendModule[];
  preview: FrontendModule[];
  hold: FrontendModule[];
}

export function modulesByDomainGrouped(): DomainModuleGroup[] {
  const byDomain = modulesByDomain();
  return MODULE_DOMAINS.map((domain) => {
    const modules = byDomain.get(domain.id) ?? [];
    return {
      domain,
      ready: modules.filter((m) => m.availability === "ready"),
      preview: modules.filter((m) => m.availability === "preview"),
      hold: modules.filter((m) => m.availability === "hold"),
    };
  }).filter((g) => g.ready.length > 0 || g.preview.length > 0 || g.hold.length > 0);
}

/**
 * F2-1 — 取模块双层能力（不存在时返回全 false 兜底）。
 * 禁止把 contract 与 ui 合并判断；两层的语义不同，消费方不同。
 */
export function moduleCapabilities(moduleId: string): ModuleCapabilities {
  const entry = MODULES.find((m) => m.id === moduleId);
  if (entry) return entry.capabilities;
  return { contract: CONTRACT_NONE, ui: UI_NONE };
}

/** F2-1 — 后端契约能力（Backend FINAL contract 是否存在；可据 API routes 核验） */
export function contractCapabilities(moduleId: string): CapabilityFlags {
  return moduleCapabilities(moduleId).contract;
}

/** F2-1 — 前端已开放能力（**唯一允许 UI 消费的层**：Sidebar / Dashboard / Workspace / action rendering） */
export function uiCapabilities(moduleId: string): CapabilityFlags {
  return moduleCapabilities(moduleId).ui;
}

/** F2-1 — 模块 UI 是否已开放某项能力（消费 ui 层，禁止用 contract 层替代） */
export function hasCapability(moduleId: string, capability: ModuleCapability): boolean {
  return uiCapabilities(moduleId)[capability];
}
