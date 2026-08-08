# ADR-0021：Receipt & Payment Allocation Domain（收款事实源与核销领域决策）

- 状态：**Proposed（2026-08-08，Sprint 4E-2 设计阶段）**——待 CTO Design Review 拍板；批准后进入 Schema → Migration 0019 → Seed → RBAC → API → Workflow → OpenAPI → QA → Final Review 流程
- 日期：2026-08-08
- 关联：ADR-0019（Invoice Domain）、ADR-0020（Accounts Receivable Domain）、Sprint4E2_ReceiptAllocation_Design.md、EVENTS.md（v1.10 注册）、Sprint4E1_AR_Design.md（已实现，PR #16 已合并）
- 背景：Sprint 4E-1 Accounts Receivable Foundation 已合并（PR #16，f58fd87）。CTO Final Review（2026-08-08，98/100 APPROVE & MERGE）启动 4E-2：**Receipt = 收款事实源；AccountsReceivable = 余额事实源（唯一）**；Payment Allocation 完成核销；WriteOff 独立事实。本阶段仅设计（3 文件），不写代码；Credit/Debit Note 属 4E-3。
- **边界锁死（CTO 启动令）**：Receipt 是收款事实源，**Payment 不单独建表**（避免两个重复入账事实）；核销 **M:N**（Receipt ↔ AR）；核销锁 AR（**ID ASC + FOR UPDATE**）；`allocatedAmount ≤ AR.balanceAmount` 并发下成立；**WriteOff 独立事实**（禁 PATCH `AR.writeOffAmount`）；普通 Receipt 不审批，WriteOff 按 ApprovalPolicy 条件触发 Workflow。

## 决策

### 1. Receipt 是唯一收款事实源（Payment 不建表）

- **Payment 与 Receipt 是同一入账事实，只允许一个载体**：建 `Receipt`，Payment 仅作语义别名/视图概念，不落表（CTO 明确禁止两个重复入账事实）。
- Receipt 持有收款事实：totalAmount / currency / paymentMethod / receivedAt / referenceNo / customerId；**不持有余额**。
- 未核销余额 `Receipt.balanceAmount = totalAmount - Σ allocatedAmount` 服务端计算，只读暴露。

### 2. ReceiptAllocation 承载 M:N 核销（CTO 锁定）

- 中间表 `ReceiptAllocation(receiptId, accountsReceivableId, allocatedAmount, allocatedAt, allocatedBy)`。
- **M:N 语义**：一个 Receipt → 多 AR（一次收款核销多张发票）；一个 AR → 多 Receipt（一张发票分多次收款）。
- 建议 `unique (receiptId, accountsReceivableId)`：同一收款对同一 AR 只核销一次（Pending ① 默认建议，防重复核销）。
- 核销是显式动作（`POST /api/receipts` 创建时原子核销或 `POST /api/receipts/{id}/allocate`），**禁止 PATCH 金额**。

### 3. 核销锁序：AR ID ASC + FOR UPDATE（CTO 锁定）

- 所有核销/写销动作按目标 `accountsReceivableId` **升序** `SELECT ... FOR UPDATE`（对齐 4C 防超交 / 4D 防超开票 / 4E-1 同款锁序，防死锁）。
- 锁内重读 `AR.balanceAmount` → 校验 → 回写 → 提交；事务提交前锁不释放，并发核销串行化。

### 4. 防超核销：allocatedAmount ≤ AR.balanceAmount（并发下仍成立）

- 校验口径：Σ(该 AR 全部有效核销 allocatedAmount) ≤ AR.balanceAmount（锁内校验 + 锁内重算）。
- 超限 → `409 RECEIPT_ALLOCATION_EXCEEDED`（对齐 4C/4D 同一套防超模式）。
- WriteOff APPLIED 同锁序校验：`amount ≤ balanceAmount`，超限 → `409 WRITE_OFF_EXCEEDED`。

### 5. WriteOff 是独立事实实体（禁止 PATCH AR.writeOffAmount）

- 建 `WriteOff(accountsReceivableId, amount, reason, writeOffDate, status, approvalPolicyId?, workflowInstanceId?)`。
- 状态机：DRAFT → SUBMITTED →（无策略）APPLIED /（有策略）APPROVED → APPLIED；REJECTED → DRAFT 重提。
- 只有 **APPLIED 动作**在服务端原子回写 `AR.writeOffAmount += amount` + computeBalance + Revision/Snapshot(WRITE_OFF) + 事件。
- 红线：前端/接口不允许直接写 `AR.writeOffAmount / balanceAmount / paidAmount`。

### 6. 审批边界（CTO 锁定）

- **普通 Receipt 不审批**（收款入账即时生效，不引入审批体系）。
- **WriteOff 条件审批**：`approvalPolicyId` 可空；有值 → 按 ApprovalPolicy 触发 Workflow（复用 Workflow，不建 WriteOffApproval 表）；无值/策略不需审批 → 直接 APPLIED。

### 7. 余额口径与投影不变（4E-1 锁定）

- `balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（唯一口径，computeBalance 单入口）。
- `Invoice.paidAmount / balanceAmount` 保持 **Projection**（核销/写销时同步回写，4D 语义不变）。
- **4E-2 起不出现第二套余额事实**；AR 是唯一余额载体。

## 未决（CTO Pending Decisions，见 Sprint4E2_ReceiptAllocation_Design.md §10）

| # | 问题 | CIO 默认建议 |
| --- | --- | --- |
| ① | Receipt 创建是否原子核销（带 allocations[] 一次完成）？ | 是（对齐 4D 唯一创建入口模式） |
| ② | Receipt VOID 语义：允许作废吗？已核销后能否冲销？ | 仅未核销/全额可逆可 VOID；已核销冲销走 4E-3 CN |
| ③ | WriteOff 是否三件套（Revision/Snapshot）？ | 是 |
| ④ | Receipt/WriteOff 编号是否走 DocumentSequence？创建即取号？ | 是；创建即取号（REC-2026-xxxx / WO-2026-xxxx） |
| ⑤ | 部分核销剩余金额处理？ | 保留在 Receipt.balanceAmount 继续核销，不自动退回 |
