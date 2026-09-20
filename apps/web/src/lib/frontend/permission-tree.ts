/**
 * 系统权限树（Permission Tree）——前端分组契约
 *
 * 数据源：GET /api/permissions（DB Permission 目录；与 shared PERMISSION_MODULES × PERMISSION_ACTIONS
 * + SYSTEM_PERMISSIONS 对齐，ADR-0028 防漂移）。
 *
 * 三层结构（供角色权限分配消费）：
 *   域（MODULE_DOMAINS，与 Sidebar/导航同一 IA 契约）
 *     → 权限模块（Permission.module，如 item / purchase-order-line）
 *       → 动作（PERMISSION_ACTIONS，如 view / create / approve）
 *
 * 红线：
 * - 本文件只做**展示分组与选择集运算**（纯函数），不产生权限事实、不做鉴权判断。
 * - 域映射必须显式覆盖权限目录模块；未覆盖模块回退 'other' 并在 UI 中以「其他（未归类）」显示——
 *   漂移必须可见，禁止静默丢弃。
 * - 分组不改变权限码本身：提交给 API 的仍是 Permission.code 原始列表。
 */
import { MODULE_DOMAINS, type ModuleDomain } from './modules';
import { moduleLabel, permissionLabel } from './labels';

/** 权限目录条目（GET /api/permissions data.items） */
export interface PermissionCatalogItem {
  id: string;
  code: string;
  module: string;
  action: string;
  name: string;
}

/** 域标识：与导航 IA 一致；other = 未归类回退（可见漂移，不静默丢弃） */
export type PermissionDomainId = ModuleDomain | 'other';

export interface PermissionModuleNode {
  module: string;
  label: string;
  permissions: PermissionCatalogItem[];
}

export interface PermissionDomainNode {
  domain: PermissionDomainId;
  label: string;
  order: number;
  modules: PermissionModuleNode[];
}

const DOMAIN_LABELS: Record<PermissionDomainId, string> = {
  ...(Object.fromEntries(MODULE_DOMAINS.map((d) => [d.id, d.label])) as Record<ModuleDomain, string>),
  other: '其他（未归类）',
};

const DOMAIN_ORDERS: Record<PermissionDomainId, number> = {
  ...(Object.fromEntries(MODULE_DOMAINS.map((d) => [d.id, d.order])) as Record<ModuleDomain, number>),
  other: 99,
};

/**
 * 权限模块 → 一级域映射（显式全量覆盖权限目录；新增模块必须在此登记语义归属）。
 * 依据 MODULE_DOMAINS（2026-08-21 用户指令：销售财务与采购财务统一归口「财务管理」）。
 */
