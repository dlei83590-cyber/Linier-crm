-- Migration 0051 - 报销流程补齐 + 经营目标/客户分层（feat(crm) contract-expense-analytics-mvp）
-- R：ProjectExpense 补/开放 —— 费用类型 / 费用归属 / 提交 / 批准 / 驳回（复用 approvalStatus 枚举，不新增工作流模型）
-- S：经营目标最小目标表 ReportTarget（period / dimensionType / dimensionValue / targetAmount）
-- 仅 CREATE/ALTER TABLE + CREATE INDEX（对齐 0048-0050 手写迁移约定；无新枚举类型）

-- 1) ProjectExpense 追加字段（全部可空，存量数据不迁移）
ALTER TABLE "ProjectExpense" ADD COLUMN "expenseType" TEXT;
ALTER TABLE "ProjectExpense" ADD COLUMN "expenseAttribution" TEXT;
ALTER TABLE "ProjectExpense" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "ProjectExpense" ADD COLUMN "rejectedById" TEXT;

-- 2) 经营目标最小目标表（固定看板目标值/达成率；HOLD：Metric Engine / OLAP / DW / BI Platform / Rule DSL）
CREATE TABLE "ReportTarget" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dimensionType" TEXT NOT NULL,
    "dimensionValue" TEXT NOT NULL DEFAULT 'ALL',
    "targetAmount" DECIMAL(18,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportTarget_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReportTarget_period_dimensionType_dimensionValue_idx" ON "ReportTarget"("period", "dimensionType", "dimensionValue");
CREATE INDEX "ReportTarget_deletedAt_idx" ON "ReportTarget"("deletedAt");
