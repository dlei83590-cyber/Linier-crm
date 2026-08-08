# CTO Final Review Cover — Sprint 4E-1 Accounts Receivable Foundation

**PR:** #16 – Accounts Receivable Foundation
**Branch:** `feature/sprint4-sales`
**Head:** `0dcaa35`
**Status:** APPROVED & MERGED（PR #16，squash `f58fd87`，2026-08-08）

## 1. Scope

本 PR 完成 Sprint 4E-1 Accounts Receivable Foundation 全部计划范围：

- Accounts Receivable Domain（余额事实源）
- Schema + Migration 0018
- Seed + RBAC
- Query APIs（列表/详情/aging/revisions/snapshots）
- 惰性投影（effectiveStatus / effectiveAgingBucket）
- OpenAPI
- QA
- Test Cases
- ADR
- ERD
- Domain Events

**未包含：**

- Receipt / Payment（Sprint 4E-2）
- Credit Note / Debit Note（Sprint 4E-3）
- WriteOff 独立实体（4E-2）
- Adjustment 独立实体（4E-3）
- AR 创建/金额修改端点（Invoice ISSUED 自动创建；金额由 4E-2/4E-3 动作驱动）
- 修改 Invoice 表（Migration 0018 只新增，CTO 拍板）

## 2. Architecture Verification

### Domain Boundary

- **Invoice = 单据事实源；AccountsReceivable = 余额事实源**。
- Invoice 上 `paidAmount / balanceAmount` 仅投影回写（4D 语义不变）。
- AR 唯一来源 Invoice（1:1，`invoiceId @unique`）。

### Balance Formula（唯一口径）

```
balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount
```

- 服务端唯一计算（`computeBalance` 单入口）。
- 前端禁止 PATCH 金额（无 PATCH 端点）。
- 金额变动只能由 4E-2 Receipt / WriteOff、4E-3 CN/DN 动作或下游事实表驱动。

### OVERDUE（惰性投影，拍板②）

```
storedStatus ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now
    → effectiveStatus = OVERDUE
```

- 不落库、不新增 Scheduler（与 Quotation EXPIRED 一致）。
- API 返回 `status / effectiveStatus / isOverdue`。

### Aging（不存库，必改①）

- `effectiveAgingBucket` 读取时动态计算（0-30 / 31-60 / 61-90 / 90+），只依赖 today/dueDate/balance。
- 属 Projection，不每天更新数据库。

### Snapshot Source（必改②）

- `snapshotSource` 来源枚举：ISSUE / PAYMENT / WRITE_OFF / ADJUSTMENT / MANUAL。
- Receipt / CN / DN / WriteOff 全部可复用。

### Invoice 删除保护（必改③）

- Invoice → AR exists → **禁止删除**（`onDelete: Restrict`）。
- Invoice Cancel 也不删 AR（只能 CLOSED）。

### Workflow 边界（必改④）

- AR 不审批、不建审批表。
- **Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 明确属 Sprint 4E-2**（避免后续重复讨论）。

## 3. Quality Gates

- CI：Quality Gates ✅ / Build ✅ / Secret Scanning ✅
- Head：`0dcaa35`（全链路 CI 全绿：#31208182363）

## 4. Documentation

完成：OpenAPI（5 端点 / 13 schemas，161 paths / 423 schemas）/ QA（Sprint4E1_QA.md，T1-T15）/ Test Cases（AccountsReceivable_API.md，76 用例 A-H 8 组）/ DOMAIN_MODEL（v1.12，第 23 章）/ ADR-0020（Accepted + Implemented）/ EVENTS（v1.9，8 事件），全部与实现一致。

## 5. CTO Checklist

| Item | Status |
| --- | --- |
| Invoice = 单据事实源 / AR = 余额事实源（1:1） | ✅ |
| 余额唯一口径（original+adjusted-paid-writeOff，单入口） | ✅ |
| 前端禁止 PATCH 金额（无 PATCH 端点） | ✅ |
| AR 唯一来源 Invoice（ISSUED 自动创建，拍板①） | ✅ |
| OVERDUE 惰性投影（不落库、无 Scheduler，拍板②） | ✅ |
| agingBucket 不存库（effectiveAgingBucket 动态计算，必改①） | ✅ |
| Snapshot snapshotSource 来源枚举（必改②） | ✅ |
| Invoice 删除保护（Restrict，必改③） | ✅ |
| Workflow 边界（AR 不审批；Receipt/WriteOff × ApprovalPolicy 属 4E-2，必改④） | ✅ |
| WriteOff 独立实体 / CN-DN Adjustment 事实（拍板③④，本阶段只留字段） | ✅ |
| Migration 0018 纯增量（TYPE 3/TABLE 3/INDEX 11/FK 4；不动 Invoice） | ✅ |
| 无 4E-2 / 4E-3 越界实现（无 Receipt/CN/DN/WriteOff/Adjustment 端点与表） | ✅ |

## 6. Review Result

**Recommendation: APPROVE & MERGE — 已执行（2026-08-08）**

CTO Final Review：**98/100 APPROVE & MERGE ✅（Blocking Issues：0）**

- 核心架构复核 12 项全 PASS（Invoice=单据事实源/AR=余额事实源、1:1、余额唯一口径、禁 PATCH、OVERDUE 惰性、aging 动态、Snapshot 可追溯、Invoice 删除保护、AR 不审批、WriteOff/Receipt/CN/DN 无越界、Migration 0018 纯增量）
- `snapshotSource = ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL` 保留，为 4E-2/4E-3 提供统一 AR 历史入口
- 数据边界锁死：`Invoice.paidAmount/balanceAmount` = Projection；`AR.paidAmount/writeOffAmount/adjustedAmount/balanceAmount` = Source of Truth；4E-2 起不出现第二套余额事实

Merge 后执行（已完成）：

1. ✅ Merge PR #16（squash `f58fd87`）
2. ✅ 更新 CHANGELOG（Ready → Completed/已合并）
3. ✅ 更新 RELEASE_NOTES（MERGED）
4. ✅ 更新 ROADMAP（4E-1 ✅，v1.12，成熟度 ≈87%）
5. ✅ 保留 `feature/sprint4-sales`
6. ✅ 进入 **Sprint 4E-2 – Receipt & Payment Allocation Design**（2026-08-08 启动）
