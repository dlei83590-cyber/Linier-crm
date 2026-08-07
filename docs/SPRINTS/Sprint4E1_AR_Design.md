# Sprint 4E-1：Accounts Receivable Design（应收领域 Schema 设计）

> 定位（CTO 启动令 2026-08-08）：**Invoice = 单据事实源；AccountsReceivable = 余额事实源；Invoice 上的 paidAmount/balanceAmount 只做投影回写**。
> **AR 是销售财务链第五环**（Quotation → SalesOrder → Delivery → Invoice → **AR** → Receipt → Credit Note）。
> 本阶段仅设计（3 文件），不写代码：`Sprint4E1_AR_Design.md` + `ADR-0020` + `EVENTS.md v1.9`。
> 边界锁死：**先不要创建 Migration 0018，也不要写 Payment/Receipt API**（4E-2/4E-3 后续阶段）。

---

## 1. 模型范围（CTO 锁定）

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | AccountsReceivable | 应收余额事实源（1:1 Invoice；持有余额计算全部输入，Invoice 只保留投影） |
| ✅ 新增 | AccountsReceivableRevision | 修改历史（唯一版本载体，余额相关变更时系统生成） |
| ✅ 新增 | AccountsReceivableSnapshot | 关键状态证据（仅固化节点：CREATED / PARTIALLY_PAID / PAID / ADJUSTED / WRITTEN_OFF / CLOSED） |
| ❌ 禁止 | Receipt / Payment | 属 4E-2（Receipt/Payment），本阶段只设计 AR 事实源 |
| ❌ 禁止 | CreditNote / DebitNote | 属 4E-3（CN/DN），本阶段只设计 AR 事实源 |
| ❌ 禁止 | WriteOff 独立表 | CTO 默认建议：write-off 后续走显式动作/实体（Pending Decision ③ 待拍板） |
| ❌ 禁止 | Adjustment 独立表 | CTO 默认建议：CN/DN 先形成调整事实再聚合到 AR（Pending Decision ④ 待拍板） |

**核心关系（CTO 锁定）：**
```
Invoice 1:1 AccountsReceivable
  │
  ├── AccountsReceivableRevision（1:N，余额变更留痕）
  └── AccountsReceivableSnapshot（1:N，关键节点固化）
```

**业务链（CTO 锁定）：**
```
Invoice（单据事实源）
  │ ISSUED 后
  ▼
AccountsReceivable（余额事实源）
  │ 后续 4E-2/4E-3 动作驱动
  ▼
balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount
```

---

## 2. Prisma Schema 草案（+2 枚举 / +3 模型；Migration 0018 规划，本阶段不创建）

