# ADR-0053：客户公海（Customer Pool）架构审计与设计决策

- 状态：**DRAFT → PROPOSED（2026-08-25，待 CTO Review 后 Accepted）**
- 日期：2026-08-25
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/SPRINTS/Phase2C0_Pool_Audit.md（2C-0 Audit 小结）；docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 0，§8 公海 MISSING）；ADR-0050（SSOT 冻结）；ADR-0051（Customer 遗留模型 DEPRECATE）；ADR-0052（联系人管理，partial unique 先例）；CTO Directive Phase 2C-0（纯设计 Gate）

---

## 1. 背景与合同原文

合同原文（ROADMAP v1.43 合同验收范围，docs/ROADMAP.md L33）：

> 「客户公海——①与客户状态衔接，可根据企业需求设定流公海规则，触碰规则客户自动流入公海，人员按权限周期可自由挑入；②具备多公海能力，支持根据区域、小组设定不同公海规则。」

CTO 已定（Phase 2C-0）：本轮**只做 Architecture Audit + ADR（纯设计）**——禁止创建 Migration 0049，禁止 Schema，禁止任何代码改动。核心不变量锁定：

> **同一 BusinessPartner 同一时刻只能存在一个有效客户归属事实。**

Phase 0 合同审计已确认公海为全新领域（docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md L103）：MISSING——无 Pool/PoolRule/PoolEntry/Ownership/Claim/Reclaim；建议「一个客户同一时刻仅一个有效归属事实；领取须 transaction + CAS/row lock + AuditLog + RBAC」。本 ADR 即该缺口的设计 Gate 产出。

---

## 2. 决策摘要

| # | 决策 | 结论 |
|---|---|---|
| D1 | 归属事实承载 | **必须新建 CustomerOwnership**（审计证明现有系统无客户级权威 owner fact，见 §3.2）；它是核心不变量的载体 |
| D2 | 数据模型 | 四模型：CustomerPool / CustomerPoolRule / CustomerPoolEntry / CustomerOwnership（职责见 §4） |
| D3 | 规则引擎 | **无 scheduler 现状下采用「写入即判定（同步、事件触发）+ 手动刷新端点」**；后台批量 sweep 可选（§6） |
| D4 | 「无跟进 N 天自动入池」 | **Phase 2C 禁止实现**——无 CRM Activity 事实源（§3.6）；ruleType 保留 INACTIVITY 枚举位并标记 BLOCKED-UNTIL-PHASE-3 |
| D5 | 并发 claim | ```$transaction``` + 行锁（```SELECT ... FOR UPDATE```）+ **partial unique index 兜底**（P2002 → 409）（§7） |
| D6 | 软删除 | 四模型全部沿用 ```deletedAt``` + ```isActive``` 双标志（对齐 ADR-0052 §5 / BP DELETE 先例）（§8） |
| D7 | RBAC | **复用既有 RBAC 体系，不新建第二套**：新模块 ```customer-pool```（claim/return 映射 ```:edit```）+ 可选系统权限 ```customer-pool:consume```（§9） |
| D8 | 禁止项 | 本轮零 Schema / 零 Migration 0049 / 零代码；禁止平行 Customer 体系；禁止自动合并 BP（§11） |

---

## 3. Audit Findings（审计证据）

### 3.1 BusinessPartner 是否已有 owner / salesperson / assignee 字段？

**结论：没有。** BusinessPartner（prisma/schema.prisma L672-740）仅含：

| 字段 | 行号 | 语义 |
|---|---|---|
| region | L689 | ```String? // 所属区域```——**自由文本**，非 FK，非归属 |
| industry / companySize / creditRating / sourceChannel | L690-693 | 画像字段，非归属 |
| isActive | L704 | 启用标志 |
| createdById / updatedById / approvedById | L705-707 | **审计/经办人**，非业务归属 |
| approvalStatus / version | L708-709 | 主数据审批投影 + 乐观锁 |
| deletedAt | L710 | 软删除 |

