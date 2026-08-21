-- Migration 0040 — ProductionInbound 生产入库（P-1：基于利尼尔生产入库表设计；Item.standardCost + 生产入库单/行）

-- AlterTable Item（标准成本：生产入库成本基数）
ALTER TABLE "Item"
  ADD COLUMN "standardCost" DECIMAL(14,4);

-- CreateEnum
CREATE TYPE "ProductionInboundStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED');

-- CreateTable ProductionInbound（生产入库单头）
CREATE TABLE "ProductionInbound" (
    "id" TEXT NOT NULL,
    "inboundNo" TEXT NOT NULL,
    "inboundDate" TIMESTAMP(3) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchNo" TEXT,
    "totalQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ProductionInboundStatus" NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionInbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable ProductionInboundLine（生产入库行：半成品消耗 → 产成品入库）
CREATE TABLE "ProductionInboundLine" (
    "id" TEXT NOT NULL,
    "inboundId" TEXT NOT NULL,
    "fromItemId" TEXT NOT NULL,
    "fromQty" DECIMAL(14,3) NOT NULL,
    "toItemId" TEXT NOT NULL,
    "toQty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionInboundLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionInbound_inboundNo_key" ON "ProductionInbound"("inboundNo");
CREATE INDEX "ProductionInbound_inboundDate_idx" ON "ProductionInbound"("inboundDate");
CREATE INDEX "ProductionInbound_warehouseId_idx" ON "ProductionInbound"("warehouseId");
CREATE INDEX "ProductionInbound_status_idx" ON "ProductionInbound"("status");
CREATE INDEX "ProductionInbound_deletedAt_idx" ON "ProductionInbound"("deletedAt");
CREATE INDEX "ProductionInboundLine_inboundId_idx" ON "ProductionInboundLine"("inboundId");
CREATE INDEX "ProductionInboundLine_fromItemId_idx" ON "ProductionInboundLine"("fromItemId");
CREATE INDEX "ProductionInboundLine_toItemId_idx" ON "ProductionInboundLine"("toItemId");

-- AddForeignKey
ALTER TABLE "ProductionInbound" ADD CONSTRAINT "ProductionInbound_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionInboundLine" ADD CONSTRAINT "ProductionInboundLine_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "ProductionInbound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionInboundLine" ADD CONSTRAINT "ProductionInboundLine_fromItemId_fkey" FOREIGN KEY ("fromItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionInboundLine" ADD CONSTRAINT "ProductionInboundLine_toItemId_fkey" FOREIGN KEY ("toItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
