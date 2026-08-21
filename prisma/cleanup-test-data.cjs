// 安全清理：软删残留 + seed 示例（用户指令 2026-08-21）；CJS 版本
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SOFT_DELETE_TABLES = [
  "Quotation","QuotationLine","QuotationRevision","QuotationSnapshot",
  "SalesOrder","SalesOrderLine","SalesOrderRevision","SalesOrderSnapshot",
  "Delivery","DeliveryLine","DeliveryRevision","DeliverySnapshot",
  "Invoice","InvoiceLine","InvoiceRevision","InvoiceSnapshot",
  "AccountsReceivable","AccountsReceivableRevision","AccountsReceivableSnapshot",
  "Receipt","ReceiptRevision","ReceiptSnapshot","ReceiptAllocation",
  "WriteOff","WriteOffAllocation","CreditDebitNote","CreditDebitNoteLine","InvoiceAdjustment",
  "PurchaseRequisition","PurchaseRequisitionLine","PurchaseRequisitionRevision",
  "PurchaseOrder","PurchaseOrderLine","PurchaseOrderRevision","PurchaseOrderSnapshot",
  "PurchaseReceipt","PurchaseReceiptLine","Inspection",
  "WarehouseReceipt","WarehouseReceiptLine","PurchaseReturn","PurchaseReturnLine",
  "SupplierInvoice","SupplierInvoiceLine","SupplierCreditDebitNote","SupplierCreditDebitNoteLine",
  "SupplierCreditDebitNoteInvoice","SupplierPayment","SupplierPaymentAllocation",
  "SupplierInvoiceMatchRun","SupplierInvoiceMatchLine","GrirRecord","ApLiabilityFact","ApOpenItem",
  "InventoryMovement","StockProjection","InventoryTransfer","InventoryTransferLine",
  "StockCount","StockCountLine","InventoryAdjustment","InventoryAdjustmentLine",
  "InventoryConversion","InventoryConversionLine","InventoryCostBalance","InventoryCostSource",
  "ProductionInbound","ProductionInboundLine","GlJournalEntry","GlJournalEntryLine","GlPeriodClose",
  "WorkflowInstance","WorkflowAction","WorkflowHistory",
  "ProjectOpportunity","Project","ProjectStakeholder","ProjectMember","ProjectMilestone","ProjectTask",
  "ProjectBudget","ProjectExpense","ProjectProduct","ProjectRisk","ProjectVisit",
  "ProjectProgress","ProjectAcceptance","ProjectClosure","ProjectTag",
  "FileFolder","File","FileVersion","FileAttachment",
];

async function main() {
  console.error("[cleanup] start");
  let total = 0;
  for (const t of SOFT_DELETE_TABLES) {
    try {
      const r = await prisma.$executeRawUnsafe("DELETE FROM " + JSON.stringify(t) + " WHERE \"deletedAt\" IS NOT NULL");
      if (r > 0) { console.error("[cleanup] " + t + ": " + r + " purged"); total += r; }
    } catch (e) {
      console.error("[cleanup] " + t + ": skipped (" + (e.message || "").slice(0, 80) + ")");
    }
  }
  console.error("[cleanup] soft-deleted total: " + total);
  // seed 示例：LG- 物料 + 示例主数据（尽力删除，失败不阻断）
  try {
    const lg = await prisma.item.findMany({ where: { code: { startsWith: "LG-" } }, select: { id: true } });
    for (const it of lg) {
      await prisma.linearGuideSpecification.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.itemStandard.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.itemCost.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.itemRevision.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.itemTag.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.priceListItem.deleteMany({ where: { itemId: it.id } }).catch(() => {});
      await prisma.item.delete({ where: { id: it.id } }).catch(() => {});
    }
    await prisma.technicalStandard.deleteMany({ where: { description: { contains: "示例" } } }).catch(() => {});
    await prisma.workflowDefinition.deleteMany({ where: { name: { contains: "示例" } } }).catch(() => {});
    await prisma.approverGroup.deleteMany({ where: { name: { contains: "示例" } } }).catch(() => {});
    await prisma.priceRule.deleteMany({ where: { name: { contains: "示例" } } }).catch(() => {});
    await prisma.promotionRule.deleteMany({ where: { name: { contains: "示例" } } }).catch(() => {});
    console.error("[cleanup] seed examples pass complete");
  } catch (e) {
    console.error("[cleanup] seed example phase error: " + (e.message || ""));
  }
  console.error("[cleanup] done");
}

main()
  .catch((e) => { console.error("[cleanup] FAILED:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
