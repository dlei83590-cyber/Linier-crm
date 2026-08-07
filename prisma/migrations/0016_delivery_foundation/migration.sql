-- Sprint 4C Delivery Foundation（交付领域，CTO Review 94/100 APPROVED WITH CHANGES 2026-08-07）
-- 红线：仅 CREATE TYPE / CREATE TABLE / ALTER TABLE ADD COLUMN / UPDATE 初始化 / CREATE INDEX / ADD CONSTRAINT
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表
-- 设计依据：ADR-0015（PricingEngine 唯一入口）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、
-- ADR-0018（Delivery Domain）、Sprint4C_Delivery_Design.md（Schema 草案）、EVENTS.md v1.5（Delivery 事件 8 个已注册）
-- onDelete（CTO Review 锁定）：Delivery→Line/Revision/Snapshot Cascade；Delivery→SalesOrder/Customer Restrict；
-- Line→SalesOrderLine/UOM SetNull；Line→Item Restrict
-- CTO 锁定项：① Direct Delivery 禁止（salesOrderId NOT NULL，唯一入口经 SO 创建）② 超交禁止（availableQty 动态校验）
-- ③ DELIVERED=客户确认收货（业务确认动作）④ POD=File Center + 最小投影（podStatus/podReceivedAt/podConfirmedById）
-- SalesOrderLine 追加 deliveredQty/remainingQty 投影列；remainingQty 初始化 = quantity（DB default 无法引用 quantity）

-- CreateEnum: DeliveryStatus（主状态不含 Invoice/Payment；COMPLETED 仅枚举不实现 action）
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum: DeliverySnapshotType（仅固化节点）
CREATE TYPE "DeliverySnapshotType" AS ENUM ('CREATED', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

-- CreateEnum: DeliveryRevisionStatus（与 SalesOrder/Quotation 同构）
CREATE TYPE "DeliveryRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum: DeliveryPodStatus（POD 签收状态；File Center 存文件 + 最小投影字段）
CREATE TYPE "DeliveryPodStatus" AS ENUM ('PENDING', 'RECEIVED', 'WAIVED');

-- CreateTable: Delivery（交付单头；交付事实源；salesOrderId NOT NULL——Direct Delivery 禁止）
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedArrivalDate" TIMESTAMP(3) WITH TIME ZONE,
    "carrier" TEXT,
    "trackingNo" TEXT,
    "podStatus" "DeliveryPodStatus" NOT NULL DEFAULT 'PENDING',
    "podReceivedAt" TIMESTAMP(3) WITH TIME ZONE,
    "podConfirmedById" TEXT,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Delivery.code unique（DocumentSequence docType=DELIVERY_ORDER，前缀 DO）
CREATE UNIQUE INDEX "Delivery_code_key" ON "Delivery"("code");

-- CreateIndex
CREATE INDEX "Delivery_salesOrderId_idx" ON "Delivery"("salesOrderId");

-- CreateIndex
CREATE INDEX "Delivery_customerId_idx" ON "Delivery"("customerId");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "Delivery_deletedAt_idx" ON "Delivery"("deletedAt");

-- CreateTable: DeliveryLine（交付单行；本次实际交付量；sourceSalesOrderLineId 溯源）
CREATE TABLE "DeliveryLine" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "sourceSalesOrderLineId" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "orderedQty" DECIMAL(18,4) NOT NULL,
    "deliveredQty" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DeliveryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 行号唯一（10/20/30/40 步进）
CREATE UNIQUE INDEX "DeliveryLine_deliveryId_lineNo_key" ON "DeliveryLine"("deliveryId", "lineNo");

-- CreateIndex
CREATE INDEX "DeliveryLine_deliveryId_idx" ON "DeliveryLine"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliveryLine_sourceSalesOrderLineId_idx" ON "DeliveryLine"("sourceSalesOrderLineId");

-- CreateIndex
CREATE INDEX "DeliveryLine_itemId_idx" ON "DeliveryLine"("itemId");

-- CreateIndex
CREATE INDEX "DeliveryLine_deletedAt_idx" ON "DeliveryLine"("deletedAt");

-- CreateTable: DeliveryRevision（统一版本载体，系统生成，不开放自由编辑）
CREATE TABLE "DeliveryRevision" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionStatus" "DeliveryRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeReason" TEXT NOT NULL,
    "snapshotData" JSONB,
    "createdById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DeliveryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 修订号唯一
CREATE UNIQUE INDEX "DeliveryRevision_deliveryId_revisionNo_key" ON "DeliveryRevision"("deliveryId", "revisionNo");

-- CreateIndex
CREATE INDEX "DeliveryRevision_deliveryId_idx" ON "DeliveryRevision"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliveryRevision_deletedAt_idx" ON "DeliveryRevision"("deletedAt");

-- CreateTable: DeliverySnapshot（关键状态证据，不可变；金额统一 Decimal 字符串，禁止 toNumber()）
CREATE TABLE "DeliverySnapshot" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "snapshotType" "DeliverySnapshotType" NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "snapshotData" JSONB,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DeliverySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 每单据每节点一个快照（CREATED/READY/DISPATCHED/DELIVERED/CANCELLED）
CREATE UNIQUE INDEX "DeliverySnapshot_deliveryId_snapshotType_key" ON "DeliverySnapshot"("deliveryId", "snapshotType");

-- CreateIndex
CREATE INDEX "DeliverySnapshot_deliveryId_idx" ON "DeliverySnapshot"("deliveryId");

-- CreateIndex
CREATE INDEX "DeliverySnapshot_deletedAt_idx" ON "DeliverySnapshot"("deletedAt");

-- AlterTable: SalesOrderLine 追加交付投影列（仅新增列，不改既有列/索引；CTO Review：不新增 allocatedQty 第三列）
-- deliveredQty：已实际交付量（仅 confirm-delivery 聚合回写；DRAFT/READY/DISPATCHED 不计入）
ALTER TABLE "SalesOrderLine" ADD COLUMN "deliveredQty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- remainingQty：剩余可交付量 = quantity - deliveredQty（无 default——DB default 无法引用 quantity）
ALTER TABLE "SalesOrderLine" ADD COLUMN "remainingQty" DECIMAL(18,4);

-- 初始化：存量数据 remainingQty = quantity（新订单行由 Delivery 聚合逻辑维护）
UPDATE "SalesOrderLine" SET "remainingQty" = "quantity" WHERE "remainingQty" IS NULL;

-- 投影列非空约束（初始化完成后收紧）
ALTER TABLE "SalesOrderLine" ALTER COLUMN "remainingQty" SET NOT NULL;

-- AddForeignKey: Delivery → SalesOrder（Restrict：有交付单的订单不可物理删；Delivery 为事实源）
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Delivery → Customer（Restrict：收货客户）
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: DeliveryLine → Delivery（Cascade：行随单据软删）
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DeliveryLine → SalesOrderLine（SetNull：订单行软删不影响交付行，保留溯源字段）
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_sourceSalesOrderLineId_fkey" FOREIGN KEY ("sourceSalesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: DeliveryLine → Item（Restrict）
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: DeliveryLine → UnitOfMeasure（SetNull）
ALTER TABLE "DeliveryLine" ADD CONSTRAINT "DeliveryLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: DeliveryRevision → Delivery（Cascade：修订历史随单据）
ALTER TABLE "DeliveryRevision" ADD CONSTRAINT "DeliveryRevision_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: DeliverySnapshot → Delivery（Cascade：快照证据随单据）
ALTER TABLE "DeliverySnapshot" ADD CONSTRAINT "DeliverySnapshot_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
