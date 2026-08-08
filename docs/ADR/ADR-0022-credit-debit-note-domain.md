# ADR-0022：Credit Note / Debit Note Domain（发票调整与应收调整领域决策）

- 状态：**Approved with Changes（2026-08-08，CTO Design Review 98/100）**——5 个 Pending 全部拍板 + 3 项设计调整已落实；**无需第二轮设计评审**，直接进入 Schema → Migration 0020 → Seed → RBAC → API 实现阶段
- 日期：2026-08-08
- 关联：ADR-0019（Invoice Domain）、ADR-0020（Accounts Receivable Domain）、ADR-0021（Receipt & Payment Allocation Domain）、Sprint4E3_CreditDebitNote_Design.md、EVENTS.md（v1.12 注册）
- 背景：Sprint 4E-2 Receipt & Payment Allocation 已合并（PR #17，b84b036；CTO Final Review APPROVE & MERGE，3 项财务一致性阻断项修复后复核全 PASS）。CTO 启动 4E-3：**CN/DN = Invoice Adjustment 事实源**；补齐 **Invoice Adjustment → AR.adjustedAmount → Credit/Debit Note** 最后的销售财务调整链。
- **边界锁死（CTO 启动令 + Design Review 98/100）**：**CN/DN 不修改原 Invoice 金额事实**（invoiceTotal/subtotal/taxAmount/行快照一律不动）；**不承担 Receipt/Allocation Reversal**（收款冲销仍属 4E-2）；**AR.adjustedAmount 是聚合结果，不允许 PATCH**；**Credit Note 负向调整 AR、Debit Note 正向调整 AR**；所有 adjustment 必须能追溯到 `sourceInvoiceId / sourceInvoiceLineId`；**已有付款时允许 CN，但按当前 AR.balance 与 adjustedAmount 规则处理，不回滚 Receipt**；已支付完再开 CN 形成的负余额场景在设计阶段明确（负 AR projection，不新增数据库状态）。

## 决策

### 1. CN/DN = Invoice Adjustment 事实源（核心定位）

- **Credit Note / Debit Note 统一为 Invoice Adjustment 的载体**：不直接修改 Invoice 金额事实，不直接改 AR——经中间事实层 `InvoiceAdjustment` 生效。
- `InvoiceAdjustment` 是**真正影响 AR.adjustedAmount 的事实中间层**（类比：ReceiptAllocation 是收款↔AR 中间层、WriteOffAllocation 是写销↔AR 明细）。
- 核心链路：`Invoice → CreditDebitNote → CreditDebitNoteLine → InvoiceAdjustment → AR.adjustedAmount → AR.balanceAmount（computeBalance）→ Invoice.balanceAmount 投影`。
- 好处：折让 / 退货 / 价差 / 更正统一走同一事实层；后续扩展不污染 CN/DN 语义。

### 2. 不修改原 Invoice 金额事实（CTO 锁死）

- Invoice 头金额（invoiceTotal / subtotal / taxAmount）与行金额快照（lineAmount / taxAmount / totalAmount / unitPrice / discountRate）**财务事实不可变**。
- Invoice 上唯一允许变化的投影：`paidAmount`（4E-2 Payment 回写）、`balanceAmount`（= AR newBalance，4E-2 修复后口径）。
- **Invoice.balanceAmount 投影**：CN/DN Apply 后直接回写 AR 计算出的 newBalance（computeBalance 单入口），不自行重算——延续 4E-2 CTO 阻断项① 修复。

### 3. 不承担 Receipt / Allocation Reversal（CTO 锁死，延续 ADR-0021 §5）

| 概念 | 语义 | 归属 |
| --- | --- | --- |
| `Credit Note` | 发票/应收金额发生**负向调整**（冲减：折让/退货/价差/更正） | **4E-3 发票调整域** |
| `Debit Note` | 发票/应收金额发生**正向调整**（补收：补价/更正少开） | **4E-3 发票调整域** |
| `Receipt Reversal` | 收款事实发生撤销（如银行退票） | **4E-2 收款域** |
| `Allocation Reversal` | 原核销关系被撤销 | **4E-2 核销域** |

- **红线：CN/DN 不承担收款冲销**——银行退票不是 CN，原 Invoice 金额未变。
- **已有付款允许 CN**：按当前 AR.balance 与 adjustedAmount 规则处理，**不回滚 Receipt / ReceiptAllocation**（收款是已发生事实）。

### 4. AR.adjustedAmount 聚合规则（禁 PATCH）+ 符号口径（CTO 98/100 拍板）

