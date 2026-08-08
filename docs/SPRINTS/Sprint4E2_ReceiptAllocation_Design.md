# Sprint 4E-2：Receipt & Payment Allocation Design（收款与核销领域设计）

> 定位（CTO Final Review 2026-08-08，Sprint 4E-1 APPROVE & MERGE 98/100 后启动）：**Receipt = 收款事实源**；
> **AccountsReceivable = 余额事实源（唯一）**；Invoice 上 `paidAmount/balanceAmount` 保持投影回写。
> **CTO Design Review（2026-08-08，97/100 APPROVED WITH CHANGES）**：5 个 Pending **全部拍板** + 3 个调整已落实（① 创建与核销分离 ② Allocation/Receipt Reversal 边界，CN 不负责收款冲销 ③ 同 Customer + 同 Currency 才允许 Allocation，第一版禁止跨币种核销）。
> 落实 3 个调整后**无需第二轮设计评审**，直接进入 Schema → Migration 0019 实现阶段。

---

## 1. 模型范围（CTO 锁定 + Design Review 拍板）

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | Receipt | 收款事实源（唯一入账事实；**Payment 不单独建表**——CTO 明确禁止两个重复入账事实） |
| ✅ 新增 | ReceiptAllocation | 核销事实（M:N：Receipt ↔ AR；一次收款可核销多张 AR，一张 AR 可被多次收款核销） |
| ✅ 新增 | ReceiptRevision | 修改历史（唯一版本载体，收款信息变更时系统生成） |
| ✅ 新增 | ReceiptSnapshot | 关键状态证据（仅固化节点：CREATED / ALLOCATED / VOIDED / REVERSED；snapshotSource 复用 4E-1 枚举） |
| ✅ 新增 | WriteOff | 坏账/折让独立事实实体（不 PATCH AR.writeOffAmount；APPLIED 后服务端原子回写） |
| ✅ 新增 | WriteOffAllocation | WriteOff 明细（拍板③：**不做 Revision/Snapshot 三件套**，审批历史由 Workflow、审计由 AuditLog，避免模型膨胀） |
| ❌ 禁止 | Payment 独立表 | 与 Receipt 重复入账事实（CTO 拍板） |
| ❌ 禁止 | ReceiptApproval / WriteOffApproval | Workflow 仍是唯一审批事实源（不建审批表） |
| ❌ 禁止 | CreditNote / DebitNote | 属 4E-3（发票调整域），本阶段不进入 |
| ❌ 禁止 | PATCH AR / Invoice / Receipt 金额 | 金额变动只能由 allocate/reversal/WriteOff Apply 事务驱动 |

**核心关系（CTO 锁定）：**
```
Receipt（收款事实源）
  └── ReceiptAllocation ──→ AccountsReceivable（余额事实源，唯一）
        │
        └── Invoice（单据事实源，paidAmount/balanceAmount 仅投影）

WriteOff（独立事实实体，审批后 APPLIED）
  └── WriteOffAllocation ──→ AccountsReceivable（APPLIED 时服务端回写 writeOffAmount，不 PATCH）
```

**业务链（销售财务闭环）：**
```
Invoice（单据事实源，4D）→ AccountsReceivable（余额事实源，4E-1）
    ▲ 核销（ReceiptAllocation）／写销（WriteOff Apply）
    │
Receipt（收款事实源，4E-2）
  ├── allocate（显式核销动作，一次请求内部原子化）
  └── reversal（Allocation Reversal / Receipt Reversal，4E-2 边界）
```

---

## 2. 事实源边界（CTO 锁死）

```
Invoice.paidAmount / Invoice.balanceAmount
    = Projection（4D 语义不变，4E-2 核销/冲销时同步回写）

AccountsReceivable.paidAmount
AccountsReceivable.writeOffAmount
AccountsReceivable.adjustedAmount
AccountsReceivable.balanceAmount
    = Source of Truth（唯一余额事实）

Receipt.amount = allocatedAmount + unallocatedAmount   （受控投影）
```

