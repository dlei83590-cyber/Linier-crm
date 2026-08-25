/**
 * Recent Activity — 审计动作中文标签（UI-03 展示投影，纯函数可测试）
 *
 * 消费真实 GET /api/audit-logs（audit:view）返回的 action 码。
 * 已知动作映射为中文业务名；未收录动作原样展示 action 码
 * （审计动作码是系统事实，不属于 raw database ID，不做隐藏处理）。
 */
const ACTIVITY_LABELS: Record<string, string> = {
  // 销售链
  "sales-order.confirm": "确认销售订单",
  "sales-order.cancel": "取消销售订单",
  "quotation.submit": "提交报价单",
  "quotation.accept": "接受报价单",
  "quotation.convert": "报价单转销售订单",
  "quotation.cancel": "取消报价单",
  "delivery.ready": "送货单备货",
  "delivery.dispatch": "送货单发货",
  "delivery.confirm-delivery": "确认送达",
  "delivery.cancel": "取消送货单",
  "invoice.issue": "开具销售发票",
  "invoice.cancel": "取消销售发票",
  "invoice.reverse-issue": "冲销销售发票",
  "receipt.allocate": "收款核销",
  "receipt.void": "作废收款",
  // 报销审批流
  "expenses.submit": "提交报销申请",
  "expenses.approve": "批准报销申请",
  "expenses.reject": "驳回报销申请",
  // 采购链
  "purchase-requisition.submit": "提交采购申请",
  "purchase-requisition.convert": "采购申请转采购订单",
  "purchase-order.submit": "提交采购订单",
  "purchase-order.confirm": "确认采购订单",
  "purchase-receipt.receive": "采购收货",
  "warehouse-receipt.post": "过账仓库收货",
  "inventory-transfer.execute": "执行库存调拨",
  "inventory-adjustment.apply": "应用库存调整",
  "stock-count.complete": "完成库存盘点",
  // 供应商发票 / AP
  "supplier-invoice.submit": "提交供应商发票",
  "supplier-invoice.match": "供应商发票匹配",
  "supplier-invoice.post": "过账供应商发票",
  "supplier-payment.apply": "付款核销",
  "supplier-payment.reverse": "冲销付款",
  // GL
  "gl-journal-entry.submit": "提交记账凭证",
  "gl-journal-entry.approve": "批准记账凭证",
  "gl-journal-entry.post": "过账记账凭证",
  "gl-journal-entry.reject": "驳回记账凭证",
  "gl.month-end-close": "期末结转",
  "gl.period-reopen": "重开会计期间",
  // 客户/项目
  "project-opportunity.convert": "商机转项目",
  "project.transition": "项目阶段流转",
  "project.close": "项目结项",
  "customer-pool.claim": "领取公海客户",
  "customer-pool.release": "移出公海客户",
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? action;
}
