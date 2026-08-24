# Phase 2A 联系人管理 QA

> 日期：2026-08-24 ｜ CTO Directive Phase 2A-1（Backend）
> 验证事实源：GitHub CI

## 范围

- Migration 0048（PartnerContact +mobile/contactNote + ContactSpecialDate(recurrence) + ContactRelation + 主联系人 partial unique index）
- API：contacts CRUD + special-dates + relations + upcoming-reminders；RBAC partner-contact:*；错误码 CONTACT_*；Audit
- 不在范围：2A-2 前端 Workspace（后续）；Phase 3（FollowUp/VisitPlan/CheckIn）；公海

## 验收

- [ ] CI 全绿（Quality/Build/Secret）
- [ ] 单测：helpers（recurrence/2-29/remindAt/window）+ contacts route（主联系人排他/P2002 409）

## Runtime Acceptance（待人工，2A-2 UI 前补）

- [ ] 新建联系人 → 设主联系人 → 旧主自动降级
- [ ] 添加生日（YEARLY）→ upcoming-reminders 正确列出
- [ ] 添加联系人关系（同客户内）→ 跨客户被拒

## 边界

- 零 Legacy CustomerContact 写入；零双写；零 Phase 3；零公海；零 Sales/Inventory/GL/BOM 核心改动
