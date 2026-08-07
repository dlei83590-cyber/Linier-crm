-- Sprint 4B Sales Order Foundation（销售订单领域，CTO DESIGN APPROVED 2026-08-07）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT；禁止 DROP/RENAME/TRUNCATE/改旧字段/重建旧表
-- 设计依据：ADR-0015（PricingEngine 唯一入口）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、
-- Sprint4B_SO_Design.md（Schema 草案）、EVENTS.md v1.4（SalesOrder 事件 7 个已注册）
-- onDelete（CTO 建议）：SO→Line/Revision/Snapshot Cascade；SO→Quotation/Customer/Project Restrict；
-- Line→QuotationLine/PriceSnapshot/UOM SetNull；Line→Item Restrict；SO→WorkflowInstance SetNull
-- CTO 锁定项：quotationId 必填 + @unique（并发安全，唯一约束冲突稳定转 409）；SalesOrderLine 保留
-- sourceQuotationLineId + priceSnapshotId（完整溯源）；Snapshot 金额以 Decimal 字符串保存（禁止 toNumber()）

-- CreateEnum: SalesOrderStatus（主状态不含 Invoice/Payment——Delivery/Invoice/Payment 各自生命周期）
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum: SalesOrderSnapshotType（仅固化节点；DELIVERED/COMPLETED 待 4C 补充）
CREATE TYPE "SalesOrderSnapshotType" AS ENUM ('CREATED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum: SalesOrderRevisionStatus（与 QuotationRevisionStatus 同构）
CREATE TYPE "SalesOrderRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateTable: SalesOrder（销售订单头；唯一入口 Quotation convert；审批/交付均为投影字段）
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedDeliveryDate" TIMESTAMP(3) WITH TIME ZONE,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "paymentTerm" TEXT,
    "incoterm" TEXT,
    "exchangeRateSnapshot" DECIMAL(18,8),
    "taxProfileId" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "workflowInstanceId" TEXT,
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "deliveredAt" TIMESTAMP(3) WITH TIME ZONE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: SalesOrder.code unique
CREATE UNIQUE INDEX "SalesOrder_code_key" ON "SalesOrder"("code");

-- CreateIndex: quotationId unique（并发安全：唯一约束冲突稳定转 409；与 Project.opportunityId 同构）
CREATE UNIQUE INDEX "SalesOrder_quotationId_key" ON "SalesOrder"("quotationId");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_projectId_idx" ON "SalesOrder"("projectId");

-- CreateIndex
CREATE INDEX "SalesOrder_workflowInstanceId_idx" ON "SalesOrder"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "SalesOrder_deletedAt_idx" ON "SalesOrder"("deletedAt");

-- CreateTable: SalesOrderLine（继承 QuotationLine 商业价格，不重新定价；unitPrice 为快照冗余展示）
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "sourceQuotationLineId" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "priceSnapshotId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 行号唯一（10/20/30/40 步进）
CREATE UNIQUE INDEX "SalesOrderLine_salesOrderId_lineNo_key" ON "SalesOrderLine"("salesOrderId", "lineNo");

-- CreateIndex
CREATE INDEX "SalesOrderLine_salesOrderId_idx" ON "SalesOrderLine"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_sourceQuotationLineId_idx" ON "SalesOrderLine"("sourceQuotationLineId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_itemId_idx" ON "SalesOrderLine"("itemId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_priceSnapshotId_idx" ON "SalesOrderLine"("priceSnapshotId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_deletedAt_idx" ON "SalesOrderLine"("deletedAt");

-- CreateTable: SalesOrderRevision（统一版本载体，系统生成，不开放自由编辑）
CREATE TABLE "SalesOrderRevision" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionStatus" "SalesOrderRevisionStatus" NOT NULL DEFAULT 'DRAFT',
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

    CONSTRAINT "SalesOrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 修订号唯一
CREATE UNIQUE INDEX "SalesOrderRevision_salesOrderId_revisionNo_key" ON "SalesOrderRevision"("salesOrderId", "revisionNo");

-- CreateIndex
CREATE INDEX "SalesOrderRevision_salesOrderId_idx" ON "SalesOrderRevision"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderRevision_deletedAt_idx" ON "SalesOrderRevision"("deletedAt");

-- CreateTable: SalesOrderSnapshot（关键状态证据，不可变；金额统一 Decimal 字符串，禁止 toNumber()）
CREATE TABLE "SalesOrderSnapshot" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "snapshotType" "SalesOrderSnapshotType" NOT NULL,
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

    CONSTRAINT "SalesOrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 每单据每节点一个快照
CREATE UNIQUE INDEX "SalesOrderSnapshot_salesOrderId_snapshotType_key" ON "SalesOrderSnapshot"("salesOrderId", "snapshotType");

-- CreateIndex
CREATE INDEX "SalesOrderSnapshot_salesOrderId_idx" ON "SalesOrderSnapshot"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderSnapshot_deletedAt_idx" ON "SalesOrderSnapshot"("deletedAt");

-- AddForeignKey: SalesOrder → Quotation（Restrict：有订单的报价不可物理删；唯一入口 convert）
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SalesOrder → Customer（Restrict：有订单的客户不可物理删）
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SalesOrder → Project（Restrict）
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SalesOrder → WorkflowInstance（SetNull：Workflow 为唯一审批事实源）
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderLine → SalesOrder（Cascade：行随单据软删）
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderLine → QuotationLine（SetNull：报价行软删不影响订单行，保留溯源字段）
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_sourceQuotationLineId_fkey" FOREIGN KEY ("sourceQuotationLineId") REFERENCES "QuotationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderLine → Item（Restrict）
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderLine → QuotationPriceSnapshot（SetNull：价格快照软删不阻断订单行读取）
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "QuotationPriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderLine → UnitOfMeasure（SetNull）
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderRevision → SalesOrder（Cascade：修订历史随单据）
ALTER TABLE "SalesOrderRevision" ADD CONSTRAINT "SalesOrderRevision_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SalesOrderSnapshot → SalesOrder（Cascade：快照证据随单据）
ALTER TABLE "SalesOrderSnapshot" ADD CONSTRAINT "SalesOrderSnapshot_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
