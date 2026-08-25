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
 * ui 层事实基线（治理规则，长期有效；不维护模块快照——每个 capability activation PR 必须同步本 Registry）：
 * - list/detail/create/edit：以真实页面 surface 为准（有真实 page.tsx 才算开放；Create/Edit 未入 main 的模块必须 false）
 * - workflow / factActions 默认 HOLD；只有经过 contract review、权限/状态 Gate 实现、CI 和 runtime acceptance 后，
 *   对应 capability 才允许 ui=true
 * - ui 不得大于 contract（backend FINAL contract 缺失的能力不允许声明为开放）；
 * - Registry 必须随每个 capability activation PR 同步更新（禁止快照式列举具体模块名单）；
 * - 占位页（PlaceholderPage「尚未开放」）不算开放 → ui 全 false
 */

export type ModuleAvailability = 'ready' | 'preview' | 'hold';

export type ModuleDomain =
  | 'workbench'
  | 'customer-project'
  | 'sales'
  | 'purchasing'
  | 'inventory'
  | 'finance'
  | 'master-data'
  | 'system'
  | 'reports';

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
/** 单据型：CRUD + 提交审批流（无事实动作——报销提交/批准/驳回仅状态迁移，不触发付款/GL） */
const CONTRACT_CRUD_WORKFLOW: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: true,
  workflow: true,
  factActions: false,
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
/** 列表 + 事实动作（无详情/创建/编辑/审批流：拜访计划签到/签退、GL 期末结转月结/重开等） */
const CONTRACT_LIST_ACTIONS: CapabilityFlags = {
  list: true,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: true,
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
/** 列表 + 事实动作（无详情页：拜访计划签到/签退、GL 期末结转月结/重开） */
const UI_LIST_ACTIONS: CapabilityFlags = {
  list: true,
  detail: false,
  create: false,
  edit: false,
  workflow: false,
  factActions: true,
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
/** 列表 + Create/Edit 页（无独立详情页：主数据/系统管理简单编辑即详情） */
const UI_LIST_CRUD: CapabilityFlags = {
  list: true,
  detail: false,
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
/** 列表 + 详情 + Create + 提交流（报销流程补齐：详情页提交/批准/驳回按钮；无独立 Edit 页、无事实动作） */
const UI_LIST_DETAIL_CREATE_WORKFLOW: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: false,
  workflow: true,
  factActions: false,
};
/** 列表 + 详情 + Create + 提交流 + 事实动作（5C-2 供应商贷/借项：详情页 submit+apply，无独立 Edit 页） */
const UI_LIST_DETAIL_CREATE_WORKFLOW_ACTIONS: CapabilityFlags = {
  list: true,
  detail: true,
  create: true,
  edit: false,
  workflow: true,
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
  { id: 'workbench', label: '仪表盘', order: 1 },
  { id: 'customer-project', label: '客户与项目', order: 2 },
  { id: 'sales', label: '销售管理', order: 3 },
  { id: 'purchasing', label: '采购管理', order: 4 },
  { id: 'inventory', label: '库存管理', order: 5 },
  // 销售财务（应收/收款/贷借项）与采购财务（供应商发票/应付/付款）统一归口财务管理（用户指令 2026-08-21，为权限分配）
  { id: 'finance', label: '财务管理', order: 6 },
  { id: 'master-data', label: '基础资料', order: 7 },
  { id: 'system', label: '系统管理', order: 8 },
  { id: 'reports', label: '分析与报表', order: 9 },
];

export const MODULES: ReadonlyArray<FrontendModule> = [
  // ===== 仪表盘 =====
  // dashboard：聚合页已在 main（ui.list）；contract 侧以 dashboard API 为准
  {
    id: 'dashboard',
    domain: 'workbench',
    label: '仪表盘',
    route: '/dashboard',
    permission: null,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 1,
  },

  // ===== 客户与项目（F2-4 开放）=====
  // project-opportunities：contract CRUD + convert（事实动作，无审批流）；ui CRUD + factActions（FRT-05 convert 已交付，POST /api/project-opportunities/:id/convert）
  {
    id: 'project-opportunities',
    domain: 'customer-project',
    label: '项目机会',
    route: '/project-opportunities',
    permission: actionPermission('project-opportunity', 'view'), // F2-6-0: 对齐 API requirePermission("project-opportunity:view")（原 PERMISSIONS 值为 read 风格，与后端强制码不一致）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/project-opportunities/new',
    createPermission: actionPermission('project-opportunity', 'create'),
    order: 1,
  },
  // projects：contract CRUD + transition/close/acceptance + 子资源 CRUD；ui CRUD + factActions——
  // 详情页 Tab 子资源 CRUD（stakeholders/members/milestones/tasks/risks/visits/products/tags/budgets/expenses/progress/acceptance）已交付（B2-1B/L2-A）；
  // transition / closure 事实动作已交付（L2-B1）；project-visits / project-risks 独立页仍为引导页（能力归属本模块，不建平行 CRUD）
  {
    id: 'projects',
    domain: 'customer-project',
    label: '项目管理',
    route: '/projects',
    permission: actionPermission('project', 'view'), // F2-6-0: 对齐 API requirePermission("project:view")（原 PERMISSIONS 值为 read 风格）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/projects/new',
    createPermission: actionPermission('project', 'create'),
    order: 2,
  },
  // project-visits / project-risks：独立页=引导页（Pending Pages Batch 3）——CRUD 在项目详情 Tab（B2-1B 已交付 风险/走访 完整 CRUD）；
  // 保持 hold：独立页无独立能力（能力归属 projects 模块），不建平行 CRUD（AGENTS.md 禁止平行业务真相）
  {
    id: 'project-visits',
    domain: 'customer-project',
    label: '客户走访',
    route: '/project-visits',
    permission: actionPermission('project', 'view'),
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 3,
  },
  {
    id: 'project-risks',
    domain: 'customer-project',
    label: '项目风险',
    route: '/project-risks',
    permission: actionPermission('project', 'view'),
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 4,
  },
  // Phase 2C 客户公海（CTO 生产测试 MVP）：列表/详情/新建 + 手工入池/领取/移出（ui.detail + factActions 已交付；规则引擎/sweep HOLD）
  {
    id: 'customer-pools',
    domain: 'customer-project',
    label: '客户公海',
    route: '/customer-pools',
    permission: actionPermission('customer-pool', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/customer-pools/new',
    createPermission: actionPermission('customer-pool', 'create'),
    order: 5,
  },
  // 报销申请（feat(crm) 报销申请 MVP + expense-analytics 流程补齐）：复用 ProjectExpense 事实——客户归属直接走 Project → BusinessPartner，
  // 不新造平行 Reimbursement/ExpenseClaim 模型；列表/详情消费只读 GET /api/expenses(+ /:id)，
  // 创建复用既有 POST /api/projects/:id/expenses（单一写入源）；提交/批准/驳回走 /api/expenses/:id/{submit|approve|reject}
  // （复用 approvalStatus 枚举，不新增工作流模型；权限复用 project-expense:view/create/edit/approve）。Migration 0054。
  {
    id: 'expenses',
    domain: 'customer-project',
    label: '报销申请',
    route: '/expenses',
    permission: actionPermission('project-expense', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_WORKFLOW, ui: UI_LIST_DETAIL_CREATE_WORKFLOW },
    createRoute: '/expenses/new',
    createPermission: actionPermission('project-expense', 'create'),
    order: 6,
  },
  // 拜访计划（feat(crm) 拜访周/月视图 + 签到规则 MVP）：/api/visits 只读周/月视图（project-visit:view）；
  // 签到/签退（factActions）复用 CustomerActivity 资源已交付（POST /api/business-partners/:id/activities + /:activityId/checkout）；
  // 权限复用 project-visit（不新增权限模块，ADR-0028）；HOLD：GIS/地图/GeoFence/推送/日历/拖拽排程
  {
    id: 'visits',
    domain: 'customer-project',
    label: '拜访计划',
    route: '/visits',
    permission: actionPermission('project-visit', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ACTIONS, ui: UI_LIST_ACTIONS },
    order: 7,
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
  // accounts-receivable：只读模型（list/detail/aging），无 create/edit（财务域——用户指令 2026-08-21 移入财务管理）
  {
    id: 'accounts-receivable',
    domain: 'finance',
    label: '应收账款',
    route: '/sales/accounts-receivable',
    permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL, ui: UI_LIST_DETAIL },
    order: 2,
  },
  // receipt-allocation：收款创建 + allocate/void/reverse 事实动作，无编辑（F2-6B 批 2 已交付；财务域）
  {
    id: 'receipt-allocation',
    domain: 'finance',
    label: '收款核销',
    route: '/sales/receipts',
    permission: PERMISSIONS.RECEIPT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL_CREATE_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/sales/receipts/new',
    createPermission: actionPermission('receipt', 'create'),
    order: 3,
  },
  // credit-debit-notes：F2-6-0 contract 基线修正——/api/credit-debit-notes/[id] 仅 submit/apply，无详情 GET/PATCH route → detail=false / edit=false；
  // root 有 GET+POST（list/create），submit（workflow）+ apply（factAction）→ CONTRACT_LIST_CREATE_WORKFLOW_ACTIONS（不再用 CONTRACT_FULL；财务域）
  {
    id: 'credit-debit-notes',
    domain: 'finance',
    label: '贷项/借项通知单',
    route: '/sales/credit-debit-notes',
    permission: PERMISSIONS.CREDIT_DEBIT_NOTE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_CREATE_WORKFLOW_ACTIONS, ui: UI_LIST_CREATE_WORKFLOW_ACTIONS },
    createRoute: '/sales/credit-debit-notes/new',
    createPermission: actionPermission('credit-debit-note', 'create'),
    order: 4,
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
  // Sprint 6A Read Model（Inventory Read Model Gate FINAL，2026-08-18）：GET /api/stock-projections + /api/inventory-movements
  // 只读；余额唯一权威 = StockProjection SSOT；前端不 SUM Movement（CTO Directive §14/§16）。CTO #8845 Contract Blocking 解除。
  {
    id: 'stock-projection',
    domain: 'inventory',
    label: '库存余额投影',
    route: '/inventory/stock-projection',
    permission: PERMISSIONS.STOCK_PROJECTION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 5,
  },
  {
    id: 'inventory-ledger',
    domain: 'inventory',
    label: '库存流水',
    route: '/inventory/ledger',
    permission: PERMISSIONS.INVENTORY_MOVEMENT_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_DETAIL, ui: UI_LIST_DETAIL },
    order: 6,
  },

  // ===== 财务管理（采购侧；用户指令 2026-08-21：采购财务统一归口财务管理）=====
  {
    id: 'supplier-invoices',
    domain: 'finance',
    label: '供应商发票',
    route: '/supplier-invoices',
    permission: PERMISSIONS.SUPPLIER_INVOICE_READ,
    availability: 'ready',
    // F2-6B 批 3：list/detail/create + submit/match/post（Edit 本轮不做）
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/supplier-invoices/new',
    createPermission: actionPermission('supplier-invoice', 'create'),
    order: 5,
  },
  // ap-open-items：Pending Pages — 只读查询（GET /api/ap-open-items，5C-1C1 POST 产生的会计投影；不提供 5C-2 写入口）
  {
    id: 'ap-open-items',
    domain: 'finance',
    label: '应付未结项',
    route: '/supplier-ap/open-items',
    permission: actionPermission('ap-open-item', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 6,
  },
  // supplier-cn-dn：5C-2（CTO 解锁 2026-08-19）——/api/supplier-credit-debit-notes CRUD + submit（workflow）/apply（factAction）已交付；
  // 权限码 supplier-credit-debit-note:view/create/edit/approve/close（apply→:edit，maker-checker 业务层强制）；无独立 Edit 页（详情页展示+状态动作）
  {
    id: 'supplier-cn-dn',
    domain: 'finance',
    label: '供应商贷项/借项',
    route: '/supplier-ap/credit-debit-notes',
    permission: actionPermission('supplier-credit-debit-note', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CREATE_WORKFLOW_ACTIONS },
    createRoute: '/supplier-ap/credit-debit-notes/new',
    createPermission: actionPermission('supplier-credit-debit-note', 'create'),
    order: 7,
  },
  // payment-allocation：5C-2（CTO 解锁 2026-08-19）——/api/supplier-payments CRUD + apply/void + allocation reverse
  {
    id: 'payment-allocation',
    domain: 'finance',
    label: '付款核销',
    route: '/supplier-ap/payments',
    permission: actionPermission('supplier-payment', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/supplier-ap/payments/new',
    createPermission: actionPermission('supplier-payment', 'create'),
    order: 8,
  },
  // gl：Sprint 7 Finance（CTO 解锁 2026-08-20，ADR-0033/0035）——/api/gl/journal-entries 列表/详情只读（事件驱动自动过账）；
  // 手工凭证（POST /api/gl/journal-entries/manual）已交付；详情页 submit/approve/post/reject（maker-checker，MANUAL 来源）；无独立 Edit 页 → ui.edit=false
  {
    id: 'gl',
    domain: 'finance',
    label: '记账凭证（GL）',
    route: '/finance/gl-journal-entries',
    permission: actionPermission('gl', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CREATE_ACTIONS },
    createRoute: '/finance/gl-journal-entries/new',
    createPermission: actionPermission('gl', 'create'),
    order: 1,
  },
  // gl-balance：Sprint 7 Finance（ADR-0034）——试算平衡只读列表（实时聚合派生；无详情页/事实动作）；利润表见 gl-profit-statement
  {
    id: 'gl-balance',
    domain: 'finance',
    label: '试算平衡',
    route: '/finance/gl-trial-balance',
    permission: actionPermission('gl', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 9,
  },
  // gl-profit-statement：Sprint 7 Finance（ADR-0034）——利润表只读页（实时聚合派生；期间收入−成本−费用）
  {
    id: 'gl-profit-statement',
    domain: 'finance',
    label: '利润表',
    route: '/finance/gl-profit-statement',
    permission: actionPermission('gl', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 11,
  },
  // inventory-costs：成本核算（CTO 授权解除 D9 HOLD 2026-08-20，ADR-0038）——移动加权平均成本只读
  {
    id: 'inventory-costs',
    domain: 'inventory',
    label: '库存成本（移动平均）',
    route: '/inventory/costs',
    permission: actionPermission('inventory-cost', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 6,
  },
  // boms：物料配方（P-1 Item Sourcing，ADR-0049）——成品物料组合固定配方（系数+损耗率；吨→米/件/个）
  {
    id: 'boms',
    domain: 'inventory',
    label: '物料配方',
    route: '/inventory/boms',
    permission: actionPermission('bom', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD_ACTIONS, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/inventory/boms/new',
    createPermission: actionPermission('bom', 'create'),
    order: 7,
  },
  // production-orders：生产/外协工单（P-1 Item Sourcing，ADR-0049）——自产/OEM 领料→成品入库
  {
    id: 'production-orders',
    domain: 'inventory',
    label: '生产/外协工单',
    route: '/inventory/production-orders',
    permission: actionPermission('production-order', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_FULL, ui: UI_LIST_DETAIL_CRUD_ACTIONS },
    createRoute: '/inventory/production-orders/new',
    createPermission: actionPermission('production-order', 'create'),
    order: 8,
  },
  // gl-period-close：Sprint 7 Finance（ADR-0036）——期末结转（收入/费用 → 本年利润；防重复月结）；
  // 执行结转（POST /api/gl/month-end-close）+ 期间重开（POST /api/gl/period-closes/:id/reopen）factActions 已交付；无详情页
  {
    id: 'gl-period-close',
    domain: 'finance',
    label: '期末结转',
    route: '/finance/gl-period-close',
    permission: actionPermission('gl', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ACTIONS, ui: UI_LIST_ACTIONS },
    order: 10,
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
  // business-partners：Pending Pages Completion Gate（Batch 1）——/api/business-partners CRUD FINAL（list/get/create/patch/delete）
  // 权限码对齐 API requirePermission("business-partner:view/create/edit/delete")（原 PERMISSIONS 值为 read 风格）
  // 供应商档案合同补齐 MVP（contract-supplier）：详情页（/business-partners/[id]）已开放——Customer 360 工作台 + 供应商档案
  // （信用等级/账期/资质评级/状态 + 关联采购订单 + 供应物料只读聚合）→ ui.detail=true
  {
    id: 'business-partners',
    domain: 'master-data',
    label: '往来单位',
    route: '/business-partners',
    permission: actionPermission('business-partner', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_DETAIL_CRUD },
    createRoute: '/business-partners/new',
    createPermission: actionPermission('business-partner', 'create'),
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
  // technical-standards：Pending Pages Completion Gate（Batch 1）——/api/technical-standards CRUD FINAL
  {
    id: 'technical-standards',
    domain: 'master-data',
    label: '技术标准',
    route: '/technical-standards',
    permission: actionPermission('technical-standard', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/technical-standards/new',
    createPermission: actionPermission('technical-standard', 'create'),
    order: 4,
  },
  // unit-of-measures：/api/unit-of-measures CRUD FINAL；main 已有列表 + 新建/编辑/删除行操作 → ui create/edit 开放（无独立详情页）
  {
    id: 'unit-of-measures',
    domain: 'master-data',
    label: '计量单位',
    route: '/unit-of-measures',
    permission: actionPermission('unit-of-measure', 'view'), // F2-6-0: 对齐 API requirePermission("unit-of-measure:view")（原 PERMISSIONS 值为 read 风格）
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/unit-of-measures/new',
    createPermission: actionPermission('unit-of-measure', 'create'),
    order: 5,
  },
  // commercial-terms：Pending Pages Completion Gate（Batch 1）——/api/commercial-terms CRUD FINAL
  {
    id: 'commercial-terms',
    domain: 'master-data',
    label: '商业条款',
    route: '/commercial-terms',
    permission: actionPermission('commercial-term', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/commercial-terms/new',
    createPermission: actionPermission('commercial-term', 'create'),
    order: 6,
  },
  // document-sequences：Pending Pages Completion Gate（Batch 1）——/api/document-sequences CRUD FINAL（nextNo 编号引擎只读）
  {
    id: 'document-sequences',
    domain: 'master-data',
    label: '单据序列',
    route: '/document-sequences',
    permission: actionPermission('document-sequence', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/document-sequences/new',
    createPermission: actionPermission('document-sequence', 'create'),
    order: 7,
  },
  // 仓库（CRUD FINAL：POST create + [id] GET/PATCH/DELETE；删除引用检查——被库位/单据引用不可删但可编辑；无独立详情页，编辑页即详情）
  {
    id: 'warehouses',
    domain: 'master-data',
    label: '仓库',
    route: '/warehouses',
    permission: PERMISSIONS.WAREHOUSE_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/warehouses/new',
    createPermission: actionPermission('warehouse', 'create'),
    order: 8,
  },
  // warehouse-locations：/api/warehouse-locations CRUD FINAL；main 已有列表 + 新建/编辑/删除行操作 → ui create/edit 开放（无独立详情页）
  {
    id: 'warehouse-locations',
    domain: 'master-data',
    label: '库位',
    route: '/warehouse-locations',
    permission: PERMISSIONS.WAREHOUSE_LOCATION_READ,
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/warehouse-locations/new',
    createPermission: actionPermission('warehouse-location', 'create'),
    order: 9,
  },

  // ===== 系统管理（当前 Placeholder → hold；后续独立规划）=====
  // users：Pending Pages Completion Gate（Batch 2）——/api/users CRUD FINAL（停用语义：DELETE=isActive=false；无 CAS）
  {
    id: 'users',
    domain: 'system',
    label: '用户管理',
    route: '/users',
    permission: actionPermission('user', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/users/new',
    createPermission: actionPermission('user', 'create'),
    order: 1,
  },
  // departments：Pending Pages Completion Gate（Batch 2）——/api/departments CRUD FINAL（无 DELETE/isActive/CAS）
  {
    id: 'departments',
    domain: 'system',
    label: '部门管理',
    route: '/departments',
    permission: actionPermission('department', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/departments/new',
    createPermission: actionPermission('department', 'create'),
    order: 2,
  },
  // roles：Pending Pages Completion Gate（Batch 2）——/api/roles CRUD FINAL（无 DELETE/CAS；权限映射由 seed/ADMIN 治理）
  {
    id: 'roles',
    domain: 'system',
    label: '角色权限',
    route: '/roles',
    permission: actionPermission('role', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_CRUD, ui: UI_LIST_CRUD },
    createRoute: '/roles/new',
    createPermission: actionPermission('role', 'create'),
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
  // operations-report：经营数据固定看板 MVP（feat(crm)）——GET /api/reports/operations 只读聚合（reports:view）
  {
    id: 'operations-report',
    domain: 'reports',
    label: '经营数据看板',
    route: '/reports/operations',
    permission: actionPermission('reports', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 1,
  },
  // performance-report：绩效数据固定页 MVP（feat(crm)）——GET /api/reports/performance 只读聚合（reports:view）
  {
    id: 'performance-report',
    domain: 'reports',
    label: '绩效数据',
    route: '/reports/performance',
    permission: actionPermission('reports', 'view'),
    availability: 'ready',
    capabilities: { contract: CONTRACT_LIST_ONLY, ui: UI_LIST },
    order: 2,
  },
  {
    id: 'reports',
    domain: 'reports',
    label: '报表中心',
    route: '/reports',
    permission: null,
    availability: 'hold',
    capabilities: { contract: CONTRACT_NONE, ui: UI_NONE },
    order: 3,
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