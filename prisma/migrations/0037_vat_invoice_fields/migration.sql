-- CreateEnum
CREATE TYPE "InvoiceInvoiceType" AS ENUM ('SPECIAL_VAT', 'ORDINARY_VAT', 'ELECTRONIC_VAT', 'EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceTaxpayerType" AS ENUM ('GENERAL_VAT_PAYER', 'SMALL_SCALE');

-- AlterEnum（PG 16 事务内 ADD VALUE 允许：本迁移不使用 NINE 值，仅追加定义）
ALTER TYPE "TaxRateType" ADD VALUE 'NINE';

-- CreateTable
CREATE TABLE "BusinessPartnerInvoiceInfo" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "uscc" TEXT NOT NULL,
    "taxpayerType" "InvoiceTaxpayerType" NOT NULL DEFAULT 'GENERAL_VAT_PAYER',
    "registeredAddress" TEXT,
    "registeredPhone" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessPartnerInvoiceInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartnerInvoiceInfo_partnerId_key" ON "BusinessPartnerInvoiceInfo"("partnerId");
CREATE INDEX "BusinessPartnerInvoiceInfo_partnerId_idx" ON "BusinessPartnerInvoiceInfo"("partnerId");

-- AddForeignKey
ALTER TABLE "BusinessPartnerInvoiceInfo" ADD CONSTRAINT "BusinessPartnerInvoiceInfo_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Invoice（增值税要素：类型/税务代码/税务号码/红字标志/红字引用）
ALTER TABLE "Invoice"
  ADD COLUMN "invoiceType" "InvoiceInvoiceType",
  ADD COLUMN "taxInvoiceCode" TEXT,
  ADD COLUMN "taxInvoiceNo" TEXT,
  ADD COLUMN "redLetter" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "redInvoiceRefId" TEXT;

-- 号码格式 CHECK（I7：专/普 12+8 全填；数电 20 位且 code 空；未开票全空；EXPORT/OTHER 可空）
ALTER TABLE "Invoice" ADD CONSTRAINT "ck_invoice_tax_no_format" CHECK (
  ("invoiceType" IN ('SPECIAL_VAT', 'ORDINARY_VAT')
     AND "taxInvoiceCode" IS NOT NULL AND "taxInvoiceNo" IS NOT NULL
     AND "taxInvoiceCode" ~ '^[0-9]{12}$' AND "taxInvoiceNo" ~ '^[0-9]{8}$')
  OR ("invoiceType" = 'ELECTRONIC_VAT'
     AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" ~ '^[0-9]{20}$')
  OR ("invoiceType" IS NULL AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" IS NULL)
  OR ("invoiceType" IN ('EXPORT', 'OTHER'))
);

-- 红字引用一致性 CHECK（R1：redInvoiceRefId 非空 ⇔ redLetter=true）
ALTER TABLE "Invoice" ADD CONSTRAINT "ck_invoice_red_ref" CHECK (
  ("redLetter" = true AND "redInvoiceRefId" IS NOT NULL)
  OR ("redLetter" = false AND "redInvoiceRefId" IS NULL)
);

-- AddForeignKey 红字自引用（R2 终态蓝票由应用层校验；引用不可变）
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_redInvoiceRefId_fkey" FOREIGN KEY ("redInvoiceRefId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex 税务号码组合唯一（I2：NULL 不参与）
CREATE UNIQUE INDEX "Invoice_taxInvoiceCode_taxInvoiceNo_key" ON "Invoice"("taxInvoiceCode", "taxInvoiceNo");

-- AlterTable InvoiceSnapshot（I9：ISSUED 快照固化增值税要素）
ALTER TABLE "InvoiceSnapshot"
  ADD COLUMN "invoiceType" "InvoiceInvoiceType",
  ADD COLUMN "taxInvoiceCode" TEXT,
  ADD COLUMN "taxInvoiceNo" TEXT;

-- AlterTable SupplierInvoice（进项侧同构）
ALTER TABLE "SupplierInvoice"
  ADD COLUMN "invoiceType" "InvoiceInvoiceType",
  ADD COLUMN "taxInvoiceCode" TEXT,
  ADD COLUMN "taxInvoiceNo" TEXT,
  ADD COLUMN "redLetter" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "redInvoiceRefId" TEXT;

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "ck_supplier_invoice_tax_no_format" CHECK (
  ("invoiceType" IN ('SPECIAL_VAT', 'ORDINARY_VAT')
     AND "taxInvoiceCode" IS NOT NULL AND "taxInvoiceNo" IS NOT NULL
     AND "taxInvoiceCode" ~ '^[0-9]{12}$' AND "taxInvoiceNo" ~ '^[0-9]{8}$')
  OR ("invoiceType" = 'ELECTRONIC_VAT'
     AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" ~ '^[0-9]{20}$')
  OR ("invoiceType" IS NULL AND "taxInvoiceCode" IS NULL AND "taxInvoiceNo" IS NULL)
  OR ("invoiceType" IN ('EXPORT', 'OTHER'))
);

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "ck_supplier_invoice_red_ref" CHECK (
  ("redLetter" = true AND "redInvoiceRefId" IS NOT NULL)
  OR ("redLetter" = false AND "redInvoiceRefId" IS NULL)
);

ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_redInvoiceRefId_fkey" FOREIGN KEY ("redInvoiceRefId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SupplierInvoice_taxInvoiceCode_taxInvoiceNo_key" ON "SupplierInvoice"("taxInvoiceCode", "taxInvoiceNo");
