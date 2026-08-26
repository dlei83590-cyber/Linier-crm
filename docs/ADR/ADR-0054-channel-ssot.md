# ADR-0054：销售渠道 SSOT（经营数据「渠道」维度事实源）

- 状态：**Accepted（Implemented，2026-08-24）**
- 日期：2026-08-24
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 6A 经营数据）；ADR-0050（SSOT 冻结）；cc-08-channel（合同收口 → 生产测试）

---

## 背景

合同经营数据 = 公司/区域/**渠道**/品牌/目标达成。公司/区域/品牌/目标已落地（/api/reports/operations 只读聚合）；
「渠道」维度此前 channelAvailable=false（无 SSOT 事实源，前端显式「暂无渠道事实数据」）。

本 ADR 为该缺口建立渠道事实源：渠道 SSOT 单一字段 + 经营看板渠道聚合。

## 决策

1. **SSOT = BusinessPartner.channel（最小新增单一字段，Migration 0055）**：null = 未设置；第一版固定字符串
   **直销 / 经销 / 电商 / 项目 / 其他**（前端 Create/Edit 下拉 + 列表 filter 与服务端 z.enum 校验共用
   apps/web/src/lib/business-partner/channel.ts 单一清单，禁止两处漂移；非法值 400 fail closed）。
2. **不复用 BusinessPartner.sourceChannel**：sourceChannel = 来源渠道/获客渠道（展会/行业推荐/老客户转介绍），
   语义是「客户从哪里来」；channel = 销售渠道，语义是「客户通过什么渠道交易」。两者正交，混用将污染经营看板口径。
3. **经营看板渠道维度**（/api/reports/operations）与区域维度同构：BusinessPartner.groupBy(channel) 客户数 +
   期间（Asia/Shanghai 业务日）非草稿/非取消 SalesOrder 按 customer.channel 归集订单数/金额；
   未设置（null）统一归「未设置」；channelAvailable 置 true；前端渠道分布表展示（金额 Decimal 字符串，禁 toNumber）。
4. **渠道 filter**（/api/business-partners 列表）：固定枚举精确匹配；「未设置」= channel IS NULL。
5. **不做**：营销归因平台 / Campaign / CDP / 渠道漏斗 Engine / sourceChannel 迁移（保持独立语义）。

## 影响

- Migration 0055（ADD COLUMN only）；BusinessPartner create/update/list/detail 透传 channel
- 经营看板新增 channels 聚合 + channelAvailable=true；前端 Create/Edit/列表/详情/看板接线
- 零错误码新增（校验走 VALIDATION_ERROR）；零事件/Outbox 变更（主数据变更沿用 business-partner.update Audit）

## 兼容性

- 零破坏：BusinessPartner 仅加可空字段；既有 sourceChannel 语义不变；Customer 遗留模型不动
- 冻结边界（Sales/Inventory/GL/BOM/Project/Pricing）零改动
