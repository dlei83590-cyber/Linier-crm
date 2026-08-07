-- Sprint 4A Quotation Foundation（报价领域，CTO DESIGN APPROVED 95/100，2026-08-07）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT；禁止 DROP/RENAME/TRUNCATE/改旧字段/重建旧表
-- 设计依据：ADR-0015（PricingEngine 唯一入口）、ADR-0016（模型边界锁定，不建 QuotationApproval/QuotationVersion）、
-- Sprint4A_Quote_Design.md（Schema 草案）、EVENTS.md v1.2（事件先注册后开发）
-- onDelete（CTO 建议）：Quotation→Line Cascade；Quotation→Revision/Snapshot Cascade；Line→PriceSnapshot SetNull；
-- Quotation→WorkflowInstance SetNull；Customer/Project/Item Restrict；Policy→Rule Cascade；WorkflowDefinition→PolicyRule Restrict

-- CreateEnum: QuotationStatus（EXPIRED 为惰性判定，不依赖后台调度器写入）
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'CONVERTED', 'EXPIRED');

-- CreateEnum: QuotationRevisionStatus（CTO 审核补充④）
CREATE TYPE "QuotationRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum: QuotationSnapshotType（CTO 审核补充⑤）
CREATE TYPE "QuotationSnapshotType" AS ENUM ('SUBMITTED', 'APPROVED', 'SENT', 'ACCEPTED', 'CONVERTED');

-- CreateTable: Quotation（报价单头；审批/转换均为投影字段）
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "projectId" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validFrom" TIMESTAMP(3) WITH TIME ZONE,
    "validUntil" TIMESTAMP(3) WITH TIME ZONE,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "exchangeRateSnapshot" DECIMAL(18,8),
    "taxProfileId" TEXT,
    "taxSnapshot" DECIMAL(5,2),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "workflowInstanceId" TEXT,
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "convertedAt" TIMESTAMP(3) WITH TIME ZONE,
    "convertedById" TEXT,
    "salesOrderId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Quotation.code unique
CREATE UNIQUE INDEX "Quotation_code_key" ON "Quotation"("code");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_opportunityId_idx" ON "Quotation"("opportunityId");

-- CreateIndex
CREATE INDEX "Quotation_projectId_idx" ON "Quotation"("projectId");

-- CreateIndex
CREATE INDEX "Quotation_workflowInstanceId_idx" ON "Quotation"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "Quotation_deletedAt_idx" ON "Quotation"("deletedAt");

-- CreateTable: QuotationLine（unitPrice 为快照冗余，禁止前端绕过 Pricing Engine 填写）
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
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

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 行号唯一（CTO 审核补充②：10/20/30/40 步进）
CREATE UNIQUE INDEX "QuotationLine_quotationId_lineNo_key" ON "QuotationLine"("quotationId", "lineNo");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationLine_itemId_idx" ON "QuotationLine"("itemId");

-- CreateIndex
CREATE INDEX "QuotationLine_priceSnapshotId_idx" ON "QuotationLine"("priceSnapshotId");

-- CreateIndex
CREATE INDEX "QuotationLine_deletedAt_idx" ON "QuotationLine"("deletedAt");

-- CreateTable: QuotationRevision（统一版本载体，删除 QuotationVersion）
CREATE TABLE "QuotationRevision" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionStatus" "QuotationRevisionStatus" NOT NULL DEFAULT 'DRAFT',
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

    CONSTRAINT "QuotationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 修订号唯一
CREATE UNIQUE INDEX "QuotationRevision_quotationId_revisionNo_key" ON "QuotationRevision"("quotationId", "revisionNo");

-- CreateIndex
CREATE INDEX "QuotationRevision_quotationId_idx" ON "QuotationRevision"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationRevision_deletedAt_idx" ON "QuotationRevision"("deletedAt");

-- CreateTable: QuotationSnapshot（关键状态证据，不可变）
CREATE TABLE "QuotationSnapshot" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "snapshotType" "QuotationSnapshotType" NOT NULL,
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

    CONSTRAINT "QuotationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 每单据每节点一个快照（CTO 审核补充⑤）
CREATE UNIQUE INDEX "QuotationSnapshot_quotationId_snapshotType_key" ON "QuotationSnapshot"("quotationId", "snapshotType");

-- CreateIndex
CREATE INDEX "QuotationSnapshot_quotationId_idx" ON "QuotationSnapshot"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationSnapshot_deletedAt_idx" ON "QuotationSnapshot"("deletedAt");

-- CreateTable: ApprovalPolicy（只负责选择 Workflow，不执行审批）
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL DEFAULT 'QUOTATION',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ApprovalPolicy.code unique
CREATE UNIQUE INDEX "ApprovalPolicy_code_key" ON "ApprovalPolicy"("code");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_module_idx" ON "ApprovalPolicy"("module");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_enabled_idx" ON "ApprovalPolicy"("enabled");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_deletedAt_idx" ON "ApprovalPolicy"("deletedAt");

-- CreateTable: ApprovalPolicyRule（命中即选择对应 WorkflowDefinition；priority DESC 匹配）
CREATE TABLE "ApprovalPolicyRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "minAmount" DECIMAL(18,4),
    "maxAmount" DECIMAL(18,4),
    "grossMarginThreshold" DECIMAL(5,2),
    "customerCreditLevel" TEXT,
    "projectType" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "workflowDefinitionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ApprovalPolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_policyId_idx" ON "ApprovalPolicyRule"("policyId");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_workflowDefinitionId_idx" ON "ApprovalPolicyRule"("workflowDefinitionId");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_deletedAt_idx" ON "ApprovalPolicyRule"("deletedAt");

-- AddForeignKey: Quotation → Customer（Restrict：有报价的客户不可物理删除）
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Quotation → ProjectOpportunity（SetNull：机会软删不影响报价）
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ProjectOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Quotation → Project（Restrict，CTO 建议 Project: Restrict）
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Quotation → WorkflowInstance（SetNull：Workflow 为唯一审批事实源）
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: QuotationLine → Quotation（Cascade）
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: QuotationLine → Item（Restrict，CTO 建议 Item: Restrict）
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: QuotationLine → QuotationPriceSnapshot（SetNull：快照软删不阻断报价行读取）
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "QuotationPriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: QuotationLine → UnitOfMeasure（SetNull）
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: QuotationRevision → Quotation（Cascade：修订历史随单据）
ALTER TABLE "QuotationRevision" ADD CONSTRAINT "QuotationRevision_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: QuotationSnapshot → Quotation（Cascade：快照证据随单据）
ALTER TABLE "QuotationSnapshot" ADD CONSTRAINT "QuotationSnapshot_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ApprovalPolicyRule → ApprovalPolicy（Cascade）
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ApprovalPolicyRule → WorkflowDefinition（Restrict）
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_workflowDefinitionId_fkey" FOREIGN KEY ("workflowDefinitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