export const PERMISSION_MODULE_DOMAINS: Readonly<Record<string, PermissionDomainId>> = {
  // ===== 仪表盘 =====
  'dashboard-widget': 'workbench',
  'dashboard-layout': 'workbench',
  'dashboard-kpi': 'workbench',
  'dashboard-chart': 'workbench',

  // ===== 客户与项目 =====
  customer: 'customer-project',
  'customer-contact': 'customer-project',
  'customer-address': 'customer-project',
  'customer-tag': 'customer-project',
  'customer-credit': 'customer-project',
  'customer-pool': 'customer-project',
  industry: 'customer-project',
  tag: 'customer-project',
  project: 'customer-project',
  'project-opportunity': 'customer-project',
  'project-visit': 'customer-project',
  'project-risk': 'customer-project',
  'project-stakeholder': 'customer-project',
  'project-member': 'customer-project',
  'project-milestone': 'customer-project',
  'project-task': 'customer-project',
  'project-budget': 'customer-project',
  'project-expense': 'customer-project',
  'project-product': 'customer-project',
  'project-progress': 'customer-project',
  'project-acceptance': 'customer-project',
  'project-closure': 'customer-project',
  'project-tag': 'customer-project',
  'project-attachment': 'customer-project',

  // ===== 销售管理 =====
  quotation: 'sales',
  'quotation-line': 'sales',
  'quotation-revision': 'sales',
  'quotation-snapshot': 'sales',
  'approval-policy': 'sales',
  'approval-policy-rule': 'sales',
  'sales-order': 'sales',
  'sales-order-line': 'sales',
  'sales-order-revision': 'sales',
  'sales-order-snapshot': 'sales',
  delivery: 'sales',
  'delivery-line': 'sales',
  'delivery-revision': 'sales',
  'delivery-snapshot': 'sales',
  invoice: 'sales',
  'invoice-line': 'sales',
  'invoice-revision': 'sales',
  'invoice-snapshot': 'sales',

  // ===== 采购管理 =====
  'purchase-requisition': 'purchasing',
  'purchase-requisition-line': 'purchasing',
  'purchase-requisition-revision': 'purchasing',
  'purchase-order': 'purchasing',
  'purchase-order-line': 'purchasing',
  'purchase-order-revision': 'purchasing',
  'purchase-order-snapshot': 'purchasing',
  'purchase-receipt': 'purchasing',
  'purchase-receipt-line': 'purchasing',
  inspection: 'purchasing',
  'warehouse-receipt': 'purchasing',
  'warehouse-receipt-line': 'purchasing',
  'purchase-return': 'purchasing',
  'purchase-return-line': 'purchasing',

  // ===== 库存管理 =====
  warehouse: 'inventory',
  'warehouse-location': 'inventory',
  'inventory-transfer': 'inventory',
  'inventory-transfer-line': 'inventory',
  'stock-count': 'inventory',
  'stock-count-line': 'inventory',
  'inventory-adjustment': 'inventory',
  'inventory-adjustment-line': 'inventory',
  'inventory-conversion': 'inventory',
  'inventory-conversion-line': 'inventory',
  'production-inbound': 'inventory',
  bom: 'inventory',
  'production-order': 'inventory',
  'stock-projection': 'inventory',
  'inventory-movement': 'inventory',
  'inventory-ledger': 'inventory',
  'inventory-cost': 'inventory',

  // ===== 财务管理（销售财务 + 采购财务统一归口）=====
  'accounts-receivable': 'finance',
  'accounts-receivable-revision': 'finance',
  'accounts-receivable-snapshot': 'finance',
  receipt: 'finance',
  'receipt-allocation': 'finance',
  'receipt-revision': 'finance',
  'receipt-snapshot': 'finance',
  'write-off': 'finance',
  'write-off-allocation': 'finance',
  'credit-debit-note': 'finance',
  'credit-debit-note-line': 'finance',
  'invoice-adjustment': 'finance',
  'supplier-invoice': 'finance',
  'supplier-invoice-line': 'finance',
  'ap-open-item': 'finance',
  'supplier-credit-debit-note': 'finance',
  'supplier-payment': 'finance',
  'supplier-payment-allocation': 'finance',
  gl: 'finance',

  // ===== 基础资料 =====
  item: 'master-data',
  'item-category': 'master-data',
  'item-specification': 'master-data',
  'item-uom': 'master-data',
  'item-cost': 'master-data',
  'item-supplier': 'master-data',
  'item-revision': 'master-data',
  'item-tag': 'master-data',
  'item-attachment': 'master-data',
  'business-partner': 'master-data',
  'business-partner-role': 'master-data',
  'partner-contact': 'master-data',
  'partner-address': 'master-data',
  'partner-tag': 'master-data',
  'partner-bank-account': 'master-data',
  'partner-credit': 'master-data',
  supplier: 'master-data',
  'supplier-qualification': 'master-data',
  'supplier-certificate': 'master-data',
  'supplier-settlement': 'master-data',
  'price-list': 'master-data',
  'price-list-version': 'master-data',
  'price-policy': 'master-data',
  'price-rule': 'master-data',
  'partner-price': 'master-data',
  promotion: 'master-data',
  'tax-profile': 'master-data',
  'tax-rate': 'master-data',
  'exchange-rate': 'master-data',
  'pricing-engine': 'master-data',
  'price-audit': 'master-data',
  'technical-standard': 'master-data',
  'unit-of-measure': 'master-data',
  'commercial-term': 'master-data',
  'document-sequence': 'master-data',

  // ===== 系统管理 =====
  user: 'system',
  role: 'system',
  department: 'system',
  audit: 'system',
  menu: 'system',
  'menu-group': 'system',
  file: 'system',
  'file-folder': 'system',
  'file-version': 'system',
  'file-attachment': 'system',
  'workflow-definition': 'system',
  'workflow-step': 'system',
  'workflow-condition': 'system',
  'workflow-instance': 'system',
  'workflow-action': 'system',
  'workflow-history': 'system',
  approver: 'system',
  'approver-group': 'system',
  'approval-delegate': 'system',
  'approval-escalation': 'system',
  'approval-timeout': 'system',
  'approval-reminder': 'system',
  'notification-template': 'system',
  'notification-message': 'system',
  'notification-channel': 'system',
  'notification-log': 'system',
  'dictionary-type': 'system',
  'dictionary-item': 'system',
  'system-setting': 'system',
  'tenant-setting': 'system',
  'user-setting': 'system',
  'domain-event': 'system',
  'customer-supplier-rating-rule': 'system',

  // ===== 分析与报表 =====
  reports: 'reports',
};

