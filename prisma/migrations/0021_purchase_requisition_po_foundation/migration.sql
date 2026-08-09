-- Sprint 5A Purchase Requisition & Purchase Order Foundation（采购申请与采购订单领域，CTO Design Review 97/100 APPROVED WITH CHANGES 2026-08-09）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Invoice/AccountsReceivable/Delivery/SalesOrder/Supplier 一律不动）
-- 设计依据：ADR-0023（Purchase Requisition & Purchase Order Domain）、Sprint5A_PurchaseRequisition_PO_Design.md、
-- EVENTS.md v1.14（采购领域 11 事件注册：PurchaseRequisitionCreated/Submitted/Approved/Rejected/Converted +
--   PurchaseOrderCreated/Submitted/Approved/Confirmed/Rejected/Cancelled）
-- CTO Design Review 97/100 拍板：
-- ① PR/PO 各自独立条件审批（ApprovalPolicy module=PURCHASE_REQUISITION / PURCHASE_ORDER，不建 Approval 表）
-- ② PO 创建入口 = PR Convert + Direct Purchase（sourceType=REQUISITION|DIRECT；Direct 显式可审计、不能绕过 PO Approval；
--    PR 转 PO 时 line 保留 sourcePurchaseRequisitionLineId；Direct 时来源字段为空）
-- ③ PO 价格双通道：SUPPLIER_PRICE_SNAPSHOT（优先）/ MANUAL（授权手工，必须记录 priceReason/priceSetById/priceSetAt）
--    头金额仍由服务端 Decimal 聚合，客户端不可直接传总额
-- ④ 税率快照复制（taxRate 快照，税档变化不影响已 APPROVED PO）
-- ⑤ PR 不带金额（纯需求，金额事实在 PO）
-- ⑥ PR 仅 Revision（无 Snapshot）；PO 全套 Revision+Snapshot（快照含 CONFIRMED 类型）
-- ⑦ PO 修改：财务/承诺字段变更触发重新审批
-- 生命周期锁死（拍板调整③）：PO DRAFT→SUBMITTED→APPROVED→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED；DRAFT→CANCELLED；
--    **APPROVED ≠ CONFIRMED**（只有 Confirmed PO 才是 5B Goods Receipt 来源）；
--    PO Line 预留 receivedQty=0 / remainingReceiveQty=quantity（5A 不允许客户端改，5B 才是唯一回写方）
-- 事实源：PR = 需求事实源（不带金额）；PO = 采购承诺事实源（金额=行快照复制，服务端 Σ 计算）
-- 边界：PO 不修改 PR 数量/金额事实；PO 不调用销售 Pricing Engine；Supplier 主数据复用（不新建）；不新建 Approval 表
-- 编号：DocumentSequence 创建即取号（PO docType=PURCHASE_ORDER 已有；PR docType=PURCHASE_REQUISITION 本次 ADD VALUE）
-- onDelete：PR→requester/department SetNull、→WorkflowInstance SetNull；PR Line→PR Cascade、→Item Restrict、→UOM SetNull；
--           PO→Supplier Restrict、→PR SetNull（Direct 可空）、→WorkflowInstance SetNull；
--           PO Line→PO Cascade、→PR Line SetNull（Direct 为空）、→Item Restrict、→UOM SetNull、→PartnerPrice SetNull；
--           Revision/Snapshot→主表 Cascade
-- Decimal 全程：金额 18,4

-- CreateEnum: PurchaseRequisitionStatus（PR 生命周期；审批状态走 approvalStatus 投影复用 ApprovalStatus——不膨胀）
CREATE TYPE "PurchaseRequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONVERTED', 'CANCELLED');

-- CreateEnum: PurchaseOrderStatus（CTO 拍板调整③锁死：APPROVED ≠ CONFIRMED；只有 Confirmed PO 才是 5B GR 来源）
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum: PurchaseOrderSnapshotType（仅固化节点生成；含 CONFIRMED 定稿快照）
CREATE TYPE "PurchaseOrderSnapshotType" AS ENUM ('CREATED', 'SUBMITTED', 'APPROVED', 'CONFIRMED', 'RECEIVED', 'CANCELLED');

