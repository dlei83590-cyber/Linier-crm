# Phase 2A 联系人管理 QA（2A-1 Backend + 2A-2 UI + 2A-3 Scope Hardening）

> 日期：2026-08-24 ｜ CTO Directive Phase 2A ｜ 验证事实源：GitHub CI + 人工 Runtime Acceptance（AI 不机械勾选）

## 范围

- 2A-1：Migration 0048 + contacts CRUD + special-dates + relations + upcoming-reminders + RBAC + 错误码 + Audit
- 2A-2：Customer 360 联系人管理 Workspace（联系人 CRUD / 特殊日期 / 即将到期提醒 / 关系档案）
- 2A-3：Nested Resource Scope Hardening（parent-scope 校验 fail-closed 404 + 关系 target 仅有效联系人）
- 不在范围：Phase 3（FollowUp/VisitPlan/CheckIn）；公海；2B 查重 Implementation

## CI 验证（已 PASS）

- 2A-1 PR #220（Run #959）、2A-2 PR #221（Run #961）、2A-3 PR（本次）Quality/Build/Secret 全绿
- 单测：helpers（recurrence/2-29/remindAt/window）、contacts route（主联系人排他/P2002 409）、workspace-helpers（payload/排除自己/recurrence 透传）、scope hardening（parent-scope 404）

## Runtime Acceptance（人工执行，未机械勾选）

> 环境 / build SHA / 执行人 / 日期：（待填）。建议 Phase 1 + Phase 2A 同一次最新 Build 一并 Smoke（CTO 指示）。

| # | 验证项 | 结果 |
|---|---|---|
| RA-1 | Customer 360 打开联系人 Tab（列表展示） | [ ] |
| RA-2 | 新建联系人（姓名必填，其余可空） | [ ] |
| RA-3 | 编辑联系人（含 version CAS；409 冲突提示） | [ ] |
| RA-4 | 设置主联系人（旧主自动取消；前端只提交 isPrimary=true） | [ ] |
| RA-5 | 新建生日 + YEARLY + 提前 N 天提醒 | [ ] |
| RA-6 | Upcoming Reminder 正确显示（nextOccurrence/remindAt，服务端派生） | [ ] |
| RA-7 | 建立两个联系人关系（target 排除自己 + 仅有效联系人） | [ ] |
| RA-8 | 删除关系 | [ ] |
| RA-9 | 删除联系人（confirm + deletedAt/isActive=false） | [ ] |
| RA-10 | 权限不足（partner-contact 无 create/edit/delete） | [ ] |
| RA-11 | 空数据状态 | [ ] |
| RA-12 | 错误 parent URL（错误 partnerId/contactId）→ 404 不触达子资源 | [ ] |

## 边界

- 零 Legacy CustomerContact 写入；零双写；零 Phase 3；零公海；零 Sales/Inventory/GL/BOM 核心改动