owner/salesperson/assignee 字段在**其他聚合**中零散存在（均为该聚合自己的负责人，非客户级归属）：ProjectOpportunity.ownerId（L1258）、Project.ownerId（L1310）、ProjectTask.assigneeId（L1427）、ProjectRisk.ownerId（L1531）、File.ownerId（L2534）。

### 3.2 Customer/BusinessPartner 现有归属实现是什么（有权威 owner fact 吗）？

**结论：无客户级权威 owner fact。** ```createdById``` 表达的是「谁创建了主档记录」（apps/web/src/app/api/business-partners/route.ts L148 写入 ```createdById: user?.id```），是审计事实而非业务归属事实。ProjectOpportunity.ownerId（L1258）是商机级负责人，且商机是可选的（非每个客户都有），不能作为客户归属的权威源。→ **因此 CustomerOwnership 是必要的**（满足「仅当现有系统无权威 owner fact 时才需要」的启用条件）。

### 3.3 User / Department / Team / Region 的 authoritative source

| 对象 | 结论 | 证据 |
|---|---|---|
| User | 权威源 = ```User``` 模型（id/email/passwordHash/name/isActive/departmentId） | schema L284-314 |
| Department（小组/部门） | 权威源 = ```Department```（name/code @unique/parentId 自树），User.departmentId → Department | schema L317-331，L290-291 |
| Role / Permission | 权威源 = Role / UserRole / Permission（RBAC 目录） | schema L334-372 |
| Team | **不存在 Team 模型** | 全 schema 无 Team |
| Region | **不存在 Region 模型**；仅自由文本 ```region String?```（BusinessPartner L689 / TaxRate L963 / 遗留 Customer L2653） | schema |

→ 合同「根据区域、小组设定不同公海规则」的映射：**区域 = BusinessPartner.region（先字符串匹配，字典归一化留待后续）；小组 = Department（User.departmentId 或池 scopeValue=departmentId）**。

### 3.4 是否已有规则引擎或 scheduler？

**结论：无。** 全仓无 scheduler/cron/规则引擎：

- schema 无 cron/scheduler/job 字段（grep 零命中）。
- apps/web/src 中 ```cron|scheduler|scheduleJob|CronJob``` 仅注释提及「供 cron/手动触发」（apps/web/src/app/api/inventory-ledger/consume/route.ts L15；apps/web/src/lib/inventory-ledger/consumer.ts L416）——**消费端点是 HTTP route，由外部 cron 或人工触发，应用内无定时器**。
- 依赖无 node-cron/bull/agenda 等；.github/workflows 无 cron schedule。
- 最接近「规则」的先例是审批流 WorkflowCondition（field/operator/value/expression，schema L1772-1792）——面向审批条件，非通用规则引擎，但 **field/operator/value 的声明式表达可复用为公海规则的语法先例**。
- 后台消费基建存在：OutboxMessage（L5602-5621）+ domain-events/consumer.ts（L62 ```FOR UPDATE SKIP LOCKED``` claim）+ 触发端点 POST /api/domain-events/consume（权限 domain-event:consume，route L20）。

### 3.5 Audit/Event 基础设施现状

| 能力 | 现状 | 证据 |
|---|---|---|
| AuditLog | ✅ 就绪：writeAuditLog（best-effort，失败不阻断业务）；动作命名 ```business-partner.create/update/delete``` 等 | apps/web/src/lib/api-helpers.ts L160-200；schema AuditLog L383-408（含 beforeData/afterData/requestId/traceId/result） |
| Domain Event / Outbox | ✅ 就绪：OutboxMessage（eventType/aggregateId/payload/idempotencyKey @unique/lease 字段）+ 通用 consumer + EVENTS.md 注册表 | schema L5602-5621；domain-events/consumer.ts；docs/EVENTS.md L12-24 |
| Error Code 注册表 | ✅ 就绪：SSOT = apps/web/src/lib/api/errors.ts，docs/ERROR_CODES.md 自动生成（禁止手编） | docs/ERROR_CODES.md L3-4 |

