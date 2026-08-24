# Phase 2C-0 Customer Pool（客户公海）Architecture Audit 小结

> 日期：2026-08-25 ｜ CTO Directive Phase 2C-0（纯设计 Gate——零 Schema / 零 Migration / 零代码）
> 产出：本小结 + **ADR-0053**（docs/ADR/ADR-0053-customer-pool-architecture.md，DRAFT→PROPOSED）
> 合同原文：「客户公海——①与客户状态衔接，可根据企业需求设定流公海规则，触碰规则客户自动流入公海，人员按权限周期可自由挑入；②具备多公海能力，支持根据区域、小组设定不同公海规则。」
> 核心不变量：**同一 BusinessPartner 同一时刻只能存在一个有效客户归属事实。**

---

## 1. 三大结论（CTO 速览）

| # | 问题 | 结论 | 证据锚点 |
|---|---|---|---|
| A | **现有系统是否有权威 owner fact？** | **无。** BusinessPartner 无 ownerId/salesperson/assignee；createdById 只是记录创建人（审计事实）；ProjectOpportunity.ownerId 是可选商机子域的负责人。→ **CustomerOwnership 必须新建**（满足「仅当无权威 owner fact 才需要」的启用条件） | schema L672-740（L689 region / L705-707 createdById 等）；route.ts L148；schema L1258 |
| B | **是否有 scheduler / 规则引擎？** | **无。** 全仓无 cron/定时器/规则引擎；后台执行先例 = 外部 cron 触发 HTTP 消费端点（domain-events/consume、inventory-ledger/consume）。→ 规则取舍：**写入即判定（同步）+ 手动刷新端点**；INACTIVITY（无跟进 N 天）因无 Activity 事实源**推迟 Phase 3** | domain-events/consume/route.ts；consumer.ts L62；WorkflowCondition L1772-1792 为 field/operator/value 语法先例 |
| C | **RBAC 可复用项？** | **复用现有体系，只新增 1 个模块 ```customer-pool```**：claim/return 映射 ```:edit```（对齐 submit→:edit 先例）；后台 sweep → SYSTEM_PERMISSIONS ```customer-pool:consume```；模块 MUST 与 seed 同 PR 注册（ADR-0028 防漂移） | index.ts L120-131（PERMISSION_ACTIONS）/L134-325/L338+；seed.ts L238-243 |

---

## 2. 发现清单（9 问 × 证据）

### 2.1 BusinessPartner 归属字段 — 无
| 字段 | 位置 | 结论 |
|---|---|---|
| region ```String?``` | schema L689 | 自由文本，非归属、非 FK |
| createdById/updatedById/approvedById | schema L705-707 | 审计/经办人 |
| isActive/deletedAt/approvalStatus/version | schema L704/L710/L708-709 | 通用主数据语义 |
| （无）ownerId/salespersonId/assigneeId | — | **BusinessPartner 上不存在** |

### 2.2 既有归属实现 — 无权威 owner fact
- ```createdById``` = 「谁建的主档」（route.ts L148），非「谁拥有客户」。
- 其他聚合的负责人字段：ProjectOpportunity.ownerId（L1258）、Project.ownerId（L1310）、ProjectTask.assigneeId（L1427）、ProjectRisk.ownerId（L1531）、File.ownerId（L2534）——均为该聚合自己的负责人，客户级归属无载体。
- **→ CustomerOwnership 必要（ADR-0053 §3.2/§4.4）**。

