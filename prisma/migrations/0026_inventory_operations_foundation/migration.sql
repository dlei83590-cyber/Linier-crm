-- Sprint 6B：Inventory Operations 业务事实层（Schema + Migration 0026）
-- CTO 6B Gate Re-review 98/100 APPROVED FOR SCHEMA DESIGN（#8014，2026-08-11）——8/8 PASS 后放行 Schema
-- 设计依据：ADR-0026（Approved with Changes）、Sprint6B_Inventory_Operations_Architecture_Process_Gate.md、
--           Sprint6B_Inventory_Operations_Field_Matrix.md、Sprint6B_CTO_Pending_Decisions.md（P1-P12 全部 Final）
-- ⚠️ 迁移编号治理：最新 main migrations 事实源 = `0025_inventory_ledger_foundation` → 本迁移 = **0026**（不得猜测/复用/改写已进 main 的 migration）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表；0025 冻结为批准基线，不重写
-- 范围锁定（CTO #8014）：业务事实层 8 表（InventoryTransfer/Line、StockCount/Line、InventoryAdjustment/Line、InventoryConversion/Line）
-- **本迁移不创建**：API / Workflow / Seed（DocumentSequence TRF/CNT/ADJ/CVT 行）/ RBAC / 共享 InventoryLedgerCommand core 抽取 / Consumer 改造
-- 6B 红线继承（6A SSOT）：业务 API 不得直接 INSERT InventoryMovement / UPDATE StockProjection——必须经共享 Ledger Command（同步）或 Outbox + Consumer（异步）
-- P12 Final 实现前置：抽取共享 InventoryLedgerCommand core（实现阶段做，不在本迁移）

-- ① 新枚举（7 个，业务事实层状态/类型）
CREATE TYPE "InventoryTransferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'EXECUTED', 'CANCELLED'); -- P2 Final：EXECUTED 才触发双边 Movement
CREATE TYPE "InventoryTransferType" AS ENUM ('INTER_WAREHOUSE', 'INTRA_WAREHOUSE'); -- P3 Final：跨仓/同仓统一模型
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'COUNTING', 'COMPLETED', 'ADJUSTED', 'CANCELLED');
CREATE TYPE "StockCountFreezeStrategy" AS ENUM ('DYNAMIC'); -- P6 Final：动态盘点（不冻结维度，per-line atomic snapshot）
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'APPLIED', 'CANCELLED'); -- P9 Final maker-checker；APPLIED 仅 Ledger 成功后
CREATE TYPE "InventoryConversionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'EXECUTED', 'CANCELLED');
CREATE TYPE "InventoryConversionLineRole" AS ENUM ('CONSUME', 'PRODUCE');

-- ② DocumentType 增加 4 个单据类型（TRF / CNT / ADJ / CVT；Seed 行在 Seed 阶段补，本迁移不建）
ALTER TYPE "DocumentType" ADD VALUE 'INVENTORY_TRANSFER';
ALTER TYPE "DocumentType" ADD VALUE 'STOCK_COUNT';
ALTER TYPE "DocumentType" ADD VALUE 'INVENTORY_ADJUSTMENT';
ALTER TYPE "DocumentType" ADD VALUE 'INVENTORY_CONVERSION';

-- ③ InventoryMovementSourceType 增加 3 个来源（CTO #7975：不新增 STOCK_COUNT——Count 本身不产生 Movement，差异走 Adjustment）
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'TRANSFER';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'ADJUSTMENT';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'CONVERSION';

