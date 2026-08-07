-- Sprint 4E-1 Accounts Receivable Foundation（应收余额领域，CTO Review 97/100 APPROVED WITH CHANGES 2026-08-08）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Invoice/Delivery/SalesOrder/Quotation 一律不动——CTO 拍板：Migration 0018 只新增，禁止修改 Invoice）
-- 设计依据：ADR-0020（Accounts Receivable Domain）、Sprint4E1_AR_Design.md（Schema 草案）、
-- EVENTS.md v1.9（AR 事件 8 个已注册：Created/Updated/Overdue 属 4E-1；PartiallyPaid/Paid/WrittenOff 属 4E-2；Adjusted 属 4E-3；Closed 为 CTO Review 追加）
-- onDelete（CTO 锁定）：AR→Invoice/Customer Restrict（有 AR 的发票禁止删除——必改③）；Revision/Snapshot→AR Cascade
-- CTO 拍板项：① Invoice ISSUED 自动创建 AR（同事务，不延迟）② OVERDUE = effectiveStatus 惰性投影（不落库、不新增 Scheduler）
-- ③ WriteOff 独立实体（4E-2 实现，本阶段只留 writeOffAmount 字段）④ CN/DN 先形成 Adjustment 事实（4E-3 实现，本阶段只留 adjustedAmount 字段）
-- CTO 必改①：不持久化 agingBucket——effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，只依赖 today/dueDate/balance，属 Projection，不每天更新数据库）
-- CTO 必改②：AccountsReceivableSnapshot 增加 snapshotSource 来源枚举（ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL），Receipt/CN/DN/WriteOff 全部可复用
-- CTO 必改④：Workflow 边界——AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 明确属 Sprint 4E-2（本阶段不建审批）
-- 余额唯一口径：balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount（服务端唯一计算，前端禁止 PATCH 金额）
-- Decimal 全程：金额 18,4；Snapshot/Revision JSON 金额一律 toString() 禁止 toNumber()

-- CreateEnum: AccountsReceivableStatus（余额生命周期；OVERDUE 惰性判定非真实状态——CTO 拍板② Projection）
CREATE TYPE "AccountsReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CLOSED');

-- CreateEnum: AccountsReceivableSnapshotType（仅固化节点生成，只读）
CREATE TYPE "AccountsReceivableSnapshotType" AS ENUM ('CREATED', 'PARTIALLY_PAID', 'PAID', 'ADJUSTED', 'WRITTEN_OFF', 'CLOSED');

-- CreateEnum: AccountsReceivableSnapshotSource（CTO 必改②：来源类型——Receipt/CN/DN/WriteOff 全部可复用）
CREATE TYPE "AccountsReceivableSnapshotSource" AS ENUM ('ISSUE', 'PAYMENT', 'WRITE_OFF', 'ADJUSTMENT', 'MANUAL');

-- CreateTable: AccountsReceivable（余额事实源；Invoice 1:1；invoiceId 唯一——CTO 锁定）
CREATE TABLE "AccountsReceivable" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "originalAmount" DECIMAL(18,4) NOT NULL,
    "adjustedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "writeOffAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balanceAmount" DECIMAL(18,4) NOT NULL,
    "status" "AccountsReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "effectiveStatus" "AccountsReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3) WITH TIME ZONE,
    "lastPaymentAt" TIMESTAMP(3) WITH TIME ZONE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountsReceivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AccountsReceivableRevision（余额变更留痕；系统生成）
CREATE TABLE "AccountsReceivableRevision" (
    "id" TEXT NOT NULL,
    "accountsReceivableId" TEXT NOT NULL,
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

    CONSTRAINT "AccountsReceivableRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AccountsReceivableSnapshot（关键节点固化；含 snapshotSource——CTO 必改②）
CREATE TABLE "AccountsReceivableSnapshot" (
    "id" TEXT NOT NULL,
    "accountsReceivableId" TEXT NOT NULL,
    "snapshotType" "AccountsReceivableSnapshotType" NOT NULL,
    "snapshotSource" "AccountsReceivableSnapshotSource" NOT NULL,
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

    CONSTRAINT "AccountsReceivableSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: AccountsReceivable.invoiceId 唯一（1:1 Invoice——CTO 锁定；P2002 兜底防并发重复创建）
CREATE UNIQUE INDEX "AccountsReceivable_invoiceId_key" ON "AccountsReceivable"("invoiceId");

-- CreateIndex: AccountsReceivable 查询索引
CREATE INDEX "AccountsReceivable_customerId_idx" ON "AccountsReceivable"("customerId");
CREATE INDEX "AccountsReceivable_status_idx" ON "AccountsReceivable"("status");
CREATE INDEX "AccountsReceivable_dueDate_idx" ON "AccountsReceivable"("dueDate");
CREATE INDEX "AccountsReceivable_deletedAt_idx" ON "AccountsReceivable"("deletedAt");

-- CreateIndex: AccountsReceivableRevision 唯一 + 查询
CREATE UNIQUE INDEX "AccountsReceivableRevision_accountsReceivableId_revisionNo_key" ON "AccountsReceivableRevision"("accountsReceivableId", "revisionNo");
CREATE INDEX "AccountsReceivableRevision_accountsReceivableId_idx" ON "AccountsReceivableRevision"("accountsReceivableId");
CREATE INDEX "AccountsReceivableRevision_deletedAt_idx" ON "AccountsReceivableRevision"("deletedAt");

-- CreateIndex: AccountsReceivableSnapshot 唯一 + 查询
CREATE UNIQUE INDEX "AccountsReceivableSnapshot_accountsReceivableId_snapshotType_key" ON "AccountsReceivableSnapshot"("accountsReceivableId", "snapshotType");
CREATE INDEX "AccountsReceivableSnapshot_accountsReceivableId_idx" ON "AccountsReceivableSnapshot"("accountsReceivableId");
CREATE INDEX "AccountsReceivableSnapshot_deletedAt_idx" ON "AccountsReceivableSnapshot"("deletedAt");

-- AddForeignKey: AccountsReceivable → Invoice（Restrict：有 AR 的发票禁止删除——CTO 必改③；Invoice Cancel 也不删 AR，只能 CLOSED）
ALTER TABLE "AccountsReceivable" ADD CONSTRAINT "AccountsReceivable_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: AccountsReceivable → Customer（Restrict：客户对账）
ALTER TABLE "AccountsReceivable" ADD CONSTRAINT "AccountsReceivable_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: AccountsReceivableRevision → AccountsReceivable（Cascade：修订历史随记录）
ALTER TABLE "AccountsReceivableRevision" ADD CONSTRAINT "AccountsReceivableRevision_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: AccountsReceivableSnapshot → AccountsReceivable（Cascade：快照证据随记录）
ALTER TABLE "AccountsReceivableSnapshot" ADD CONSTRAINT "AccountsReceivableSnapshot_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
