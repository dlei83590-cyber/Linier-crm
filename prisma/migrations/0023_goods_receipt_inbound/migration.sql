-- Sprint 5B：采购收货与入库（Goods Receipt Inbound）—— Schema + Migration 0023
-- CTO Gate Re-review 96/100 APPROVED WITH MINOR DOC FIXES（2026-08-09）；Migration 0023 CONDITIONALLY APPROVED
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE / ALTER TABLE ADD COLUMN
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Invoice/AccountsReceivable/Delivery/SalesOrder/Supplier 一律不动）
-- 设计依据：ADR-0024（Approved with Changes）、Sprint5B_China_ERP_Process_Field_Gate.md、Sprint5B_Field_Matrix.md、
--           Sprint5B_CTO_Pending_Decisions.md（P1-P10 全部 Final）
-- 事实链：PO CONFIRMED → PurchaseReceipt（到货/收货现场事实）→ Inspection（QC 唯一事实源）
--        → WarehouseReceipt（采购入库事实，Created ≠ Posted，只有 POSTED 才触发 6A InventoryMovement(IN)）
-- 关键决策（CTO 拍板 + Gate Re-review 8 门禁）：
-- ① 超收：System Default = 0%；容差优先级 PO Line → Supplier+Item → Item → Supplier → System；超容差 → Over-Receipt Approval（Blocking ①）
-- ② receivedQty 精确定义：PurchaseReceipt.quantity=物理到货；PO Line.receivedQty=被采购履约接受、可冲减未交数量（当场拒收 rejectedOnReceiptQty 不计入）（Blocking ②）
-- ③ Inspection 唯一 QC 事实源：PurchaseReceipt 只留现场事实（quantity/visibleDamageQty/rejectedOnReceiptQty/remark）；免检=SKIP+QUALIFIED（Blocking ③）
-- ④ 5B 建最小 Warehouse/WarehouseLocation 主数据；Stock/InventoryMovement/库存余额模型属 6A（Blocking ④ / P8 Final）
-- ⑤ 退货=独立 PurchaseReturn（非负 GR）：必须有来源（三个真实 FK 之一非空且与 sourceRefType 匹配，exactly-one 由 API+QA 强制）+ disposition（REPLACE_REQUIRED/CREDIT_ONLY）（P5 Final / Blocking ②）
-- ⑥ D2/D9：CONFIRMED→可收 / PARTIALLY_RECEIVED→可继续收 / RECEIVED→禁止普通新增收货（需 Reopen/Amendment/Approved Over-Receipt Exception）
-- ⑦ D10：WarehouseReceipt status = DRAFT → POSTED → CANCELLED；Created ≠ Posted，只有 Posted 才触发 InventoryMovement(IN)
-- ⑧ P4 Final：直送 fulfillmentType = WAREHOUSE | DIRECT_PROJECT（PO Line 预声明，非简单 boolean）；直送=有 PurchaseReceipt 无 WarehouseReceipt 无 InventoryMovement(IN)
-- ⑨ P6 Final：批次/序列号/效期 canonical capture point = WarehouseReceiptLine（入库层采集）
-- ⑩ P1b Final：普通收货/退货不走审批；超收/特殊退货才走 Workflow
-- 本迁移不创建：Stock / InventoryMovement / InventoryBalance / AvailableQty / ReservedQty / SupplierInvoice / AP / 三单匹配（6A/5C 边界）

