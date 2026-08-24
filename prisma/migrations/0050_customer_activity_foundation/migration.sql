-- Migration 0050 — Customer Activity Foundation（Phase 3 MVP：客户跟进 / 拜访计划 / 定位签到）
-- CustomerActivity（BP 维度；businessPartnerId → BusinessPartner CASCADE；contactId → PartnerContact SET NULL）
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT（对齐 0048/0049 手写迁移约定）
-- 复用 project-visit RBAC（不新增权限模块，ADR-0028 防漂移）；无审批流/评论/围栏/签退/通用 Activity Engine
-- 时间线事实：FOLLOW_UP → createdAt；VISIT_PLAN → planDate；CHECK_IN → checkinAt（服务端 now）

-- 1) 新枚举
CREATE TYPE "CustomerActivityType" AS ENUM ('FOLLOW_UP', 'VISIT_PLAN', 'CHECK_IN');

-- 2) CustomerActivity 表
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "activityType" "CustomerActivityType" NOT NULL DEFAULT 'FOLLOW_UP',
    "contactId" TEXT,
    "summary" TEXT,
    "nextAction" TEXT,
    "reminderAt" TIMESTAMP(3),
    "planDate" TIMESTAMP(3),
    "checkinAt" TIMESTAMP(3),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "locationNote" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerActivity_businessPartnerId_idx" ON "CustomerActivity"("businessPartnerId");
CREATE INDEX "CustomerActivity_activityType_idx" ON "CustomerActivity"("activityType");
CREATE INDEX "CustomerActivity_deletedAt_idx" ON "CustomerActivity"("deletedAt");
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
