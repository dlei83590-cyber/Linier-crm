# Sprint 4E-1 QA — Accounts Receivable Foundation（应收领域：Schema/Migration 0018 + Seed/RBAC + 查询 API）

> Sprint：4E-1 | 模块：Accounts Receivable Foundation（已通过代码门禁） | PR：#16（feature/sprint4-sales，待验收合并） | 日期：2026-08-08
> 状态：✅ 代码门禁通过（CI 全绿：Phase 1 #31206666645 / Phase 2 #31206929056 / Phase 3 #31207456840）；文档收尾后交 CTO Final Review
> 关联：ADR-0020（Accounts Receivable Domain）、Sprint4E1_AR_Design.md、EVENTS.md v1.9、openapi.yaml（AR 5 端点）
> 架构原则（CTO Review 97/100 APPROVED WITH CHANGES 锁定）：
> ① **Invoice = 单据事实源；AccountsReceivable = 余额事实源**——Invoice 上 paidAmount/balanceAmount 仅投影回写；AR 持有真实余额；
> ② 拍板①：AR 在 Invoice ISSUED 时自动创建（同事务，不延迟；失败整体回滚）；
> ③ 拍板②：OVERDUE = effectiveStatus 惰性投影（不落库、不新增 Scheduler；与 Quotation EXPIRED 一致）；
> ④ 拍板③：WriteOff 走独立实体（4E-2 实现），不 PATCH AR——本阶段只留 writeOffAmount 字段；
> ⑤ 拍板④：CN/DN 先生成 Adjustment 事实（4E-3 实现）再聚合 AR.adjustedAmount——本阶段只留 adjustedAmount 字段；
> ⑥ 余额唯一口径：`balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（服务端唯一计算，前端禁止 PATCH 金额）；
> ⑦ 必改①：agingBucket 不存库——effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，只依赖 today/dueDate/balance，属 Projection）；
> ⑧ 必改②：Snapshot 增加 snapshotSource 来源枚举（ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL），Receipt/CN/DN/WriteOff 全部可复用；
> ⑨ 必改③：Invoice 删除保护——Invoice → AR exists → 禁止删除（Restrict）；Invoice Cancel 也不删 AR，只能 CLOSED；
> ⑩ 必改④：Workflow 边界——AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 明确属 4E-2，避免后续重复讨论；
> ⑪ Migration 0018 只新增 TYPE/TABLE/FK/INDEX，禁止修改 Invoice 表；
> ⑫ 不开发 4E-2（Receipt/Payment）/ 4E-3（CN/DN）——本阶段仅余额事实源 + 查询。

## 1. 交付范围

### 1.1 API（5 端点，均在 `apps/web/src/app/api/**`，全部只读）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 主档 | GET `/api/accounts-receivables` | 列表（分页 + customerId/status/effectiveStatus/currency/dueDateFrom/dueDateTo 过滤 + customer/invoice 摘要 + effectiveStatus/isOverdue/effectiveAgingBucket 惰性投影） |
| 查询 | GET `/api/accounts-receivables/aging` | 账龄分析（0-30/31-60/61-90/90+ + settled 聚合；惰性计算投影——必改①） |
| 主档 | GET `/api/accounts-receivables/{id}` | 详情（AR + Invoice/Customer 摘要 + 最近 Revision/Snapshot + 惰性投影） |
| 历史 | GET `/api/accounts-receivables/{id}/revisions` | 修订列表（只读，revisionNo desc） |
| 历史 | GET `/api/accounts-receivables/{id}/snapshots` | 快照列表（只读，generatedAt desc；含 snapshotSource——必改②） |

> **无 POST/PATCH**——AR 由 Invoice ISSUED 自动创建（拍板①），金额只能由 4E-2/4E-3 动作驱动（CTO 锁定）。

### 1.2 RBAC（权限码，动作级，零新造）
accounts-receivable:view / accounts-receivable-revision:view / accounts-receivable-snapshot:view
（seed 中 3 模块 × 10 动作自动生成，SEED_ACTION_MODULES 已注册 accounts-receivable / accounts-receivable-revision / accounts-receivable-snapshot）

### 1.3 Domain Events（EVENTS.md v1.9 注册 8 个）
本阶段已注册待实现：AccountsReceivableCreated / AccountsReceivableUpdated / AccountsReceivableOverdue（4E-1 查询/投影）
4E-2 待实现：AccountsReceivablePartiallyPaid / AccountsReceivablePaid / AccountsReceivableWrittenOff
4E-3 待实现：AccountsReceivableAdjusted
CTO Review 追加：AccountsReceivableClosed（余额=0 且生命周期结束 → CLOSED）

## 2. 测试要点（CTO Review 锁定项覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 无创建端点 | `POST /api/accounts-receivables` 不存在（404/405）；AR 由 Invoice ISSUED 自动创建（4E-1 未接 issue 联动，4E-2 前由设计保证） | 路由结构（无 POST） |
| T2 | 无金额 PATCH | `PATCH /api/accounts-receivables/:id` 不存在（404/405）；金额前端禁止直改 | 路由结构（无 PATCH） |
| T3 | 列表过滤 | GET 列表支持 customerId/status/effectiveStatus/currency/dueDateFrom/dueDateTo | accounts-receivables/route.ts |
| T4 | effectiveStatus 惰性过滤 | `?effectiveStatus=OVERDUE` → status∈{OPEN,PARTIALLY_PAID} 且 dueDate<now（查询时转换，不落库） | route.ts where 构造 |
| T5 | 惰性投影字段 | 列表/详情响应含 effectiveStatus/isOverdue/effectiveAgingBucket | projection.ts computeArProjection |
| T6 | 账龄不存库 | aging 桶 0-30/31-60/61-90/90+ 动态计算；Schema 无 agingBucket 列（必改①） | projection.ts + Migration 0018（无该列） |
| T7 | 余额唯一口径 | balanceAmount = original + adjusted - paid - writeOff（computeBalance 单入口） | projection.ts |
| T8 | Snapshot 来源枚举 | snapshots 列表返回 snapshotSource（ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL）（必改②） | [id]/snapshots/route.ts + Migration 0018 |
| T9 | Invoice 删除保护 | AR 存在时 Invoice 不可物理删（onDelete: Restrict）；Migration 无 DROP（必改③） | Migration 0018 FK |
| T10 | Workflow 边界 | AR 无审批表/无 workflow 集成；Receipt/WriteOff × ApprovalPolicy 属 4E-2（必改④） | Schema（无审批字段）+ ADR-0020 §9 |
| T11 | Migration 纯增量 | 只 CREATE TYPE/TABLE/INDEX/FK；禁 DROP/RENAME/TRUNCATE/改旧表（不动 Invoice） | Migration 0018 红线核验 |
| T12 | 权限 | 无 accounts-receivable:view → 403；revision/snapshot 各自权限码 | 各路由 requirePermission |
| T13 | 软删除隔离 | deletedAt 记录不出现在查询 | where deletedAt: null |
| T14 | 详情一次带出 | GET /:id 含 invoice/customer 摘要 + 最近 revision/snapshot | [id]/route.ts include |
| T15 | 分页 | page/pageSize 钳制 100 | parsePagination |

## 3. 状态机（设计确认，4E-1 仅投影）

```
Invoice ISSUED ──自动创建──▶ OPEN ──4E-2 部分收款──▶ PARTIALLY_PAID ──4E-2 收清──▶ PAID
                                │                        │
                                └──── 惰性投影 OVERDUE（dueDate < now，不落库）────┘
CLOSED：余额=0 且生命周期结束（CTO Review 追加事件 AccountsReceivableClosed）
```

## 4. 测试清单（测试用例详见 docs/test-cases/AccountsReceivable_API.md）

- [ ] 权限：accounts-receivable* / accounts-receivable-revision* / accounts-receivable-snapshot* 无权限 403
- [ ] 列表：分页 + 各过滤项 + effectiveStatus 惰性转换 + 摘要 + 投影字段
- [ ] 账龄：0-30/31-60/61-90/90+ 桶计算 + settled + totalBalance
- [ ] 详情：一次带出 invoice/customer + 最近 revision/snapshot + 投影
- [ ] 子资源：revisions desc / snapshots desc（含 snapshotSource）
- [ ] 边界：404 ACCOUNTS_RECEIVABLE_NOT_FOUND / 空列表 / 分页钳制 / 软删除隔离
- [ ] 红线：无 POST/PATCH / 无 agingBucket 列 / 无审批字段 / Migration 纯增量

## 5. 红线核验（Final Review checklist 前置）

- [x] 无 AR 创建/PATCH 端点（金额禁止前端直改）
- [x] 无 4E-2（Receipt/Payment）/ 4E-3（CN/DN）实现
- [x] 无 WriteOff / Adjustment 独立表（4E-2/4E-3 实现）
- [x] AR 无审批字段（Workflow 边界锁定——必改④）
- [x] agingBucket 不存库（effectiveAgingBucket 动态计算——必改①）
- [x] Snapshot 含 snapshotSource（必改②）
- [x] Invoice 删除保护（Restrict——必改③）
- [x] Migration 0018 纯增量（TYPE 3 / TABLE 3 / INDEX 11 / FK 4；0 违规；不动 Invoice）
- [x] Decimal 全程（18,4）；投影金额 Number 仅用于计算展示，不写库