→ 公海的 Audit 动作、Outbox 事件、错误码均可直接挂接现有基建（§10）。

### 3.6 当前 CRM Activity 缺失对「无跟进 N 天自动入池」的影响

**结论：Phase 3（CRM 活动/跟进/拜访/签到）尚未开始（ROADMAP L42 ⬜）；全 schema 与 apps/web/src 无 Activity/FollowUp/跟进 实现（grep 零命中）。** 最接近的 ProjectVisit（schema L1549-1572：visitType/visitedAt/visitorId/summary/nextAction/reminderAt）是项目维度走访记录，合同审计将其标记为「CRM Activity 基座候选」（ROADMAP L308；Contract audit 矩阵行 7）。

→ 影响：**「无跟进 N 天自动流入公海」在 Phase 2C 没有事实源（无 lastFollowUpAt/lastActivityAt 权威字段）**。ADR 约束（§6.4）：Phase 2C 规则只允许基于 BusinessPartner 既有字段的判定；INACTIVITY 规则必须等到 Phase 3 Activity 模块落地、提供权威 lastActivityAt 后才可启用——禁止在 Phase 2C 用 ProjectVisit 或临时字段拼凑「最后跟进时间」。

### 3.7 并发 claim 可用的事务模式

| 模式 | 现状 | 证据 |
|---|---|---|
| 乐观锁 CAS | ✅ ```casUpdate```：updateMany where {id, version, deletedAt:null} + count → OK/NOT_FOUND/CONFLICT（消除 read-check-update TOCTOU） | apps/web/src/lib/api/cas.ts L18-34；BP PATCH 用 ```$transaction``` + casUpdate（[id]/route.ts L134-136） |
| 悲观行锁 | ✅ ```FOR UPDATE``` 已有先例：domain-events/consumer.ts L62（```FOR UPDATE SKIP LOCKED``` 批量 claim）；ledger-command.ts 调用方事务 + 锁序 | domain-events/consumer.ts L59-70 |
| 唯一约束兜底 | ✅ partial unique 先例：Migration 0048 L16 ```CREATE UNIQUE INDEX "PartnerContact_one_primary_per_partner" ... WHERE "isPrimary" = true AND "isActive" = true AND "deletedAt" IS NULL``` | prisma/migrations/0048_contact_management/migration.sql L16 |
| 锁序红线 | 仓库级：collect IDs → deduplicate → sort → ```SELECT ... ORDER BY id FOR UPDATE``` | 根 AGENTS.md §3（Blocking Gate） |

### 3.8 soft delete / active semantics 现状

**结论：全仓统一 ```deletedAt``` + ```isActive``` 双标志，读取一律过滤 ```deletedAt: null```，casUpdate 也带 ```deletedAt: null``` 条件。**

- BP DELETE：```data: { deletedAt: new Date(), isActive: false, ... }```（[id]/route.ts L242-245）；删除前引用检查（L230-240）。
- GET 全部 ```deletedAt: null```（route.ts L65/L74/L102/L212）。
- ADR-0052 §5：「软删 = deletedAt=now 且 isActive=false（两者同时）」。
- partial unique 一律 ```WHERE ... deletedAt IS NULL```（Migration 0048 L16）。

### 3.9 RBAC 现状（可复用项）

| 能力 | 现状 | 证据 |
|---|---|---|
| 模块注册 | PERMISSION_MODULES（含 business-partner L142、partner-contact L232、partner-*、project-*、supplier-* 等） | packages/shared/src/constants/index.ts L134-325 |
| 动作集 | PERMISSION_ACTIONS = view/create/edit/delete/approve/audit/export/import/**assign**/close（**assign 已存在**） | index.ts L120-131 |
| 系统受限权限 | SYSTEM_PERMISSIONS（inventory-ledger:consume / domain-event:consume / inventory-adjustment:apply）——后台执行动作不进通用动作集 | index.ts L338+；seed.ts SEED_SYSTEM_ACTION_PERMISSIONS L238-243 |
| 强制层 | requirePermission / hasPermission（fail-closed 403） | apps/web/src/lib/api-helpers.ts L56-65 |
| 漂移红线 | ADR-0028：API 引用的权限 ⊆ ALL_ACTION_PERMISSIONS；**模块必须同时在 PERMISSION_MODULES 与 seed SEED_ACTION_MODULES 注册**（历史漂移教训：index.ts L147-149/L173-174 注释） | index.ts L333-335；seed.ts L47/L189 |

