# ADR-0020：Accounts Receivable Domain（应收领域模型边界与余额事实源决策）

- 状态：**Accepted + Implemented（2026-08-08，Sprint 4E-1 完成）**——CTO Review（2026-08-08，97/100 APPROVED WITH CHANGES）4 项 Pending 全部拍板 + 4 项必改已落地；Schema（0018）、Migration、Seed、RBAC、查询 API（5 端点）全部实现并通过 CI（PR #16）；等待 CTO Final Review 合并
- 日期：2026-08-08
- 关联：ADR-0015（Pricing Engine 唯一入口）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、ADR-0018（Delivery Domain）、ADR-0019（Invoice Domain）、Sprint4E1_AR_Design.md、EVENTS.md（v1.9 注册）、Sprint4D_Invoice_Design.md（已实现，PR #15 已合并）
- 背景：Sprint 4D Invoice Foundation 已合并（PR #15，cea4162）。Sprint 4E 进入应收/收款设计。CTO 启动令（2026-08-08）：**Invoice = 单据事实源；AccountsReceivable = 余额事实源；Invoice 上的 paidAmount/balanceAmount 只做投影回写**。本阶段仅设计（3 文件），不写代码；Receipt/Payment 属 4E-2，Credit/Debit Note 属 4E-3。
- **边界锁死（CTO 启动令）**：AR 唯一来源 Invoice（1:1，Invoice ISSUED 后自动创建——Pending ① 默认）；前端禁止 PATCH 金额；余额计算唯一口径 `balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`；OVERDUE 惰性判定（与 4A EXPIRED 同思路，不新增 Scheduler）；不建 Receipt/Payment/CN/DN/WriteOff/Adjustment 独立表（本阶段）。

## 决策

### 1. Invoice 是单据事实源，AR 是余额事实源（核心定位）

- **Invoice 持有单据事实**（开票金额、行快照、税务/汇率快照——4D 已完成）；Invoice 上的 `paidAmount/balanceAmount` 为投影（4E-2 Receipt 时回写，保持 4D 语义）。
- **AccountsReceivable 持有余额事实**：originalAmount / adjustedAmount / paidAmount / writeOffAmount / balanceAmount 全部在 AR 上维护，是余额的唯一事实来源。
- 职责分离：Invoice 不因收款而改变单据；AR 不涉及开票/行/税务（那些在 Invoice）。

### 2. Invoice 1:1 AccountsReceivable（唯一余额载体）

- `AccountsReceivable.invoiceId @unique`；一张 Invoice 至多一条 AR。
- 创建时机：Invoice ISSUED 后自动创建（Pending ①，默认：是）；originalAmount = invoiceTotal（复制，不重算）。
- 无独立创建入口（禁 POST /api/accounts-receivables 创建）；金额变动只能由下游动作/事实表驱动。

### 3. 余额计算唯一口径（禁止前端直写）

- `balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`
- 四个输入字段 + balanceAmount **全部禁止前端 PATCH**（schema 白名单无金额字段）；服务端唯一计算。
- 读算写必须同事务（锁 AR 行 FOR UPDATE 后计算回写），禁止事务外读算写（对齐 4C/4D 模式）。
- Decimal 全程（18,4）；Snapshot/Revision JSON 金额 `.toString()`，禁止 `toNumber()`。

### 4. AR 状态机与 OVERDUE 惰性判定（Pending ②）

- 状态：OPEN / PARTIALLY_PAID / PAID / OVERDUE / CLOSED。
- **OVERDUE 惰性投影（默认建议）**：storedStatus ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → effectiveStatus = OVERDUE；不落库、不新增 Scheduler（与 4A EXPIRED 惰性判定同思路）。
- Schema 是否保留 status/effectiveStatus 双字段 → Pending ② 拍板后确定（默认建议保留，API 返回 status/effectiveStatus/isOverdue）。

### 5. Write-off 不直接 PATCH AR（Pending ③）

- 默认建议：不直接改 AR；后续 4E-2 定义显式 WriteOff 动作或实体，聚合回写 `writeOffAmount`。
- 本阶段 Schema 只留 `writeOffAmount` 字段，动作在 4E-2 实现。

### 6. CN/DN 不直接改余额（Pending ④）

- 默认建议：Credit Note / Debit Note 先形成调整事实（4E-3 实体），再聚合到 `AR.adjustedAmount`。
- 本阶段 Schema 只留 `adjustedAmount` 字段，CN/DN 实体在 4E-3 实现；AR 快照类型预留 ADJUSTED。

### 7. 事件先注册后开发（EVENTS.md v1.9 注册）

- 注册 7 个 AR 事件：AccountsReceivableCreated / Updated / PartiallyPaid / Paid / Overdue / Adjusted / WrittenOff。
- 事件总线落地前以 AuditLog 留痕（与 4A-4D 一致）。

