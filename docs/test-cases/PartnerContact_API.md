# PartnerContact API 测试用例（2A 联系人管理）

> 日期：2026-08-24 ｜ 关联：ADR-0052 / docs/SPRINTS/Phase2A_Contact_Design.md
> 权限：partner-contact:view/create/edit/delete

## 契约

- GET/POST /api/business-partners/:id/contacts（列表/创建）
- PATCH/DELETE /api/business-partners/:id/contacts/:contactId（编辑/软删）
- GET/POST .../contacts/:contactId/special-dates + DELETE .../:specialDateId
- GET/POST .../contacts/:contactId/relations + DELETE .../:relationId
- GET .../contacts/upcoming-reminders?windowDays=30

## 用例

| # | 场景 | 预期 |
|---|---|---|
| PC-01 | 创建联系人（isPrimary=true） | 201；同事务清除其他 active primary |
| PC-02 | 并发设置两个主联系人 | 仅一个成功；另一个 409 CONTACT_PRIMARY_CONFLICT（partial unique） |
| PC-03 | 软删除联系人 | deletedAt=now 且 isActive=false |
| PC-04 | 创建特殊日期 BIRTHDAY | recurrence 默认 YEARLY |
| PC-05 | 创建特殊日期 OTHER | recurrence 默认 NONE |
| PC-06 | upcoming-reminders 服务端计算 | YEARLY nextOccurrence（已过则下年度）；NONE 一次性 |
| PC-07 | 2 月 29 日生日 | 非闰年按 2/28 提醒；闰年按 2/29 |
| PC-08 | date-only 不跨日 | nextOccurrence 日期分量不变（本地口径） |
| PC-09 | 创建关系 source==target | 400 CONTACT_RELATION_SELF |
| PC-10 | 创建关系跨客户 | 400 CONTACT_RELATION_CROSS_PARTNER |

> 单测证据：apps/web/src/lib/contact/helpers.test.ts（recurrence/2-29/remindAt/window）；route.test.ts（主联系人排他 + P2002 409）。
