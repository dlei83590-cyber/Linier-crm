# Phase 2A Contact Design Gate — 联系人精细画像 / 特殊日期提醒 / 关系档案

> 日期：2026-08-24 ｜ CTO Directive Phase 2A-0（Design/Scope Gate，纯设计，不实施）
> 主数据 SSOT：BusinessPartner → PartnerContact（**禁止新建第二套联系人主档 / 禁止写 Legacy CustomerContact**）

---

## 0. 合同三条要求（唯一业务验收依据）

> ① 关联客户档案库，核心做联系人精细画像管理；
> ② 可设置联系人特殊时间前置提醒（例：生日）；
> ③ 可建立联系人间的关联关系档案。

---

## 1. 当前已满足能力（复用，零新增）

| 能力 | 现状 | 证据 |
|---|---|---|
| 联系人事实源 | PartnerContact（partnerId → BusinessPartner） | prisma L2886 |
| 姓名/职务/部门/电话/邮箱/微信 | 已有 name/title/department/phone/email/wechat | PartnerContact |
| 主联系人标识 | 已有 isPrimary | PartnerContact |
| 状态 | 已有 isActive（active/inactive，布尔即可，无需新枚举） | PartnerContact |
| 所属客户 | 已有 partnerId = BusinessPartner.id | PartnerContact |
| 审计 | 已有 createdById/updatedById/approvedById/approvalStatus/version/deletedAt | PartnerContact |
| Customer 360 联系人 tab | Phase 1A 只读展示（/business-partners/[id] 详情 include partnerContacts） | PR #214 |

## 2. 缺失字段/模型（需 Migration）

| 项 | 现状 | 缺口 | 决策 |
|---|---|---|---|
| 手机号（合同「手机」与「电话」分开） | 仅 phone（未区分座机/手机） | 缺 mobile | PartnerContact 加 mobile 字段 |
| 联系备注 | 无 | 缺 contactNote | PartnerContact 加 contactNote 字段 |
| 特殊日期（生日等）+ 前置提醒 | 无 | 缺 ContactSpecialDate 模型（含 recurrence NONE|YEARLY） | 新建（§5） |
| 联系人关系档案 | 无 | 缺 ContactRelation 模型 | 新建（§6） |

## 3. 是否需要 Migration

需要。Migration 0048（contact_management）：
- ALTER TABLE PartnerContact ADD COLUMN mobile TEXT, ADD COLUMN contactNote TEXT
- CREATE TABLE ContactSpecialDate（见 §5）
- CREATE TABLE ContactRelation（见 §6）
- 新枚举 ContactSpecialDateType（BIRTHDAY/ANNIVERSARY/OTHER）、ContactSpecialDateRecurrence（NONE/YEARLY）、ContactRelationType（COLLEAGUE/REPORTS_TO/DECISION_MAKER/INFLUENCER/RELATIVE/OTHER）
- 主联系人唯一性 partial unique index（手写 SQL，Prisma DSL 无法表达 partial index，migration history 为 SSOT）：
  CREATE UNIQUE INDEX PartnerContact_one_primary_per_partner ON PartnerContact(partnerId) WHERE isPrimary = true AND isActive = true AND deletedAt IS NULL;

## 4. API 设计（contacts CRUD，消费 BusinessPartner.id）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/business-partners/:id/contacts | partner-contact:view | 联系人列表（isPrimary 排序） |
| POST | /api/business-partners/:id/contacts | partner-contact:create | 新建（isPrimary 时清除其他主联系人） |
| PATCH | /api/business-partners/:id/contacts/:contactId | partner-contact:edit | 编辑（CAS version；isPrimary 排他） |
| DELETE | /api/business-partners/:id/contacts/:contactId | partner-contact:delete | 软删除：deletedAt=now 且 isActive=false（两者同时，非二选一） |
| GET | /api/business-partners/:id/contacts/upcoming-reminders | partner-contact:view | 即将到期特殊日期提醒（服务端计算） |
| GET/POST | /api/business-partners/:id/contacts/:contactId/special-dates | partner-contact:view/edit | 特殊日期 |
| DELETE | .../special-dates/:specialDateId | partner-contact:edit | 删除特殊日期 |
| GET/POST | /api/business-partners/:id/contacts/:contactId/relations | partner-contact:view/edit | 关系档案 |
| DELETE | .../relations/:relationId | partner-contact:edit | 删除关系 |

> 红线：contact.partnerId = BusinessPartner.id（服务端校验）；禁止 CustomerContact/CRMContact 写入；禁止复制 BusinessPartner 主档字段。

## 5. Reminder 设计（特殊日期 + 前置提醒）

ContactSpecialDate 字段：id / contactId / type(BIRTHDAY|ANNIVERSARY|OTHER) / date / recurrence(NONE|YEARLY) / title / remindDaysBefore / reminderEnabled + 审计字段