- **全系统唯一符号规则**：`Credit Note → adjustmentAmount < 0`；`Debit Note → adjustmentAmount > 0`。请求可输入正数（业务口径），但**落入 InvoiceAdjustment 的财务事实必须规范成有符号金额**（signed adjustment），禁止在不同 API 中用“CN amount 正数但 Apply 时再减”的混合语义。
- `AR.adjustedAmount` = Σ(该 AR 对应 Invoice 的全部已 Apply InvoiceAdjustment.adjustmentAmount)，**可正可负**（CN 负 / DN 正）。
- 唯一写入口：InvoiceAdjustment Apply 事务（服务端聚合，禁止前端/接口直改）。
- 余额唯一口径不变：`AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（computeBalance 单入口，4E-1 锁定）。
  - 示例（CTO）：Invoice 1000、Paid 1000、CN -200 → AR.balance = 1000 - 200 - 1000 = **-200**（客户有 200 Credit）。
- **负余额表达（CTO 拍板：不新增数据库状态）**：AccountsReceivableStatus 不加 CREDIT 枚举；只做读取投影：`isCreditBalance = balance < 0`；`creditAmount = abs(balance)`；`effectiveBalanceType = DEBIT / SETTLED / CREDIT`。
- **锁死（CTO）**：balance < 0 → 不参与 Aging / OVERDUE 判定；禁止 WriteOff；Receipt Allocation 不得继续核销到该 AR；后续 DN 可把负余额向 0 拉回；Refund / CustomerCredit 后续模块再消费这笔 Credit。

### 5. 核心模型（三件套：CreditDebitNote + CreditDebitNoteLine + InvoiceAdjustment）

- `CreditDebitNote`（头）：noteType（CREDIT/DEBIT）、code（CN-/DN-2026-xxxx，DocumentSequence **创建即取号**）、sourceInvoiceId（**必填且唯一——单票制，CTO 拍板①**）、customerId、currency、reason、adjustmentTotal（= Σ lines，服务端计算）、status（DRAFT/SUBMITTED/APPROVED/REJECTED/APPLIED）、approvalPolicyId?、workflowInstanceId?、approvalStatus、appliedAt/appliedById。
- `CreditDebitNoteLine`（明细）：逐行溯源 sourceInvoiceLineId；quantity（>0；**部分行数量调整——CTO 拍板④，必须累计防超调**）；unitPrice/discountRate/lineAmount/taxAmount/totalAmount **直接复制 InvoiceLine 快照，不重算、不调用 Pricing Engine**。
- `InvoiceAdjustment`（事实中间层，**4E-3 最核心事实层，CTO 批准**）：sourceNoteId / sourceNoteLineId / invoiceId / invoiceLineId?（可空=整票调整）/ accountsReceivableId / customerId / currency / adjustmentType（CREDIT 负 / DEBIT 正）/ quantity / **adjustmentAmount（signed：CN<0 / DN>0）** / appliedAt? / appliedById? / **reversedAt? / reversedById?（预留，4E-3 首版可不实现 reversal）**；**Apply 前不生效**。

### 6. Apply 事务红线（Final Review 检查点——CTO 98/100 锁定顺序）

```
Lock CreditDebitNote（FOR UPDATE）
 ↓
状态/审批门禁：APPLIED → 409 CN_DN_ALREADY_APPLIED（幂等稳定 409）
             非 SUBMITTED → 409 CN_DN_INVALID_STATE
             命中审批但未 APPROVED → 409 CN_DN_APPROVAL_REQUIRED
             无策略 → 可直接 Apply
 ↓
Lock Invoice（FOR UPDATE）
 ↓
Lock source InvoiceLines（按 id ASC，FOR UPDATE——防死锁锁序）
 ↓
Lock 全部目标 AR（按 id ASC，FOR UPDATE）
 ↓
校验 customerId / currency 与 AR 一致（409 CN_DN_CUSTOMER_MISMATCH / CN_DN_CURRENCY_MISMATCH）
 ↓
**累计 CN/DN 防超调（CTO 拍板，本轮最重要补充）**：
  remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty
  newCreditQty ≤ remainingAdjustableQty（否则 409 CN_DN_QUANTITY_EXCEEDED）
  金额同样累计上限校验（否则 409 CN_DN_AMOUNT_EXCEEDED）
 ↓
Create InvoiceAdjustment facts（signed adjustmentAmount：CN<0 / DN>0）
 ↓
AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合）
 ↓
AR.balanceAmount = computeBalance(...)（单入口）
 ↓
AR status / credit projection（isCreditBalance / effectiveBalanceType）
 ↓
Invoice.balanceAmount = AR newBalance（**Invoice 金额事实不动**）
 ↓
AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
 ↓
CreditDebitNote = APPLIED + appliedAt/appliedById
 ↓