- **锁死：4E-2 起不允许出现第二套余额事实。**
- 余额唯一口径不变：`balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（服务端 computeBalance 单入口）。
- Receipt 的 `allocatedAmount / unallocatedAmount` 为**受控投影**：只能由 allocation / reversal 事务更新，**禁止 PATCH**。

### 2.1 三个事实域的边界区分（本轮 Review 最重要修正）

| 概念 | 语义 | 归属 |
| --- | --- | --- |
| `Credit Note` | 发票/应收金额发生调整（冲减开票金额） | **4E-3 发票调整域** |
| `Receipt Reversal` | 收款事实发生撤销（如银行退票：Invoice 金额没变，变的是这笔钱实际没收到） | **4E-2** |
| `Allocation Reversal` | 原核销关系被撤销（核销错了/退款后解除核销） | **4E-2** |

> **红线：不要把「已核销 Receipt 冲销」交给 Credit Note。** 例：客户付款 RM10,000，银行退票——这不是 CN，原 Invoice 金额没有变化。CN 若做成万能冲销工具，4E-3 会被污染。ADR-0021 已写死此边界。

---

## 3. Receipt 模型（拍板④：DocumentSequence 创建即取号）

```
Receipt {
  id
  code                 // DocumentSequence，创建即取号（REC-2026-xxxx）——拍板④
  customerId           // BusinessPartner；与目标 AR.customerId 必须一致（硬规则）
  currency             // 与目标 AR.currency 必须一致（硬规则，第一版禁止跨币种核销）
  amount               // 实收金额（Decimal 18,4）
  allocatedAmount      // 受控投影 = Σ ReceiptAllocation.allocatedAmount
  unallocatedAmount    // 受控投影 = amount - allocatedAmount（拍板⑤：支持预收/暂未指定发票）
  receiptDate
  paymentMethod        // 枚举：BANK_TRANSFER / CHEQUE / CASH / CARD / OTHER
  referenceNo          // 银行流水号/备注，可空
  status               // ReceiptStatus（受控投影，见下）
  version
  // allocations: ReceiptAllocation[]
}
```

**ReceiptStatus（拍板②，受控投影——不 PATCH，只能由事务更新）：**
```
UNALLOCATED ──allocate──> PARTIALLY_ALLOCATED ──allocate──> FULLY_ALLOCATED
     │                         │                              │
     └─────────void────────────┴───────────> VOIDED（仅未核销可 VOID）
```
- `UNALLOCATED / PARTIALLY_ALLOCATED / FULLY_ALLOCATED` 可由金额动态推导（unallocatedAmount > 0 / = 0），落库为**受控投影**，所有变更只能由 allocation/reversal 事务更新。
- **VOID 规则（拍板②）**：未核销 Receipt 可 VOID；**已有核销不得直接 VOID**——必须走 Allocation Reversal / Receipt Reversal 留痕后再处理。
- Receipt **不审批**（CTO 锁定：Receipt / ReceiptAllocation 均不引入审批体系）。

---

## 4. ReceiptAllocation：M:N 核销事实（拍板①：创建与核销分离）

```
ReceiptAllocation {
  id
  receiptId                // 收款
  accountsReceivableId     // 应收
  allocatedAmount          // 本次核销金额（Decimal 18,4）
  allocatedAt
  allocatedBy
  reversedAt / reversedBy  // Allocation Reversal 留痕（可空）
  // unique (receiptId, accountsReceivableId) —— 同一收款对同一 AR 只核销一次
}
```

**拍板①：创建与核销分离**
- `POST /api/receipts`：只记录实际收到的钱（DRAFT 收款事实，状态 UNALLOCATED），**不核销**。
- `POST /api/receipts/{id}/allocate`：显式核销动作，**一次请求内部必须原子化**（多 AR 批量核销同一事务）。

### 4.1 Allocation 事务红线（CTO 指定顺序，写入 ADR，Final Review 按此检查）

```
Lock Receipt（FOR UPDATE）
 ↓
Lock all target AR rows（按 id ASC，FOR UPDATE，对齐 4C/4D 锁序防死锁）
 ↓
Validate customer/currency（Receipt.customerId == AR.customerId；Receipt.currency == AR.currency，否则 409）
 ↓
Validate Receipt unallocated balance（本次分配 ≤ unallocatedAmount，否则 409 RECEIPT_UNALLOCATED_EXCEEDED）
 ↓
Validate each allocation ≤ AR.balanceAmount（否则 409 RECEIPT_ALLOCATION_EXCEEDED）
 ↓
Create ReceiptAllocation
 ↓
Update AR paidAmount / balanceAmount（computeBalance 单入口）
 ↓
Update Invoice paidAmount / balanceAmount projection
 ↓
