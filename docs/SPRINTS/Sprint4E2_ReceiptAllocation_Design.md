# Sprint 4E-2：Receipt & Payment Allocation Design（收款与核销领域设计）

> 定位（CTO Final Review 2026-08-08，Sprint 4E-1 APPROVE & MERGE 98/100 后启动）：**Receipt = 收款事实源**；
> **AccountsReceivable = 余额事实源（唯一）**；Invoice 上 `paidAmount/balanceAmount` 保持投影回写。
> 本阶段仅设计（3 文件），不写代码：`Sprint4E2_ReceiptAllocation_Design.md` + `ADR-0021` + `EVENTS.md v1.10`。
> 边界锁死：**先不要创建 Migration 0019，也不要写 Receipt / WriteOff API**（4E-2 实现阶段后续）。
> **CTO 启动边界（2026-08-08 Final Review）**：Receipt 是收款事实源，**不要把 Payment 和 Receipt 做成两个重复的入账事实**；
> Allocation 必须 **M:N**；核销必须锁 AR（**ID ASC + FOR UPDATE**）；`allocatedAmount ≤ AR.balanceAmount` 并发下仍必须成立；
> **Write-off 独立事实**，不允许直接 PATCH `AR.writeOffAmount`；审批边界：普通 Receipt 不审批，WriteOff 根据 ApprovalPolicy 条件触发 Workflow。

---

## 1. 模型范围（CTO 锁定）

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | Receipt | 收款事实源（唯一入账事实；**Payment 不单独建表**——CTO 明确禁止两个重复入账事实，Payment 仅作为语义别名/视图概念存在） |
| ✅ 新增 | ReceiptAllocation | 核销中间表（M:N：Receipt ↔ AR；一次收款可核销多张 AR，一张 AR 可被多次收款核销） |
| ✅ 新增 | ReceiptRevision | 修改历史（唯一版本载体，收款信息变更时系统生成） |
| ✅ 新增 | ReceiptSnapshot | 关键状态证据（仅固化节点：CREATED / ALLOCATED / VOID；snapshotSource 复用 4E-1 枚举） |
| ✅ 新增 | WriteOff | 坏账/折让独立事实实体（不 PATCH AR.writeOffAmount；APPLIED 后服务端原子回写） |
| ⏳ Pending | WriteOffRevision / WriteOffSnapshot | WriteOff 三件套是否齐全（Pending ③，默认建议：是，对齐事实源标准） |
| ❌ 禁止 | Payment 独立表 | 与 Receipt 重复入账事实（CTO 拍板） |
| ❌ 禁止 | CreditNote / DebitNote | 属 4E-3（CN/DN），本阶段不进入 |
| ❌ 禁止 | Adjustment 独立表 | 属 4E-3（CN/DN 先形成调整事实再影响 AR） |
| ❌ 禁止 | PATCH AR / Invoice 金额 | 金额变动只能由核销/WriteOff/4E-3 动作或下游事实表驱动 |

**核心关系（CTO 锁定）：**
```
Receipt（收款事实源）
  │ 1:N
  ▼
ReceiptAllocation（M:N 核销中间表，allocatedAmount ≤ AR.balanceAmount）
  │ N:1
  ▼
AccountsReceivable（余额事实源，唯一）
  ▲ 1:1
  │
Invoice（单据事实源，paidAmount/balanceAmount 仅投影）

WriteOff（独立事实实体，审批后 APPLIED）
  │ N:1
  ▼
AccountsReceivable（APPLIED 时服务端回写 writeOffAmount，不 PATCH）
```

**业务链（销售财务闭环）：**
```
Invoice（单据事实源，4D）
  │ ISSUED 后自动创建
  ▼
AccountsReceivable（余额事实源，4E-1）
  ▲
  │ 核销（ReceiptAllocation）／写销（WriteOff）
  │
Receipt（收款事实源，4E-2）   WriteOff（独立事实，4E-2）
  └── Payment Allocation（M:N）──┘
```

---

## 2. 事实源边界（CTO 锁死，与 4E-1 一致）

```
Invoice.paidAmount / Invoice.balanceAmount
    = Projection（4D 语义不变，4E-2 核销时同步回写）

AccountsReceivable.paidAmount
AccountsReceivable.writeOffAmount
AccountsReceivable.adjustedAmount
AccountsReceivable.balanceAmount
    = Source of Truth（唯一余额事实）
```