```prisma
/// 应收状态（余额生命周期；OVERDUE 惰性判定，非数据库真实状态——Pending Decision ② 待拍板）
enum AccountsReceivableStatus {
  OPEN            // 未收款（余额 > 0 且未逾期）
  PARTIALLY_PAID  // 部分收款（0 < paidAmount < balance 且未逾期）
  PAID            // 已收清（balanceAmount = 0）
  OVERDUE         // 已逾期（惰性投影：OPEN/PARTIALLY_PAID + dueDate < now）
  CLOSED          // 已关闭（全额核销 / 全部 write-off / 手动关闭）
}

/// 应收快照类型（仅固化节点生成，只读）
enum AccountsReceivableSnapshotType {
  CREATED          // 创建时固化（ISSUED 后 AR 初始快照）
  PARTIALLY_PAID   // 部分收款时固化（4E-2 回写）
  PAID             // 收清时固化（4E-2 回写）
  ADJUSTED         // 金额调整时固化（4E-3 CN/DN 聚合后）
  WRITTEN_OFF      // 坏账核销时固化（Pending Decision ③ 后确定）
  CLOSED           // 关闭时固化
}

/// 应收（余额事实源；1:1 Invoice）
model AccountsReceivable {
  id           String   @id @default(cuid())
  invoiceId    String   @unique // 1:1 绑定 Invoice（单据事实源）；Invoice 软删防御
  invoice      Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  customerId   String   // 客户（继承 Invoice.customerId；对账用）
  customer     Customer @relation(fields: [customerId], references: [id], onDelete: Restrict)
  currency     String   @default("CNY") // 币种（继承 Invoice.currency）

  // 余额计算四输入（CTO 锁定：前端禁止 PATCH 这些金额）
  originalAmount Decimal @db.Decimal(18, 4) // 原始金额（= Invoice.invoiceTotal，AR 创建时复制）
  adjustedAmount Decimal @default(0) @db.Decimal(18, 4) // 调整金额（4E-3 CN/DN 聚合，可正可负）
  paidAmount     Decimal @default(0) @db.Decimal(18, 4) // 已收款（4E-2 Receipt 回写）
  writeOffAmount Decimal @default(0) @db.Decimal(18, 4) // 坏账核销金额（write-off 动作回写）

  // 余额（唯一计算口径，禁止手工写）
  balanceAmount  Decimal @db.Decimal(18, 4) // = originalAmount + adjustedAmount - paidAmount - writeOffAmount

  // 状态与账龄
  status     AccountsReceivableStatus @default(OPEN)
  effectiveStatus AccountsReceivableStatus // 惰性投影（OVERDUE 判定；Pending Decision ② 后确定是否保留双字段）
  dueDate    DateTime? @db.Timestamptz(3) // 到期日（继承 Invoice.dueDate；逾期判定基准）
  agingBucket String?  // 账龄区间（0-30/31-60/61-90/90+；查询时计算投影，可空）
  lastPaymentAt DateTime? @db.Timestamptz(3) // 最近收款时间（4E-2 回写）

  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  revisions AccountsReceivableRevision[]
  snapshots AccountsReceivableSnapshot[]

  @@index([customerId])
  @@index([status])
  @@index([dueDate])
  @@index([deletedAt])
}

/// 应收修订（余额变更留痕；系统生成，禁止手工编辑）
model AccountsReceivableRevision {
  id           String   @id @default(cuid())
  accountsReceivableId String
  accountsReceivable AccountsReceivable @relation(fields: [accountsReceivableId], references: [id], onDelete: Cascade)
  revisionNo   Int
  changeReason String
  snapshotData Json?    // 当前余额状态快照（金额 Decimal 字符串，禁止 toNumber）
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([accountsReceivableId, revisionNo])
  @@index([accountsReceivableId])
  @@index([deletedAt])
}

/// 应收快照（关键节点固化；金额 Decimal 字符串）
model AccountsReceivableSnapshot {
  id           String   @id @default(cuid())
  accountsReceivableId String
  accountsReceivable AccountsReceivable @relation(fields: [accountsReceivableId], references: [id], onDelete: Cascade)
  snapshotType AccountsReceivableSnapshotType
  revisionNo   Int
  snapshotData Json?    // 完整快照（Header + 四金额输入 + balanceAmount + customerId/currency/dueDate；Decimal 字符串）
  generatedById String?
  generatedAt  DateTime @default(now()) @db.Timestamptz(3)
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([accountsReceivableId, snapshotType])
  @@index([accountsReceivableId])
  @@index([deletedAt])
}
```

**关键设计点（CTO 锁定）：**
- `invoiceId @unique` → Invoice 1:1 AR；同一 Invoice 不会存在多个 AR 余额记录
- 金额字段全部 `Decimal(18,4)`；前端**禁止 PATCH** originalAmount/adjustedAmount/paidAmount/writeOffAmount/balanceAmount（schema 无这些字段的 PATCH 白名单）
- `balanceAmount` 由服务端唯一计算：`originalAmount + adjustedAmount - paidAmount - writeOffAmount`
- Invoice 上的 `paidAmount/balanceAmount` 保持 4D 投影不变（4E-2 Receipt 时回写投影），AR 持有真实余额

---

## 3. AR ERD