-- ① 新枚举（9 个）
CREATE TYPE "PurchaseOrderFulfillmentType" AS ENUM ('WAREHOUSE', 'DIRECT_PROJECT');
CREATE TYPE "PurchaseReceiptStatus" AS ENUM ('DRAFT', 'RECEIVED', 'CANCELLED');
CREATE TYPE "InspectionMode" AS ENUM ('SKIP', 'SPOT', 'FULL');
CREATE TYPE "InspectionResult" AS ENUM ('QUALIFIED', 'PARTIAL', 'REJECTED', 'PENDING');
CREATE TYPE "WarehouseReceiptStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
CREATE TYPE "PurchaseReturnType" AS ENUM ('REJECTED_ON_RECEIPT', 'RETURN_AFTER_STOCK_IN', 'QUALITY_ISSUE');
CREATE TYPE "PurchaseReturnStatus" AS ENUM ('DRAFT', 'RETURNED', 'CANCELLED');
CREATE TYPE "PurchaseReturnSourceType" AS ENUM ('RECEIPT_LINE', 'WAREHOUSE_RECEIPT_LINE', 'INSPECTION');
CREATE TYPE "PurchaseReturnDisposition" AS ENUM ('REPLACE_REQUIRED', 'CREDIT_ONLY');

-- ② DocumentType 增加 3 个单据类型（收货单 / 入库单 / 退货单）
ALTER TYPE "DocumentType" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "DocumentType" ADD VALUE 'WAREHOUSE_RECEIPT';
ALTER TYPE "DocumentType" ADD VALUE 'PURCHASE_RETURN';

-- ③ PurchaseOrderLine 扩展（履约类型 / 直送项目 / 超收容差 override）
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "fulfillmentType" "PurchaseOrderFulfillmentType" NOT NULL DEFAULT 'WAREHOUSE';
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "projectId" TEXT;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "overReceiptToleranceRate" DECIMAL(8,6);

-- Foreign Keys（onDelete SetNull：项目删除不影响 PO Line 历史）
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "PurchaseOrderLine_projectId_idx" ON "PurchaseOrderLine"("projectId");

-- ④ Warehouse（5B 最小主数据，P8 Final）
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE INDEX "Warehouse_deletedAt_idx" ON "Warehouse"("deletedAt");

-- ⑤ WarehouseLocation（5B 最小主数据，P8 Final；库位是否必填待实现阶段定）
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete Cascade：仓库删除级联库位）
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "WarehouseLocation_warehouseId_code_key" ON "WarehouseLocation"("warehouseId", "code");
CREATE UNIQUE INDEX "WarehouseLocation_id_warehouseId_key" ON "WarehouseLocation"("id", "warehouseId");
CREATE INDEX "WarehouseLocation_warehouseId_idx" ON "WarehouseLocation"("warehouseId");
CREATE INDEX "WarehouseLocation_deletedAt_idx" ON "WarehouseLocation"("deletedAt");

-- ⑥ PurchaseReceipt（到货/收货现场事实；Blocking ③：只保留现场事实，不承载 QC）
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "status" "PurchaseReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3) WITH TIME ZONE,
    "receivedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete Restrict：PO/供应商/仓库删除受收货单约束；receivedById SetNull）
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "PurchaseReceipt_code_key" ON "PurchaseReceipt"("code");
CREATE INDEX "PurchaseReceipt_purchaseOrderId_idx" ON "PurchaseReceipt"("purchaseOrderId");
CREATE INDEX "PurchaseReceipt_supplierId_idx" ON "PurchaseReceipt"("supplierId");
CREATE INDEX "PurchaseReceipt_warehouseId_idx" ON "PurchaseReceipt"("warehouseId");
CREATE INDEX "PurchaseReceipt_status_idx" ON "PurchaseReceipt"("status");
CREATE INDEX "PurchaseReceipt_deletedAt_idx" ON "PurchaseReceipt"("deletedAt");

