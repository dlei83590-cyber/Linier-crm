import { PERMISSIONS, type PermissionCode } from "@nilier-crm/shared";

/**
 * Frontend Module Registry（Frontend Productization Reset — F2-0 IA v2）
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
 * - icon：预留图标名（可选）
 * - order：域内排序
 */

export type ModuleAvailability = "ready" | "preview" | "hold";

export type ModuleDomain =
  | "workbench"
  | "customer-project"
  | "sales"
  | "purchasing"
  | "inventory"
  | "supplier-ap"
  | "master-data"
  | "system"
  | "reports";

export interface ModuleDomainDef {
  id: ModuleDomain;
  label: string;
  order: number;
}

export interface FrontendModule {
  id: string;
  domain: ModuleDomain;
  label: string;
  route: string;
  permission: PermissionCode | null;
  availability: ModuleAvailability;
  icon?: string;
  order: number;
}

/** 一级域（顺序即导航顺序；CTO 22:30 锁定） */
export const MODULE_DOMAINS: ReadonlyArray<ModuleDomainDef> = [
  { id: "workbench", label: "工作台", order: 1 },
  { id: "customer-project", label: "客户与项目", order: 2 },
  { id: "sales", label: "销售管理", order: 3 },
  { id: "purchasing", label: "采购管理", order: 4 },
  { id: "inventory", label: "库存管理", order: 5 },
  { id: "supplier-ap", label: "采购财务", order: 6 },
  { id: "master-data", label: "基础资料", order: 7 },
  { id: "system", label: "系统管理", order: 8 },
  { id: "reports", label: "分析与报表", order: 9 },
];

