-- Migration 0055 — DingTalk Channel Foundation（合同功能收口：自建消息底座 + 钉钉酷卡片最小接线）
-- 场景：业务事实事务 → Outbox INSERT → sender POST 钉钉群机器人 → SENT/FAILED → retry；外部渠道失败不影响业务事务。
-- 1) OutboxStatus 追加渠道投递终态 SENT / FAILED（既有 PENDING/PROCESSING/PROCESSED/DEAD_LETTER 语义不变；
--    消费扫描仍按 PENDING/FAILED + nextAttemptAt 进行；SENT = 投递成功，FAILED = 可重试）
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "OutboxStatus" ADD VALUE IF NOT EXISTS 'FAILED';
-- 2) BusinessPartner 追加协同群 channel key（DB 只存 key 不存 secret；webhook/secret 仅在自建 Server 环境
--    DINGTALK_CHANNELS_JSON 配置，绝不暴露前端 / 不入 git）
ALTER TABLE "BusinessPartner" ADD COLUMN "collaborationChannelKey" TEXT;
