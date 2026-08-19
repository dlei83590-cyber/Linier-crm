-- Sprint 5C-2（CTO 解锁 2026-08-19）：0029_supplier_cn_dn — 供应商贷项/借项通知单（AP 侧独立事实，ADR-0027 D6）
--
-- 范围：DocumentType 枚举 +SUPPLIER_CREDIT_NOTE/SUPPLIER_DEBIT_NOTE；新增 SupplierCnDnType/SupplierCnDnStatus 枚举；
--      SupplierCreditDebitNote（头）+ SupplierCreditDebitNoteLine（行，来源发票行快照）。
-- 红线：本 migration 只建模型，不触碰 frozen 0027/0028；CN/DN APPLIED 对 ApOpenItem 投影的更新在应用层（同事务）。
--
-- ============ 1. 枚举 ============
-- DocumentType 加 2 值（SCN/SDN 序列，创建即取号 fail closed）
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_CREDIT_NOTE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_DEBIT_NOTE';

CREATE TYPE "SupplierCnDnType" AS ENUM ('CREDIT', 'DEBIT'); -- CN 冲减 AP（signed 负向）/ DN 增加 AP（signed 正向）
CREATE TYPE "SupplierCnDnStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'APPLIED', 'CANCELLED'); -- 终态 APPLIED/CANCELLED

-- ============ 2. SupplierCreditDebitNote（头） ============
CREATE TABLE "SupplierCreditDebitNote" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "noteType" "SupplierCnDnType" NOT NULL,
    "sourceSupplierInvoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "reason" TEXT NOT NULL,
    "adjustmentTotal" DECIMAL(18,4) NOT NULL,
    "status" "SupplierCnDnStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" TEXT,
    "appliedAt" TIMESTAMPTZ(3),
    "appliedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierCreditDebitNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierCreditDebitNote_code_key" ON "SupplierCreditDebitNote"("code");
CREATE INDEX "SupplierCreditDebitNote_supplierId_idx" ON "SupplierCreditDebitNote"("supplierId");
CREATE INDEX "SupplierCreditDebitNote_status_idx" ON "SupplierCreditDebitNote"("status");
CREATE INDEX "SupplierCreditDebitNote_sourceSupplierInvoiceId_idx" ON "SupplierCreditDebitNote"("sourceSupplierInvoiceId");
CREATE INDEX "SupplierCreditDebitNote_deletedAt_idx" ON "SupplierCreditDebitNote"("deletedAt");

ALTER TABLE "SupplierCreditDebitNote" ADD CONSTRAINT "SupplierCreditDebitNote_sourceSupplierInvoiceId_fkey" FOREIGN KEY ("sourceSupplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditDebitNote" ADD CONSTRAINT "SupplierCreditDebitNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ 3. SupplierCreditDebitNoteLine（行） ============
CREATE TABLE "SupplierCreditDebitNoteLine" (
    "id" TEXT NOT NULL,
    "creditDebitNoteId" TEXT NOT NULL,
    "sourceSupplierInvoiceLineId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "taxRate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "SupplierCreditDebitNoteLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierCreditDebitNoteLine_creditDebitNoteId_idx" ON "SupplierCreditDebitNoteLine"("creditDebitNoteId");
CREATE INDEX "SupplierCreditDebitNoteLine_sourceSupplierInvoiceLineId_idx" ON "SupplierCreditDebitNoteLine"("sourceSupplierInvoiceLineId");

ALTER TABLE "SupplierCreditDebitNoteLine" ADD CONSTRAINT "SupplierCreditDebitNoteLine_creditDebitNoteId_fkey" FOREIGN KEY ("creditDebitNoteId") REFERENCES "SupplierCreditDebitNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditDebitNoteLine" ADD CONSTRAINT "SupplierCreditDebitNoteLine_sourceSupplierInvoiceLineId_fkey" FOREIGN KEY ("sourceSupplierInvoiceLineId") REFERENCES "SupplierInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCreditDebitNoteLine" ADD CONSTRAINT "SupplierCreditDebitNoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
