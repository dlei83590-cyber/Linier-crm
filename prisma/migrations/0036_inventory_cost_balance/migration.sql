-- Sprint 7/成本核算（CTO 授权解除 D9 HOLD 2026-08-20）：0036_inventory_cost_balance — 移动加权平均成本层
--
-- 范围（ADR-0038）：InventoryCostBalance（itemId @unique：onHandQty/totalCost/avgUnitCost，item 级移动平均）。
-- 红线：成本层独立，不写 InventoryMovement/StockProjection（6A SSOT 红线延续）；成本口径 = 未税采购成本（P9）。

CREATE TABLE "InventoryCostBalance" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "onHandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "avgUnitCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "InventoryCostBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryCostBalance_itemId_key" ON "InventoryCostBalance"("itemId");
CREATE INDEX "InventoryCostBalance_itemId_idx" ON "InventoryCostBalance"("itemId");

ALTER TABLE "InventoryCostBalance" ADD CONSTRAINT "InventoryCostBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 成本幂等源（防重复累计；与入库成本更新同事务）
CREATE TABLE "InventoryCostSource" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "baseAmount" DECIMAL(18,4) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryCostSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryCostSource_sourceKey_key" ON "InventoryCostSource"("sourceKey");
CREATE INDEX "InventoryCostSource_itemId_idx" ON "InventoryCostSource"("itemId");
ALTER TABLE "InventoryCostSource" ADD CONSTRAINT "InventoryCostSource_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