Audit / Events（事务外：InvoiceAdjustmentApplied + AccountsReceivableAdjusted 同时发布）
```

- **累计防超调（CTO 98/100 拍板，本轮最重要补充）**：不能只检查本次 quantity ≤ invoiceLine.quantity（连续 CN#1=60、CN#2=60 单张合法但累计 120）；必须按 sourceInvoiceLineId 聚合所有已 APPLIED、未撤销的 Credit Adjustment：`remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty`，`newCreditQty ≤ remainingAdjustableQty`；金额同样累计上限校验（409 CN_DN_QUANTITY_EXCEEDED / CN_DN_AMOUNT_EXCEEDED）。
- **并发 Apply 锁序（CTO 锁定）**：Lock Note → Lock Invoice/InvoiceLine → Lock AR，统一稳定锁序——否则两张 CN 同时 Apply 仍可能双双通过累计检查。
- 同一 InvoiceAdjustment 只 Apply 一次（appliedAt 非空即已生效；重复 Apply → 稳定 409 CN_DN_ALREADY_APPLIED）。
- **负余额 AR 锁死**：balance < 0 → 禁止 WriteOff（allocation ≤ AR.balanceAmount 校验自然拒绝 balance≤0）、Receipt Allocation 不得继续核销到该 AR、不参与 Aging。

### 7. 审批边界（CTO 拍板③：条件审批，Workflow 唯一审批事实源）

- CN/DN **按 ApprovalPolicy(module=CREDIT_DEBIT_NOTE) 条件审批**（复用 Workflow，不建 CreditDebitNoteApproval / CreditNoteApproval / DebitNoteApproval 表）。
- 时序：Create → Submit →（命中策略 → Workflow → APPROVED）→ **显式 Apply**；审批完成前禁止提前修改 AR.adjustedAmount。
- **APPROVED ≠ APPLIED**（与 WriteOff 同构：审批只回写投影，Apply 才是唯一回写 AR.adjustedAmount 的入口）。
- 未命中策略 → 可直接进入可 Apply 状态（CTO 拍板③）。

### 8. 事件注册（EVENTS.md v1.12）

- `CreditDebitNoteCreated / Submitted / Approved / Rejected` + `InvoiceAdjustmentApplied`（4E-3 注册）。
- **Apply 成功时同时发布 `InvoiceAdjustmentApplied` + `AccountsReceivableAdjusted`**（后者 v1.9 已注册，复用不重复定义——CTO 拍板）。

### 9. 编号与溯源

- 编号：DocumentSequence **创建即取号**（CN-/DN-2026-xxxx；调整单是财务事实，创建即占号——拍板④ 语义延续）。
- 溯源：CreditDebitNoteLine.sourceInvoiceLineId（行级）+ InvoiceAdjustment.sourceNoteId/sourceNoteLineId/invoiceId/invoiceLineId（双溯源，审计可追溯）。

### 10. DN 上限（CTO 拍板⑤：第一版禁止超原 Invoice 金额）

- **行级可调整上限**：`cumulative debit adjustment + current debit adjustment ≤ ceiling`（第一版 ceiling = 原行金额）。
- 超过 → 409 CN_DN_AMOUNT_EXCEEDED。
- 未来无上限补价（运输费/利息/额外费用）需单独 ADR + ADDITIONAL_CHARGE 类调整模型 + 权限/审批策略，**不在 4E-3 放开无限 DN**。

### 11. Invoice 原始事实边界（CTO 锁死）

- CN/DN Apply 后不得修改：`Invoice.invoiceTotal / InvoiceLine.quantity / unitPrice / lineAmount / taxAmount / InvoiceSnapshot`。
- 允许变化：仅 `Invoice.balanceAmount` 投影（= AR newBalance）；本 Sprint 不增加 adjustment summary projection。

### 12. 模型范围（CTO 拍板：不膨胀）

- 只保留：`CreditDebitNote / CreditDebitNoteLine / InvoiceAdjustment`。
- 不增加：`CreditNoteApproval / DebitNoteApproval / CustomerCredit / Refund / AdjustmentAllocation`（后续模块）。

## 未决状态（5 个 Pending 全部拍板，Design Review 98/100 APPROVED WITH CHANGES）

| # | 问题 | CTO 拍板 |
| --- | --- | --- |
| ① | CN/DN 是否允许跨 Invoice 合并？ | **第一版禁止，单票制**——sourceInvoiceId 必填且唯一；跨票 Consolidated Adjustment 延后 |
| ② | 已全额付款后的 CN 产生负 AR 还是 Customer Credit？ | **负 AR 方案 A**——允许 balanceAmount < 0（=Customer Credit/可退可抵），**不新增数据库状态**，只做读取投影 isCreditBalance/creditAmount/effectiveBalanceType；暂不建 CustomerCredit 实体 |
| ③ | CN/DN 是否必须审批？ | **条件审批**——复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE)，不建 Approval 表；未命中策略可直接进入可 Apply 状态 |
| ④ | CN/DN 是否支持部分行数量调整？ | **批准支持，但必须累计防超调**——remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty；金额同样累计上限校验（409 CN_DN_QUANTITY_EXCEEDED / CN_DN_AMOUNT_EXCEEDED）；并发 Apply 锁序：Lock Note → Lock Invoice/InvoiceLine → Lock AR |
| ⑤ | 是否允许 Debit Note 超过原 Invoice 金额？ | **第一版禁止**——行级 ceiling（第一版 = 原行金额），超过 409；未来无上限补价需单独 ADR + ADDITIONAL_CHARGE 模型 |

**3 项设计调整（进入 Schema 前已落实）**：① CN 累计数量/金额防超调 + Apply 并发锁定（§6）；② 负 AR 只做 credit projection 不新增数据库状态（§4，并锁死：不参与 Aging / 禁 WriteOff / Receipt Allocation 不得继续核销 / DN 可拉回 0）；③ CN/DN 符号口径统一：CN → adjustmentAmount < 0、DN → adjustmentAmount > 0，AR 公式不变（§4）。