-- ⑦ PurchaseReceiptLine（只保留收货现场事实；quality 判定归 Inspection；直送执行补充字段 P4 Final）
CREATE TABLE "PurchaseReceiptLine" (
    "id" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "visibleDamageQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedOnReceiptQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "deliveryAddress" TEXT,
    "receiver" TEXT,
    "proof" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete：头 Cascade / PO Line Restrict / Item Restrict / UOM SetNull）
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "PurchaseReceiptLine_purchaseReceiptId_lineNo_key" ON "PurchaseReceiptLine"("purchaseReceiptId", "lineNo");
CREATE INDEX "PurchaseReceiptLine_purchaseReceiptId_idx" ON "PurchaseReceiptLine"("purchaseReceiptId");
CREATE INDEX "PurchaseReceiptLine_purchaseOrderLineId_idx" ON "PurchaseReceiptLine"("purchaseOrderLineId");
CREATE INDEX "PurchaseReceiptLine_itemId_idx" ON "PurchaseReceiptLine"("itemId");
CREATE INDEX "PurchaseReceiptLine_deletedAt_idx" ON "PurchaseReceiptLine"("deletedAt");

-- ⑧ Inspection（QC 唯一事实源；P3 Final；免检 = SKIP + QUALIFIED，不绕过 Inspection）
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "purchaseReceiptLineId" TEXT NOT NULL,
    "inspectionMode" "InspectionMode" NOT NULL,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "qualifiedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3) WITH TIME ZONE,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete Cascade：收货行删除级联检验记录；inspectedById SetNull）
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_purchaseReceiptLineId_fkey" FOREIGN KEY ("purchaseReceiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "Inspection_purchaseReceiptLineId_idx" ON "Inspection"("purchaseReceiptLineId");
CREATE INDEX "Inspection_inspectedById_idx" ON "Inspection"("inspectedById");
CREATE INDEX "Inspection_deletedAt_idx" ON "Inspection"("deletedAt");

-- ⑨ WarehouseReceipt（采购入库事实；D10：Created ≠ Posted，只有 POSTED 才触发 6A InventoryMovement(IN)）
CREATE TABLE "WarehouseReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseReceiptId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" "WarehouseReceiptStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3) WITH TIME ZONE,
    "postedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseReceipt_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete Restrict：收货单/仓库删除受入库单约束；locationId/postedById SetNull；Blocking ④ 已删除 stockedById）
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_locationId_warehouseId_fkey" FOREIGN KEY ("locationId", "warehouseId") REFERENCES "WarehouseLocation"("id", "warehouseId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "WarehouseReceipt_code_key" ON "WarehouseReceipt"("code");
CREATE INDEX "WarehouseReceipt_purchaseReceiptId_idx" ON "WarehouseReceipt"("purchaseReceiptId");
CREATE INDEX "WarehouseReceipt_warehouseId_idx" ON "WarehouseReceipt"("warehouseId");
CREATE INDEX "WarehouseReceipt_locationId_idx" ON "WarehouseReceipt"("locationId");
CREATE INDEX "WarehouseReceipt_status_idx" ON "WarehouseReceipt"("status");
CREATE INDEX "WarehouseReceipt_deletedAt_idx" ON "WarehouseReceipt"("deletedAt");

-- ⑩ WarehouseReceiptLine（P6 Final：批次/序列号/效期 canonical capture point = 入库层采集）
CREATE TABLE "WarehouseReceiptLine" (
    "id" TEXT NOT NULL,
    "warehouseReceiptId" TEXT NOT NULL,
    "purchaseReceiptLineId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "itemId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "batchNo" TEXT,
    "serialNos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
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

    CONSTRAINT "WarehouseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete：头 Cascade / 收货行 Restrict / Item Restrict / UOM SetNull）
ALTER TABLE "WarehouseReceiptLine" ADD CONSTRAINT "WarehouseReceiptLine_warehouseReceiptId_fkey" FOREIGN KEY ("warehouseReceiptId") REFERENCES "WarehouseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceiptLine" ADD CONSTRAINT "WarehouseReceiptLine_purchaseReceiptLineId_fkey" FOREIGN KEY ("purchaseReceiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceiptLine" ADD CONSTRAINT "WarehouseReceiptLine_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceiptLine" ADD CONSTRAINT "WarehouseReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WarehouseReceiptLine" ADD CONSTRAINT "WarehouseReceiptLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "WarehouseReceiptLine_warehouseReceiptId_idx" ON "WarehouseReceiptLine"("warehouseReceiptId");
CREATE INDEX "WarehouseReceiptLine_purchaseReceiptLineId_idx" ON "WarehouseReceiptLine"("purchaseReceiptLineId");
CREATE INDEX "WarehouseReceiptLine_inspectionId_idx" ON "WarehouseReceiptLine"("inspectionId");
CREATE INDEX "WarehouseReceiptLine_itemId_idx" ON "WarehouseReceiptLine"("itemId");
CREATE INDEX "WarehouseReceiptLine_deletedAt_idx" ON "WarehouseReceiptLine"("deletedAt");

-- ⑪ PurchaseReturn（采购退货独立事实，非负 GR；P5 Final：必须有来源 + disposition）
CREATE TABLE "PurchaseReturn" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "returnType" "PurchaseReturnType" NOT NULL,
    "status" "PurchaseReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "returnedAt" TIMESTAMP(3) WITH TIME ZONE,
    "returnedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete Restrict：PO/供应商删除受退货单约束；returnedById SetNull）
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE UNIQUE INDEX "PurchaseReturn_code_key" ON "PurchaseReturn"("code");
CREATE INDEX "PurchaseReturn_purchaseOrderId_idx" ON "PurchaseReturn"("purchaseOrderId");
CREATE INDEX "PurchaseReturn_supplierId_idx" ON "PurchaseReturn"("supplierId");
CREATE INDEX "PurchaseReturn_status_idx" ON "PurchaseReturn"("status");
CREATE INDEX "PurchaseReturn_deletedAt_idx" ON "PurchaseReturn"("deletedAt");

-- ⑫ PurchaseReturnLine（P5 Final：三个真实来源 FK 之一非空且与 sourceRefType 匹配，不采用 polymorphic string；disposition 必填；returnReason 必填）
CREATE TABLE "PurchaseReturnLine" (
    "id" TEXT NOT NULL,
    "purchaseReturnId" TEXT NOT NULL,
    "sourceRefType" "PurchaseReturnSourceType" NOT NULL,
    "sourcePurchaseReceiptLineId" TEXT,
    "sourceWarehouseReceiptLineId" TEXT,
    "sourceInspectionId" TEXT,
    "itemId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "batchNo" TEXT,
    "serialNos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "disposition" "PurchaseReturnDisposition" NOT NULL,
    "returnReason" TEXT NOT NULL,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReturnLine_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys（onDelete：头 Cascade / Item Restrict / UOM SetNull）
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_purchaseReturnId_fkey" FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_sourcePurchaseReceiptLineId_fkey" FOREIGN KEY ("sourcePurchaseReceiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_sourceWarehouseReceiptLineId_fkey" FOREIGN KEY ("sourceWarehouseReceiptLineId") REFERENCES "WarehouseReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_sourceInspectionId_fkey" FOREIGN KEY ("sourceInspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReturnLine" ADD CONSTRAINT "PurchaseReturnLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "PurchaseReturnLine_purchaseReturnId_idx" ON "PurchaseReturnLine"("purchaseReturnId");
CREATE INDEX "PurchaseReturnLine_sourcePurchaseReceiptLineId_idx" ON "PurchaseReturnLine"("sourcePurchaseReceiptLineId");
CREATE INDEX "PurchaseReturnLine_sourceWarehouseReceiptLineId_idx" ON "PurchaseReturnLine"("sourceWarehouseReceiptLineId");
CREATE INDEX "PurchaseReturnLine_sourceInspectionId_idx" ON "PurchaseReturnLine"("sourceInspectionId");
CREATE INDEX "PurchaseReturnLine_itemId_idx" ON "PurchaseReturnLine"("itemId");
CREATE INDEX "PurchaseReturnLine_deletedAt_idx" ON "PurchaseReturnLine"("deletedAt");
