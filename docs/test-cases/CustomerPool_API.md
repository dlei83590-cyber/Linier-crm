# Customer Pool API 测试用例（2C 客户公海）

> 日期：2026-08-25 ｜ 关联：ADR-0053 APPROVED + CTO OQ 裁决 ｜ Migration 0049
> 合同原文：「客户公海——①与客户状态衔接，触碰规则客户自动流入公海，人员按权限周期可自由挑入；②具备多公海能力，支持根据区域、小组设定不同公海规则。」
> 权限：customer-pool:view/create/edit/delete/assign + customer-pool:consume（SYSTEM）

## 契约（2C-1 Foundation）

- GET/POST /api/customer-pools（列表/创建）
- GET/PATCH/DELETE /api/customer-pools/:id（详情/乐观锁更新/软删）
- GET/POST /api/customer-pools/:id/rules（规则列表/创建）
- PATCH/DELETE /api/customer-pools/:id/rules/:ruleId（规则更新/软删）
- GET /api/customer-pools/:id/entries（条目列表：BP 最小投影 + 当前 owner）
- POST /api/customer-pools/:id/entries（手工入池：BP 存在/未删/CUSTOMER|BOTH → 无 active ownership → 无 active entry → pool active → scope compatible → 事务 + Outbox CustomerPoolEntryEntered）

## 契约（2C-2 归属操作）

- POST /api/customer-pools/:poolId/entries/:entryId/claim（挑入；ownerId 可选需 assign 权限；事务行锁 + Outbox CustomerPoolEntryClaimed）
- POST .../release（回池 / 移出池；单事务；Outbox CustomerOwnershipReleased）
- POST /api/customer-pools/sweep（customer-pool:consume；batch/idempotent/sorted/FOR UPDATE SKIP LOCKED；返回 scanned/entered/unchanged/ambiguous/blocked/failed）
- BP create/update 后同步 evaluate-and-sync（失败不回滚 BP 主档事务）

## 不变量（DB partial unique，Migration 0049）

| # | 不变量 | 约束 |
|---|---|---|
| I1 | 同一 BusinessPartner 至多一个有效 ownership | UNIQUE(businessPartnerId) WHERE releasedAt IS NULL AND deletedAt IS NULL |
| I2 | 同一 BusinessPartner 至多一个有效 entry | UNIQUE(businessPartnerId) WHERE status <> 'RELEASED' AND deletedAt IS NULL |
| I3 | entry.status=CLAIMED ⟺ 存在对应有效 ownership | claim/release 事务内成对更新 |

## 用例

| # | 场景 | 预期 |
|---|---|---|
| CP-01 | 创建 GLOBAL 池 | 201；scopeValue 必须为空 |
| CP-02 | 创建 REGION 池（scopeValue=区域字符串） | 201（OQ-1：不建字典，字符串 EQ/IN） |
| CP-03 | GLOBAL + scopeValue | 400 POOL_SCOPE_INVALID |
| CP-04 | REGION/DEPARTMENT 缺 scopeValue | 400 POOL_SCOPE_INVALID |
| CP-05 | 池编码重复 | 409 POOL_CODE_EXISTS（含并发 P2002） |
| CP-06 | 更新池（version CAS） | 200；VERSION_CONFLICT → 409 |
| CP-07 | 软删池 | deletedAt=now + isActive=false；entries/rules 保留 |
| CP-08 | 创建 FIELD_MATCH 规则（白名单 region/industry/sourceChannel/type/isActive；EQ/IN） | 201 |
| CP-09 | 创建 INACTIVITY 规则 | 400 POOL_RULE_SOURCE_UNAVAILABLE（Phase 3 前禁用） |
| CP-10 | 规则字段不在白名单 / operator 非 EQ/IN | 400 POOL_RULE_INVALID |
| CP-11 | 手工入池（GLOBAL + CUSTOMER 客户 + 无 active ownership/entry） | 201 + Outbox CustomerPoolEntryEntered 同事务 |
| CP-12 | 手工入池 SUPPLIER 客户 | 400 POOL_ENTRY_NOT_ALLOWED |
| CP-13 | REGION scope 与 BP.region 不匹配 | 400 POOL_ENTRY_NOT_ALLOWED |
| CP-14 | DEPARTMENT scope 与操作者部门不匹配 | 400 POOL_ENTRY_NOT_ALLOWED |
| CP-15 | 已有 active ownership 入池 | 409 CUSTOMER_ALREADY_OWNED |
| CP-16 | 已有 active entry 入池（含并发 P2002） | 409 CUSTOMER_ALREADY_IN_POOL |
| CP-17 | claim（2C-2） | 单事务行锁 → ownership + entry=CLAIMED + Outbox；P2002 → 409 POOL_CLAIM_CONFLICT |
| CP-18 | release 回池（2C-2） | ownership.releasedAt=now + entry=IN_POOL |
| CP-19 | release 移出池（2C-2） | ownership close + entry=RELEASED + releasedAt=now |
| CP-20 | sweep（2C-2） | 统计 scanned/entered/unchanged/ambiguous/blocked/failed；多池同 priority → NO AUTO ENTRY + ambiguous |

> 单测证据：apps/web/src/lib/customer-pool/validators.test.ts；apps/web/src/app/api/customer-pools/**/route.test.ts（2C-1 全套 + entries 全校验 + Outbox 同事务）。