### 2.3 User / Department / Team / Region 权威源
- User（L284-314）：id/email/name/isActive/**departmentId**。
- Department（L317-331）：name/code @unique/**parentId 自树**（部门/小组权威源）。
- Role/UserRole/Permission（L334-372）：RBAC 目录权威源。
- **Team 模型：不存在**；**Region 模型：不存在**（仅 ```region String?``` 自由文本：BusinessPartner L689 / TaxRate L963 / 遗留 Customer L2653）。
- → 公海区域/小组映射：区域=BP.region 字符串匹配；小组=Department（User.departmentId）。

### 2.4 规则引擎 / scheduler — 无
- schema 无 cron/job 字段；apps/web/src 无定时器；依赖无 node-cron/bull/agenda；.github/workflows 无 cron。
- 后台先例：POST /api/domain-events/consume（route L18-31，权限 domain-event:consume）——**外部 cron 或人工触发**。
- Outbox 消费 claim 模式：domain-events/consumer.ts L62 ```FOR UPDATE SKIP LOCKED```。
- WorkflowCondition（L1772-1792）field/operator/value 声明式 = 公海规则语法可复用先例。

### 2.5 Audit / Event 基建 — 就绪
- writeAuditLog：api-helpers.ts L160-200（best-effort，失败不阻断业务）。
- AuditLog 模型：L383-408（beforeData/afterData/requestId/traceId/result）。
- OutboxMessage：L5602-5621（idempotencyKey @unique + lease）+ EVENTS.md 注册表（L12-24 事件信封格式）。
- Error Code：SSOT = apps/web/src/lib/api/errors.ts，ERROR_CODES.md 自动生成（L3-4）。

### 2.6 CRM Activity — 缺失（影响「无跟进 N 天自动入池」）
- Phase 3 未开始（ROADMAP L42 ⬜）；schema 与 apps/web/src **无 Activity/FollowUp/跟进**（grep 零命中）。
- ProjectVisit（L1549-1572）是项目维度走访记录，合同审计标为「CRM Activity 基座候选」（ROADMAP L308）。
- **结论：Phase 2C 无 lastFollowUpAt/lastActivityAt 事实源 → INACTIVITY 规则 MUST NOT 实现（ADR-0053 §6.4），ruleType 保留位 BLOCKED-UNTIL-PHASE-3。**

### 2.7 并发 claim 可用模式 — 齐全
| 模式 | 先例 |
|---|---|
| 乐观锁 CAS | cas.ts L18-34（updateMany {id,version,deletedAt:null} + count → OK/NOT_FOUND/CONFLICT）；BP PATCH 用 ```$transaction``` + casUpdate（[id]/route.ts L134-136） |
| 悲观行锁 | domain-events/consumer.ts L62 ```FOR UPDATE SKIP LOCKED``` |
| 唯一约束兜底 | **Migration 0048 L16** partial unique：```CREATE UNIQUE INDEX "PartnerContact_one_primary_per_partner" ON "PartnerContact"("partnerId") WHERE "isPrimary" = true AND "isActive" = true AND "deletedAt" IS NULL``` |
| 锁序红线 | 根 AGENTS.md §3：collect → dedupe → sort → ORDER BY id FOR UPDATE |

### 2.8 软删除语义 — 全仓统一
- ```deletedAt``` + ```isActive``` 双标志；读取全过滤 ```deletedAt: null```（route.ts L65/L74/L102/L212）。
- BP DELETE：```{ deletedAt: new Date(), isActive: false }```（[id]/route.ts L242-245）+ 引用检查（L230-240）。
- ADR-0052 §5：软删 = deletedAt=now **且** isActive=false（两者同时）。
- partial unique 一律带 ```deletedAt IS NULL```（Migration 0048 L16）。

### 2.9 RBAC — 可复用
- PERMISSION_MODULES（index.ts L134-325）：business-partner L142 / partner-contact L232 / partner-* / project-* 等。
- PERMISSION_ACTIONS（L120-131）：view/create/edit/delete/approve/audit/export/import/**assign**/close。
- SYSTEM_PERMISSIONS（L338+）：inventory-ledger:consume / domain-event:consume / inventory-adjustment:apply。
- requirePermission（api-helpers.ts L56-65）fail-closed 403。
- **漂移红线（ADR-0028）**：API 引用的权限 ⊆ ALL_ACTION_PERMISSIONS；模块必须在 PERMISSION_MODULES **和** seed SEED_ACTION_MODULES **同 PR**注册（教训：index.ts L147-149/L173-174）。

---

## 3. 建议模型与不变量（详见 ADR-0053 §4/§5）

