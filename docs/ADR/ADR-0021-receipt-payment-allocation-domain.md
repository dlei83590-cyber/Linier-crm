# ADR-0021：Receipt & Payment Allocation Domain（收款事实源与核销领域决策）

- 状态：**Approved with Changes（2026-08-08，CTO Design Review 97/100）**——5 个 Pending 全部拍板 + 3 项调整已落实；**无需第二轮设计评审**，直接进入 Schema → Migration 0019 → Seed → RBAC → API 实现阶段
- 日期：2026-08-08
- 关联：ADR-0019（Invoice Domain）、ADR-0020（Accounts Receivable Domain）、Sprint4E2_ReceiptAllocation_Design.md、EVENTS.md（v1.10 注册）、Sprint4E1_AR_Design.md（已实现，PR #16 已合并）
- 背景：Sprint 4E-1 Accounts Receivable Foundation 已合并（PR #16，f58fd87）。CTO Final Review（2026-08-08，98/100）启动 4E-2；CTO Design Review（2026-08-08，97/100 APPROVED WITH CHANGES）拍板全部设计决策。
- **边界锁死（CTO 启动令 + Design Review）**：Receipt = 收款事实源（**Payment 不单独建表**）；ReceiptAllocation = 核销事实；AccountsReceivable = 余额事实源（唯一）；**创建与核销分离**；**Allocation/Receipt Reversal 属 4E-2，CN 属 4E-3 发票调整域且不承担收款冲销**；**同 Customer + 同 Currency 才允许 Allocation，第一版禁止跨币种核销**；WriteOff 独立事实（禁 PATCH AR.writeOffAmount）。

## 决策

### 1. Receipt 是唯一收款事实源（Payment 不建表）

- **Payment 与 Receipt 是同一入账事实，只允许一个载体**：建 `Receipt`，Payment 仅作语义别名/视图概念，不落表（CTO 明确禁止两个重复入账事实）。
- Receipt 持有收款事实：`amount / currency / receiptDate / paymentMethod / referenceNo / customerId / status`；**不持有余额**。
- 核心金额关系（CTO 锁定）：`Receipt.amount = allocatedAmount + unallocatedAmount`；`allocatedAmount / unallocatedAmount` 为**受控投影**——只能由 allocation / reversal 事务更新，**禁止 PATCH**。

### 2. 创建与核销分离（拍板①）

- `POST /api/receipts`：**只记录实际收到的钱**（UNALLOCATED），不核销。
- `POST /api/receipts/{id}/allocate`：**显式核销动作**；一次 allocate 请求内部**必须原子化**（多 AR 批量核销同一事务，任何一步失败整体回滚）。
- Receipt 编号：**DocumentSequence，创建时取号**（拍板④，REC-2026-xxxx）。Receipt 是实际收款凭证，创建即成为财务事实，与 Invoice DRAFT 不占号的业务语义不同。

### 3. ReceiptAllocation 承载 M:N 核销（CTO 锁定）

- 中间表 `ReceiptAllocation(receiptId, accountsReceivableId, allocatedAmount, allocatedAt, allocatedBy, reversedAt?, reversedBy?)`。
- **M:N 语义**：一个 Receipt → 多 AR（一次收款核销多张发票）；一个 AR → 多 Receipt（一张发票分多次收款）。
- `unique (receiptId, accountsReceivableId)`：同一收款对同一 AR 只核销一次；多次收款 = 多张 Receipt。
- **硬规则（CTO 追加）**：`Receipt.customerId == AR.customerId`（否则 409 `RECEIPT_CUSTOMER_MISMATCH`，M:N 不允许跨客户核销）；`Receipt.currency == AR.currency`（否则 409 `RECEIPT_CURRENCY_MISMATCH`，**第一版禁止跨币种核销**——FX Receipt 需单独设计汇兑损益与核销汇率，避免污染财务口径）。

### 4. Allocation 事务红线（CTO 指定顺序，Final Review 按此检查）