-- CreateEnum: PurchaseOrderSourceType（CTO 拍板②：Direct Purchase 显式可审计）
CREATE TYPE "PurchaseOrderSourceType" AS ENUM ('REQUISITION', 'DIRECT');

-- CreateEnum: PurchaseOrderPriceSource（CTO 拍板③：双通道；MANUAL 必须记录 priceReason/priceSetById/priceSetAt）
CREATE TYPE "PurchaseOrderPriceSource" AS ENUM ('SUPPLIER_PRICE_SNAPSHOT', 'MANUAL');

-- ExtendEnum: DocumentType + PURCHASE_REQUISITION（PR 编号 DocumentSequence 取号用）
ALTER TYPE "DocumentType" ADD VALUE 'PURCHASE_REQUISITION';

-- CreateTable: PurchaseRequisition（PR = 需求事实源；**不带任何金额事实**——拍板⑤）
CREATE TABLE "PurchaseRequisition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requesterId" TEXT,
    "departmentId" TEXT,
    "status" "PurchaseRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "needDate" TIMESTAMP(3) WITH TIME ZONE,
    "remark" TEXT,
    "workflowInstanceId" TEXT,
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseRequisitionLine（纯需求行；**无任何金额字段**——拍板⑤）
CREATE TABLE "PurchaseRequisitionLine" (
    "id" TEXT NOT NULL,
    "purchaseRequisitionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "needDate" TIMESTAMP(3) WITH TIME ZONE,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequisitionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseRequisitionRevision（PR 仅 Revision，**无 Snapshot**——拍板⑥）
CREATE TABLE "PurchaseRequisitionRevision" (
    "id" TEXT NOT NULL,
    "purchaseRequisitionId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
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
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequisitionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseOrder（PO = 采购承诺事实源；sourceType=REQUISITION|DIRECT（拍板②）；金额事实=服务端 Σ 行快照；APPROVED ≠ CONFIRMED）
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceType" "PurchaseOrderSourceType" NOT NULL,
    "supplierId" TEXT NOT NULL,
    "requisitionId" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3) WITH TIME ZONE,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "paymentTerm" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "workflowInstanceId" TEXT,
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMP(3) WITH TIME ZONE,
    "confirmedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseOrderLine（价格双通道快照；PR Convert line 保留 sourcePurchaseRequisitionLineId；receivedQty/remainingReceiveQty 预留 5B 回写）
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sourcePurchaseRequisitionLineId" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "priceSource" "PurchaseOrderPriceSource" NOT NULL DEFAULT 'SUPPLIER_PRICE_SNAPSHOT',
    "sourcePartnerPriceId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "priceReason" TEXT,
    "priceSetById" TEXT,
    "priceSetAt" TIMESTAMP(3) WITH TIME ZONE,
    "discountRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(18,4) NOT NULL,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remainingReceiveQty" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseOrderRevision（系统生成，不开放自由编辑；财务/承诺字段变更触发重审——拍板⑦）
CREATE TABLE "PurchaseOrderRevision" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionStatus" TEXT NOT NULL DEFAULT 'DRAFT',
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
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PurchaseOrderSnapshot（仅固化节点生成，只读；金额统一 Decimal 字符串保存，禁止 toNumber()）
CREATE TABLE "PurchaseOrderSnapshot" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "snapshotType" "PurchaseOrderSnapshotType" NOT NULL,
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
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderSnapshot_pkey" PRIMARY KEY ("id")
);

-- Unique & Indexes
CREATE UNIQUE INDEX "PurchaseRequisition_code_key" ON "PurchaseRequisition"("code");
CREATE INDEX "PurchaseRequisition_requesterId_idx" ON "PurchaseRequisition"("requesterId");
CREATE INDEX "PurchaseRequisition_departmentId_idx" ON "PurchaseRequisition"("departmentId");
CREATE INDEX "PurchaseRequisition_status_idx" ON "PurchaseRequisition"("status");
CREATE INDEX "PurchaseRequisition_workflowInstanceId_idx" ON "PurchaseRequisition"("workflowInstanceId");
CREATE INDEX "PurchaseRequisition_deletedAt_idx" ON "PurchaseRequisition"("deletedAt");

