-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "GlVoucherType" AS ENUM ('GENERAL', 'RECEIPT', 'PAYMENT', 'TRANSFER');

-- AlterTable GlJournalEntry（凭证字 + 附件张数，ADR-0044）
ALTER TABLE "GlJournalEntry"
  ADD COLUMN "voucherType" "GlVoucherType" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "attachmentCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "GlJournalEntry" ADD CONSTRAINT "GlJournalEntry_attachmentCount_nonneg" CHECK ("attachmentCount" >= 0);

-- CreateTable AccountingPeriod（期间主数据；periodKey YYYYMM）
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "periodCloseId" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_periodKey_key" ON "AccountingPeriod"("periodKey");
CREATE UNIQUE INDEX "AccountingPeriod_periodCloseId_key" ON "AccountingPeriod"("periodCloseId");
CREATE INDEX "AccountingPeriod_fiscalYear_idx" ON "AccountingPeriod"("fiscalYear");
CREATE INDEX "AccountingPeriod_status_idx" ON "AccountingPeriod"("status");

-- AddCheckConstraint
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_periodKey_format" CHECK ("periodKey" ~ '^[0-9]{6}$');

-- AddForeignKey（status=CLOSED 引用结转记录；重开时清引用）
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_periodCloseId_fkey" FOREIGN KEY ("periodCloseId") REFERENCES "GlPeriodClose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable DocumentSequence（编号引擎期间扩展，ADR-0044）
ALTER TABLE "DocumentSequence"
  ADD COLUMN "periodPattern" TEXT,
  ADD COLUMN "perPeriodReset" BOOLEAN NOT NULL DEFAULT false;