Update Receipt allocatedAmount / unallocatedAmount / status projection
 ↓
AR status projection（OPEN → PARTIALLY_PAID → PAID；余额=0 且生命周期结束 → CLOSED）
 ↓
Snapshot / Audit（AR Snapshot(snapshotSource=PAYMENT) + Revision）
 ↓
Domain Events
```

### 4.2 硬规则（CTO 追加）

1. **跨币种核销不在 4E-2 静默支持**：`Receipt.currency == AR.currency`，否则 409 `RECEIPT_CURRENCY_MISMATCH`。FX Receipt（汇兑损益/核销汇率）后续单独设计，否则污染财务口径。
2. **Receipt customerId 与 AR customerId 必须一致**：M:N 不意味着允许一笔 Receipt 跨客户核销，否则 409 `RECEIPT_CUSTOMER_MISMATCH`。

### 4.3 Allocation Reversal / Receipt Reversal（4E-2 边界）

- `POST /api/receipt-allocations/{id}/reverse`：撤销原核销关系 → 锁 Receipt + 锁 AR（id ASC）→ 校验 → AR.paidAmount 回退 / balanceAmount 重算 → Invoice 投影回退 → Receipt 投影回退（unallocatedAmount 恢复）→ Snapshot/Audit → `ReceiptAllocationReversed` 事件。
- `Receipt Reversal`：收款事实整体撤销（如银行退票）→ 先 reverse 全部 Allocation，再 VOID Receipt；不修改 Invoice 金额（Invoice 没变，变的只是这笔钱实际没收到）。
- **CN 不负责收款冲销**（边界写死，见 §2.1）。

---

## 5. WriteOff：独立事实实体（拍板③：WriteOff + WriteOffAllocation，无三件套）

```
WriteOff {
  id
  code                    // DocumentSequence（WO-2026-xxxx，拍板④：创建即取号）
  accountsReceivableId    // 目标应收（同客户同币种校验同上）
  amount                  // 写销金额（Decimal 18,4）
  reason                  // 原因：坏账/折让/其他
  writeOffDate
  status                  // WriteOffStatus：DRAFT / SUBMITTED / APPROVED / REJECTED / APPLIED
  approvalPolicyId        // 可空；有值则条件触发 Workflow
  workflowInstanceId      // 复用 Workflow（不建 WriteOffApproval 表）
  appliedAt / appliedBy
}

WriteOffAllocation {
  id
  writeOffId
  accountsReceivableId
  amount
  // 审批历史 → Workflow；审计 → AuditLog（拍板③：不建 Revision/Snapshot 三件套）
}
```

**状态机：**
```
DRAFT ──submit──> SUBMITTED ──(无审批策略)──> APPLIED（服务端回写 AR）
                    │
                    ├──(有审批策略)──> APPROVED ──apply──> APPLIED
                    └──────────────> REJECTED ──> DRAFT（修改重提）
```

**审批边界（CTO 锁定）：**
- Receipt：**不审批**
- ReceiptAllocation：**不审批**
- WriteOff：**根据 ApprovalPolicy 条件审批**（复用 Workflow，不建 `ReceiptApproval` / `WriteOffApproval`）
- **审批完成前禁止修改 AR.writeOffAmount**：
  ```
  Create WriteOff → 命中策略则进入 Workflow → APPROVED → Apply WriteOff → 更新 AR
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

---

## 6. 事件注册（EVENTS.md v1.10，先注册后开发）

| 事件 | 归属 | 说明 |
| --- | --- | --- |
| `ReceiptCreated` | 4E-2 | 创建收款单（不核销，拍板①） |
| `ReceiptAllocated` | 4E-2 | 核销完成（AR.paidAmount + Invoice 投影回写） |
| `ReceiptFullyAllocated` | 4E-2 | 全部核销完成（unallocatedAmount = 0） |
| `ReceiptVoided` | 4E-2 | 作废（仅未核销可 VOID） |
| `ReceiptAllocationReversed` | 4E-2 | **Allocation Reversal（本轮 Review 新锁定边界，必须覆盖）** |
| `WriteOffCreated` | 4E-2 | 创建写销单（DRAFT） |
| `WriteOffSubmitted` | 4E-2 | 提交审批 |
| `WriteOffApproved` | 4E-2 | 审批通过（Workflow 回调） |
| `WriteOffRejected` | 4E-2 | 审批驳回 |
| `WriteOffApplied` | 4E-2 | APPLIED（AR.writeOffAmount 回写） |
| `AccountsReceivableWrittenOff` | v1.9 已注册 | 4E-2 实现时联动发布 |