→ 可复用：business-partner:view/edit/delete（读/写主档）、partner-contact:view（联系人）、audit（审计查询）、RBAC 基础设施本身。公海新能力只新增 ```customer-pool``` 一个模块（§9）。

---

## 4. 建议数据模型（Design 层契约，非 Schema 落地）

> 本节省略实现细节，只定义职责/关键字段/关系，供 CTO Review。全部模型遵循 §8 软删除语义。

### 4.1 CustomerPool（公海池定义——主数据风格）

- 职责：多公海的「池」定义；合同「具备多公海能力，支持根据区域、小组设定不同公海规则」。
- 关键字段：```id```、```code @unique```（池编码）、```name```、```description```、```scopeType```（```GLOBAL | REGION | DEPARTMENT```）、```scopeValue```（REGION→区域名；DEPARTMENT→departmentId；GLOBAL→null）、```isActive```、```version```、```approvalStatus```（对齐主数据 maker-checker 先例）、```createdById/updatedById/approvedById```、```deletedAt/createdAt/updatedAt```。
- 关系：```rules CustomerPoolRule[]```、```entries CustomerPoolEntry[]```。

### 4.2 CustomerPoolRule（流公海规则——主数据风格）

- 职责：合同「可根据企业需求设定流公海规则，触碰规则客户自动流入公海」。
- 关键字段：```id```、```poolId```、```ruleType```（```STATUS_MATCH``` 首版；```INACTIVITY``` 保留位，BLOCKED-UNTIL-PHASE-3）、```matchMode```（```ALL | ANY```）、```condition```（```Json```：```[{field, operator, value}]```，语法对齐 WorkflowCondition 先例 field/operator/value，见 schema L1772-1792）、```priority```（多池命中时仲裁）、```isActive```、```version```、```approvalStatus```、```createdById/updatedById/approvedById```、```deletedAt/createdAt/updatedAt```。
- 约束：ruleType=STATUS_MATCH 的 condition 字段**只允许 BusinessPartner 既有字段白名单**（type/region/industry/sourceChannel/isActive…）——防止规则引用不存在的字段（fail closed）。

### 4.3 CustomerPoolEntry（在池成员事实——业务事实风格）

- 职责：BusinessPartner 与池的成员关系 + 在池状态机（IN_POOL → CLAIMED → RELEASED）。
- 关键字段：```id```、```poolId```、```businessPartnerId```、```status```（```IN_POOL | CLAIMED | RELEASED```）、```enteredAt/enteredBy```、```enterReason```（```MANUAL | STATUS_RULE | RE_ENTER```）、```releasedAt/releasedBy```、```releaseReason```（```MANUAL | CLAIMED | RULE_RETURN | POOL_CHANGED | BP_INACTIVE```）、```isActive```、```version```、```createdById/updatedById```、```deletedAt/createdAt/updatedAt```。
- 关系：```pool CustomerPool```、```partner BusinessPartner```、```ownership CustomerOwnership?```。
- 不变量：一个客户同一时刻只在一个池（见 §5 I2）。

### 4.4 CustomerOwnership（权威客户归属事实——**必要**，核心不变量载体）

> **必要性判定**：§3.2 审计证明现有系统**无客户级权威 owner fact**（createdById 只是记录创建人；商机 ownerId 是可选子域）→ 按任务前提「仅当现有系统无权威 owner fact 时才需要」，**CustomerOwnership 必须新建**。它就是核心不变量的表。