```
Lock Receipt（FOR UPDATE）
 ↓
Lock all target AR rows（按 id ASC，FOR UPDATE，对齐 4C 防超交 / 4D 防超开票锁序）
 ↓
Validate customer/currency（同上，否则 409）
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

- 并发保证：锁内重读 + 锁内校验 + 锁内回写，事务提交前不释放 → `allocatedAmount ≤ AR.balanceAmount` 并发下始终成立。

### 5. Reversal 边界：Allocation Reversal / Receipt Reversal 属 4E-2，CN 不承担收款冲销（本轮最重要修正）

| 概念 | 语义 | 归属 |
| --- | --- | --- |
| `Credit Note` | 发票/应收金额发生调整（冲减开票金额） | **4E-3 发票调整域** |
| `Receipt Reversal` | 收款事实发生撤销（如银行退票：Invoice 金额没变，变的是这笔钱实际没收到） | **4E-2** |
| `Allocation Reversal` | 原核销关系被撤销（解除核销，回退 AR/Invoice/Receipt 投影） | **4E-2** |

- 例：客户付款 RM10,000，银行退票——这不是 Credit Note，原 Invoice 金额没有变化。
- `POST /api/receipt-allocations/{id}/reverse`：锁 Receipt + 锁 AR（id ASC）→ 校验 → AR.paidAmount 回退 / balanceAmount 重算 → Invoice 投影回退 → Receipt 投影恢复 → Snapshot/Audit → `ReceiptAllocationReversed` 事件。
- **红线：CN 不能做成万能冲销工具**；已核销 Receipt 的逆向处理必须先 Reversal 留痕。

### 6. VOID 规则（拍板②）

- **未核销 Receipt 可 VOID**（状态 → VOIDED）。
- **已有核销的 Receipt 不得直接 VOID**：必须先 `Allocation Reversal / Receipt Reversal` 留痕，再处理。
- ReceiptStatus（受控投影，不 PATCH）：`UNALLOCATED / PARTIALLY_ALLOCATED / FULLY_ALLOCATED / VOIDED`；前三个可由金额动态推导（unallocatedAmount > 0 / = 0），落库但只能由 allocation/reversal 事务更新。

### 7. WriteOff 独立事实 + WriteOffAllocation（拍板③：不做三件套）

- 建 `WriteOff(accountsReceivableId, amount, reason, writeOffDate, status, approvalPolicyId?, workflowInstanceId?)` + `WriteOffAllocation(writeOffId, accountsReceivableId, amount)`。
- **不建 WriteOffRevision / WriteOffSnapshot**：审批历史由 **Workflow**、审计由 **AuditLog** 承载，避免模型膨胀（拍板③）。
- 状态机：DRAFT → SUBMITTED →（无策略）APPLIED /（有策略）APPROVED → APPLIED；REJECTED → DRAFT 重提。
- 只有 **APPLIED 动作**在服务端原子回写 `AR.writeOffAmount += amount` + computeBalance + Revision/Snapshot(WRITE_OFF) + 事件。
- 红线：前端/接口不允许直接写 `AR.writeOffAmount / balanceAmount / paidAmount`。

### 8. 审批边界（CTO 锁定，Workflow 唯一审批事实源）

- **Receipt：不审批**；**ReceiptAllocation：不审批**。
- **WriteOff：根据 ApprovalPolicy 条件审批**（复用 Workflow，不建 `ReceiptApproval` / `WriteOffApproval` 表）。
- WriteOff 时序：`Create WriteOff → 命中策略则进入 Workflow → APPROVED → Apply WriteOff → 更新 AR`；**审批完成前禁止提前修改 AR.writeOffAmount**。

### 9. 余额口径与投影不变（4E-1 锁定）

- `AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（唯一口径，computeBalance 单入口）。
- `Invoice.paidAmount / balanceAmount` 保持 **Projection**（核销/冲销时同步回写，4D 语义不变）。
- **4E-2 起不出现第二套余额事实**；AR 是唯一余额载体。

## 未决状态（全部已拍板，Design Review 97/100）

| # | 问题 | CTO 拍板 |
| --- | --- | --- |
| ① | Receipt 创建是否立即核销？ | **否。创建与核销分离**；一次 allocate 请求内部原子化 |
| ② | VOID 规则？ | 未核销可 VOID；已核销不得直接 VOID，走 Allocation/Receipt Reversal 留痕；CN 属 4E-3 不承担收款冲销 |
| ③ | WriteOff 是否三件套？ | 否。`WriteOff + WriteOffAllocation`；审批历史 Workflow、审计 AuditLog |
| ④ | Receipt 编号？ | DocumentSequence，创建时取号（REC-/WO-2026-xxxx） |
| ⑤ | 部分核销剩余款？ | 必须保留 `unallocatedAmount`（预收/暂未指定发票场景） |