- **锁死：4E-2 起不允许出现第二套余额事实。**
- Receipt 持有收款事实（金额/币种/方式/日期/客户/流水号），**不持有余额**。
- 余额唯一口径不变：`balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（服务端 computeBalance 单入口）。

---

## 3. Receipt 模型草案

```
Receipt {
  id
  code                 // 编号（Pending ④：建议 DocumentSequence，REC-2026-xxxx）
  customerId           // BusinessPartner
  currency
  totalAmount          // 收款总额（Decimal 18,4）
  receivedAt           // 收款日期
  paymentMethod        // 枚举：BANK_TRANSFER / CHEQUE / CASH / CARD / OTHER
  referenceNo          // 银行流水号/备注，可空
  status               // ReceiptStatus：DRAFT / PARTIALLY_ALLOCATED / ALLOCATED / VOID
  balanceAmount        // 未核销余额 = totalAmount - Σ allocatedAmount（服务端计算）
  version
  // allocations: ReceiptAllocation[]
}
```

**ReceiptStatus 状态机（草案）：**
```
DRAFT ──allocate──> PARTIALLY_ALLOCATED ──allocate──> ALLOCATED（余额=0）
  │                       │
  └───────void────────────┴──────────> VOID（Pending ②：仅未核销/全额可逆场景）
```
- `PARTIALLY_ALLOCATED`：部分核销，剩余金额保留在 Receipt.balanceAmount，可继续核销（Pending ⑤）。
- Receipt **不审批**（CTO 锁定：普通 Receipt 不引入审批体系）。

---

## 4. ReceiptAllocation：M:N 核销中间表（CTO 锁定）

```
ReceiptAllocation {
  id
  receiptId                // 收款
  accountsReceivableId     // 应收
  allocatedAmount          // 本次核销金额（Decimal 18,4）
  allocatedAt
  allocatedBy
  // unique (receiptId, accountsReceivableId) —— 同一收款对同一 AR 只核销一次（Pending ① 默认建议）
}
```

**M:N 语义（CTO 锁死）：**
- 一个 Receipt → 多 AR：一次收款核销多张 Invoice 的应收（`allocations[]` 批量）。
- 一个 AR → 多 Receipt：一张 Invoice 分多次收款。

**核销动作（锁序，CTO 锁死——ID ASC + FOR UPDATE）：**
```
POST /api/receipts/{id}/allocate  （或创建时原子核销，Pending ①）
  1. 按 accountsReceivableId 升序锁定全部目标 AR 行（FOR UPDATE，对齐 4C/4D 锁序防死锁）
  2. 锁内重读 AR.balanceAmount
  3. 校验 Σ(该 AR 已核销累计 + 本次 allocatedAmount) ≤ AR.balanceAmount
       → 否则 409 RECEIPT_ALLOCATION_EXCEEDED（防超核销，对齐 4C 防超交/4D 防超开票）
  4. AR.paidAmount += allocatedAmount；computeBalance 重算 balanceAmount
  5. AR 状态推进：OPEN → PARTIALLY_PAID → PAID（余额=0 且生命周期结束 → CLOSED）
  6. 回写 Invoice 投影（paidAmount/balanceAmount）
  7. AR Revision + Snapshot(snapshotSource=PAYMENT)
  8. 事件发布（ReceiptAllocated / AR PartiallyPaid|Paid / Invoice 投影事件）
```

**并发保证（CTO 锁死）：** `allocatedAmount ≤ AR.balanceAmount` 在锁内校验 + 锁内重算，事务提交前锁不释放 → 并发核销串行化，条件始终成立。

---

## 5. WriteOff：独立事实实体（CTO 锁死）

```
WriteOff {
  id
  code                    // 编号（Pending ④：建议 DocumentSequence，WO-2026-xxxx）
  accountsReceivableId    // 目标应收
  amount                  // 写销金额（Decimal 18,4）
  reason                  // 原因：坏账/折让/其他
  writeOffDate
  status                  // WriteOffStatus：DRAFT / SUBMITTED / APPROVED / REJECTED / APPLIED
  approvalPolicyId        // 可空；有值则条件触发 Workflow
  workflowInstanceId      // 复用 Workflow（不建 WriteOffApproval 表）
  appliedAt / appliedBy
}
```

**状态机（草案）：**
```
DRAFT ──submit──> SUBMITTED ──(无审批策略)──> APPLIED（服务端回写 AR）
                    │
                    ├──(有审批策略)──> APPROVED ──apply──> APPLIED
                    └──────────────> REJECTED ──> DRAFT（修改重提）