-- ④ InventoryTransfer（调拨单头——业务事实；DRAFT/SUBMITTED/APPROVED 不落账）
-- CTO Schema 问题①：movementGroupId 不在 DRAFT 创建时生成——只在 EXECUTE 时生成并冻结（Schema 可空，执行后必有）
-- CTO Schema 问题②：防自调拨——同仓且同库位（含都 NULL）拒绝（DB CHECK 覆盖 warehouse/location 层；item/batch/serial 五维全等由 service invariant 锁死）
CREATE TABLE "InventoryTransfer" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL, -- 调拨单号（DocumentSequence docType=INVENTORY_TRANSFER，前缀 TRF）
    "status" "InventoryTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "transferType" "InventoryTransferType" NOT NULL DEFAULT 'INTER_WAREHOUSE',
    "sourceWarehouseId" TEXT NOT NULL,
    "sourceLocationId" TEXT,
    "destinationWarehouseId" TEXT NOT NULL,
    "destinationLocationId" TEXT,
    "movementGroupId" TEXT, -- CTO Schema 问题①：EXECUTE 时生成并冻结（双边 SOURCE_OUT + DESTINATION_IN 共享）；DRAFT 可空
    "approvedById" TEXT,
    "executedAt" TIMESTAMP(3) WITH TIME ZONE, -- CTO Schema 问题⑥：Ledger 双边成功后写入（EXECUTED 才有）
    "executedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransfer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryTransfer_transferNo_key" UNIQUE ("transferNo"),
    -- CTO Schema 问题②：防自调拨（同仓且同库位——含两 location 都 NULL 视为自调拨 → 拒绝；跨仓 warehouse 不同自然通过）
    CONSTRAINT "InventoryTransfer_self_transfer_check" CHECK (NOT ("sourceWarehouseId" = "destinationWarehouseId" AND "sourceLocationId" IS NOT DISTINCT FROM "destinationLocationId"))
);

-- ⑤ InventoryTransferLine（调拨单行——每行 → SOURCE_OUT + DESTINATION_IN 一对 Movement，同一 movementGroupId）
CREATE TABLE "InventoryTransferLine" (
    "id" TEXT NOT NULL,
    "transferHeaderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "uomId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL, -- 双边 quantity 相等（守恒）
    "batchNo" TEXT, -- P5 Final：batch 精确继承
    "serialNos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], -- serial-managed：每 serial 一对 Movement（serial 精确继承不重生成）
    "mfgDate" DATE,
    "expDate" DATE,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransferLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryTransferLine_quantity_positive_check" CHECK ("quantity" > 0)
);

-- ⑥ StockCount（盘点单头——实盘事实；本身不产生 Movement；差异经 Adjustment Command → InventoryMovement(ADJUSTMENT)）
-- 严禁 StockCount → UPDATE StockProjection（CTO 红线）
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "countNo" TEXT NOT NULL, -- 盘点单号（DocumentSequence docType=STOCK_COUNT，前缀 CNT）
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "freezeStrategy" "StockCountFreezeStrategy" NOT NULL DEFAULT 'DYNAMIC', -- P6 Final
    "countedById" TEXT,
    "completedAt" TIMESTAMP(3) WITH TIME ZONE,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCount_countNo_key" UNIQUE ("countNo")
);

-- ⑦ StockCountLine（盘点明细行——per-line atomic snapshot，CTO #7975 Blocking ①）
-- 录入 countedQty 时同事务读取五维 StockProjection → bookQtyAtCount / countedAt / ledgerWatermark（仅审计）
-- CTO Schema 问题③：同一五维在一个 Count 内必须唯一（防重复盘两行）——PG16 UNIQUE NULLS NOT DISTINCT
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countHeaderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT,
    "serialNo" TEXT, -- 单值（serial-managed 逐 serial 盘点）
    "countedQty" DECIMAL(18,4) NOT NULL, -- 实盘数（录入）
    "bookQtyAtCount" DECIMAL(18,4) NOT NULL, -- 录入时同事务读取五维 StockProjection.onHandQty（per-line atomic snapshot）
    "countedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 录入时点
    "ledgerWatermark" TEXT, -- 仅审计/重放证据（movementNo 不作并发时序主键，CTO #7975 Blocking ②）
    "varianceQty" DECIMAL(18,4), -- 服务端计算：countedQty - bookQtyAtCount
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StockCountLine_countedQty_nonnegative_check" CHECK ("countedQty" >= 0)
);

