-- Sprint 4E-2 Receipt & Payment Allocation Foundation（收款与核销领域，CTO Design Review 97/100 APPROVED WITH CHANGES 2026-08-08）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Invoice/AccountsReceivable/Delivery/SalesOrder 一律不动）
-- 设计依据：ADR-0021（Receipt & Payment Allocation Domain）、Sprint4E2_ReceiptAllocation_Design.md、
-- EVENTS.md v1.10（收款/核销 11 事件已注册：ReceiptCreated/Updated/Allocated/FullyAllocated/AllocationReversed/Voided + WriteOffCreated/Submitted/Approved/Rejected/Applied）
-- CTO Design Review 拍板：
-- ① 创建与核销分离（POST /api/receipts 只记录金额；allocate 显式动作且一次请求原子化）
-- ② VOID 仅未核销；已核销逆向走 Allocation/Receipt Reversal 留痕（reversedAt/reversedBy）；CN 属 4E-3 发票调整域不承担收款冲销
-- ③ WriteOff = WriteOff + WriteOffAllocation（不做 Revision/Snapshot 三件套；审批历史 Workflow、审计 AuditLog）
-- ④ Receipt/WriteOff 编号 DocumentSequence 创建即取号（REC-/WO-2026-xxxx）
-- ⑤ unallocatedAmount 受控投影保留（预收/暂未指定发票场景）
-- 硬规则：同 Customer + 同 Currency 才允许 Allocation（409；第一版禁止跨币种核销）
-- 锁序（CTO 指定）：Lock Receipt → Lock AR rows(id ASC) → 校验客户/币种 → 校验 unallocated → 校验 ≤ AR.balanceAmount
--   → Create ReceiptAllocation → 回写 AR → 回写 Invoice 投影 → 回写 Receipt 投影 → AR 状态投影 → Snapshot/Audit → Events
-- onDelete：Receipt→Customer Restrict；ReceiptAllocation→Receipt/AR Restrict；Revision/Snapshot→Receipt Cascade；WriteOff→WorkflowInstance SetNull；WriteOffAllocation→WriteOff Cascade、→AR Restrict
-- Decimal 全程：金额 18,4；Snapshot/Revision JSON 金额一律 toString() 禁止 toNumber()

-- CreateEnum: ReceiptStatus（受控投影——拍板②：只能由 allocation/reversal/void 事务更新，禁止 PATCH；前三个可由金额动态推导）
CREATE TYPE "ReceiptStatus" AS ENUM ('UNALLOCATED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED', 'VOIDED');

-- CreateEnum: PaymentMethod（收款方式）
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER');

-- CreateEnum: ReceiptSnapshotType（仅固化节点生成，只读）
CREATE TYPE "ReceiptSnapshotType" AS ENUM ('CREATED', 'ALLOCATED', 'VOIDED', 'REVERSED');

-- CreateEnum: WriteOffStatus（写销状态；审批边界：WriteOff 按 ApprovalPolicy 条件审批，审批完成前禁止改 AR.writeOffAmount）
CREATE TYPE "WriteOffStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'APPLIED');

-- CreateTable: Receipt（收款事实源；Payment 不单独建表——CTO 拍板；code DocumentSequence 创建即取号）
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receiptDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "referenceNo" TEXT,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'UNALLOCATED',
    "voidedAt" TIMESTAMP(3) WITH TIME ZONE,
    "voidedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReceiptAllocation（核销事实，M:N Receipt ↔ AR；允许同一 (receipt, AR) 多行——Reversal 后可重新分配，Σ 校验防超核销）
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "accountsReceivableId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,
    "allocatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedBy" TEXT,
    "reversedAt" TIMESTAMP(3) WITH TIME ZONE,
    "reversedBy" TEXT,
    "reverseReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReceiptRevision（头信息变更留痕；系统生成）
CREATE TABLE "ReceiptRevision" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "changeReason" TEXT NOT NULL,
    "snapshotData" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ReceiptSnapshot（关键节点固化：CREATED/ALLOCATED/VOIDED/REVERSED）