```

**APPLIED 动作（锁序对齐核销）：**
```
1. 锁 AR（FOR UPDATE，ID ASC）
2. 校验 amount ≤ AR.balanceAmount → 否则 409 WRITE_OFF_EXCEEDED
3. AR.writeOffAmount += amount；computeBalance 重算
4. 余额=0 且生命周期结束 → AR CLOSED
5. 回写 Invoice 投影；AR Revision + Snapshot(snapshotSource=WRITE_OFF)
6. 事件发布（WriteOffApplied / AccountsReceivableWrittenOff / Closed）
```

**红线：禁止直接 PATCH `AR.writeOffAmount` / `AR.balanceAmount`。**

---

## 6. 审批边界（CTO 锁定）

| 对象 | 审批 | 说明 |
| --- | --- | --- |
| Receipt（普通收款） | ❌ 不审批 | 收款入账即时生效，不引入审批体系（与 AR 不审批一致） |
| WriteOff | ✅ 条件审批 | `approvalPolicyId` 可空；有值 → 按 ApprovalPolicy 创建 WorkflowInstance（复用 Workflow，不建新表）；无值/策略不需审批 → 直接 APPLIED |

---

## 7. 事件注册（EVENTS.md v1.10，先注册后开发）

| 事件 | 归属 |
| --- | --- |
| `ReceiptCreated` / `ReceiptUpdated` / `ReceiptAllocated` / `ReceiptVoided` | 4E-2 注册 |
| `WriteOffCreated` / `WriteOffSubmitted` / `WriteOffApproved` / `WriteOffRejected` / `WriteOffApplied` | 4E-2 注册 |
| `AccountsReceivablePartiallyPaid` / `AccountsReceivablePaid` / `AccountsReceivableWrittenOff` | v1.9 已注册 → 4E-2 实现 |
| `InvoicePartiallyPaid` / `InvoicePaid` | 4D 已注册 → 4E-2 实现（投影回写时发布） |

---

## 8. Migration 0019 草案（实现阶段，本阶段不创建）

- 纯增量：`Receipt` / `ReceiptAllocation` / `ReceiptRevision` / `ReceiptSnapshot` / `WriteOff`（+ WriteOffRevision/Snapshot 视 Pending ③）
- 枚举新增：`ReceiptStatus` / `PaymentMethod` / `WriteOffStatus`
- **红线：不动 Invoice / AccountsReceivable 既有表**（AR 已含 paidAmount/writeOffAmount/adjustedAmount/balanceAmount，无需改表）

---

## 9. API 草案（实现阶段，本阶段不写）

| 端点 | 说明 |
| --- | --- |
| `POST /api/receipts` | 创建收款（含 `allocations[]` 原子核销，Pending ①）——唯一收款入账入口 |
| `GET /api/receipts` / `GET /api/receipts/{id}` | 只读列表/详情（含 allocations 摘要） |
| `GET /api/receipts/{id}/allocations` / `revisions` / `snapshots` | 只读 |
| `POST /api/receipts/{id}/allocate` | 追加核销（Pending ①：若创建即核销则无需单独端点） |
| `POST /api/receipts/{id}/void` | 作废（Pending ②，仅限未核销/全额可逆） |
| `POST /api/write-offs` | 创建 WriteOff（DRAFT） |
| `POST /api/write-offs/{id}/submit` / `approve` / `reject` | 审批动作（Workflow 回调） |
| `POST /api/write-offs/{id}/apply` | APPLIED（服务端回写 AR） |
| `GET /api/write-offs` / `{id}` / `revisions` / `snapshots` | 只读 |

**无 PATCH 金额端点。**

---

## 10. CTO Pending Decisions（4E-2 设计评审）

| # | 问题 | CIO 默认建议 |
| --- | --- | --- |
| ① | Receipt 创建是否原子核销（POST /api/receipts 带 allocations[] 一次完成）？还是先建 DRAFT 再单独 allocate？ | 创建即核销原子化（对齐 4D 唯一创建入口模式），一次事务完成锁 AR + 校验 + 回写，避免悬空收款单 |
| ② | Receipt VOID 语义：允许作废吗？已核销后能否冲销？ | 仅允许未核销/全额可逆场景 VOID；已核销冲销复杂，建议走 4E-3 CN 承载（与 4D "ISSUED+ 取消 → CN" 一致），4E-2 不做反向核销 |
| ③ | WriteOff 是否三件套（Revision/Snapshot）？ | 是（对齐 Invoice/AR/Receipt 事实源标准，留痕可追溯） |
| ④ | Receipt / WriteOff 编号是否走 DocumentSequence？创建即取号？ | 是；Receipt 为即时入账事实，建议创建即取号（无 DRAFT 不占号语义），编号格式 REC-2026-xxxx / WO-2026-xxxx |
| ⑤ | 部分核销剩余金额处理？ | 剩余金额保留在 Receipt.balanceAmount，可继续核销；不自动退回（退款/冲销属 4E-3 CN 范围） |

---

## 11. 边界红线（本阶段无越界实现）

- ❌ 不建 Payment 表（Receipt 唯一入账事实）
- ❌ 不建 CreditNote / DebitNote / Adjustment（4E-3）
- ❌ 不 PATCH AR / Invoice 金额
- ❌ 不新建审批表（复用 Workflow / ApprovalPolicy）
- ❌ 不创建 Migration 0019、不写 Receipt/WriteOff API（实现阶段）
- ❌ 不引入第二套余额事实（AR 保持唯一余额载体）