-- ⑧ InventoryAdjustment（调整单头——受控库存账事实；只能经共享 Ledger Command 追加 Movement）
-- CTO Schema 问题④ maker-checker：createdById（创建人）与 approvedById/appliedById（批准/Apply 人）结构承载，service 强制不同人
-- CTO Schema 问题⑥：状态只有在 Ledger 成功后才进入 APPLIED——不允许"业务单据终态已写、Movement 失败"
-- reasonCode（P8 Final）：系统保留码（COUNT_VARIANCE/DAMAGE/LOSS/GIFT/SYSTEM_CORRECTION/MANUAL）+ 可扩展字典（String，不写死 enum）
CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL,
    "adjustmentNo" TEXT NOT NULL, -- 调整单号（DocumentSequence docType=INVENTORY_ADJUSTMENT，前缀 ADJ）
    "status" "InventoryAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "reasonCode" TEXT NOT NULL,
    "direction" "InventoryMovementDirection" NOT NULL, -- IN / OUT（正负方向；quantity 恒正数）
    "sourceStockCountId" TEXT, -- 来源盘点单（可空——Manual 调整无盘点来源）
    "approvedById" TEXT,
    "appliedById" TEXT,
    "appliedAt" TIMESTAMP(3) WITH TIME ZONE, -- CTO Schema 问题⑥：Ledger 成功后写入（APPLIED 才有）
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryAdjustment_adjustmentNo_key" UNIQUE ("adjustmentNo"),
    -- maker-checker 第一道防线：批准/Apply 人不得与创建人相同（service 强制 + DB CHECK 兜底；NULL 视为未审批/未 Apply）
    CONSTRAINT "InventoryAdjustment_maker_checker_approve_check" CHECK ("approvedById" IS NULL OR "approvedById" <> "createdById"),
    CONSTRAINT "InventoryAdjustment_maker_checker_apply_check" CHECK ("appliedById" IS NULL OR "appliedById" <> "createdById")
);

-- ⑨ InventoryAdjustmentLine（调整行——每行 → 一笔 ADJUSTMENT Movement；Count 通过 sourceStockCountLineId 追溯，不新增 STOCK_COUNT sourceType）
CREATE TABLE "InventoryAdjustmentLine" (
    "id" TEXT NOT NULL,
    "adjustmentHeaderId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT,
    "serialNo" TEXT, -- 单值（serial-managed 逐 serial 原子化）
    "quantity" DECIMAL(18,4) NOT NULL, -- 恒正数（方向在 header）
    "uomId" TEXT,
    "sourceStockCountLineId" TEXT, -- 盘点行追溯（CTO #7975：Count 经此追溯，不新增 STOCK_COUNT sourceType）
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAdjustmentLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryAdjustmentLine_quantity_positive_check" CHECK ("quantity" > 0)
);

-- ⑩ InventoryConversion（转换单头——收窄为同 item Repack / UOM Conversion，CTO #7975 Blocking ③）
-- CTO Schema 问题⑤：Base UOM canonicalization 与现有 Item/UOM 模型对齐——baseUomId 引用现有 UnitOfMeasure（不发明第二套 UOM master）
-- CTO Schema 问题⑥：状态只有在 Ledger 成功后才进入 EXECUTED
CREATE TABLE "InventoryConversion" (
    "id" TEXT NOT NULL,
    "conversionNo" TEXT NOT NULL, -- 转换单号（DocumentSequence docType=INVENTORY_CONVERSION，前缀 CVT）
    "status" "InventoryConversionStatus" NOT NULL DEFAULT 'DRAFT',
    "itemId" TEXT NOT NULL, -- 同一 itemId（6B 收窄：同 item Repack/UOM Conversion）
    "baseUomId" TEXT NOT NULL, -- Inventory Base UOM（引用现有 UnitOfMeasure；P11 Final）
    "conversionRate" DECIMAL(18,6), -- 显式换算率 snapshot（单据声明，不隐式查表）
    "movementGroupId" TEXT, -- CTO Schema 问题①：EXECUTE 时生成并冻结（CONSUME + PRODUCE 共享）；DRAFT 可空
    "executedAt" TIMESTAMP(3) WITH TIME ZONE, -- CTO Schema 问题⑥：Ledger 成功后写入（EXECUTED 才有）
    "executedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryConversion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryConversion_conversionNo_key" UNIQUE ("conversionNo")
);

