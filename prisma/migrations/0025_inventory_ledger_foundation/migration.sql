-- Sprint 6A：Inventory Ledger Foundation（库存账本——Schema + Migration 0025）
-- CTO 6A Schema Review 88/100 REQUEST CHANGES（#7469，2026-08-10）落实 5 项：
--   Blocking ① 幂等 identity + movementAtomKey（五元：sourceType+sourceId+sourceLineId+movementRole+movementAtomKey；serial=serialNo，非 serial=BULK）
--   Blocking ② StockProjection 五维数据库级 nullable-normalized 唯一（PG16 UNIQUE NULLS NOT DISTINCT；dimensionKey 仅查询/锁键，非唯一防线；禁空串与 NULL 混淆）
--   Blocking ③ StockProjection.onHandQty >= 0 CHECK（负库存 DB 最后防线，与 Movement+Outbox 同事务回滚）
--   Minor ① InventoryMovement.committedAt NOT NULL（创建即 COMMITTED）
--   Minor ② Reversal 单次冲销语义（reversalOfMovementId @unique：一笔 Movement 最多被完整冲销一次）
-- ⚠️ 迁移编号治理：**不用 0024**（5B Inspection 已使用 `0024_inspection_line_unique`）；6A 从 main migrations 事实源下一个可用编号 = 0025
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表；0024 冻结为批准基线，不重写
-- 设计依据：ADR-0025（Approved with Changes）、Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md、
--           Sprint6A_Inventory_Field_Matrix.md、Sprint6A_CTO_Pending_Decisions.md（P1-P10 全部 Final）
-- 核心事实（CTO #7405/#7458 锁死）：
-- ① InventoryMovement = 库存数量唯一事实源（SSOT）；Stock/OnHandQty 只能投影，不能成为独立业务事实
-- ② 业务模块不得直接创建 InventoryMovement——必须走 Inventory Ledger command 层（sourceType+sourceId+sourceLineId+movementRole+movementAtomKey 五元幂等键）
-- ③ 来源映射：WarehouseReceiptPosted → IN；PurchaseReturned（WAREHOUSE_RECEIPT_LINE 来源）→ OUT；未入库退货无 Movement
-- ④ Movement 历史不可变：COMMITTED 后禁止 UPDATE/DELETE（数据库层约束）；纠错只能追加 Reversal/Correction（独立幂等身份）
-- ⑤ 单层原子事实：一行 = 一个不可变库存原子事实（无 Header/Line 两层）；编组用 movementGroupId（CTO #7458）
-- ⑥ serial-managed 原子化：serialNo 单值 + quantity=1（CHECK 约束）；5B 可批量采集 serialNos[]，6A command 层展开
-- ⑦ P1/P8：Transactional Outbox——业务事实 + Outbox 同事务落库 → Inventory consumer 幂等消费（PENDING/PROCESSING/PROCESSED/DEAD_LETTER + lease/retry）
-- ⑧ P7：物化 StockProjection + 与 Movement 同事务更新 + reconciliation（SUM(COMMITTED Movement) vs onHandQty，差异报警/修复投影不改 Movement）
-- ⑨ P3：ReservedQty/availableQty 不进 6A；P4：Costing（含 costSnapshot）不进入 6A
-- ⑩ P6：禁止负库存——OUT 由 command 层锁 StockProjection 行后判断 onHandQty >= outQty（schema 无法单独解决）
-- ⑪ P5：只建 Ledger + Projection + Outbox；Transfer/Conversion/Count 本期只锁规则，不建业务单据 Schema
-- 本迁移不创建：Transfer / Conversion / Count 业务模型、ReservedQty / availableQty、Costing / FIFO / Moving Average、
--             Sales OUT、PurchaseReturn 以外新来源、API / Consumer 实现

-- ① 新枚举（6 个）
CREATE TYPE "InventoryMovementStatus" AS ENUM ('COMMITTED'); -- P2 Final：创建即 COMMITTED（6A 第一版无 PENDING）
CREATE TYPE "InventoryMovementSourceType" AS ENUM ('WAREHOUSE_RECEIPT_POSTED', 'PURCHASE_RETURN_RETURNED', 'REVERSAL', 'CORRECTION');
CREATE TYPE "InventoryMovementRole" AS ENUM ('IN', 'OUT', 'SOURCE_OUT', 'DESTINATION_IN', 'CONSUME', 'PRODUCE', 'ADJUSTMENT', 'REVERSAL', 'CORRECTION');
CREATE TYPE "InventoryMovementDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "InventoryMovementType" AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER_OUT', 'TRANSFER_IN', 'CONSUME', 'PRODUCE', 'ADJUSTMENT', 'REVERSAL', 'CORRECTION');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD_LETTER');