- 职责：同一 BusinessPartner 唯一有效归属事实（谁拥有/谁负责该客户）；claim/release/reclaim 的完整时间线（事实流，可审计）。
- 关键字段：```id```、```businessPartnerId```、```entryId```（从哪个池条目 claim）、```ownerId```（→ User，归属人）、```claimedAt/claimedBy```、```releasedAt/releasedBy```、```releaseReason```（```RECLAIMED | RULE_RETURN | MANUAL_RELEASE | BP_INACTIVE```）、```isActive```（= releasedAt IS NULL 的冗余镜像，对齐全仓双标志）、```version```、```createdById/updatedById```、```deletedAt/createdAt/updatedAt```。
- 关系：```partner BusinessPartner```、```entry CustomerPoolEntry```、```owner User```。

### 4.5 模型关系总览

```
BusinessPartner 1 ─── * CustomerPoolEntry * ─── 1 CustomerPool
                        │ (status: IN_POOL|CLAIMED|RELEASED)
                        │ 1
                        └── 0..1 CustomerOwnership (releasedAt IS NULL = 有效)
                              └── 1 User (ownerId)
CustomerPool 1 ─── * CustomerPoolRule
```

> 备选简化：entry 与 ownership 合并为一张表（CLAIMED + ownerId 即归属）。本 ADR 选择两表——ownership 作为**归属事实流**（每次 claim/release 一行，保留完整历史，删除只允许纠错场景），entry 聚焦**池成员**；是否合并由 CTO 裁（Open Question OQ-3）。

---

## 5. 核心不变量与事务保证

### 5.1 不变量

| 编号 | 不变量 | 强制手段 |
|---|---|---|
| **I1（核心）** | **同一 BusinessPartner 同一时刻至多一个有效 CustomerOwnership**（有效 = releasedAt IS NULL AND deletedAt IS NULL） | partial unique index + claim 事务内行锁（§5.2/§7） |
| I2 | 同一 BusinessPartner 同一时刻至多一个有效 CustomerPoolEntry（有效 = status <> 'RELEASED' AND deletedAt IS NULL）——一个客户同时只在一个公海 | partial unique index |
| I3 | entry.status=CLAIMED ⟺ 存在对应有效 ownership（双向，同事务维护） | service 在 claim/release 事务内成对更新 |
| I4 | ownerId 必须是 active User；claim 仅允许 entry.status=IN_POOL | service 校验 + FK |
| I5 | 规则判定只读 BusinessPartner 既有字段（STATUS_MATCH 白名单） | rule condition schema 校验（fail closed） |

### 5.2 partial unique 写法（实施参考，对齐 Migration 0048 先例）

> Prisma DSL 无法表达 partial index，须手写 SQL（先例：prisma/migrations/0048_contact_management/migration.sql L16 的 ```PartnerContact_one_primary_per_partner```）。以下为 Design 层 SQL 契约，**非本轮落地**。

```sql
-- I1：核心归属唯一性
CREATE UNIQUE INDEX "CustomerOwnership_one_active_per_partner"
  ON "CustomerOwnership"("businessPartnerId")
  WHERE "releasedAt" IS NULL AND "deletedAt" IS NULL;

-- I2：同一客户同时只在一个池
CREATE UNIQUE INDEX "CustomerPoolEntry_one_active_per_partner"
  ON "CustomerPoolEntry"("businessPartnerId")
  WHERE "status" <> 'RELEASED' AND "deletedAt" IS NULL;

-- I2b：同一池内同一客户至多一条有效条目
CREATE UNIQUE INDEX "CustomerPoolEntry_one_active_per_pool_partner"
  ON "CustomerPoolEntry"("poolId", "businessPartnerId")
  WHERE "status" <> 'RELEASED' AND "deletedAt" IS NULL;
```

### 5.3 事务保证