-- ⑪ InventoryConversionLine（转换行——lineRole=CONSUME / PRODUCE；换算到 base UOM 后 ΣCONSUME 与 ΣPRODUCE 相等，P11 Final）
CREATE TABLE "InventoryConversionLine" (
    "id" TEXT NOT NULL,
    "conversionHeaderId" TEXT NOT NULL,
    "lineRole" "InventoryConversionLineRole" NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "batchNo" TEXT, -- P5 Final：batch 默认精确继承
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryConversionLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryConversionLine_quantity_positive_check" CHECK ("quantity" > 0)
);

-- ⑫ Foreign Keys（onDelete：Header 级主数据 Restrict / 审批-执行人 SetNull / 子行 Cascade）
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_sourceLocationId_sourceWarehouseId_fkey" FOREIGN KEY ("sourceLocationId", "sourceWarehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_destinationLocationId_destinationWarehouseId_fkey" FOREIGN KEY ("destinationLocationId", "destinationWarehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryTransferLine" ADD CONSTRAINT "InventoryTransferLine_transferHeaderId_fkey" FOREIGN KEY ("transferHeaderId") REFERENCES "InventoryTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryTransferLine" ADD CONSTRAINT "InventoryTransferLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransferLine" ADD CONSTRAINT "InventoryTransferLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countHeaderId_fkey" FOREIGN KEY ("countHeaderId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_sourceStockCountId_fkey" FOREIGN KEY ("sourceStockCountId") REFERENCES "StockCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_adjustmentHeaderId_fkey" FOREIGN KEY ("adjustmentHeaderId") REFERENCES "InventoryAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryAdjustmentLine" ADD CONSTRAINT "InventoryAdjustmentLine_sourceStockCountLineId_fkey" FOREIGN KEY ("sourceStockCountLineId") REFERENCES "StockCountLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryConversion" ADD CONSTRAINT "InventoryConversion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryConversion" ADD CONSTRAINT "InventoryConversion_baseUomId_fkey" FOREIGN KEY ("baseUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryConversion" ADD CONSTRAINT "InventoryConversion_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryConversionLine" ADD CONSTRAINT "InventoryConversionLine_conversionHeaderId_fkey" FOREIGN KEY ("conversionHeaderId") REFERENCES "InventoryConversion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryConversionLine" ADD CONSTRAINT "InventoryConversionLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryConversionLine" ADD CONSTRAINT "InventoryConversionLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryConversionLine" ADD CONSTRAINT "InventoryConversionLine_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ⑬ Indexes
CREATE INDEX "InventoryTransfer_transferNo_idx" ON "InventoryTransfer"("transferNo");
CREATE INDEX "InventoryTransfer_sourceWarehouseId_idx" ON "InventoryTransfer"("sourceWarehouseId");
CREATE INDEX "InventoryTransfer_destinationWarehouseId_idx" ON "InventoryTransfer"("destinationWarehouseId");
CREATE INDEX "InventoryTransfer_status_idx" ON "InventoryTransfer"("status");
CREATE INDEX "InventoryTransfer_movementGroupId_idx" ON "InventoryTransfer"("movementGroupId");
CREATE INDEX "InventoryTransfer_deletedAt_idx" ON "InventoryTransfer"("deletedAt");

