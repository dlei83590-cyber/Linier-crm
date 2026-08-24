-- Migration 0047 — 商品来源 + 配方（BOM）+ 生产/外协工单（P-1：Item Sourcing Design Gate，用户指令 2026-08-24）
-- 业务：①外购成品直接销售（零新流程）②物料组合成品（自产 SELF / OEM 外协）③原料吨→成品米/件/个（配方系数承载）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE / ALTER TABLE ADD COLUMN

-- 1) 新枚举
CREATE TYPE "ItemSourcingType" AS ENUM ('BOUGHT', 'SELF_MANUFACTURED', 'OEM_OUTSOURCED');
CREATE TYPE "BomStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ProductionOrderType" AS ENUM ('SELF_MANUFACTURE', 'OEM_OUTSOURCING');
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'POSTED', 'CANCELLED');
CREATE TYPE "ProductionOrderLineType" AS ENUM ('MATERIAL', 'FINISHED');

-- 2) DocumentType 追加 PRODUCTION_ORDER（PG16 事务内 ADD VALUE 允许；本迁移不使用新值）
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PRODUCTION_ORDER';

-- 3) Item 扩展：商品来源（默认外购；成品三大来源语义）
ALTER TABLE "Item"
  ADD COLUMN "sourcingType" "ItemSourcingType" NOT NULL DEFAULT 'BOUGHT';

-- 4) CreateTable ItemBom（配方头：1 配方 = 1 成品，多版本）
CREATE TABLE "ItemBom" (
    "id" TEXT NOT NULL,
    "bomNo" TEXT NOT NULL,
    "finishedItemId" TEXT NOT NULL,
    "bomVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "BomStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ItemBom_pkey" PRIMARY KEY ("id")
);

-- 5) CreateTable ItemBomLine（配方行：系数 + 损耗率）
CREATE TABLE "ItemBomLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "componentUomId" TEXT NOT NULL,
    "qtyPerFinishedUnit" DECIMAL(18,6) NOT NULL,
    "lossRate" DECIMAL(8,6) NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ItemBomLine_pkey" PRIMARY KEY ("id")
);

-- 6) CreateTable ProductionOrder（生产/外协工单头）
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "productionType" "ProductionOrderType" NOT NULL DEFAULT 'SELF_MANUFACTURE',
    "bomId" TEXT,
    "finishedItemId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "supplierId" TEXT,
    "processingFee" DECIMAL(18,2),
    "batchNo" TEXT,
    "productionDate" TIMESTAMP(3),
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "movementGroupId" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- 7) CreateTable ProductionOrderLine（工单行：MATERIAL 领料 / FINISHED 成品）
CREATE TABLE "ProductionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineType" "ProductionOrderLineType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "uomId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "warehouseId" TEXT,
    "unitCost" DECIMAL(18,4),
    "amount" DECIMAL(18,2),
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- 8) CreateIndex
CREATE UNIQUE INDEX "ItemBom_bomNo_key" ON "ItemBom"("bomNo");
CREATE UNIQUE INDEX "ItemBom_finishedItemId_bomVersion_key" ON "ItemBom"("finishedItemId", "bomVersion");
CREATE INDEX "ItemBom_finishedItemId_idx" ON "ItemBom"("finishedItemId");
CREATE INDEX "ItemBom_status_idx" ON "ItemBom"("status");
CREATE INDEX "ItemBom_deletedAt_idx" ON "ItemBom"("deletedAt");
CREATE UNIQUE INDEX "ItemBomLine_bomId_componentItemId_key" ON "ItemBomLine"("bomId", "componentItemId");
CREATE INDEX "ItemBomLine_bomId_idx" ON "ItemBomLine"("bomId");
CREATE INDEX "ItemBomLine_componentItemId_idx" ON "ItemBomLine"("componentItemId");
CREATE INDEX "ItemBomLine_deletedAt_idx" ON "ItemBomLine"("deletedAt");
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");
CREATE INDEX "ProductionOrder_finishedItemId_idx" ON "ProductionOrder"("finishedItemId");
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");
CREATE INDEX "ProductionOrder_deletedAt_idx" ON "ProductionOrder"("deletedAt");
CREATE UNIQUE INDEX "ProductionOrderLine_orderId_lineType_itemId_key" ON "ProductionOrderLine"("orderId", "lineType", "itemId");
CREATE INDEX "ProductionOrderLine_orderId_idx" ON "ProductionOrderLine"("orderId");
CREATE INDEX "ProductionOrderLine_itemId_idx" ON "ProductionOrderLine"("itemId");
CREATE INDEX "ProductionOrderLine_deletedAt_idx" ON "ProductionOrderLine"("deletedAt");

-- 9) AddForeignKey
ALTER TABLE "ItemBom" ADD CONSTRAINT "ItemBom_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemBomLine" ADD CONSTRAINT "ItemBomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ItemBom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemBomLine" ADD CONSTRAINT "ItemBomLine_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemBomLine" ADD CONSTRAINT "ItemBomLine_componentUomId_fkey" FOREIGN KEY ("componentUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "ItemBom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
