// 安全清理：只清理①seed 测试示例信息 ②前端软删残留（deletedAt 非空）——用户指令 2026-08-21
// 通过 Railway preDeployCommand 执行（一次性 RUN_DATA_CLEANUP=true 开关控制）：node prisma/cleanup-test-data.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 前端软删残留：所有含 deletedAt 的业务表物理删除残留（保留系统表）
const SOFT_DELETE_TABLES = [
  "Quotation", "QuotationLine", "QuotationRevision", "QuotationSnapshot",
  "SalesOrder", "SalesOrderLine", "SalesOrderRevision", "SalesOrderSnapshot",
  "Delivery", "DeliveryLine", "DeliveryRevision", "DeliverySnapshot",
  "Invoice", "InvoiceLine", "InvoiceRevision", "InvoiceSnapshot",
  "AccountsReceivable", "AccountsReceivableRevision", "AccountsReceivableSnapshot",
  "Receipt", "ReceiptRevision", "ReceiptSnapshot", "ReceiptAllocation",
  "WriteOff", "WriteOffAllocation", "CreditDebitNote", "CreditDebitNoteLine", "InvoiceAdjustment",
  "PurchaseRequisition", "PurchaseRequisitionLine", "PurchaseRequisitionRevision",
  "PurchaseOrder", "PurchaseOrderLine", "PurchaseOrderRevision", "PurchaseOrderSnapshot",
  "PurchaseReceipt", "PurchaseReceiptLine", "Inspection",
  "WarehouseReceipt", "WarehouseReceiptLine", "PurchaseReturn", "PurchaseReturnLine",
  "SupplierInvoice", "SupplierInvoiceLine", "SupplierCreditDebitNote", "SupplierCreditDebitNoteLine",
  "SupplierCreditDebitNoteInvoice", "SupplierPayment", "SupplierPaymentAllocation",
  "SupplierInvoiceMatchRun", "SupplierInvoiceMatchLine", "GrirRecord", "ApLiabilityFact", "ApOpenItem",
  "InventoryMovement", "StockProjection", "InventoryTransfer", "InventoryTransferLine",
  "StockCount", "StockCountLine", "InventoryAdjustment", "InventoryAdjustmentLine",
  "InventoryConversion", "InventoryConversionLine", "InventoryCostBalance", "InventoryCostSource",
  "ProductionInbound", "ProductionInboundLine", "GlJournalEntry", "GlJournalEntryLine", "GlPeriodClose",
  "WorkflowInstance", "WorkflowAction", "WorkflowHistory",
  "ProjectOpportunity", "Project", "ProjectStakeholder", "ProjectMember", "ProjectMilestone", "ProjectTask",
  "ProjectBudget", "ProjectExpense", "ProjectProduct", "ProjectRisk", "ProjectVisit",
  "ProjectProgress", "ProjectAcceptance", "ProjectClosure", "ProjectTag",
  "FileFolder", "File", "FileVersion", "FileAttachment",
];

async function seedExampleCleanup(tx) {
  // 直线导轨示例物料（LG- 前缀，seed 创建）
  const lgItems = await tx.item.findMany({ where: { code: { startsWith: "LG-" } }, select: { id: true } });
  for (const it of lgItems) {
    await tx.linearGuideSpecification.deleteMany({ where: { itemId: it.id } });
    await tx.itemStandard.deleteMany({ where: { itemId: it.id } });
    await tx.itemCost.deleteMany({ where: { itemId: it.id } });
    await tx.itemRevision.deleteMany({ where: { itemId: it.id } });
    await tx.itemTag.deleteMany({ where: { itemId: it.id } });
    await tx.priceListItem.deleteMany({ where: { itemId: it.id } });
    await tx.item.delete({ where: { id: it.id } });
  }
  // 示例技术标准（description 含"示例"）
  await tx.technicalStandard.deleteMany({ where: { description: { contains: "示例" } } });
  // 示例工作流/审批组/价格规则/促销（name 含"示例"）
  await tx.workflowDefinition.deleteMany({ where: { name: { contains: "示例" } } });
  await tx.approverGroup.deleteMany({ where: { name: { contains: "示例" } } });
  await tx.priceRule.deleteMany({ where: { name: { contains: "示例" } } });
  await tx.promotionRule.deleteMany({ where: { name: { contains: "示例" } } });
  console.log("[cleanup] seed examples removed");
}

async function main() {
  console.log("[cleanup] start");
  await prisma.$transaction(async (tx) => {
    // ① 软删残留物理清除（仅含 deletedAt 的业务表；保留系统数据表）
    let total = 0;
    for (const t of SOFT_DELETE_TABLES) {
      try {
        const r = await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE "deletedAt" IS NOT NULL`);
        if (r > 0) { console.log(`  [cleanup] ${t}: ${r} soft-deleted rows purged`); total += r; }
      } catch (e) {
        console.log(`  [cleanup] ${t}: skipped (${e instanceof Error ? e.message.slice(0, 80) : "unknown"})`);
      }
    }
    console.log(`[cleanup] soft-deleted purge total: ${total}`);
    // ② seed 测试示例清理
    await seedExampleCleanup(tx);
  });
  console.log("[cleanup] done");
}

main()
  .catch((e) => {
    console.error("[cleanup] FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