- 所有状态迁移（enter / claim / release / reclaim / 规则回流）**MUST 在单个 ```$transaction``` 内完成**；```$transaction``` 与 ```casUpdate``` 先例见 §3.7。
- 并发双 claim → 行锁串行化；若仍撞 unique → Prisma P2002 → 映射 **409 POOL_CLAIM_CONFLICT**（错误码注册见 §10）。
- 后台批量（sweep/规则回流）MUST 遵循仓库锁序红线：collect IDs → deduplicate → sort → ```SELECT ... ORDER BY id FOR UPDATE```（根 AGENTS.md §3）。

---

## 6. 规则引擎取舍（无 scheduler 现状）

### 6.1 现状约束

无 scheduler / 无规则引擎（§3.4）；唯一后台执行先例 = 外部 cron 触发 HTTP 消费端点（domain-events/consume、inventory-ledger/consume）。

### 6.2 决策：写入即判定（同步、事件触发）+ 手动刷新端点

1. **共享判定服务** ```lib/customer-pool/rule-evaluator.ts```：输入 BusinessPartner 快照 + 激活池/规则 → 输出「应入池」结果（确定性、无外部调用、纯函数，必须配 unit test）。
2. **触发点（Phase 2C 主路径）**：```POST/PATCH /api/business-partners``` 写成功后**同步调用** rule-evaluator（在同一次请求内，不阻塞主档写入成败；判定失败仅记 AuditLog，可手动重跑）。合同「触碰规则客户自动流入公海」在此语义下成立：**客户状态字段一旦变化即被评估**。
3. **手动刷新端点**：```POST /api/customer-pool/sweep```（SYSTEM 权限 ```customer-pool:consume```，```FOR UPDATE SKIP LOCKED``` 分批，幂等——partial unique 兜底），供运维/外部 cron 触发全量重算。
4. 备选异步化：通过 Outbox 事件 + domain-events consumer 重算——基建已就绪（§3.5），但因 consumer 仍需外部 cron 触发，**Phase 2C 首版以同步判定为准，异步化留待平台 scheduler 就绪后**（OQ-4）。

### 6.3 规则范围（Phase 2C）

- 只支持基于 BusinessPartner 既有字段的判定：```type```（PartnerType CUSTOMER/BOTH）、```region```、```industry```、```sourceChannel```、```isActive```、```deletedAt IS NULL``` 等。
- 多池命中仲裁：按 ```rule.priority``` 取最高；仍并列 → **不自动入池，标记 MANUAL 待人工**（不猜测业务意图）。

### 6.4 明确排除（Phase 2C）

- **INACTIVITY（无跟进 N 天）规则 MUST NOT 在 Phase 2C 实现**：无 CRM Activity 事实源（§3.6）。ruleType 枚举保留 ```INACTIVITY``` 位并注释 ```BLOCKED-UNTIL-PHASE-3```；Phase 3 Activity 提供权威 ```lastActivityAt``` 后才启用。

---

## 7. 并发 claim（挑入）方案

**单客户 claim（主路径）**——单事务：

```
$transaction(tx):
  1. row = tx.customerPoolEntry.findFirst({ where: { businessPartnerId, status: 'IN_POOL', deletedAt: null } })
     -- 锁：SELECT ... FOR UPDATE（对 entry 行加锁，串行化同客户并发 claim）
  2. if (!row) → 409 POOL_ENTRY_NOT_CLAIMABLE（客户不在池/已被挑走）
  3. 校验 owner 用户 isActive + RBAC customer-pool:edit
  4. tx.customerOwnership.create({ businessPartnerId, entryId: row.id, ownerId, claimedAt: now, claimedBy: actor })
  5. tx.customerPoolEntry.update({ id: row.id, data: { status: 'CLAIMED' } })   -- I3 成对更新
  6. writeAuditLog('customer-ownership.claim') + Outbox 事件（同事务或事务后，见 §10）
-- DB 兜底：并发双 claim → CustomerOwnership_one_active_per_partner P2002 → 409 POOL_CLAIM_CONFLICT
```

**release / reclaim（回池）**：单事务内 ```ownership.releasedAt=now + entry.status=IN_POOL（或 RELEASED，若同时退出公海）``` + 审计。RULE_RETURN（触碰规则回流）同一模式，releaseReason=RULE_RETURN。

