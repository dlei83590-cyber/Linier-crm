/**
 * Domain Class — 10 业务域 Tailwind 字面量色类（Sprint8 U1）
 *
 * JIT 无法扫描动态类名（bg-${id}-50），必须静态注册；与 tokens.ts MODULE_ACCENTS 一一对应。
 * 供 AdminShell 侧栏/顶栏、CommandPalette 等壳层组件共用。
 */

export interface DomainClassSet {
  dot: string;
  soft: string;
  text: string;
  indicator: string;
  square: string;
}

const DOMAIN_CLASS: Record<string, DomainClassSet> = {
  workbench: { dot: "bg-domain-workbench-500", soft: "bg-domain-workbench-50", text: "text-domain-workbench-600", indicator: "bg-domain-workbench-600", square: "bg-domain-workbench-100 text-domain-workbench-700" },
  "customer-project": { dot: "bg-domain-customer-project-500", soft: "bg-domain-customer-project-50", text: "text-domain-customer-project-600", indicator: "bg-domain-customer-project-600", square: "bg-domain-customer-project-100 text-domain-customer-project-700" },
  sales: { dot: "bg-domain-sales-500", soft: "bg-domain-sales-50", text: "text-domain-sales-600", indicator: "bg-domain-sales-600", square: "bg-domain-sales-100 text-domain-sales-700" },
  purchasing: { dot: "bg-domain-purchasing-500", soft: "bg-domain-purchasing-50", text: "text-domain-purchasing-600", indicator: "bg-domain-purchasing-600", square: "bg-domain-purchasing-100 text-domain-purchasing-700" },
  inventory: { dot: "bg-domain-inventory-500", soft: "bg-domain-inventory-50", text: "text-domain-inventory-600", indicator: "bg-domain-inventory-600", square: "bg-domain-inventory-100 text-domain-inventory-700" },
  finance: { dot: "bg-domain-finance-500", soft: "bg-domain-finance-50", text: "text-domain-finance-600", indicator: "bg-domain-finance-600", square: "bg-domain-finance-100 text-domain-finance-700" },
  "master-data": { dot: "bg-domain-master-data-500", soft: "bg-domain-master-data-50", text: "text-domain-master-data-600", indicator: "bg-domain-master-data-600", square: "bg-domain-master-data-100 text-domain-master-data-700" },
  system: { dot: "bg-domain-system-500", soft: "bg-domain-system-50", text: "text-domain-system-600", indicator: "bg-domain-system-600", square: "bg-domain-system-100 text-domain-system-700" },
  reports: { dot: "bg-domain-reports-500", soft: "bg-domain-reports-50", text: "text-domain-reports-600", indicator: "bg-domain-reports-600", square: "bg-domain-reports-100 text-domain-reports-700" },
};

export function domainClass(domainId: string): DomainClassSet {
  return DOMAIN_CLASS[domainId] ?? DOMAIN_CLASS.workbench;
}
