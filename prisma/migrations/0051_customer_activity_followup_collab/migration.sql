-- Migration 0051 — Customer Activity Followup Collab（跟进审批 + 评论 MVP）
-- CustomerActivity 追加最小审批状态（仅 FOLLOW_UP：DRAFT→SUBMITTED→APPROVED/REJECTED；VISIT_PLAN/CHECK_IN 不参与 → NULL）
-- 新增 ActivityComment（最小评论：activityId/content/createdById/createdAt；不可变，无编辑/删除）
-- 红线：仅 CREATE TYPE / ALTER TABLE ADD COLUMN / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT（对齐 0050 手写迁移约定）
-- RBAC：复用 project-visit（submit→:edit；approve/reject→:approve；comment→:create；view→:view），不新增权限模块（ADR-0028）
-- HOLD：Workflow Designer/多级审批/会签/抄送/Notification Engine

-- 1) 新枚举
CREATE TYPE "CustomerActivityStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- 2) CustomerActivity 追加跟进审批字段（nullable；历史行 status=NULL=不参与审批，行为不变）
ALTER TABLE "CustomerActivity" ADD COLUMN "status" "CustomerActivityStatus";
ALTER TABLE "CustomerActivity" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "CustomerActivity" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "CustomerActivity" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "CustomerActivity" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "CustomerActivity" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "CustomerActivity" ADD COLUMN "rejectedById" TEXT;
ALTER TABLE "CustomerActivity" ADD COLUMN "rejectReason" TEXT;

-- 3) ActivityComment 表
CREATE TABLE "ActivityComment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityComment_activityId_idx" ON "ActivityComment"("activityId");
CREATE INDEX "ActivityComment_createdAt_idx" ON "ActivityComment"("createdAt");
ALTER TABLE "ActivityComment" ADD CONSTRAINT "ActivityComment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CustomerActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
