-- Sprint 4E-3 Credit Note / Debit Note Foundation（发票调整与应收调整领域，CTO Design Review 98/100 APPROVED WITH CHANGES 2026-08-08）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Invoice/AccountsReceivable/Delivery/SalesOrder 一律不动）
-- 设计依据：ADR-0022（Credit Note / Debit Note Domain）、Sprint4E3_CreditDebitNote_Design.md、
-- EVENTS.md v1.12（发票调整领域 5 事件注册：CreditDebitNoteCreated/Submitted/Approved/Rejected + InvoiceAdjustmentApplied）
-- CTO Design Review 98/100 拍板：
-- ① 单票制（sourceInvoiceId 必填且唯一；跨票 Consolidated Adjustment 延后）
-- ② 负 AR 方案 A：允许 balanceAmount < 0（=Customer Credit/可退可抵）；**不新增数据库状态**
--    （AccountsReceivableStatus 不加 CREDIT；读取投影 isCreditBalance/creditAmount/effectiveBalanceType）
-- ③ 条件审批：复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE)，不建 Approval 表
-- ④ 部分行调整支持，但必须累计防超调（remainingAdjustableQty = original - cumulativeAppliedCreditQty）
-- ⑤ 第一版禁止 DN 超原 Invoice 金额（行级 ceiling = 原行金额；未来 ADDITIONAL_CHARGE 单独 ADR）
-- 符号口径（CTO 拍板）：CN → adjustmentAmount < 0；DN → adjustmentAmount > 0（signed Decimal，全系统唯一）
-- 事实链：Invoice → CreditDebitNote → CreditDebitNoteLine → InvoiceAdjustment → AR.adjustedAmount → AR.balanceAmount
-- 边界：不修改原 Invoice 金额事实；不承担 Receipt/Allocation Reversal；AR.adjustedAmount 聚合结果禁 PATCH；APPROVED ≠ APPLIED
-- 编号：DocumentSequence 创建即取号（CN-/DN-2026-xxxx；docType=CREDIT_NOTE/DEBIT_NOTE 已有，无需 ALTER）
-- onDelete：CreditDebitNote→Invoice/Customer Restrict、→WorkflowInstance SetNull；CreditDebitNoteLine→Note Cascade、→InvoiceLine Restrict、→Item/UOM SetNull；
--           InvoiceAdjustment→Note/Line/Invoice/AR Restrict、→InvoiceLine SetNull、→Customer Restrict
-- Decimal 全程：金额 18,4

-- CreateEnum: CreditDebitNoteType（CTO 98/100：全系统唯一符号口径——CREDIT 负向、DEBIT 正向）
CREATE TYPE "CreditDebitNoteType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum: CreditDebitNoteStatus（单据生命周期；审批状态走 approvalStatus 投影复用 ApprovalStatus——不膨胀）
CREATE TYPE "CreditDebitNoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPLIED', 'CANCELLED');

-- CreateTable: CreditDebitNote（CN/DN 调整单头；4E-3 发票调整域；不修改原 Invoice 金额事实）
CREATE TABLE "CreditDebitNote" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "noteType" "CreditDebitNoteType" NOT NULL,
    "sourceInvoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "reason" TEXT NOT NULL,
    "adjustmentTotal" DECIMAL(18,4) NOT NULL,
    "status" "CreditDebitNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalPolicyId" TEXT,
    "workflowInstanceId" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "approvedById" TEXT,
    "appliedAt" TIMESTAMP(3) WITH TIME ZONE,
    "appliedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditDebitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CreditDebitNoteLine（调整明细；逐行溯源 sourceInvoiceLineId；金额快照直接复制 InvoiceLine——不重算、不调用 Pricing Engine）
