-- Sprint 5C-2（CTO 解锁 2026-08-19）：0032_supplier_cn_dn_cross_invoice — Supplier CN/DN 跨票 Consolidated 调整
--
-- 范围：
-- 1) 新增 SupplierCreditDebitNoteInvoice（CN/DN ↔ SupplierInvoice M:N 关联表，Migration 0032）
-- 2) SupplierCreditDebitNote.sourceSupplierInvoiceId 改为可空（历史单票数据保留；新跨票走关联表）
-- 3) 历史单票数据回填关联表（保持代码统一从 invoices 集合读取）
-- 红线：只加表/放宽列；调整金额分摊（按行归属）与防超调在应用层同事务执行；不手改 openAmount。

-- 1) 关联表
CREATE TABLE "SupplierCreditDebitNoteInvoice" (
    "id" TEXT NOT NULL,
    "creditDebitNoteId" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierCreditDebitNoteInvoice_pkey" PRIMARY KEY ("id")
);

-- 2) 唯一约束：同一通知单不重复关联同一发票
CREATE UNIQUE INDEX "SupplierCreditDebitNoteInvoice_creditDebitNoteId_supplierInvoiceId_key" ON "SupplierCreditDebitNoteInvoice"("creditDebitNoteId", "supplierInvoiceId");
CREATE INDEX "SupplierCreditDebitNoteInvoice_creditDebitNoteId_idx" ON "SupplierCreditDebitNoteInvoice"("creditDebitNoteId");
CREATE INDEX "SupplierCreditDebitNoteInvoice_supplierInvoiceId_idx" ON "SupplierCreditDebitNoteInvoice"("supplierInvoiceId");

ALTER TABLE "SupplierCreditDebitNoteInvoice" ADD CONSTRAINT "SupplierCreditDebitNoteInvoice_creditDebitNoteId_fkey" FOREIGN KEY ("creditDebitNoteId") REFERENCES "SupplierCreditDebitNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditDebitNoteInvoice" ADD CONSTRAINT "SupplierCreditDebitNoteInvoice_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) 历史单票数据回填（sourceSupplierInvoiceId 非空 → 关联表一条；幂等：唯一约束 + 未命中才插）
INSERT INTO "SupplierCreditDebitNoteInvoice" ("id", "creditDebitNoteId", "supplierInvoiceId", "createdAt")
SELECT 'link-' || "id", "id", "sourceSupplierInvoiceId", "createdAt"
FROM "SupplierCreditDebitNote"
WHERE "sourceSupplierInvoiceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "SupplierCreditDebitNoteInvoice" l
    WHERE l."creditDebitNoteId" = "SupplierCreditDebitNote"."id"
      AND l."supplierInvoiceId" = "SupplierCreditDebitNote"."sourceSupplierInvoiceId"
  );

-- 4) 放宽单票列（历史数据保留；新单据跨票走关联表）
ALTER TABLE "SupplierCreditDebitNote" ALTER COLUMN "sourceSupplierInvoiceId" DROP NOT NULL;