CREATE TABLE "ReceiptSnapshot" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "snapshotType" "ReceiptSnapshotType" NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "snapshotData" JSONB,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WriteOff（独立事实实体——拍板③；不做 Revision/Snapshot 三件套；审批复用 Workflow）
CREATE TABLE "WriteOff" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "writeOffDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL,
    "status" "WriteOffStatus" NOT NULL DEFAULT 'DRAFT',
    "approvalPolicyId" TEXT,
    "workflowInstanceId" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "approvedById" TEXT,
    "appliedAt" TIMESTAMP(3) WITH TIME ZONE,
    "appliedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WriteOffAllocation（写销明细；APPLIED 时按明细回写 AR.writeOffAmount + balanceAmount）
CREATE TABLE "WriteOffAllocation" (
    "id" TEXT NOT NULL,
    "writeOffId" TEXT NOT NULL,
    "accountsReceivableId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteOffAllocation_pkey" PRIMARY KEY ("id")
);

-- Unique: Receipt.code（DocumentSequence 创建即取号）
CREATE UNIQUE INDEX "Receipt_code_key" ON "Receipt"("code");
CREATE INDEX "Receipt_customerId_idx" ON "Receipt"("customerId");
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");
CREATE INDEX "Receipt_receiptDate_idx" ON "Receipt"("receiptDate");
CREATE INDEX "Receipt_deletedAt_idx" ON "Receipt"("deletedAt");

CREATE INDEX "ReceiptAllocation_receiptId_idx" ON "ReceiptAllocation"("receiptId");
CREATE INDEX "ReceiptAllocation_accountsReceivableId_idx" ON "ReceiptAllocation"("accountsReceivableId");
CREATE INDEX "ReceiptAllocation_reversedAt_idx" ON "ReceiptAllocation"("reversedAt");
CREATE INDEX "ReceiptAllocation_deletedAt_idx" ON "ReceiptAllocation"("deletedAt");

CREATE UNIQUE INDEX "ReceiptRevision_receiptId_revisionNo_key" ON "ReceiptRevision"("receiptId", "revisionNo");
CREATE INDEX "ReceiptRevision_receiptId_idx" ON "ReceiptRevision"("receiptId");
CREATE INDEX "ReceiptRevision_deletedAt_idx" ON "ReceiptRevision"("deletedAt");

CREATE INDEX "ReceiptSnapshot_receiptId_idx" ON "ReceiptSnapshot"("receiptId");
CREATE INDEX "ReceiptSnapshot_deletedAt_idx" ON "ReceiptSnapshot"("deletedAt");

CREATE UNIQUE INDEX "WriteOff_code_key" ON "WriteOff"("code");
CREATE INDEX "WriteOff_status_idx" ON "WriteOff"("status");
CREATE INDEX "WriteOff_workflowInstanceId_idx" ON "WriteOff"("workflowInstanceId");
CREATE INDEX "WriteOff_deletedAt_idx" ON "WriteOff"("deletedAt");

CREATE UNIQUE INDEX "WriteOffAllocation_writeOffId_accountsReceivableId_key" ON "WriteOffAllocation"("writeOffId", "accountsReceivableId");
CREATE INDEX "WriteOffAllocation_writeOffId_idx" ON "WriteOffAllocation"("writeOffId");
CREATE INDEX "WriteOffAllocation_accountsReceivableId_idx" ON "WriteOffAllocation"("accountsReceivableId");
CREATE INDEX "WriteOffAllocation_deletedAt_idx" ON "WriteOffAllocation"("deletedAt");

-- Foreign Keys（onDelete：CTO 锁定）
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptRevision" ADD CONSTRAINT "ReceiptRevision_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReceiptSnapshot" ADD CONSTRAINT "ReceiptSnapshot_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WriteOffAllocation" ADD CONSTRAINT "WriteOffAllocation_writeOffId_fkey" FOREIGN KEY ("writeOffId") REFERENCES "WriteOff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WriteOffAllocation" ADD CONSTRAINT "WriteOffAllocation_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