CREATE TABLE "CreditDebitNoteLine" (
    "id" TEXT NOT NULL,
    "creditDebitNoteId" TEXT NOT NULL,
    "sourceInvoiceLineId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditDebitNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InvoiceAdjustment（**事实中间层**——真正影响 AR.adjustedAmount 的唯一入口；CN<0 / DN>0 有符号金额）
CREATE TABLE "InvoiceAdjustment" (
    "id" TEXT NOT NULL,
    "sourceNoteId" TEXT NOT NULL,
    "sourceNoteLineId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceLineId" TEXT,
    "accountsReceivableId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "adjustmentType" "CreditDebitNoteType" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "adjustmentAmount" DECIMAL(18,4) NOT NULL,
    "appliedAt" TIMESTAMP(3) WITH TIME ZONE,
    "appliedById" TEXT,
    "reversedAt" TIMESTAMP(3) WITH TIME ZONE,
    "reversedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAdjustment_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
CREATE UNIQUE INDEX "CreditDebitNote_code_key" ON "CreditDebitNote"("code");
CREATE INDEX "CreditDebitNote_noteType_idx" ON "CreditDebitNote"("noteType");
CREATE INDEX "CreditDebitNote_sourceInvoiceId_idx" ON "CreditDebitNote"("sourceInvoiceId");
CREATE INDEX "CreditDebitNote_customerId_idx" ON "CreditDebitNote"("customerId");
CREATE INDEX "CreditDebitNote_status_idx" ON "CreditDebitNote"("status");
CREATE INDEX "CreditDebitNote_workflowInstanceId_idx" ON "CreditDebitNote"("workflowInstanceId");
CREATE INDEX "CreditDebitNote_deletedAt_idx" ON "CreditDebitNote"("deletedAt");

CREATE UNIQUE INDEX "CreditDebitNoteLine_creditDebitNoteId_lineNo_key" ON "CreditDebitNoteLine"("creditDebitNoteId", "lineNo");
CREATE INDEX "CreditDebitNoteLine_creditDebitNoteId_idx" ON "CreditDebitNoteLine"("creditDebitNoteId");
CREATE INDEX "CreditDebitNoteLine_sourceInvoiceLineId_idx" ON "CreditDebitNoteLine"("sourceInvoiceLineId");
CREATE INDEX "CreditDebitNoteLine_itemId_idx" ON "CreditDebitNoteLine"("itemId");
CREATE INDEX "CreditDebitNoteLine_deletedAt_idx" ON "CreditDebitNoteLine"("deletedAt");

CREATE UNIQUE INDEX "InvoiceAdjustment_sourceNoteId_invoiceId_invoiceLineId_key" ON "InvoiceAdjustment"("sourceNoteId", "invoiceId", "invoiceLineId");
CREATE INDEX "InvoiceAdjustment_sourceNoteId_idx" ON "InvoiceAdjustment"("sourceNoteId");
CREATE INDEX "InvoiceAdjustment_sourceNoteLineId_idx" ON "InvoiceAdjustment"("sourceNoteLineId");
CREATE INDEX "InvoiceAdjustment_invoiceId_idx" ON "InvoiceAdjustment"("invoiceId");
CREATE INDEX "InvoiceAdjustment_invoiceLineId_idx" ON "InvoiceAdjustment"("invoiceLineId");
CREATE INDEX "InvoiceAdjustment_accountsReceivableId_idx" ON "InvoiceAdjustment"("accountsReceivableId");
CREATE INDEX "InvoiceAdjustment_deletedAt_idx" ON "InvoiceAdjustment"("deletedAt");

-- Foreign Keys（onDelete：CTO 锁定）
ALTER TABLE "CreditDebitNote" ADD CONSTRAINT "CreditDebitNote_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNote" ADD CONSTRAINT "CreditDebitNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNote" ADD CONSTRAINT "CreditDebitNote_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNoteLine" ADD CONSTRAINT "CreditDebitNoteLine_creditDebitNoteId_fkey" FOREIGN KEY ("creditDebitNoteId") REFERENCES "CreditDebitNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNoteLine" ADD CONSTRAINT "CreditDebitNoteLine_sourceInvoiceLineId_fkey" FOREIGN KEY ("sourceInvoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNoteLine" ADD CONSTRAINT "CreditDebitNoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditDebitNoteLine" ADD CONSTRAINT "CreditDebitNoteLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "CreditDebitNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_sourceNoteLineId_fkey" FOREIGN KEY ("sourceNoteLineId") REFERENCES "CreditDebitNoteLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAdjustment" ADD CONSTRAINT "InvoiceAdjustment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