- recurrence 语义（CTO Required Amendment 1）：BIRTHDAY 默认 YEARLY；ANNIVERSARY 默认 YEARLY；OTHER 可 NONE|YEARLY
- 服务端计算 nextOccurrence（非原始 date 直接比较）：
  - NONE：nextOccurrence = date（一次性，date >= 今日才命中）
  - YEARLY：nextOccurrence = 本年度 month/day（若已过则下一年度）；2 月 29 日非闰年按 2 月 28 日（写入 Test Case）
- remindAt = nextOccurrence - remindDaysBefore（upcoming-reminders Query 派生，禁止前端判断）
- Query：GET .../contacts/upcoming-reminders —— 返回 now ≤ remindAt ≤ now + window 的到期项（window 参数，默认 30 天）
- Date-only 业务日期不得因 UTC 时区换算跨日（DB @db.Date，服务端按本地日期口径计算，不 new Date() 到 UTC 中间转换）
- 通知执行：Notification 基础设施（Template/Message/Channel/Log）已存在但无正式执行器——第一阶段只做 Upcoming Query + 明确后续消费方式（Notification consumer / cron 扫 Query），禁止 fake push

## 6. Contact Relation 设计（关系档案）

ContactRelation 字段：id / sourceContactId / targetContactId / relationType(COLLEAGUE|REPORTS_TO|DECISION_MAKER|INFLUENCER|RELATIVE|OTHER) / note + 审计字段

- 核心不变量：source ≠ target；两联系人必须存在；一期仅允许同 BusinessPartner 内关系（服务端校验 source.partnerId == target.partnerId）
- 只做关系事实 + 查看，不做图数据库 / 社交网络分析

## 7. RBAC

- 新增权限模块 partner-contact → partner-contact:view/create/edit/delete（PERMISSION_MODULES + seed，ADR-0028 静态门）
- 特殊日期 / 关系 / 提醒 Query 复用 partner-contact:view/edit（不新造独立权限体系）
- 主联系人标识变更 = partner-contact:edit

## 8. Audit

- 动作：contact.create/update/delete、special-date.create/delete、relation.create/delete（writeAuditLog：actor/entityId/before/after）

## 9. Error Codes（CONTACT_* 系列）

| Code | 语义 | HTTP |
|---|---|---|
| CONTACT_NOT_FOUND | 联系人不存在或已删除 | 404 |
| CONTACT_PARTNER_INVALID | 客户不存在/联系人所属客户不匹配 | 400 |
| CONTACT_RELATION_SELF | source == target | 400 |
| CONTACT_RELATION_CROSS_PARTNER | 跨客户关系（一期禁止） | 400 |
| CONTACT_SPECIAL_DATE_INVALID | 日期非法/提醒天数越界 | 400 |
| CONTACT_PRIMARY_CONFLICT | 并发设置主联系人冲突（partial unique 触发，409） | 409 |

## 10. Test Cases

- 新增 docs/test-cases/PartnerContact_API.md：contacts CRUD + 主联系人并发排他（partial unique + transaction，两并发仅一个成功）+ 特殊日期（recurrence YEARLY/NONE）+ 关系（source≠target/跨客户拒绝）+ upcoming-reminders 服务端计算 + 2 月 29 日非闰年按 2/28 提醒 + date-only 不跨日

## 11. 预计修改文件

| 层 | 文件 |
|---|---|
| Schema | prisma/schema.prisma（PartnerContact +mobile/contactNote + ContactSpecialDate + ContactRelation + 2 枚举）；prisma/migrations/0048_contact_management/ |
| RBAC | packages/shared/src/constants/index.ts（+partner-contact）；prisma/seed.ts |
| 错误码 | apps/web/src/lib/api/errors.ts（CONTACT_*）+ gen-error-codes.mjs |
| API | apps/web/src/app/api/business-partners/[id]/contacts/**（CRUD + special-dates + relations + upcoming-reminders） |
| UI | apps/web/src/app/(dashboard)/business-partners/[id]/page.tsx（联系人 tab 升级管理 Workspace） |
| 文档 | ADR-0052 + test-cases/PartnerContact_API.md + QA + CHANGELOG + ROADMAP |

## 12. 不允许修改的冻结边界

- 禁止：新建 CustomerContactV2/CRMContact；写 Legacy CustomerContact；BusinessPartner/Customer 双写；DROP Legacy Customer；修改 Sales/Inventory/GL/BOM 核心；Reservation/MRP；BI；提前建 FollowUp/VisitPlan/CheckIn（Phase 3）
- 冻结 SSOT：BusinessPartner/Item/ProjectOpportunity/Project/Quotation/SalesOrder/InventoryMovement/StockProjection/Finance-GL/AuditLog/File（ADR-0050）