**批量场景（sweep / 规则回流）**：遵循仓库锁序红线（§5.3），用 ```FOR UPDATE SKIP LOCKED``` 分批 claim 候选（先例 domain-events/consumer.ts L62）。

---

## 8. 软删除兼容

- 四模型全部沿用 ```deletedAt``` + ```isActive``` 双标志；读取 MUST 过滤 ```deletedAt: null```（对齐 §3.8 全仓惯例）。
- partial unique 全部带 ```WHERE ... deletedAt IS NULL```（对齐 Migration 0048 L16 写法，§5.2）。
- **CustomerOwnership 正常生命周期用 ```releasedAt``` 关闭（事实保留，不删行）**；```deletedAt``` 仅限纠错场景（误 claim），且 MUST 写 AuditLog ```customer-ownership.correct```（beforeData/afterData 快照）。
- BusinessPartner 被软删（```deletedAt``` 非空 / ```isActive=false```）时，其有效 entry/ownership **MUST 被联动关闭**（同事务置 RELEASED，releaseReason=BP_INACTIVE）——防止「已删除客户仍占有效归属」。

---

## 9. RBAC 建议（复用现有体系，不新建第二套）

| 动作 | 权限映射 | 说明 |
|---|---|---|
| 查看池/规则/条目/归属 | ```customer-pool:view``` | 新模块；与 business-partner:view 并列 |
| 挑入 claim / 回池 release / 手动入池 enter / 规则配置 | ```customer-pool:edit``` | **对齐仓库「动作映射」先例**（submit→:edit / apply→:edit / execute→:edit，见 index.ts L246/L253/L293 注释），不新造 claim/release 权限动作 |
| 池/规则主数据管理 | ```customer-pool:create/edit/delete``` | 主数据 CRUD |
| 后台 sweep / 规则回流执行 | ```customer-pool:consume```（SYSTEM_PERMISSIONS） | 对齐 domain-event:consume 先例（index.ts L341；seed.ts SEED_SYSTEM_ACTION_PERMISSIONS L238-243），仅 SUPER_ADMIN/ADMIN 静态授权 |

**实施红线（DRIFT 防呆，ADR-0028）**：```customer-pool``` 模块 MUST 在**同一实现 PR**内同步注册于 ① packages/shared/src/constants/index.ts ```PERMISSION_MODULES``` ② prisma/seed.ts ```SEED_ACTION_MODULES```（+ ```SEED_SYSTEM_ACTION_PERMISSIONS``` 若含 consume）；API 引用的权限 MUST ⊆ ```ALL_ACTION_PERMISSIONS```（历史漂移教训见 index.ts L147-149/L173-174 注释）。

复用而不新建：business-partner（主档读写）、partner-contact（联系人）、audit（审计查询）、RBAC 基础设施本身。

---

## 10. Audit / Event / Error Code 落地约定（实施阶段）

| 基础设施 | 约定 | 证据/先例 |
|---|---|---|
| Audit 动作 | ```customer-pool.create/update/delete```、```customer-pool-rule.create/update/delete```、```customer-pool-entry.enter/claim/release/reclaim/auto-enter```、```customer-ownership.claim/release/correct```；全部走 writeAuditLog（best-effort） | api-helpers.ts L160-200 |
| Outbox 事件（EVENTS.md 注册） | ```CustomerPoolEntryEntered```、```CustomerPoolEntryClaimed```、```CustomerOwnershipReleased```、```CustomerPoolEntryReclaimed```（事件在业务事务内写入 Outbox，消费幂等由 idempotencyKey 保证） | schema L5608；consumer.ts L59-70 |
| 错误码（errors.ts SSOT） | ```POOL_NOT_FOUND```、```POOL_CODE_EXISTS```、```POOL_ENTRY_NOT_CLAIMABLE```、```POOL_CLAIM_CONFLICT```、```POOL_RULE_INVALID```、```CUSTOMER_ALREADY_OWNED``` → 运行 gen-error-codes.mjs 再生成 ERROR_CODES.md | docs/ERROR_CODES.md L3-4 |
| 并发冲突语义 | 唯一约束冲突 → **409**（对齐 BP 唯一冲突先例 route.ts L100-101）；CAS 冲突 → 409 VERSION_CONFLICT（对齐 [id]/route.ts L184） | — |