CREATE INDEX "InventoryTransferLine_transferHeaderId_idx" ON "InventoryTransferLine"("transferHeaderId");
CREATE INDEX "InventoryTransferLine_itemId_idx" ON "InventoryTransferLine"("itemId");
CREATE INDEX "InventoryTransferLine_deletedAt_idx" ON "InventoryTransferLine"("deletedAt");

CREATE INDEX "StockCount_countNo_idx" ON "StockCount"("countNo");
CREATE INDEX "StockCount_status_idx" ON "StockCount"("status");
CREATE INDEX "StockCount_deletedAt_idx" ON "StockCount"("deletedAt");

-- CTO Schema 问题③：同一五维在一个 Count 内必须唯一（PG16 UNIQUE NULLS NOT DISTINCT——nullable 五维中 NULL 视为同一维度）
CREATE UNIQUE INDEX "StockCountLine_count_dimension_unique" ON "StockCountLine" ("countHeaderId", "warehouseId", "locationId", "itemId", "batchNo", "serialNo") NULLS NOT DISTINCT;
CREATE INDEX "StockCountLine_countHeaderId_idx" ON "StockCountLine"("countHeaderId");
CREATE INDEX "StockCountLine_warehouseId_idx" ON "StockCountLine"("warehouseId");
CREATE INDEX "StockCountLine_itemId_idx" ON "StockCountLine"("itemId");
CREATE INDEX "StockCountLine_deletedAt_idx" ON "StockCountLine"("deletedAt");

CREATE INDEX "InventoryAdjustment_adjustmentNo_idx" ON "InventoryAdjustment"("adjustmentNo");
CREATE INDEX "InventoryAdjustment_status_idx" ON "InventoryAdjustment"("status");
CREATE INDEX "InventoryAdjustment_reasonCode_idx" ON "InventoryAdjustment"("reasonCode");
CREATE INDEX "InventoryAdjustment_deletedAt_idx" ON "InventoryAdjustment"("deletedAt");

CREATE INDEX "InventoryAdjustmentLine_adjustmentHeaderId_idx" ON "InventoryAdjustmentLine"("adjustmentHeaderId");
CREATE INDEX "InventoryAdjustmentLine_warehouseId_idx" ON "InventoryAdjustmentLine"("warehouseId");
CREATE INDEX "InventoryAdjustmentLine_itemId_idx" ON "InventoryAdjustmentLine"("itemId");
CREATE INDEX "InventoryAdjustmentLine_sourceStockCountLineId_idx" ON "InventoryAdjustmentLine"("sourceStockCountLineId");
CREATE INDEX "InventoryAdjustmentLine_deletedAt_idx" ON "InventoryAdjustmentLine"("deletedAt");

CREATE INDEX "InventoryConversion_conversionNo_idx" ON "InventoryConversion"("conversionNo");
CREATE INDEX "InventoryConversion_itemId_idx" ON "InventoryConversion"("itemId");
CREATE INDEX "InventoryConversion_status_idx" ON "InventoryConversion"("status");
CREATE INDEX "InventoryConversion_movementGroupId_idx" ON "InventoryConversion"("movementGroupId");
CREATE INDEX "InventoryConversion_deletedAt_idx" ON "InventoryConversion"("deletedAt");

CREATE INDEX "InventoryConversionLine_conversionHeaderId_idx" ON "InventoryConversionLine"("conversionHeaderId");
CREATE INDEX "InventoryConversionLine_warehouseId_idx" ON "InventoryConversionLine"("warehouseId");
CREATE INDEX "InventoryConversionLine_deletedAt_idx" ON "InventoryConversionLine"("deletedAt");

-- ⑭ 本迁移不创建（CTO #8014 明令，后续阶段）：API / Workflow / Seed（DocumentSequence TRF/CNT/ADJ/CVT 行在 Seed 阶段）/
--    RBAC（inventory-adjustment:apply 等受限权限）/ 共享 InventoryLedgerCommand core 抽取（实现阶段）/ Consumer 改造