export function permissionDomainOf(module: string): PermissionDomainId {
  return PERMISSION_MODULE_DOMAINS[module] ?? 'other';
}

export function permissionDomainLabel(domain: PermissionDomainId): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

/** 未在 PERMISSION_MODULE_DOMAINS 登记的模块（域映射漂移检测；UI 以「其他（未归类）」显示） */
export function unclassifiedModules(items: readonly PermissionCatalogItem[]): string[] {
  return [...new Set(items.map((i) => i.module))].filter((m) => PERMISSION_MODULE_DOMAINS[m] === undefined).sort();
}

/** 由权限目录构建三层树（域 → 模块 → 动作）；空模块不产生节点 */
export function buildPermissionTree(items: readonly PermissionCatalogItem[]): PermissionDomainNode[] {
  const domains = new Map<PermissionDomainId, Map<string, PermissionCatalogItem[]>>();

  for (const item of items) {
    const domain = permissionDomainOf(item.module);
    const modules = domains.get(domain) ?? new Map<string, PermissionCatalogItem[]>();
    const list = modules.get(item.module) ?? [];
    list.push(item);
    modules.set(item.module, list);
    domains.set(domain, modules);
  }

  return [...domains.entries()]
    .map(([domain, modules]) => ({
      domain,
      label: permissionDomainLabel(domain),
      order: DOMAIN_ORDERS[domain] ?? 99,
      modules: [...modules.entries()]
        .map(([module, permissions]) => ({
          module,
          label: moduleLabel(module),
          permissions: [...permissions].sort((a, b) => a.code.localeCompare(b.code)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN')),
    }))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

/** 关键字过滤：命中模块（slug/中文名）或权限码（code/中文标签）；域/模块节点在无命中时移除 */
export function filterPermissionTree(
  tree: readonly PermissionDomainNode[],
  query: string,
): PermissionDomainNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tree];

  const result: PermissionDomainNode[] = [];
  for (const domain of tree) {
    const modules: PermissionModuleNode[] = [];
    for (const node of domain.modules) {
      const moduleHit =
        node.module.toLowerCase().includes(q) || node.label.toLowerCase().includes(q);
      const permissions = moduleHit
        ? node.permissions
        : node.permissions.filter(
            (p) =>
              p.code.toLowerCase().includes(q) || permissionLabel(p.code).toLowerCase().includes(q),
          );
      if (permissions.length > 0) modules.push({ ...node, permissions });
    }
    if (modules.length > 0) result.push({ ...domain, modules });
  }
  return result;
}

export type SelectionState = 'all' | 'partial' | 'none';

/** 三态计算：全选 / 半选（部分）/ 未选（空节点视为 none） */
export function selectionState(selected: ReadonlySet<string>, codes: readonly string[]): SelectionState {
  if (codes.length === 0) return 'none';
  let hit = 0;
  for (const code of codes) if (selected.has(code)) hit += 1;
  if (hit === 0) return 'none';
  return hit === codes.length ? 'all' : 'partial';
}

export function moduleCodes(node: PermissionModuleNode): string[] {
  return node.permissions.map((p) => p.code);
}

export function domainCodes(node: PermissionDomainNode): string[] {
  return node.modules.flatMap(moduleCodes);
}

export interface PermissionTreeStats {
  total: number;
  selected: number;
  modules: number;
  selectedModules: number;
}

/** 树统计（域/模块计数 + 已选权限数；供 UI 展示已选 N/总数） */
export function treeStats(
  tree: readonly PermissionDomainNode[],
  selected: ReadonlySet<string>,
): PermissionTreeStats {
  let total = 0;
  let selectedCount = 0;
  let modules = 0;
  let selectedModules = 0;
  for (const domain of tree) {
    for (const node of domain.modules) {
      modules += 1;
      const codes = moduleCodes(node);
      total += codes.length;
      const hit = codes.filter((c) => selected.has(c)).length;
      selectedCount += hit;
      if (hit > 0) selectedModules += 1;
    }
  }
  return { total, selected: selectedCount, modules, selectedModules };
}

/** 选择集运算：勾选/取消一组权限码（返回新 Set；纯函数，禁止原地修改） */
export function withCodes(
  selected: ReadonlySet<string>,
  codes: readonly string[],
  next: boolean,
): Set<string> {
  const result = new Set(selected);
  for (const code of codes) {
    if (next) result.add(code);
    else result.delete(code);
  }
  return result;
}

/** 提交用：排序后的权限码数组（与后端 PATCH permissionCodes 全量替换语义一致） */
export function selectedCodeList(selected: ReadonlySet<string>): string[] {
  return [...selected].sort((a, b) => a.localeCompare(b));
}