---

## 11. 明确禁止项（本轮与 Phase 2C 边界）

1. **本轮（Phase 2C-0）**：零 Schema / 零 Migration（**禁止创建 0049 Migration**）/ 零代码改动；只产出本 ADR + docs/SPRINTS/Phase2C0_Pool_Audit.md。
2. **Phase 2C 整体只允许 Design / ADR**（CTO 已定）；Schema/API/实现另开 Gate。
3. 禁止平行 Customer 体系：公海只引用 ```BusinessPartner.id```，禁止写 Legacy Customer（ADR-0050/0051）。
4. 禁止 INACTIVITY（无跟进 N 天）规则实现（§6.4）。
5. 禁止自动合并/自动删除 BusinessPartner（对齐 2B 查重「detect → explain → prompt → user decision，禁止自动合并」红线，docs/SPRINTS/Phase2B_Duplicate_Check_Design.md §7）。
6. 禁止本地运行 build/test/typecheck/lint 等验证（AGENTS.md CI-First）。

---

## 12. 影响 / 兼容性 / 未决问题（Open Questions）

**兼容性**：零破坏——四模型均为新表/新字段；BusinessPartner 不加字段（归属事实外置，符合 SSOT 冻结 ADR-0050）；Sales/Inventory/GL/BOM 冻结边界零改动（对齐 ADR-0052 §兼容性）。

**未决问题（供 CTO Review）**：

| # | 问题 | 建议 |
|---|---|---|
| OQ-1 | region 自由文本 → 区域规则匹配是否先做字典归一化？ | Phase 2C 先用字符串 EQ/IN 匹配；region 字典（DictionaryType/Item）归一化与 2B 查重联动，另开 Gate |
| OQ-2 | 「人员按权限周期可自由挑入」中的**周期限制**（每人最大持有数 / 冷却期）是否入 2C？ | Phase 2C 只做 RBAC 校验；持有数/冷却期需新规则维度 → HOLD（OQ 待 CTO 裁） |
| OQ-3 | entry 与 ownership 是否合并为一张表（简化）？ | 本 ADR 选两表（ownership=归属事实流）；CTO 可裁合并 |
| OQ-4 | 规则异步重算是否用 Outbox consumer？ | 基建就绪但依赖外部 cron 触发 → 首版同步判定，异步化待平台 scheduler |
| OQ-5 | CustomerPool/PoolRule 是否走 approvalStatus maker-checker？ | 建议复用（池/规则=配置主数据，对齐 BP L708 先例） |
| OQ-6 | 客户状态字段（「与客户状态衔接」）是否需要在 BusinessPartner 增加显式 status？ | 现状 type/isActive/approvalStatus 可表达；是否新增客户生命周期状态需产品确认（另开 Gate） |

---

## 13. 参考

- docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md §8（L101-106）、矩阵行 4（L119）
- docs/ROADMAP.md L33/L41/L42/L49
- docs/ADR/ADR-0050 / ADR-0051 / ADR-0052
- docs/SPRINTS/Phase2B_Duplicate_Check_Design.md（Design Gate 先例）
- prisma/schema.prisma（BusinessPartner L672-740 / User L284-314 / Department L317-331 / AuditLog L383-408 / PartnerContact L2909-2939 / ProjectVisit L1549-1572 / OutboxMessage L5602-5621 / WorkflowCondition L1772-1792）
- prisma/migrations/0048_contact_management/migration.sql L16（partial unique 先例）
- apps/web/src/lib/api/cas.ts；apps/web/src/lib/domain-events/consumer.ts；apps/web/src/lib/api-helpers.ts
- packages/shared/src/constants/index.ts；prisma/seed.ts