-- ② DocumentType 增加 1 个单据类型（库存流水，movementNo 取号用）
ALTER TYPE "DocumentType" ADD VALUE 'INVENTORY_MOVEMENT';

-- ③ InventoryMovement（库存数量唯一事实源，单层原子事实）
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "movementNo" TEXT NOT NULL,
    "sourceType" "InventoryMovementSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceLineId" TEXT NOT NULL,
    "movementRole" "InventoryMovementRole" NOT NULL,
    "movementAtomKey" TEXT NOT NULL DEFAULT 'BULK', -- CTO #7469 Blocking ①：原子子键（非 serial=BULK；serial=serialNo；未来 Transfer/Conversion 多原子同 role 区分）
    "movementGroupId" TEXT,
    "direction" "InventoryMovementDirection" NOT NULL,
    "status" "InventoryMovementStatus" NOT NULL DEFAULT 'COMMITTED',
    "movementType" "InventoryMovementType" NOT NULL,
    "reversalOfMovementId" TEXT,
    "correctionOfMovementId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT,
    "serialNo" TEXT,
    "mfgDate" TIMESTAMP(3) WITH TIME ZONE,
    "expDate" TIMESTAMP(3) WITH TIME ZONE,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "referenceNo" TEXT,
    "remark" TEXT,
    "committedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, -- Minor ①：创建即 COMMITTED，NOT NULL
    "committedById" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
    -- CTO #7458 Blocking ① + #7469 Blocking ①：五元幂等唯一键（一个 source line 可合法产生多笔 Movement：
    -- serial-managed 每 serial 一条（movementAtomKey=serialNo）；非 serial 用 BULK；对齐 Prisma 默认约束名防 migrate diff 漂移）
    CONSTRAINT "InventoryMovement_sourceType_sourceId_sourceLineId_movementRole_movementAtomKey_key" UNIQUE ("sourceType", "sourceId", "sourceLineId", "movementRole", "movementAtomKey"),
    -- CTO #7458 Blocking ②：serial-managed 原子化（serialNo 非空 ⇒ quantity 必须 = 1）；quantity 恒 > 0（方向承载正负语义）
    CONSTRAINT "InventoryMovement_quantity_positive_check" CHECK ("quantity" > 0),
    CONSTRAINT "InventoryMovement_serial_quantity_check" CHECK ("serialNo" IS NULL OR "quantity" = 1),
    -- CTO #7495 Schema Final Re-check（唯一 Blocking）：serial 存在时 atomKey 必须 = serialNo（每个 serial 的原子身份就是该 serial）
    -- 不做“serialNo IS NULL → movementAtomKey = BULK”：未来非 serial 的 Transfer/Conversion 可能需要多个 atom key，只约束 serial 存在时相等
    CONSTRAINT "InventoryMovement_serial_atom_key_check" CHECK ("serialNo" IS NULL OR "movementAtomKey" = "serialNo")
);

-- Foreign Keys（onDelete Restrict：历史不可变，来源/主数据删除受 Movement 约束；committedById SetNull）
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_reversalOfMovementId_fkey" FOREIGN KEY ("reversalOfMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_correctionOfMovementId_fkey" FOREIGN KEY ("correctionOfMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "InventoryMovement_movementNo_key" ON "InventoryMovement"("movementNo");
CREATE UNIQUE INDEX "InventoryMovement_reversalOfMovementId_key" ON "InventoryMovement"("reversalOfMovementId"); -- Minor ②：一笔 Movement 最多被完整冲销一次
CREATE INDEX "InventoryMovement_movementGroupId_idx" ON "InventoryMovement"("movementGroupId");
CREATE INDEX "InventoryMovement_warehouseId_idx" ON "InventoryMovement"("warehouseId");
CREATE INDEX "InventoryMovement_locationId_idx" ON "InventoryMovement"("locationId");
CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");
CREATE INDEX "InventoryMovement_batchNo_idx" ON "InventoryMovement"("batchNo");
CREATE INDEX "InventoryMovement_serialNo_idx" ON "InventoryMovement"("serialNo");
CREATE INDEX "InventoryMovement_committedAt_idx" ON "InventoryMovement"("committedAt");
CREATE INDEX "InventoryMovement_correctionOfMovementId_idx" ON "InventoryMovement"("correctionOfMovementId");