CREATE UNIQUE INDEX "PurchaseRequisitionLine_purchaseRequisitionId_lineNo_key" ON "PurchaseRequisitionLine"("purchaseRequisitionId", "lineNo");
CREATE INDEX "PurchaseRequisitionLine_purchaseRequisitionId_idx" ON "PurchaseRequisitionLine"("purchaseRequisitionId");
CREATE INDEX "PurchaseRequisitionLine_itemId_idx" ON "PurchaseRequisitionLine"("itemId");
CREATE INDEX "PurchaseRequisitionLine_deletedAt_idx" ON "PurchaseRequisitionLine"("deletedAt");

CREATE UNIQUE INDEX "PurchaseRequisitionRevision_purchaseRequisitionId_revisionNo_key" ON "PurchaseRequisitionRevision"("purchaseRequisitionId", "revisionNo");
CREATE INDEX "PurchaseRequisitionRevision_purchaseRequisitionId_idx" ON "PurchaseRequisitionRevision"("purchaseRequisitionId");
CREATE INDEX "PurchaseRequisitionRevision_deletedAt_idx" ON "PurchaseRequisitionRevision"("deletedAt");

CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_requisitionId_idx" ON "PurchaseOrder"("requisitionId");
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX "PurchaseOrder_workflowInstanceId_idx" ON "PurchaseOrder"("workflowInstanceId");
CREATE INDEX "PurchaseOrder_deletedAt_idx" ON "PurchaseOrder"("deletedAt");

CREATE UNIQUE INDEX "PurchaseOrderLine_purchaseOrderId_lineNo_key" ON "PurchaseOrderLine"("purchaseOrderId", "lineNo");
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX "PurchaseOrderLine_sourcePurchaseRequisitionLineId_idx" ON "PurchaseOrderLine"("sourcePurchaseRequisitionLineId");
CREATE INDEX "PurchaseOrderLine_itemId_idx" ON "PurchaseOrderLine"("itemId");
CREATE INDEX "PurchaseOrderLine_sourcePartnerPriceId_idx" ON "PurchaseOrderLine"("sourcePartnerPriceId");
CREATE INDEX "PurchaseOrderLine_deletedAt_idx" ON "PurchaseOrderLine"("deletedAt");

CREATE UNIQUE INDEX "PurchaseOrderRevision_purchaseOrderId_revisionNo_key" ON "PurchaseOrderRevision"("purchaseOrderId", "revisionNo");
CREATE INDEX "PurchaseOrderRevision_purchaseOrderId_idx" ON "PurchaseOrderRevision"("purchaseOrderId");
CREATE INDEX "PurchaseOrderRevision_deletedAt_idx" ON "PurchaseOrderRevision"("deletedAt");

CREATE UNIQUE INDEX "PurchaseOrderSnapshot_purchaseOrderId_snapshotType_key" ON "PurchaseOrderSnapshot"("purchaseOrderId", "snapshotType");
CREATE INDEX "PurchaseOrderSnapshot_purchaseOrderId_idx" ON "PurchaseOrderSnapshot"("purchaseOrderId");
CREATE INDEX "PurchaseOrderSnapshot_deletedAt_idx" ON "PurchaseOrderSnapshot"("deletedAt");

-- Foreign Keys（onDelete：对齐设计；Supplier Restrict / PR 与 Line 溯源 SetNull / 主从 Cascade）
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequisitionRevision" ADD CONSTRAINT "PurchaseRequisitionRevision_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_sourcePurchaseRequisitionLineId_fkey" FOREIGN KEY ("sourcePurchaseRequisitionLineId") REFERENCES "PurchaseRequisitionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_sourcePartnerPriceId_fkey" FOREIGN KEY ("sourcePartnerPriceId") REFERENCES "PartnerPrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderRevision" ADD CONSTRAINT "PurchaseOrderRevision_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderSnapshot" ADD CONSTRAINT "PurchaseOrderSnapshot_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