```mermaid
erDiagram
    Invoice ||--|| AccountsReceivable : balances
    Customer ||--o{ AccountsReceivable : owes
    AccountsReceivable ||--o{ AccountsReceivableRevision : versions
    AccountsReceivable ||--o{ AccountsReceivableSnapshot : snapshots

    AccountsReceivable {
        string id PK
        string invoiceId FK UK
        string customerId FK
        string currency
        Decimal originalAmount
        Decimal adjustedAmount
        Decimal paidAmount
        Decimal writeOffAmount
        Decimal balanceAmount
        AccountsReceivableStatus status
        AccountsReceivableStatus effectiveStatus
        datetime dueDate
        string agingBucket
        datetime lastPaymentAt
        int version
        datetime deletedAt
    }

    AccountsReceivableRevision {
        string id PK
        string accountsReceivableId FK
        int revisionNo
        string changeReason
        Json snapshotData
        datetime deletedAt
    }

    AccountsReceivableSnapshot {
        string id PK
        string accountsReceivableId FK
        AccountsReceivableSnapshotType snapshotType
        int revisionNo
        Json snapshotData
        string generatedById
        datetime generatedAt
        datetime deletedAt
    }
```

### 关系与约束（Migration 0018 规划，本阶段不创建）

| 关系 | 基数 | onDelete | 说明 |
| --- | --- | --- | --- |
| Invoice → AccountsReceivable | 1:1 | Restrict | 单据事实源 → 余额事实源；有 AR 的发票不可物理删 |
| Customer → AccountsReceivable | 1:N | Restrict | 客户对账 |
| AR → ARRevision | 1:N | Cascade | 修订历史随记录 |
| AR → ARSnapshot | 1:N | Cascade | 快照随记录 |

- `AccountsReceivable.invoiceId @unique`（1:1）；`ARRevision @@unique([accountsReceivableId, revisionNo])`；`ARSnapshot @@unique([accountsReceivableId, snapshotType])`

---

## 4. 状态机（Sprint 4E-1）

```
（Invoice ISSUED 后自动创建 AR——Pending Decision ①，默认：是）
                    ┌──────────────┐
  Invoice ISSUED ──►│  OPEN        │
                    └──────┬───────┘
                           │ 4E-2 部分收款
                           ▼
                    ┌──────────────┐
                    │ PARTIALLY_   │
                    │ PAID         │
                    └──────┬───────┘
                           │ 4E-2 收清
                           ▼
                    ┌──────────────┐
                    │ PAID         │
                    └──────────────┘

  OPEN/PARTIALLY_PAID + dueDate < now ──惰性投影──▶ OVERDUE（Pending Decision ②）
  CLOSED：全额核销 / 全部 write-off / 手动关闭（4E-2/4E-3 动作驱动）
```

| 规则 | 说明 |
| --- | --- |
| 创建 | Invoice ISSUED 后自动创建 AR（Pending Decision ①，默认：是）；originalAmount = invoiceTotal；balanceAmount = originalAmount；status = OPEN |
| OPEN → PARTIALLY_PAID | 4E-2 Receipt 部分核销回写（本阶段不实现，枚举保留） |
| → PAID | 4E-2 收清回写（本阶段不实现，枚举保留） |
| → OVERDUE | **惰性判定**：storedStatus ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → effectiveStatus = OVERDUE（与 4A EXPIRED 同思路，不新增 Scheduler，Pending Decision ② 待拍板：数据库状态 or effectiveStatus 惰性投影） |
| → CLOSED | 全额核销 / 全部 write-off / 手动关闭（4E-2/4E-3 动作驱动） |
| 金额调整 | 4E-3 CN/DN 聚合到 adjustedAmount（不直接改余额，先形成调整事实——Pending Decision ④） |
| Write-off | 4E-2 显式动作/实体（Pending Decision ③） |

---

## 5. 数据来源（CTO 锁定）

