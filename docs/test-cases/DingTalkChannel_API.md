# DingTalkChannel API 测试用例（自建消息底座 + 钉钉酷卡片最小接线）

> 日期：2026-08-25 ｜ 关联：ADR-0054；Migration 0055；EVENTS.md v1.45（CRM_CHECK_IN / ORDER_STAGE_CHANGED）
> 架构：Linier CRM 自建消息事实 → Outbox → DingTalk Adapter → 外部群；外部渠道失败 ≠ 业务事务失败
> 权限：business-partner:view（渠道列表只读）；domain-event:consume（sender 触发）；webhook/secret 仅在 Server 环境 DINGTALK_CHANNELS_JSON

## 范围

- BusinessPartner.collaborationChannelKey 读写（create/PATCH/GET 详情；DB 只存 key）
- GET /api/dingtalk/channels（已配置协同群列表；仅 key+name）
- 业务事务内 Outbox 写入：签到（CRM_CHECK_IN）/ 订单阶段（ORDER_STAGE_CHANGED）
- DingTalk Sender：POST 钉钉 → SENT / FAILED 可重试 / DEAD_LETTER（经 POST /api/domain-events/consume 触发）

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| D1 | 已配置协同群列表（无 secret） | GET | /api/dingtalk/channels | business-partner:view | 200 + channels[{key,name}]；响应不含 webhook/secret |
| D2 | 未配置渠道（环境无 DINGTALK_CHANNELS_JSON） | GET | /api/dingtalk/channels | business-partner:view | 200 + channels=[] |
| D3 | 客户配置协同群 key | PATCH | /api/business-partners/:id | business-partner:edit | 200；详情 GET 返回 collaborationChannelKey（仅 key） |
| D4 | 客户清除协同群 | PATCH | /api/business-partners/:id | business-partner:edit | 200 + collaborationChannelKey=null |
| D5 | 签到成功 + 已配置协同群 | POST | /api/business-partners/:id/activities (CHECK_IN) | project-visit:create | 201 + 同事务 Outbox CRM_CHECK_IN（idempotencyKey=CRM_CHECK_IN\|{activityId}） |
| D6 | 签到成功 + 未配置协同群 | POST | /api/business-partners/:id/activities (CHECK_IN) | project-visit:create | 201 + 不写 Outbox（业务事实不受影响） |
| D7 | 订单 confirm + 已配置协同群 | POST | /api/sales-orders/:id/confirm | sales-order:approve | 200 + 同事务 Outbox ORDER_STAGE_CHANGED（stage=CONFIRMED） |
| D8 | 交付 dispatch + 已配置协同群 | POST | /api/deliveries/:id/dispatch | delivery:edit | 200 + 同事务 Outbox ORDER_STAGE_CHANGED（stage=DISPATCHED） |
| D9 | 交付 confirm-delivery + 已配置协同群 | POST | /api/deliveries/:id/confirm-delivery | delivery:approve | 200 + 同事务 Outbox ORDER_STAGE_CHANGED（stage=PARTIALLY_DELIVERED/DELIVERED） |
| D10 | 钉钉投递成功 | POST | /api/domain-events/consume | domain-event:consume | 200 + dingtalk[] outcome=SENT；Outbox status=SENT + processedAt |
| D11 | 钉钉投递失败（errcode≠0 / 网络异常 / 渠道未配置） | POST | /api/domain-events/consume | domain-event:consume | Outbox status=FAILED + attemptCount+1 + lastError + nextAttemptAt（指数退避）→ 重试可恢复；**业务单据不受影响** |
| D12 | 超过最大重试次数 | POST | /api/domain-events/consume | domain-event:consume | Outbox status=DEAD_LETTER（人工调查） |
| D13 | 重复触发 consume（幂等） | POST | /api/domain-events/consume | domain-event:consume | 已 SENT 消息不再重发（claim 仅 PENDING/FAILED） |

## 不变量（契约红线）

- **业务事务与 Outbox 同事务原子**：签到/订单阶段动作成功 ⇒ Outbox 一定有记录（配置协同群时）；Outbox 写入失败 ⇒ 业务事务回滚（不允许业务成功但事件缺失）。
- **外部失败隔离**：钉钉 POST 失败只影响 Outbox 状态（FAILED 可重试），业务单据状态/金额/审计不受影响。
- **secret 隔离**：webhook/secret 只存在于 Server 环境 DINGTALK_CHANNELS_JSON；DB/前端/API 响应/git 均不得出现 secret；经纬度只出摘要（4 位小数≈11m）。
- **幂等键防重**：`CRM_CHECK_IN|{activityId}`、`ORDER_STAGE_CHANGED|{salesOrderId}|{stage}` 唯一（重复写 → P2002 → 事务回滚）。
