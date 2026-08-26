-- Migration 0055 - 客户等级→供应商评级匹配（cc-06 supplier-rating，Contract Close）
-- R：BusinessPartner.customerLevel（客户等级，复用 CustomerLevel 枚举 VIP/KEY/REGULAR/PROSPECT；订单推荐供应商评级依据；可空，存量数据不迁移）
-- S：CustomerSupplierRatingRule 专用配置模型（customerLevel @unique / minimumSupplierRating / isActive；非 Generic Rule Engine）
-- 仅 CREATE/ALTER TABLE + CREATE INDEX（对齐 0054 手写迁移约定；无新枚举类型）

-- 1) BusinessPartner 追加客户等级（可空）
ALTER TABLE "BusinessPartner" ADD COLUMN "customerLevel" "CustomerLevel";

-- 2) 客户等级→最低供应商评级配置（专用极小模型：系统设置维护简单表格，订单推荐按此门槛过滤供应商）
CREATE TABLE "CustomerSupplierRatingRule" (
    "id" TEXT NOT NULL,
    "customerLevel" "CustomerLevel" NOT NULL,
    "minimumSupplierRating" "CustomerCreditRating" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerSupplierRatingRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerSupplierRatingRule_customerLevel_key" ON "CustomerSupplierRatingRule"("customerLevel");
CREATE INDEX "CustomerSupplierRatingRule_deletedAt_idx" ON "CustomerSupplierRatingRule"("deletedAt");