- **AR 唯一来源 Invoice**：`POST /api/invoices/{id}/issue` 成功后自动创建（Pending Decision ①）；无独立创建入口
- `originalAmount` = Invoice.invoiceTotal（复制，不重算）；`customerId/currency/dueDate` 继承 Invoice
- 所有金额变动（paid/writeOff/adjust）**禁止前端直写**，必须由 4E-2 Receipt / 4E-3 CN/DN 动作或下游事实表驱动

---

## 6. 金额原则（CTO 锁定）

- **唯一计算口径**：`balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`
- Decimal 全程（18,4）；Snapshot/Revision JSON 金额一律 `.toString()`，禁止 `toNumber()`
- 前端禁止 PATCH 任何金额字段（schema 白名单无金额）；余额只读投影
- AR 不调用 Pricing Engine（价格到 SO 为止，ADR-0015；金额到 Invoice 为止，ADR-0019）

---

## 7. 事务规则（并发安全核心，4E-1 阶段规划）

### 7.1 创建 AR（Invoice ISSUED 联动）

- 与 issue 同一事务（Pending Decision ① 默认：是）：FOR UPDATE 锁 Invoice → 取号 → ISSUED → **创建 AR（originalAmount = invoiceTotal，balanceAmount = originalAmount，status = OPEN）** → ISSUED 快照 → AR CREATED 快照 + Revision → 双事件（InvoiceIssued + AccountsReceivableCreated）
- 若 AR 创建失败 → 整体回滚（Invoice 不落 ISSUED，避免"已开票无余额"状态）

### 7.2 并发场景（必须覆盖，4E-1 阶段仅规划）

- 并发 issue 同一 Invoice → 已由 4D 锁保护（第二个 409）；AR 随之只创建一次（invoiceId @unique 兜底 P2002 → 409）
- 余额读算写必须在同一事务内（锁 AR 行 FOR UPDATE 后读 → 计算 → 写回），禁止事务外读算写（对齐 4C/4D 模式）

---

## 8. Workflow / Approval 设计（4E-1 阶段规划）

- **Receipt 本身不审批**（建议）；金额较大的 CN/Write-off 可挂策略（4E-2/4E-3 再评估，Pending CTO）
- AR 本身不建审批表；若后续需要审批，复用 ApprovalPolicy(module=ACCOUNTS_RECEIVABLE) → WorkflowInstance 投影（与 4A-4D 完全同构，不新建表）

---

## 9. Domain Events 设计（先注册后开发，EVENTS.md v1.9）

| eventType | 触发时机 | 实现状态 |
| --- | --- | --- |
| `AccountsReceivableCreated` | Invoice ISSUED 后自动创建 AR | ⏳ 注册待实现（4E-1） |
| `AccountsReceivableUpdated` | 头/状态变更（非金额动作类） | ⏳ 注册待实现（4E-1） |
| `AccountsReceivablePartiallyPaid` | 4E-2 部分收款回写 | ⏳ 注册待实现（4E-2） |
| `AccountsReceivablePaid` | 4E-2 收清 | ⏳ 注册待实现（4E-2） |
| `AccountsReceivableOverdue` | 惰性判定 OVERDUE | ⏳ 注册待实现（4E-1 投影查询） |
| `AccountsReceivableAdjusted` | 4E-3 CN/DN 聚合调整 | ⏳ 注册待实现（4E-3） |
| `AccountsReceivableWrittenOff` | 4E-2 write-off | ⏳ 注册待实现（4E-2） |

> 全部先注册（CTO 启动令：先注册后开发）；事件总线落地前以 AuditLog 留痕（与 4A-4D 一致）。

---

## 10. Migration 0018 规划（本阶段不创建）

- **+2 枚举**：AccountsReceivableStatus / AccountsReceivableSnapshotType
- **+3 表**：AccountsReceivable / AccountsReceivableRevision / AccountsReceivableSnapshot
- 纯增量：CREATE TYPE/TABLE + INDEX + FK + 唯一约束；**零 DROP/RENAME/TRUNCATE/改旧字段**
- 不新增 Invoice 列（4D 已有 paidAmount/balanceAmount 投影；AR 独立持余额）

