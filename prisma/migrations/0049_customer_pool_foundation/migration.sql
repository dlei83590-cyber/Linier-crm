-- Migration 0049 — 客户公海 Customer Pool Foundation（2C，CTO OQ 裁决 + ADR-0053 APPROVED）
-- CustomerPool / CustomerPoolRule / CustomerPoolEntry / CustomerOwnership
-- 红线（CTO 最终裁决）：Entry → Ownership 1:N（entryId 不 unique）；Entry/Ownership 无 isActive
--   （status/releasedAt + deletedAt 为权威）；核心不变量 = 每 partner 至多一个 active ownership / active entry
--   （手写 partial unique）；**禁止额外 (poolId, businessPartnerId) 重复 index**（partner 全局唯一已更强）
-- 仅 CREATE TYPE / CREATE TABLE / CREATE INDEX

-- 1) 新枚举
CREATE TYPE "CustomerPoolScopeType" AS ENUM ('GLOBAL', 'REGION', 'DEPARTMENT');
CREATE TYPE "CustomerPoolRuleType" AS ENUM ('FIELD_MATCH', 'INACTIVITY');
CREATE TYPE "CustomerPoolRuleMatchMode" AS ENUM ('ALL', 'ANY');
CREATE TYPE "CustomerPoolEntryStatus" AS ENUM ('IN_POOL', 'CLAIMED', 'RELEASED');
CREATE TYPE "CustomerPoolEntryEnterReason" AS ENUM ('MANUAL', 'FIELD_RULE', 'RE_ENTER');
CREATE TYPE "CustomerPoolEntryReleaseReason" AS ENUM ('MANUAL', 'BP_INACTIVE', 'POOL_CHANGED');
CREATE TYPE "CustomerOwnershipReleaseReason" AS ENUM ('RECLAIMED', 'RULE_RETURN', 'MANUAL_RELEASE', 'BP_INACTIVE');

-- 2) CustomerPool（公海池定义；OQ-5：v1 无 approvalStatus，仅 RBAC + version + Audit）
CREATE TABLE "CustomerPool" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "CustomerPoolScopeType" NOT NULL,
    "scopeValue" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerPool_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerPool_code_key" ON "CustomerPool"("code");
CREATE INDEX "CustomerPool_scopeType_idx" ON "CustomerPool"("scopeType");
CREATE INDEX "CustomerPool_deletedAt_idx" ON "CustomerPool"("deletedAt");

-- 3) CustomerPoolRule（FIELD_MATCH 首版；INACTIVITY 保留位——Phase 3 前启用 → 400 POOL_RULE_SOURCE_UNAVAILABLE）
CREATE TABLE "CustomerPoolRule" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "ruleType" "CustomerPoolRuleType" NOT NULL DEFAULT 'FIELD_MATCH',
    "matchMode" "CustomerPoolRuleMatchMode" NOT NULL DEFAULT 'ANY',
    "condition" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerPoolRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerPoolRule_poolId_idx" ON "CustomerPoolRule"("poolId");
CREATE INDEX "CustomerPoolRule_deletedAt_idx" ON "CustomerPoolRule"("deletedAt");
ALTER TABLE "CustomerPoolRule" ADD CONSTRAINT "CustomerPoolRule_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "CustomerPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) CustomerPoolEntry（公海成员；权威状态 = status + deletedAt，无 isActive）
CREATE TABLE "CustomerPoolEntry" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "status" "CustomerPoolEntryStatus" NOT NULL DEFAULT 'IN_POOL',
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredById" TEXT,
    "enterReason" "CustomerPoolEntryEnterReason" NOT NULL DEFAULT 'MANUAL',
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" "CustomerPoolEntryReleaseReason",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerPoolEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerPoolEntry_poolId_idx" ON "CustomerPoolEntry"("poolId");
CREATE INDEX "CustomerPoolEntry_businessPartnerId_idx" ON "CustomerPoolEntry"("businessPartnerId");
CREATE INDEX "CustomerPoolEntry_deletedAt_idx" ON "CustomerPoolEntry"("deletedAt");
ALTER TABLE "CustomerPoolEntry" ADD CONSTRAINT "CustomerPoolEntry_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "CustomerPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerPoolEntry" ADD CONSTRAINT "CustomerPoolEntry_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) CustomerOwnership（客户归属事实流 = 客户级 owner SSOT；权威状态 = releasedAt + deletedAt，无 isActive）
CREATE TABLE "CustomerOwnership" (
    "id" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" "CustomerOwnershipReleaseReason",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerOwnership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerOwnership_businessPartnerId_idx" ON "CustomerOwnership"("businessPartnerId");
CREATE INDEX "CustomerOwnership_entryId_idx" ON "CustomerOwnership"("entryId");
CREATE INDEX "CustomerOwnership_ownerId_idx" ON "CustomerOwnership"("ownerId");
CREATE INDEX "CustomerOwnership_deletedAt_idx" ON "CustomerOwnership"("deletedAt");
ALTER TABLE "CustomerOwnership" ADD CONSTRAINT "CustomerOwnership_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOwnership" ADD CONSTRAINT "CustomerOwnership_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CustomerPoolEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOwnership" ADD CONSTRAINT "CustomerOwnership_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) 核心不变量（CTO 裁决；手写 partial unique，Prisma DSL 无法表达）
-- I1：同一 BusinessPartner 同一时刻至多一个有效 ownership（有效 = releasedAt IS NULL AND deletedAt IS NULL）
CREATE UNIQUE INDEX "CustomerOwnership_one_active_per_partner" ON "CustomerOwnership"("businessPartnerId") WHERE "releasedAt" IS NULL AND "deletedAt" IS NULL;
-- I2：同一 BusinessPartner 同一时刻至多一个有效 pool entry（有效 = status <> 'RELEASED' AND deletedAt IS NULL）
CREATE UNIQUE INDEX "CustomerPoolEntry_one_active_per_partner" ON "CustomerPoolEntry"("businessPartnerId") WHERE "status" <> 'RELEASED' AND "deletedAt" IS NULL;
-- 注：禁止额外 (poolId, businessPartnerId) active unique index（partner 全局唯一已更强，多余 index 只增维护成本）