> 注：`AccountsReceivablePartiallyPaid / Paid / Closed`（v1.9 已注册）与 `InvoicePartiallyPaid / InvoicePaid`（4D 已注册）在 4E-2 实现时联动发布，不重复注册。

---

## 7. Migration 0019 草案（实现阶段）

- 纯增量：`Receipt` / `ReceiptAllocation` / `ReceiptRevision` / `ReceiptSnapshot` / `WriteOff` / `WriteOffAllocation`
- 枚举新增：`ReceiptStatus`（UNALLOCATED/PARTIALLY_ALLOCATED/FULLY_ALLOCATED/VOIDED）/ `PaymentMethod` / `WriteOffStatus`
- **红线：不动 Invoice / AccountsReceivable 既有表**（AR 已含 paidAmount/writeOffAmount/adjustedAmount/balanceAmount，无需改表）

---

## 8. API 草案（实现阶段）

| 端点 | 说明 |
| --- | --- |
| `POST /api/receipts` | 创建收款（只记录金额，不核销；DocumentSequence 创建即取号） |
| `GET /api/receipts` / `GET /api/receipts/{id}` | 只读列表/详情 |
| `GET /api/receipts/{id}/allocations` / `revisions` / `snapshots` | 只读 |
| `POST /api/receipts/{id}/allocate` | 显式核销（一次请求原子化，多 AR 批量同事务） |
| `POST /api/receipt-allocations/{id}/reverse` | Allocation Reversal（解除核销，回退 AR/Invoice/Receipt 投影） |
| `POST /api/receipts/{id}/void` | 作废（仅未核销可 VOID） |
| `POST /api/write-offs` | 创建 WriteOff（DRAFT） |
| `POST /api/write-offs/{id}/submit` / `approve` / `reject` | 审批动作（Workflow 回调） |
| `POST /api/write-offs/{id}/apply` | APPLIED（服务端回写 AR；审批完成前禁止回写） |
| `GET /api/write-offs` / `{id}` | 只读（含 WriteOffAllocation 明细） |

**无 PATCH 金额端点。**

---

## 9. CTO Pending Decisions 拍板结果（Design Review 97/100）

| # | 问题 | CTO 拍板 |
| --- | --- | --- |
| ① | Receipt 创建是否立即核销？ | **否。创建与核销分离**——Receipt 先记录实际收到钱，再显式 `allocate` 动作核销；一次 allocate 请求内部必须原子化 |
| ② | VOID 规则？已核销后如何处理？ | 未核销 Receipt 可 VOID；**已有核销不得直接 VOID**；逆向处理走 **Allocation Reversal / Receipt Reversal** 留痕；CN 属 4E-3 发票调整域 |
| ③ | WriteOff 是否三件套？ | **否**。`WriteOff + WriteOffAllocation/明细`；审批历史由 Workflow、审计由 AuditLog，避免模型膨胀 |
| ④ | Receipt 编号？ | **DocumentSequence，创建时取号**（REC-/WO-2026-xxxx）；Receipt 是实际收款凭证，创建即财务事实，与 Invoice DRAFT 语义不同 |
| ⑤ | 部分核销剩余款？ | **必须保留 unallocatedAmount**，支持预收/暂未指定发票场景 |

---

## 10. 边界红线（本阶段无越界实现）

- ❌ 不建 Payment 表（Receipt 唯一入账事实）
- ❌ 不建 CreditNote / DebitNote / Adjustment（4E-3 发票调整域）
- ❌ CN 不承担收款冲销（Receipt Reversal / Allocation Reversal 属 4E-2）
- ❌ 不 PATCH AR / Invoice / Receipt 金额（受控投影，事务更新）
- ❌ 不新建审批表（复用 Workflow / ApprovalPolicy）
- ❌ 不支持跨币种核销（Receipt.currency == AR.currency，否则 409；FX 后续单独设计）
- ❌ 不允许跨客户核销（Receipt.customerId == AR.customerId）
- ❌ 不创建 Migration 0019、不写 Receipt/WriteOff API 前（先 Schema 后实现）
- ❌ 不引入第二套余额事实（AR 保持唯一余额载体）
