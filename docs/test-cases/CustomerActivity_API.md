# Customer Activity API 测试用例（跟进活动 / 跟进分级 followup-level）

> 日期：2026-08-25 ｜ 关联：合同收口 cc-03-followup-level ｜ Migration 0050/0051/0055
> 合同原文：「客户跟进——按跟进程度划分需填写维度，并根据跟进情况推送对应责任人。」
> 领域事实：CustomerActivity（BP 维度，activityType=FOLLOW_UP）；跟进程度 = followUpLevel（BASIC/IMPORTANT/DECISION）；
> 责任人 = responsibleUserId（User，可空；DECISION 必填——服务端投影：客户负责人 CustomerOwnership → 商机负责人 ProjectOpportunity.ownerId）。
> 权限：project-visit:view/create/edit/approve（复用，ADR-0028，不新增权限模块）。
> HOLD：Reminder Engine / Scoring Engine / Rule Engine / 自定义规则编辑器 / 推送平台。

## 契约（Migration 0050/0051/0055）

- GET /api/business-partners/:id/activities（时间线；返回 followUpLevel + responsibleUserId + responsibleUser 只读投影）
- POST /api/business-partners/:id/activities（创建；activityType=FOLLOW_UP 动态必填按 followUpLevel；仅 FOLLOW_UP 进入审批流 status=DRAFT）
- POST /api/business-partners/:id/activities/:activityId/submit（DRAFT|REJECTED → SUBMITTED）
- POST /api/business-partners/:id/activities/:activityId/approve（SUBMITTED → APPROVED）
- POST /api/business-partners/:id/activities/:activityId/reject（SUBMITTED → REJECTED，rejectReason 必填）
- GET/POST /api/business-partners/:id/activities/:activityId/comments（评论列表/创建，不可变）
- POST /api/business-partners/:id/activities/:activityId/checkout（签退，服务端 now）

## 动态必填门禁（followup-level，Migration 0055）

| 跟进程度 | followUpLevel | 必填维度 | 可选维度 |
|---|---|---|---|
| 普通跟进 | BASIC（缺省） | summary（跟进内容） | nextAction / reminderAt / contactId / responsibleUserId |
| 重点跟进 | IMPORTANT | summary + nextAction + reminderAt | contactId / responsibleUserId |
| 决策推进 | DECISION | summary + nextAction + reminderAt + responsibleUserId* | contactId |

> *responsibleUserId：客户端可省略 → 服务端投影默认（① 客户负责人 CustomerOwnership（releasedAt=null + deletedAt=null）；
> ② 否则最近更新的商机负责人 ProjectOpportunity.ownerId）；投影仍为空 → 400。提交的 responsibleUserId 必须为有效启用用户（isActive=true）。

## 用例

| # | 场景 | 预期 |
|---|---|---|
| CA-01 | FOLLOW_UP BASIC：仅 summary | 201；followUpLevel=BASIC 落库；responsibleUserId=null；status=DRAFT |
| CA-02 | FOLLOW_UP 缺 summary | 400 VALIDATION_ERROR（summary 必填） |
| CA-03 | IMPORTANT 缺 nextAction | 400（nextAction 必填） |
| CA-04 | IMPORTANT 缺 reminderAt | 400（reminderAt 必填） |
| CA-05 | IMPORTANT 全字段 | 201；followUpLevel=IMPORTANT + nextAction + reminderAt 落库 |
| CA-06 | DECISION 缺负责人且无投影 | 400（responsibleUserId 必填；create 不被调用） |
| CA-07 | DECISION 无负责人 + 客户负责人投影 | 201；responsibleUserId=客户负责人（CustomerOwnership active owner） |
| CA-08 | DECISION 无客户负责人 + 商机负责人投影 | 201；responsibleUserId=商机负责人（ProjectOpportunity.ownerId 最近更新） |
| CA-09 | DECISION 手动指定负责人（有效启用用户） | 201；不覆盖用户选择 |
| CA-10 | DECISION 负责人不存在/已停用 | 400 RESPONSIBLE_USER_INVALID（create 不被调用） |
| CA-11 | VISIT_PLAN/CHECK_IN 传 followUpLevel/responsibleUserId | 忽略 → NULL 落库（不参与分级） |
| CA-12 | 审批流保持（Migration 0051） | FOLLOW_UP 创建 status=DRAFT → submit → approve → APPROVED；reject 必填原因 |
| CA-13 | 时间线返回跟进程度 + 责任人投影 | followUpLevel/responsibleUserId/responsibleUser（id/name/email）；未分级 → null |
| CA-14 | 评论功能保持 | ActivityComment 列表/创建不受分级影响 |
| CA-15 | 前端展示（Customer 360 timeline） | 跟进程度徽标（普通/重点/决策）+ 负责人 + 下次行动 + 下次跟进时间（reminderAt） |
| CA-16 | 未知跟进程度（前端 meta 回退） | activityFollowUpLevelMeta("URGENT_X") → 原值 + neutral（不吞未知 enum） |

## 单测证据

- apps/web/src/app/api/business-partners/[id]/activities/route.test.ts（分级门禁 + 投影 + 审批流保持 + GET 投影）
- apps/web/src/lib/customer/activity-meta.test.ts（跟进程度展示元数据 + 未知回退 + null）

## Production Smoke（合并后人工）

- [ ] 普通跟进保存 → 时间线显示「普通跟进」
- [ ] 重点跟进缺 nextAction → 被阻止（前端 + 服务端）
- [ ] 决策推进选择负责人 → 保存 → 显示「决策推进」+ 负责人
- [ ] 提交审批 → 批准 → 刷新后跟进程度/负责人/下次行动/提醒时间仍存在
- [ ] 评论/驳回现有功能不受影响
