# CTO Final Review Cover — Sprint 4E-2 Receipt & Payment Allocation Foundation

**PR:** #17 – Sprint 4E-2 Receipt & Payment Allocation Foundation
**Branch:** `feature/sprint4-sales`
**Head:** `74a5b3d`（合并前最终 HEAD；3 项财务一致性阻断项修复后 CTO 复核全部 PASS）
**Status:** APPROVED & MERGED（PR #17 squash `b84b036`，2026-08-08）

## 1. Scope

本 PR 完成 Sprint 4E-2 Receipt & Payment Allocation Foundation 全部计划范围：

- Receipt & Payment Allocation Domain（收款事实源 + 核销事实 + WriteOff 独立事实）
- Schema + Migration 0019（Receipt/ReceiptAllocation/ReceiptRevision/ReceiptSnapshot + WriteOff/WriteOffAllocation；DocumentType +WRITE_OFF）
- Seed + RBAC（receipt / receipt-allocation / receipt-revision / receipt-snapshot / write-off / write-off-allocation 6 模块）
- Receipt API（创建/列表/详情/allocate/revisions/snapshots/void）
- Allocation API（reverse）
- WriteOff API（创建/列表/submit/apply）
- Workflow actions 接入（businessType="write-off" 终态回写）
- OpenAPI / QA / Test Cases / ADR-0021 / DOMAIN_MODEL / EVENTS / CHANGELOG / RELEASE_NOTES / ROADMAP

**未包含（边界锁死）：**

- Credit Note / Debit Note（Sprint 4E-3 发票调整域，不承担收款冲销）
- Payment 独立表（Receipt 唯一收款事实源）
- ReceiptApproval / WriteOffApproval 表（Workflow 唯一审批事实源）
- PATCH Receipt / AR / Invoice 金额（受控投影，事务驱动）
- 修改 Invoice 表（Migration 0019 只新增，CTO 拍板）
- WriteOff Revision/Snapshot 三件套（拍板③：审批历史 Workflow、审计 AuditLog）

## 2. Architecture Verification

### 收款事实源（唯一）

- **Receipt = 唯一收款事实源**（Payment 不单独建表——CTO 拍板，避免两个重复入账事实）。
- Receipt 持有 `amount / currency / receiptDate / paymentMethod / referenceNo / customerId / status`；**不持有余额**。
- 核心金额关系：`Receipt.amount = allocatedAmount + unallocatedAmount`（后两者**受控投影**，只能由 allocation/reversal/void 事务更新，禁止 PATCH）。
- 编号：DocumentSequence **创建即取号**（RCT-2026-xxxx，拍板④——实际收款凭证，创建即财务事实）。

### 创建与核销分离（拍板①）

```
POST /api/receipts          → 只记录实际收到的钱（UNALLOCATED，unallocatedAmount=amount），不核销
POST /api/receipts/{id}/allocate → 显式核销动作，一次请求原子化（多 AR 批量同事务，失败整体回滚）
```

### Allocation M:N + 事务红线（CTO 指定顺序）

```
Lock Receipt（FOR UPDATE）
 ↓
Lock all target AR rows（按 id ASC，FOR UPDATE——防死锁锁序）
 ↓
Validate customer/currency（Receipt.customerId == AR.customerId；currency 一致，否则 409）
 ↓
Validate Receipt unallocated balance（Σ allocations ≤ unallocatedAmount，否则 409 RECEIPT_UNALLOCATED_EXCEEDED）
 ↓
Validate each allocation ≤ AR.balanceAmount（锁内读，否则 409 RECEIPT_ALLOCATION_EXCEEDED——并发防超核销）
 ↓
Create ReceiptAllocation（同一 (receipt, AR) 只核销一次）
 ↓
回写 AR paidAmount/balanceAmount（computeBalance 单入口）+ status 投影（OPEN→PARTIALLY_PAID→PAID）
 ↓
回写 Invoice paidAmount/balanceAmount 投影
 ↓
回写 Receipt allocatedAmount/unallocatedAmount/status 投影（→PARTIALLY/FULLY_ALLOCATED）
 ↓
AR Revision + Snapshot(snapshotSource=PAYMENT) + Receipt Revision/Snapshot(ALLOCATED)
 ↓
Events（ReceiptAllocated / ReceiptFullyAllocated，事务外）
```

### Reversal ≠ Credit Note（CTO Design Review 新锁定边界）