export const MODULES: ReadonlyArray<FrontendModule> = [
  // ===== 工作台 =====
  { id: "dashboard", domain: "workbench", label: "工作台", route: "/dashboard", permission: null, availability: "ready", order: 1 },

  // ===== 客户与项目（后端有能力、前端未开放 → hold；F2-3 开放）=====
  { id: "project-opportunities", domain: "customer-project", label: "项目机会", route: "/project-opportunities", permission: PERMISSIONS.PROJECT_OPPORTUNITY_READ, availability: "hold", order: 1 },
  { id: "projects", domain: "customer-project", label: "项目管理", route: "/projects", permission: PERMISSIONS.PROJECT_READ, availability: "hold", order: 2 },
  { id: "project-visits", domain: "customer-project", label: "客户走访", route: "/project-visits", permission: PERMISSIONS.PROJECT_VISIT_READ, availability: "hold", order: 3 },
  { id: "project-risks", domain: "customer-project", label: "项目风险", route: "/project-risks", permission: PERMISSIONS.PROJECT_RISK_READ, availability: "hold", order: 4 },

  // ===== 销售管理（后端有 Quotation/SO/Delivery/Invoice/AR/Receipt/CN-DN API，前端未开放 → hold；F2-4 开放）=====
  // 权限码为真实 endpoint 码（quotation:view / sales-order:view / delivery:view / invoice:view / accounts-receivable:view / receipt:view / credit-debit-note:view）
  { id: "quotations", domain: "sales", label: "报价单", route: "/sales/quotations", permission: PERMISSIONS.QUOTATION_READ, availability: "hold", order: 1 },
  { id: "sales-orders", domain: "sales", label: "销售订单", route: "/sales/orders", permission: PERMISSIONS.SALES_ORDER_READ, availability: "hold", order: 2 },
  { id: "deliveries", domain: "sales", label: "送货单", route: "/sales/deliveries", permission: PERMISSIONS.DELIVERY_READ, availability: "hold", order: 3 },
  { id: "sales-invoices", domain: "sales", label: "销售发票", route: "/sales/invoices", permission: PERMISSIONS.INVOICE_READ, availability: "hold", order: 4 },
  { id: "accounts-receivable", domain: "sales", label: "应收账款", route: "/sales/accounts-receivable", permission: PERMISSIONS.ACCOUNTS_RECEIVABLE_READ, availability: "hold", order: 5 },
  { id: "receipt-allocation", domain: "sales", label: "收款核销", route: "/sales/receipts", permission: PERMISSIONS.RECEIPT_READ, availability: "hold", order: 6 },
  { id: "credit-debit-notes", domain: "sales", label: "贷项/借项通知单", route: "/sales/credit-debit-notes", permission: PERMISSIONS.CREDIT_DEBIT_NOTE_READ, availability: "hold", order: 7 },

  // ===== 采购管理（现有最成熟工作台，ready）=====
  { id: "purchase-requisitions", domain: "purchasing", label: "采购申请", route: "/purchasing/requisitions", permission: PERMISSIONS.PURCHASE_REQUISITION_READ, availability: "ready", order: 1 },
  { id: "purchase-orders", domain: "purchasing", label: "采购订单", route: "/purchasing/orders", permission: PERMISSIONS.PURCHASE_ORDER_READ, availability: "ready", order: 2 },
  { id: "purchase-receipts", domain: "purchasing", label: "到货收货", route: "/purchasing/receipts", permission: PERMISSIONS.PURCHASE_RECEIPT_READ, availability: "ready", order: 3 },
  { id: "inspections", domain: "purchasing", label: "质检记录", route: "/purchasing/inspections", permission: PERMISSIONS.INSPECTION_READ, availability: "ready", order: 4 },
  { id: "warehouse-receipts", domain: "purchasing", label: "仓库收货", route: "/purchasing/warehouse-receipts", permission: PERMISSIONS.WAREHOUSE_RECEIPT_READ, availability: "ready", order: 5 },
  { id: "purchase-returns", domain: "purchasing", label: "采购退货", route: "/purchasing/returns", permission: PERMISSIONS.PURCHASE_RETURN_READ, availability: "ready", order: 6 },

  // ===== 库存管理（现有成熟工作台 ready；Read Model 类 hold 展示但不提供假入口——F2-7 后端 Read Model Gate 后开放）=====
  { id: "inventory-transfers", domain: "inventory", label: "库存调拨", route: "/inventory/transfers", permission: PERMISSIONS.INVENTORY_TRANSFER_READ, availability: "ready", order: 1 },
  { id: "stock-counts", domain: "inventory", label: "库存盘点", route: "/inventory/stock-counts", permission: PERMISSIONS.STOCK_COUNT_READ, availability: "ready", order: 2 },
  { id: "inventory-adjustments", domain: "inventory", label: "库存调整", route: "/inventory/adjustments", permission: PERMISSIONS.INVENTORY_ADJUSTMENT_READ, availability: "ready", order: 3 },
  { id: "inventory-conversions", domain: "inventory", label: "库存转换", route: "/inventory/conversions", permission: PERMISSIONS.INVENTORY_CONVERSION_READ, availability: "ready", order: 4 },
  // Read Model（页面已存在但无 FINAL Read API → hold；inventory-ledger:view / stock-projection:view **非已存在权限事实**（CTO #8845），permission=null 避免伪造权限码
  { id: "stock-projection", domain: "inventory", label: "库存展望", route: "/inventory/stock-projection", permission: null, availability: "hold", order: 5 },
  { id: "inventory-ledger", domain: "inventory", label: "库存流水", route: "/inventory/ledger", permission: null, availability: "hold", order: 6 },

  // ===== 采购财务（5C-1 已 Accounting Baseline → Supplier Invoice hold/后续 ready；5C-2 CN/DN+Payment 继续 HOLD，菜单可出现在分类下但不可点击——F2-6）=====
  { id: "supplier-invoices", domain: "supplier-ap", label: "供应商发票", route: "/supplier-invoices", permission: PERMISSIONS.SUPPLIER_INVOICE_READ, availability: "hold", order: 1 },
  { id: "ap-open-items", domain: "supplier-ap", label: "应付未结项", route: "/supplier-ap/open-items", permission: null, availability: "hold", order: 2 },
  { id: "supplier-cn-dn", domain: "supplier-ap", label: "供应商贷项/借项", route: "/supplier-ap/credit-debit-notes", permission: PERMISSIONS.CREDIT_DEBIT_NOTE_READ, availability: "hold", order: 3 },
  { id: "payment-allocation", domain: "supplier-ap", label: "付款核销", route: "/supplier-ap/payments", permission: null, availability: "hold", order: 4 },

  // ===== 基础资料（当前 Placeholder → hold；F2-2 Master Data 开放）=====
  { id: "items", domain: "master-data", label: "物料管理", route: "/items", permission: PERMISSIONS.ITEM_READ, availability: "hold", order: 1 },
  { id: "business-partners", domain: "master-data", label: "往来单位", route: "/business-partners", permission: PERMISSIONS.BUSINESS_PARTNER_READ, availability: "hold", order: 2 },
  { id: "price-lists", domain: "master-data", label: "价格表", route: "/price-lists", permission: PERMISSIONS.PRICE_LIST_READ, availability: "hold", order: 3 },
  { id: "technical-standards", domain: "master-data", label: "技术标准", route: "/technical-standards", permission: PERMISSIONS.TECHNICAL_STANDARD_READ, availability: "hold", order: 4 },
  { id: "unit-of-measures", domain: "master-data", label: "计量单位", route: "/unit-of-measures", permission: PERMISSIONS.UNIT_OF_MEASURE_READ, availability: "hold", order: 5 },
  { id: "commercial-terms", domain: "master-data", label: "商业条款", route: "/commercial-terms", permission: PERMISSIONS.COMMERCIAL_TERM_READ, availability: "hold", order: 6 },
  { id: "document-sequences", domain: "master-data", label: "单据序列", route: "/document-sequences", permission: PERMISSIONS.DOCUMENT_SEQUENCE_READ, availability: "hold", order: 7 },
  // F2-2 Master Data 下一批：仓库/库位（Master-Data Read API 已就绪）
  { id: "warehouses", domain: "master-data", label: "仓库", route: "/warehouses", permission: PERMISSIONS.WAREHOUSE_READ, availability: "hold", order: 8 },
  { id: "warehouse-locations", domain: "master-data", label: "库位", route: "/warehouse-locations", permission: PERMISSIONS.WAREHOUSE_LOCATION_READ, availability: "hold", order: 9 },

  // ===== 系统管理（当前 Placeholder → hold；后续独立规划）=====
  { id: "users", domain: "system", label: "用户管理", route: "/users", permission: PERMISSIONS.USER_READ, availability: "hold", order: 1 },
  { id: "departments", domain: "system", label: "部门管理", route: "/departments", permission: PERMISSIONS.USER_READ, availability: "hold", order: 2 },
  { id: "roles", domain: "system", label: "角色权限", route: "/roles", permission: PERMISSIONS.ROLE_READ, availability: "hold", order: 3 },
  { id: "audit-logs", domain: "system", label: "操作日志", route: "/audit-logs", permission: PERMISSIONS.AUDIT_READ, availability: "hold", order: 4 },

  // ===== 分析与报表（信息架构先行：Catalog 见 docs/frontend/Report_Catalog.md；不实现指标）=====
  { id: "reports", domain: "reports", label: "报表中心", route: "/reports", permission: null, availability: "hold", order: 1 },
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