| 模型 | 职责 | 关键点 |
|---|---|---|
| CustomerPool | 公海池定义（多公海） | scopeType = GLOBAL/REGION/DEPARTMENT；主数据风格（version + approvalStatus + casUpdate） |
| CustomerPoolRule | 流公海规则 | ruleType = STATUS_MATCH（首版）/ INACTIVITY（保留，Phase 3 解锁）；condition = [{field, operator, value}] 对齐 WorkflowCondition；**字段白名单 fail closed** |
| CustomerPoolEntry | 在池成员事实 | status = IN_POOL/CLAIMED/RELEASED；enter/release 时间线 + reason |
| CustomerOwnership | **权威归属事实（必要）** | releasedAt IS NULL = 有效；claim/release/reclaim 事实流 |

不变量：I1（核心）同 BP 至多一个有效 ownership；I2 同 BP 同时只在一个池；I3 CLAIMED ⟺ 有效 ownership（同事务成对更新）；I4 owner 必须 active User；I5 规则只读既有字段。

partial unique（Design 层 SQL，引用 0048 写法，非本轮落地）：

```sql
CREATE UNIQUE INDEX "CustomerOwnership_one_active_per_partner"   ON "CustomerOwnership"("businessPartnerId") WHERE "releasedAt" IS NULL AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "CustomerPoolEntry_one_active_per_partner"   ON "CustomerPoolEntry"("businessPartnerId") WHERE "status" <> 'RELEASED' AND "deletedAt" IS NULL;
CREATE UNIQUE INDEX "CustomerPoolEntry_one_active_per_pool_partner" ON "CustomerPoolEntry"("poolId","businessPartnerId") WHERE "status" <> 'RELEASED' AND "deletedAt" IS NULL;
```

claim 事务：```$transaction``` + ```SELECT ... FOR UPDATE```（entry 行）→ 建 ownership → entry=CLAIMED → 审计；DB 兜底 P2002 → 409 POOL_CLAIM_CONFLICT。

---

## 4. 未决问题（OQ，供 CTO Review；完整版见 ADR-0053 §12）

| # | 问题 | 建议 | 影响 |
|---|---|---|---|
| OQ-1 | region 自由文本 → 区域规则是否先字典归一化？ | Phase 2C 字符串 EQ/IN；字典与 2B 查重联动 | 规则精度 |
| OQ-2 | 「按权限周期可自由挑入」的周期限制（持有上限/冷却期）入 2C？ | 2C 只做 RBAC；持有数/冷却期 HOLD | 2C 范围 |
| OQ-3 | entry 与 ownership 是否合并一张表？ | 本 ADR 两表（ownership=事实流）；CTO 可裁 | Schema 简化 |
| OQ-4 | 规则重算走 Outbox consumer？ | 首版同步判定；异步化待平台 scheduler | 架构方向 |
| OQ-5 | 池/规则走 approvalStatus maker-checker？ | 建议复用（配置主数据先例） | 治理 |
| OQ-6 | 「与客户状态衔接」是否需要 BP 显式 status？ | 现状 type/isActive/approvalStatus 可表达；产品确认后另开 Gate | 产品语义 |

---

## 5. 边界声明（本轮明确没做什么）

- ✅ 只创建两个文档：ADR-0053 + 本小结。
- ❌ 未修改任何代码 / Schema / Migration（**无 Migration 0049**）。
- ❌ 未运行 build / test / typecheck / lint（AGENTS.md CI-First / No Local Server）。
- ❌ 未实现公海任何业务逻辑（Coming-by-contract 占位保留：business-partners/[id]/page.tsx L178/L456）。
- ❌ 未触碰 Legacy Customer 体系（ADR-0050/0051：BP 为 SSOT）。

## 6. 下一步（供 CTO 决策）

1. Review ADR-0053（状态 DRAFT→PROPOSED→Accepted）与本小结。
2. 裁决 OQ-1~OQ-6（尤其 OQ-2 周期限制、OQ-3 表合并）。
3. 通过后另开 Phase 2C-1 Schema Design Gate（届时才允许 Migration 0049 前置设计）。