| 概念 | 语义 | 归属 |
| --- | --- | --- |
| `Credit Note` | 发票/应收金额发生调整（冲减开票金额） | **4E-3 发票调整域** |
| `Receipt Reversal` | 收款事实发生撤销（如银行退票） | **4E-2** |
| `Allocation Reversal` | 原核销关系被撤销（解除核销，回退三方投影） | **4E-2** |

- `POST /api/receipt-allocations/{id}/reverse`：**不删除原 ReceiptAllocation**——写入 `reversedAt/reversedBy/reverseReason` 留痕（独立逆向事实）；恢复 AR / Invoice / Receipt 三方投影；重复冲销 409 RECEIPT_ALLOCATION_REVERSED。
- 例：客户付款 RM10,000，银行退票——这不是 Credit Note，原 Invoice 金额没有变化。

### VOID 规则（拍板②）

- **未核销 Receipt 可 VOID**（UNALLOCATED → VOIDED + voidedAt/voidedById + Snapshot(VOIDED)）。
- **已有核销不得直接 VOID**：必须先 Allocation Reversal 留痕，否则 409 RECEIPT_VOID_FORBIDDEN。
- Void 只作废收款事实本身，**不实现 Credit Note 语义**。

### WriteOff 独立事实（拍板③）

- `WriteOff + WriteOffAllocation`（**不做三件套**：审批历史 Workflow、审计 AuditLog，避免模型膨胀）。
- 创建校验：全部目标 AR 存在；**同 Customer / 同 Currency**（否则 409 WRITE_OFF_SOURCE_NOT_COMPATIBLE）；每笔 amount > 0；头金额 = Σ allocations（服务端计算，禁止直传）。
- 状态机：DRAFT → SUBMITTED →（无策略）APPLIED /（有策略）APPROVED → APPLIED；REJECTED → DRAFT 重提。
- 编号：DocumentSequence 创建即取号（WO-2026-xxxx，拍板④）。

### Workflow 唯一审批事实源 + APPROVED ≠ APPLIED

- **Receipt / ReceiptAllocation：不审批**；**WriteOff：按 ApprovalPolicy(module=WRITE_OFF) 条件审批**（复用 Workflow，不建 WriteOffApproval 表）。
- submit 同事务 `maybeTriggerWriteOffApproval()`：命中策略 → approvalStatus=PENDING + workflowInstanceId（**必须等 APPROVED 后才能 Apply**）；未命中 → 可直接进入可 Apply 状态。
- actions 路由终态回写：businessType="write-off" → COMPLETED→`syncWriteOffApproval(APPROVED)` / REJECTED→REJECTED。
- **APPROVED ≠ APPLIED**：审批只回写投影；**Apply 是唯一修改 AR.writeOffAmount / balanceAmount 的入口**。

### WriteOff ≠ Payment（财务红线）

```
Apply 事务：
  AR.writeOffAmount += allocation
  AR.balanceAmount 重算（computeBalance 单入口）
  AR.status 投影
  Invoice.balanceAmount 投影同步减少
  Invoice.paidAmount 绝不增加（否则报表会把坏账核销误认为客户实际付款）
  AR Revision + Snapshot(snapshotSource=WRITE_OFF)
  WriteOff status=APPLIED + appliedAt/appliedById
  Events：WriteOffApplied + AccountsReceivableWrittenOff
```

- 重复 Apply → **稳定 409 WRITE_OFF_ALREADY_APPLIED**（幂等）。
- 事件发布失败可降级（.catch），但 **DB 事实更新不静默失败**（主事务失败整体回滚）。

### 余额口径与投影不变（4E-1 锁定）

