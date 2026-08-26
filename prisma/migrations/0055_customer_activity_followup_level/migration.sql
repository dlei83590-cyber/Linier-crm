-- Migration 0055 — Customer Activity Follow-Up Level（跟进程度 + 责任人）
-- 合同收口 cc-03-followup-level：CustomerActivity 追加跟进程度（BASIC/IMPORTANT/DECISION）与责任人（User，可空）。
-- 领域事实仍为 CustomerActivity.FOLLOW_UP（不建新表、不建平行真相）；仅 FOLLOW_UP 参与分级，VISIT_PLAN/CHECK_IN 为 NULL。
-- 红线：仅 CREATE TYPE / ALTER TABLE ADD COLUMN / ADD CONSTRAINT（对齐 0050/0051 手写迁移约定）
-- RBAC：复用 project-visit（view/create/edit/approve），不新增权限模块（ADR-0028）
-- HOLD：Reminder Engine / Scoring Engine / Rule Engine / 自定义规则编辑器 / 推送平台

-- 1) 新枚举
CREATE TYPE "CustomerActivityFollowUpLevel" AS ENUM ('BASIC', 'IMPORTANT', 'DECISION');

-- 2) CustomerActivity 追加跟进程度与责任人（nullable；历史行 NULL=未分级/无责任人，行为不变）
ALTER TABLE "CustomerActivity" ADD COLUMN "followUpLevel" "CustomerActivityFollowUpLevel";
ALTER TABLE "CustomerActivity" ADD COLUMN "responsibleUserId" TEXT;
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
