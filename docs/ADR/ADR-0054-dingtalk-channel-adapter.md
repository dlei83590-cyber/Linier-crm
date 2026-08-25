# ADR-0054：自建消息底座 + 钉钉酷卡片最小接线（DingTalk Channel Adapter）

- 状态：**DRAFT → PROPOSED（2026-08-25，待 CTO Review 后 Accepted）**
- 日期：2026-08-25
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/EVENTS.md（v1.45 注册 CRM_CHECK_IN / ORDER_STAGE_CHANGED）；ADR-0031（Domain Event Outbox）；ADR-0050（SSOT 冻结）；Migration 0055；docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（§8 定位签到 MISSING 后续收口）

---

## 1. 背景与合同原文

合同功能收口阶段（Contract Close → Production-Test）要求：**签到后酷卡片推送群 + 订单阶段信息推送责任人 + 关键协同群**。
架构红线：**Linier CRM 自建消息事实 → Outbox → DingTalk Adapter → 外部群**；严禁业务事务直接依赖钉钉成功；
禁止 Notification Platform / Kafka / 云消息 / 云 scheduler；webhook secret 绝不进前端/DB/git。

## 2. 决策摘要

| # | 决策 | 结论 |
|---|------|------|
| D1 | 消息底座 | **复用现有 Transactional Outbox（OutboxMessage + writeDomainEvent + domain-events consumer）**，不造 Message Bus；新增两类领域事件 `CRM_CHECK_IN` / `ORDER_STAGE_CHANGED`（EVENTS.md v1.45 注册） |
| D2 | 投递状态 | **OutboxStatus 追加 SENT / FAILED**（Migration 0055）：业务事务 → Outbox INSERT → sender POST 钉钉 → SENT（成功）/ FAILED（指数退避可重试）/ 超限 DEAD_LETTER；**外部失败不影响已提交的业务事务** |
| D3 | Channel 配置 | **DB 只存 key（BusinessPartner.collaborationChannelKey），webhook/secret 仅在 Server 环境 `DINGTALK_CHANNELS_JSON`**（`{key:{name?,webhook,secret?}}`）；前端只读 key+name（GET /api/dingtalk/channels），绝不暴露 secret |
| D4 | 发送者 | 新 `lib/dingtalk/sender`（claim FOR UPDATE SKIP LOCKED → 构造 actionCard → POST 钉钉群机器人）；无持续 worker，复用 `POST /api/domain-events/consume` 触发（同端点顺带运行 sender；权限 `domain-event:consume`，不新增权限码）；domain-events consumer 对两类事件 SKIPPED |
| D5 | 卡片内容 | 签到：客户/签到人/时间/经纬度摘要（4 位小数≈11m，非精确定位）/距离/跟进摘要 + Customer 360 deep link；订单：订单号/客户/阶段/金额/更新时间/责任人 + SalesOrder deep link |
| D6 | 触发点 | 签到成功（activities POST 事务内）；订单 confirm / 交付 dispatch / confirm-delivery（各自事务内）——客户未配置协同群则不发事件（业务事实不受影响） |
| D7 | 幂等 | producer 幂等键防重复入队（`CRM_CHECK_IN|{activityId}` / `ORDER_STAGE_CHANGED|{salesOrderId}|{stage}`）；sender 成功即 SENT 不重发 |

## 3. Audit Findings（审计证据）

### 3.1 现有 Outbox / 事件基建

- `OutboxMessage`（Migration 0025）：status PENDING/PROCESSING/PROCESSED/DEAD_LETTER、idempotencyKey @unique、attemptCount/nextAttemptAt/lockedAt/lockedBy/lastError/processedAt。
- 通用 writer：`apps/web/src/lib/domain-events/writer.ts` `writeDomainEvent(tx, envelope)`（业务事务内原子写，幂等键防重复入队）。
- 通用 consumer：`apps/web/src/lib/domain-events/consumer.ts`（claim FOR UPDATE SKIP LOCKED → PROCESSING lease → handler → PROCESSED/RETRY/DEAD_LETTER）；触发端点 `POST /api/domain-events/consume`（权限 `domain-event:consume`，SYSTEM_PERMISSIONS）。
- **无持续 worker / scheduler**：消费端点为 HTTP route，由外部 cron 或人工触发（与 inventory-ledger/consume 同模式）。

### 3.2 现有 integration / 设置

- grep `collaboration/channel/webhook`：apps/web/src 零命中——**无 CollaborationChannelKey / webhook 配置字段**。
- Sprint 3A NotificationTemplate/Message/Channel/Log 仅建模（ROADMAP L136「建模 + 模板 CRUD（真实发送后续）」，真实发送从未实现）；NotificationChannel.config 为 DB Json——**与「secret 只在 Server 环境」红线冲突**，不采用。
- Settings（SystemSetting Key-Value）存在但为通用系统设置，不承载渠道密钥。
- → 结论：**新增最小字段 BusinessPartner.collaborationChannelKey + Server 环境 DINGTALK_CHANNELS_JSON**（任务指定方案）。

### 3.3 业务事实源

- 签到：`POST /api/business-partners/:id/activities`（CHECK_IN：经纬度 + 服务端 Haversine 距离 Gate + 自动 FOLLOW_UP 草稿）；Customer 360 = `/business-partners/:id`。
- 订单阶段：SalesOrder.status（DRAFT→CONFIRMED→PARTIALLY_DELIVERED/DELIVERED）；confirm = `sales-orders/:id/confirm`；发运 = `deliveries/:id/dispatch`；收货 = `deliveries/:id/confirm-delivery`（聚合回写 soStatus）；SalesOrder 详情 = `/sales/orders/:id`。
- 责任人：SalesOrder.createdById（订单创建人 = 订单级责任人；前端卡片展示姓名，不建新归属表）。

## 4. 边界（本 ADR 不做）

- 不做站内信 / 邮件 / 企微 / 短信渠道（仅钉钉群机器人最小接线）；不做消息模板引擎 / 订阅规则 / 审批流触发消息。
- 不把 webhook/secret 写入 DB / 前端 / git（.env.example 仅占位符）；经纬度只出摘要，精确定位不进外部渠道。
- 不新增权限码（复用 `domain-event:consume` 触发 sender、`business-partner:view` 读渠道列表）；不改 frontend/modules.ts（Registry SSOT，CC-10 统一维护）。

## 5. 影响与验证

- Schema：Migration 0055（OutboxStatus += SENT/FAILED；BusinessPartner += collaborationChannelKey）。
- 测试：lib/dingtalk（channel-config/adapter/payload/sender）+ activities POST / sales-order confirm 事务内 Outbox 写入单测。
- 生产 Smoke：客户配置协同群 → 签到 → Linier 业务成功 + Outbox 有记录 + 钉钉群收到卡片；订单 confirm/dispatch/deliver 对应阶段卡片；钉钉失败 → 业务仍成功 + Outbox FAILED 可重试。