### 8. 模型边界锁定

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | AccountsReceivable / AccountsReceivableRevision / AccountsReceivableSnapshot | 3 模型（余额事实源 + 修订 + 快照） |
| ❌ 禁止（本阶段） | Receipt / Payment | 属 4E-2 |
| ❌ 禁止（本阶段） | CreditNote / DebitNote | 属 4E-3 |
| ❌ 禁止（本阶段） | WriteOff 独立表 | Pending ③ 后 4E-2 定义 |
| ❌ 禁止（本阶段） | Adjustment 独立表 | Pending ④ 后 4E-3 定义 |

### 9. 审批边界

- Receipt 本身不审批（建议）；金额较大的 CN/Write-off 可挂策略（4E-2/4E-3 再评估）。
- AR 不建审批表；若需要审批复用 ApprovalPolicy(module=ACCOUNTS_RECEIVABLE) → WorkflowInstance 投影（与 4A-4D 同构）。

## 10. CTO Pending Decisions（已全部拍板 + 4 项必改，CTO Review 2026-08-08，97/100 APPROVED WITH CHANGES）

| # | 问题 | **拍板结论** | 影响面 |
| --- | --- | --- | --- |
| ① | AR 是否在 Invoice ISSUED 时自动创建？ | **批准——自动创建，不延迟**（issue 同事务创建，失败整体回滚） | issue 路由事务扩展 + 双事件 |
| ② | OVERDUE 是数据库状态还是 effectiveStatus 惰性投影？ | **批准——Projection**（不落库、不新增 Scheduler，与 EXPIRED 一致） | Schema 保留 status/effectiveStatus 双字段 |
| ③ | write-off 直接作用 AR 还是独立实体？ | **批准——独立 WriteOff 实体（4E-2）**，不 PATCH AR | 本阶段只留 writeOffAmount |
| ④ | CN/DN 直接调整 AR 还是先生成调整事实？ | **批准——先生成 Adjustment 事实（4E-3）再更新 AR** | 本阶段只留 adjustedAmount |

### CTO 必改项（4 项，已全部纳入设计）

| # | 必改 | 落实 |
| --- | --- | --- |
| ① | **agingBucket 不存库**——改 effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，只依赖 today/dueDate/balance，属 Projection，不每天更新数据库） | Schema 删除 agingBucket 列；API 查询动态计算 |
| ② | **Snapshot 增加 snapshotSource**——枚举 ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL，Receipt/CN/DN/WriteOff 全部可复用 | Schema +AccountsReceivableSnapshotSource；快照模型加列 |
| ③ | **Invoice 删除保护**——Invoice → AR exists → 禁止删除（物理删 Restrict 保护；Invoice Cancel 也不删 AR，只能 CLOSED） | ADR §3.1 新决策（见下） |
| ④ | **Workflow 边界**——AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 明确属 Sprint 4E-2，避免后续重复讨论 | ADR §9 更新（见下） |

### 3.1 Invoice 删除保护（必改③，CTO Review 追加）

- Invoice → AR exists → **禁止删除 Invoice**（物理删 onDelete: Restrict 保护）。
- Invoice Cancel（4D 的 DRAFT→CANCELLED）也**不删除 AR**——AR 是财务历史，必须保留；若需终止只能走 CLOSED。

### 9.1 Workflow 边界锁定（必改④，CTO Review 追加）

- AR 本身不审批、不挂 ApprovalPolicy。
- **Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy**——明确属 Sprint 4E-2，本阶段不设计、不讨论。
- 未来如需审批（如大额 CN），复用 ApprovalPolicy(module=ACCOUNTS_RECEIVABLE) → WorkflowInstance 投影（4E-3 评估项）。

### 11. 事件补充（CTO Review 追加）

- 新增 `AccountsReceivableClosed`（余额=0 且生命周期结束 → CLOSED）；与 OPEN/PAID 区分——OPEN/PAID 只是余额状态。
- 应收事件共 8 个（EVENTS.md v1.9 注册）：Created / Updated / PartiallyPaid / Paid / Overdue / Adjusted / WrittenOff / **Closed**。

## 影响

- Sprint 4E-1 Schema（0018_accounts_receivable_foundation，拍板后实现阶段创建）：**+3 枚举（含 AccountsReceivableSnapshotSource）/ +3 表**，仅新增不改既有；**禁止修改 Invoice 表**（CTO 拍板：Migration 0018 只新增 TYPE/TABLE/FK/INDEX）。
- Invoice ISSUED 联动创建 AR（若 Pending ① 批准）——issue 路由事务扩展 + AR CREATED 快照/Revision + AccountsReceivableCreated 事件。
- 后续 4E-2（Receipt/Payment）、4E-3（CN/DN）、Sprint 5 采购、Sprint 7 财务引用本 ADR 与 ADR-0015~0019，禁止重新设计余额/核销。