---

## 11. RBAC 规划

- +3 模块：accounts-receivable / accounts-receivable-revision / accounts-receivable-snapshot（SEED_ACTION_MODULES 注册，复用 10 动作自动生成）
- 动作映射：view（列表/详情/查询）→ `accounts-receivable:view`；revision/snapshot 只读 → `accounts-receivable-revision:view` / `accounts-receivable-snapshot:view`
- 金额动作（4E-2/4E-3）后续阶段再映射（apply→approve、write-off→close 等）

---

## 12. API 清单（Sprint 4E-1 仅规划，不实现）

| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 主档 | GET `/api/accounts-receivables` | 列表（分页 + customerId/status/effectiveStatus/currency/dueDateFrom/dueDateTo/agingBucket 过滤） |
| 主档 | GET `/api/accounts-receivables/{id}` | 详情（含 invoice/customer 摘要 + revisions/snapshots 最近一条） |
| 历史 | GET `/api/accounts-receivables/{id}/revisions` | 修订列表（只读） |
| 历史 | GET `/api/accounts-receivables/{id}/snapshots` | 快照列表（只读） |
| 查询 | GET `/api/accounts-receivables/aging` | 账龄分析（0-30/31-60/61-90/90+ 汇总；惰性计算投影） |

> 无 POST/PATCH 创建与金额修改端点——AR 由 Invoice ISSUED 自动创建，金额只能由 4E-2/4E-3 动作驱动。

---

## 13. CTO Pending Decisions（4 项待拍板）

| # | 问题 | **默认建议（CTO 启动令）** | 影响面 |
| --- | --- | --- | --- |
| ① | **AR 是否在 Invoice ISSUED 时自动创建？** | **是**——issue 同事务自动创建 AR（originalAmount = invoiceTotal，status=OPEN）；无独立创建入口 | issue 路由事务扩展 + AR CREATED 快照/Revision + 双事件；创建失败整体回滚 |
| ② | **OVERDUE 是数据库状态还是 effectiveStatus 惰性投影？** | **惰性投影**——storedStatus ∈ {OPEN, PARTIALLY_PAID} + dueDate < now → effectiveStatus = OVERDUE（与 4A EXPIRED 同思路，不新增 Scheduler） | Schema 是否保留 status/effectiveStatus 双字段；API 返回 status/effectiveStatus/isOverdue |
| ③ | **write-off 是否允许直接作用 AR，还是必须通过独立 WriteOff 实体？** | **不直接 PATCH AR**——后续走显式动作/实体（4E-2 定义 WriteOff 动作或实体） | 4E-1 Schema 只留 writeOffAmount 字段；动作在 4E-2 实现 |
| ④ | **Credit Note / Debit Note 是直接调整 AR，还是先生成 Adjustment 事实再影响 AR？** | **不直接改余额**——CN/DN 先形成调整事实（4E-3 实体），再聚合到 AR.adjustedAmount | 4E-1 只留 adjustedAmount 字段；CN/DN 实体在 4E-3 实现 |

---

## 14. 开发顺序（固定，不可跳步）

**Design（本文档）→ CTO Review（4 项 Pending 拍板）→ Schema → Migration 0018 → Seed → RBAC → API（查询/只读）→ Workflow（如需）→ OpenAPI → QA → Test Cases → ADR/ERD/EVENTS 同步 → CI → CTO Final Review → Merge**

> 4E-2（Receipt/Payment）与 4E-3（CN/DN）在 4E-1 合并后启动。

---

## 15. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-08 | v1.0 | Sprint 4E-1 Accounts Receivable 设计初稿（CTO 启动令锁定：AR = 余额事实源 + Invoice 1:1 + 三模型 + 余额唯一计算口径 + 7 事件先注册 + 4 项 Pending Decisions + 禁 Migration 0018 / 禁 Payment-API） |