- `AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（唯一口径，computeBalance 单入口）。
- `Invoice.paidAmount / balanceAmount` 保持 **Projection**（核销/冲销/写销时同步回写，4D 语义不变）。
- **4E-2 起不出现第二套余额事实**；AR 是唯一余额载体。

## 3. Quality Gates

- CI：Quality Gates ✅ / Build ✅ / Secret Scanning ✅ / Generate Lockfile（skipped 正常）
- 提交链全部 CI 全绿：
  - `d076e3a` Receipt Create / `c075dde`+`0440cd8` Allocation / `68d697c`+`2353c8f` Reversal-Void
  - `35bde4e`+`3b44ed0` WriteOff 三件套 / `4a89268`+`68fbe53` Create-Submit / `224624d` Apply / `aabedf2` Workflow actions
- Head：`aabedf2`（PR #17，mergeable=True）

## 4. Documentation

- OpenAPI：+10 端点 / +30 schemas（171 paths / 453 schemas）；5 项财务边界写入描述（创建≠核销 / 同客户同币种 / Reversal≠CN / Approval≠Apply / WriteOff 不增加 paidAmount）
- QA：docs/qa/Sprint4E2_QA.md（T1-T18，覆盖 CTO 指令 17 场景 + Snapshot source）
- Test Cases：docs/test-cases/Receipt_WriteOff_API.md（140+ 用例，A-N 14 组，重点 Concurrency / Reversal / Projection consistency / Workflow / Boundary）
- DOMAIN_MODEL：v1.13（第 24 章 Receipt & Payment Allocation Foundation）
- ADR-0021：**Accepted + Implemented（Sprint 4E-2 完成，PR #17 已合并，squash `b84b036`）**
- EVENTS：v1.11（4E-2 事件 10 个 ✅ 已实现 + AR WrittenOff 联动）
- CHANGELOG / RELEASE_NOTES / ROADMAP：已同步（Ready for Final Review 口径；整体成熟度维持 ≈87%，PR #17 合并后统一上调）

## 5. CTO Checklist

| Item | Status |
| --- | --- |
| Receipt 唯一收款事实源（Payment 不单独建表） | ✅ |
| Allocation M:N（Receipt ↔ AR，ReceiptAllocation 中间表） | ✅ |
| Receipt 创建与核销分离（拍板①，一次 allocate 原子化） | ✅ |
| Customer / Currency 一致性（409 RECEIPT_CUSTOMER_MISMATCH / RECEIPT_CURRENCY_MISMATCH，禁跨币种） | ✅ |
| AR 锁序 id ASC FOR UPDATE（防死锁 + 并发防超核销） | ✅ |
| 防超核销（Σ ≤ unallocatedAmount；每笔 ≤ AR.balanceAmount，409） | ✅ |
| Reversal 不删除原 Allocation（reversedAt/reversedBy/reverseReason 留痕） | ✅ |
| Reversal ≠ Credit Note（CN 属 4E-3，不承担收款冲销） | ✅ |
| Void 边界正确（仅 UNALLOCATED 可 VOID；已核销先 Reversal） | ✅ |
| WriteOff 独立事实（WriteOff + WriteOffAllocation，不做三件套） | ✅ |
| Workflow 唯一审批事实源（不建 ReceiptApproval / WriteOffApproval 表） | ✅ |
| APPROVED ≠ APPLIED（Apply 唯一修改 AR.writeOffAmount/balanceAmount 的入口） | ✅ |
| WriteOff 不增加 Invoice.paidAmount（只减 balanceAmount 投影——财务红线） | ✅ |
| AR / Invoice / Receipt 三方投影一致（computeBalance 单入口） | ✅ |
| 重复 Apply 稳定 409 WRITE_OFF_ALREADY_APPLIED（幂等） | ✅ |
| Decimal 全程（18,4）无 Float；快照金额 toString 禁止 toNumber | ✅ |

## 6. Review Result

**Recommendation: APPROVE & MERGE — 已执行（2026-08-08）**

CTO Final Review：**APPROVE & MERGE ✅（Blocking Issues：0）**

- 3 项财务一致性阻断项（① Invoice.balanceAmount 投影统一回写 AR newBalance ② AR 状态投影统一 computeArStatus ③ Reversal lastPaymentAt 重算）修复后 CTO 逐项复核**全部 PASS**（commit `74a5b3d`）
- 财务边界 16 项 Checklist 全部 ✅（实现 + 文档 + 测试三重覆盖）
- 锁序/防超核销/幂等/投影一致性均按 CTO Design Review 97/100 指定顺序实现
- CI 全绿（Quality Gates / Build / Secret Scanning）

Merge 后执行（已完成）：

1. ✅ Merge PR #17（squash `b84b036`，2026-08-08）
2. ✅ 更新 CHANGELOG（Ready → Completed/已合并）
3. ✅ 更新 RELEASE_NOTES（MERGED）
4. ✅ 更新 ROADMAP（4E-2 ✅，v1.14，成熟度 ≈87% → ≈89%）
5. ✅ 保留 `feature/sprint4-sales`
6. ✅ 进入 **Sprint 4E-3 – Credit Note / Debit Note Design**（Invoice Adjustment → AR.adjustedAmount → CN/DN 销售财务调整链）
