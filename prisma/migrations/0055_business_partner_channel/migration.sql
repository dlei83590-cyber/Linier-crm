-- Migration 0055 - BusinessPartner Channel（渠道 SSOT + 经营数据渠道维度）
-- BusinessPartner.channel：销售渠道固定枚举（直销/经销/电商/项目/其他；null = 未设置）
-- 与 sourceChannel（来源渠道/获客渠道）语义不同，不复用——sourceChannel 表达「客户从哪里来」，
-- channel 表达「客户通过什么渠道交易」（经营看板渠道维度事实源）。
-- Red line: ADD COLUMN only（hand-written migration convention 0044/0050/0052）
-- 禁止：营销归因平台 / Campaign / CDP / 渠道漏斗 Engine（本线不实施）

ALTER TABLE "BusinessPartner" ADD COLUMN "channel" TEXT;
