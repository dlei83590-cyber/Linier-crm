/**
 * cc-08-channel — BusinessPartner 销售渠道 SSOT（经营数据「渠道」维度事实源）
 *
 * 与 BusinessPartner.sourceChannel（来源渠道/获客渠道：展会/转介绍…）语义不同：
 * sourceChannel 表达「客户从哪里来」；channel 表达「客户通过什么渠道交易」（直销/经销/电商/项目/其他）。
 * 固定字符串第一版（任务约定）：直销 / 经销 / 电商 / 项目 / 其他；null = 未设置（聚合归「未设置」）。
 * 服务端 z.enum 校验 fail closed；前端 Create/Edit 下拉 + 列表 filter 共用本清单，禁止两处漂移。
 */
export const BUSINESS_PARTNER_CHANNELS = ["直销", "经销", "电商", "项目", "其他"] as const;

export type BusinessPartnerChannel = (typeof BUSINESS_PARTNER_CHANNELS)[number];

/** null 渠道在列表 filter / 聚合展示中的统一文案 */
export const CHANNEL_UNSET_LABEL = "未设置";
