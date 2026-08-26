# Contract Close — DingTalk Channel 生产测试 QA（自建消息底座 + 钉钉酷卡片最小接线）

> 日期：2026-08-25 ｜ 关联：ADR-0054；Migration 0055；EVENTS.md v1.45；docs/test-cases/DingTalkChannel_API.md
> 架构红线：Linier CRM 自建消息事实 → Outbox → DingTalk Adapter → 外部群；**外部渠道失败 ≠ 业务事务失败**；secret 只在 Server 环境

## 环境准备

1. 自建 Server 配置 DINGTALK_CHANNELS_JSON（含测试群 webhook + secret，占位符见 .env.example）与 DINGTALK_APP_URL（deep link 基址）。
2. 测试群创建钉钉群机器人（自定义关键词或加签），确认 webhook 可发送。
3. 客户档案（BusinessPartner）→ 编辑页「协同群」选择测试群 key（GET /api/dingtalk/channels 返回 key+name，不显示 secret）。

## Smoke 步骤（验收人逐条勾选）

### 1. 测试群配置

- [ ] 客户编辑页出现「协同群」下拉，选项来自已配置渠道（仅 key+name，无 webhook/secret 上屏）。
- [ ] 保存后 GET /api/business-partners/:id 返回 collaborationChannelKey（只含 key）。

### 2. 客户签到 → 钉钉群收卡片

- [ ] 移动端/PC 对已配置客户执行定位签到（范围内）→ Linier 内签到业务成功（201，CHECK_IN + 自动 FOLLOW_UP）。
- [ ] 同事务 Outbox 有 CRM_CHECK_IN 记录（status=PENDING，payload 含 customerName/actorName/checkinAt/经纬度摘要/channelKey）。
- [ ] 触发 POST /api/domain-events/consume（domain-event:consume）→ dingtalk[] outcome=SENT，Outbox status=SENT + processedAt。
- [ ] 钉钉测试群收到「【签到】客户名」酷卡片：客户/签到人/时间（北京时间）/经纬度摘要/距客户距离/跟进摘要 + 「查看客户 360」可点击跳转。

### 3. 订单阶段 → 对应阶段卡片

- [ ] 订单 confirm（DRAFT→CONFIRMED）→ Outbox ORDER_STAGE_CHANGED（stage=CONFIRMED）→ consume → 钉钉群收到「已确认」卡片（订单号/客户/阶段/金额/更新时间/责任人 + 查看订单）。
- [ ] 交付 dispatch（READY→DISPATCHED）→ Outbox ORDER_STAGE_CHANGED（stage=DISPATCHED）→ consume → 钉钉群收到「已发运」卡片。
- [ ] 交付 confirm-delivery（→ PARTIALLY_DELIVERED/DELIVERED）→ Outbox ORDER_STAGE_CHANGED（对应 stage）→ consume → 钉钉群收到「部分交付/已交付」卡片。
- [ ] 未配置协同群的客户执行签到/订单动作 → 不产生渠道事件（业务正常）。

### 4. 钉钉失败测试（业务不受影响）

- [ ] 停用/改错测试群 webhook（或临时移除 DINGTALK_CHANNELS_JSON 中该 key）→ 客户签到仍成功（Linier 业务事务提交）。
- [ ] consume 后该 Outbox status=FAILED + lastError（DINGTALK_SEND_FAILED / DINGTALK_CHANNEL_NOT_CONFIGURED）+ attemptCount 递增 + nextAttemptAt（指数退避）。
- [ ] 恢复 webhook 配置 → 再次 consume → FAILED 消息被重新 claim 并投递成功 → status=SENT。
- [ ] 连续失败超过 10 次 → status=DEAD_LETTER（人工调查；业务事实仍完整）。

## 已知限制（本阶段真实限制）

- 无持续 worker：投递依赖 cron/手动触发 POST /api/domain-events/consume（与现有 Outbox dispatch 同模式；生产需外部定时触发）。
- 钉钉卡片为群机器人 actionCard（webhook + 可选加签）；未接入钉钉企业内部应用/互动酷卡片（interactive card 需应用凭据 + openConversationId）。
- 未配置 DINGTALK_APP_URL / APP_URL 时，卡片内 deep link 仅展示相对路径文本（不可点击）。
- 责任人 = SalesOrder.createdById（订单创建人）；未接入 CustomerOwnership 客户级负责人。
- 仅两类事件（CRM_CHECK_IN / ORDER_STAGE_CHANGED）；站内信/邮件/企微等渠道 HOLD。
