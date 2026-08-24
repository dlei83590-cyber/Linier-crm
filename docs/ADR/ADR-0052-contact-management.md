# ADR-0052：联系人管理（精细画像 / 特殊日期提醒 / 关系档案）

- 状态：**Accepted（Implemented，2026-08-24）**
- 日期：2026-08-24
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/SPRINTS/Phase2A_Contact_Design.md（2A-0 Design Gate）；ADR-0050（SSOT 冻结）；CTO Directive Phase 2A-1

---

## 背景

合同联系人三条：① 精细画像；② 特殊时间前置提醒（例：生日）；③ 联系人关联关系档案。主数据 SSOT = BusinessPartner → PartnerContact。

## 决策

1. **PartnerContact 复用**（零第二套主档）：+mobile（手机，与 phone 座机区分）+contactNote（联系备注）；状态复用 isActive；禁止 CustomerContactV2/CRMContact / 写 Legacy CustomerContact。
2. **ContactSpecialDate（特殊日期 + 前置提醒）**：type(BIRTHDAY|ANNIVERSARY|OTHER) + date + recurrence(NONE|YEARLY) + title + remindDaysBefore + reminderEnabled；BIRTHDAY/ANNIVERSARY 默认 YEARLY；nextOccurrence 服务端派生（YEARLY 本年度月/日，已过则下年度；2/29 非闰年按 2/28）；remindAt = nextOccurrence - remindDaysBefore；date-only 本地日期口径不跨日；第一阶段只做 upcoming-reminders Query（禁止 fake push）。
3. **ContactRelation（关系档案）**：source/target/relationType(COLLEAGUE|REPORTS_TO|DECISION_MAKER|INFLUENCER|RELATIVE|OTHER)/note；不变量 source≠target + 一期仅同 BusinessPartner 内关系（服务端校验）；只做关系事实 + 查看，不做图数据库。
4. **主联系人唯一性（并发安全）**：同一 partner 至多一个 active primary——DB partial unique index（UNIQUE(partnerId) WHERE isPrimary AND isActive AND deletedAt IS NULL，手写 SQL）+ 事务内 updateMany 清除其他 primary；并发 P2002 → 409 CONTACT_PRIMARY_CONFLICT。
5. **DELETE 语义**：软删 = deletedAt=now 且 isActive=false（两者同时）。
6. **RBAC**：partner-contact:view/create/edit/delete（PERMISSION_MODULES + seed）。

## 影响

- Migration 0048；API /api/business-partners/:id/contacts/**（CRUD + special-dates + relations + upcoming-reminders）
- 错误码 CONTACT_*；Audit 动作 partner-contact.create/update/delete、special-date.create/delete、relation.create/delete

## 兼容性

- 零破坏：PartnerContact 仅加可空字段；新表 ContactSpecialDate/ContactRelation；冻结边界（Sales/Inventory/GL/BOM 等）零改动