-- 历史不可变（D5）：COMMITTED 后禁止 UPDATE/DELETE（数据库层约束；API 层无此能力；纠错只能追加 Reversal/Correction）
CREATE OR REPLACE FUNCTION prevent_inventory_movement_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'InventoryMovement is immutable: UPDATE/DELETE forbidden (use Reversal/Correction)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_movement_immutable
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

-- ④ StockProjection（物化库存投影——**不是事实**；P7 Final：与 Movement 同事务 UPSERT + reconciliation）
CREATE TABLE "StockProjection" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "itemId" TEXT NOT NULL,
    "batchNo" TEXT,
    "serialNo" TEXT,
    -- 查询/锁键（command 层生成，NULL 归一为占位符）；**非唯一防线**（CTO #7469 Blocking ②：唯一性由下方五维 NULLS NOT DISTINCT 约束直接表达）
    "dimensionKey" TEXT NOT NULL,
    "onHandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastMovementAt" TIMESTAMP(3) WITH TIME ZONE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockProjection_pkey" PRIMARY KEY ("id"),
    -- CTO #7469 Blocking ③：负库存 DB 最后防线（Movement+Projection+Outbox 同事务：CHECK 失败 → 整个事务回滚）
    CONSTRAINT "StockProjection_onHandQty_nonnegative_check" CHECK ("onHandQty" >= 0),
    -- CTO #7469 Blocking ②：dimensionKey 禁止空字符串（与 NULL 归一混淆防线）
    CONSTRAINT "StockProjection_dimensionKey_not_empty_check" CHECK ("dimensionKey" <> '')
);

-- Foreign Keys（onDelete Restrict：主数据删除受投影约束）
ALTER TABLE "StockProjection" ADD CONSTRAINT "StockProjection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockProjection" ADD CONSTRAINT "StockProjection_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockProjection" ADD CONSTRAINT "StockProjection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
-- CTO #7469 Blocking ②：库存维度唯一性由数据库直接表达（PG16 UNIQUE NULLS NOT DISTINCT——nullable 五维中 NULL 视为同一维度；
-- 不能用普通 composite unique：PG 默认 NULLS DISTINCT 会把 NULL 当成互不相同的维度）
CREATE UNIQUE INDEX "StockProjection_dimension_unique" ON "StockProjection" ("warehouseId", "locationId", "itemId", "batchNo", "serialNo") NULLS NOT DISTINCT;
CREATE INDEX "StockProjection_warehouseId_idx" ON "StockProjection"("warehouseId");
CREATE INDEX "StockProjection_itemId_idx" ON "StockProjection"("itemId");
CREATE INDEX "StockProjection_serialNo_idx" ON "StockProjection"("serialNo");
CREATE INDEX "StockProjection_dimensionKey_idx" ON "StockProjection"("dimensionKey");

-- ⑤ OutboxMessage（平台级持久 Transactional Outbox；P8 Final：PENDING → PROCESSING → PROCESSED；失败 retry / DEAD_LETTER；成功不删除保留审计）
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB,
    "idempotencyKey" TEXT NOT NULL, -- = sourceType|sourceId|sourceLineId|movementRole|movementAtomKey（与 Movement 五元幂等键一致，CTO #7469）
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) WITH TIME ZONE,
    "lockedAt" TIMESTAMP(3) WITH TIME ZONE,
    "lockedBy" TEXT,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OutboxMessage_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

-- Indexes（消费扫描 + retry 调度）
CREATE INDEX "OutboxMessage_status_nextAttemptAt_idx" ON "OutboxMessage"("status", "nextAttemptAt");
CREATE INDEX "OutboxMessage_createdAt_idx" ON "OutboxMessage"("createdAt");

-- ⑥ 本迁移不创建（6A 边界，CTO #7446 明令）：Transfer / Conversion / Count 业务模型、ReservedQty / availableQty、
--    Costing / FIFO / Moving Average、Sales OUT、PurchaseReturn 以外新来源、API / Consumer 实现
