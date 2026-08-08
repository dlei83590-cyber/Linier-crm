# ADR-0022：Credit Note / Debit Note Domain（发票调整与应收调整领域决策）

- 状态：**Proposed（2026-08-08，Sprint 4E-3 Design Review 待拍板）**——5 个 Pending Decisions 待 CTO 拍板后进入 Schema → Migration 0020 → Seed → RBAC → API 实现阶段
- 日期：2026-08-08
- 关联：ADR-0019（Invoice Domain）、ADR-0020（Accounts Receivable Domain）、ADR-0021（Receipt & Payment Allocation Domain）、Sprint4E3_CreditDebitNote_Design.md、EVENTS.md（v1.12 注册）
- 背景：Sprint 4E-2 Receipt & Payment Allocation 已合并（PR #17，b84b036；CTO Final Review APPROVE & MERGE，3 项财务一致性阻断项修复后复核全 PASS）。CTO 启动 4E-3：**CN/DN = Invoice Adjustment 事实源**；补齐 **Invoice Adjustment → AR.adjustedAmount → Credit/Debit Note** 最后的销售财务调整链。
- **边界锁死（CTO 启动令）**：**CN/DN 不修改原 Invoice 金额事实**（invoiceTotal/subtotal/taxAmount/行快照一律不动）；**不承担 Receipt/Allocation Reversal**（收款冲销仍属 4E-2）；**AR.adjustedAmount 是聚合结果，不允许 PATCH**；**Credit Note 负向调整 AR、Debit Note 正向调整 AR**；所有 adjustment 必须能追溯到 `sourceInvoiceId / sourceInvoiceLineId`；**已有付款时允许 CN，但按当前 AR.balance 与 adjustedAmount 规则处理，不回滚 Receipt**；已支付完再开 CN 形成的负余额场景必须在设计阶段明确。

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

### 4. AR.adjustedAmount 聚合规则（禁 PATCH）

- `AR.adjustedAmount = Σ(该 AR 对应 Invoice 的全部已 Apply InvoiceAdjustment.amount)`，**可正可负**（CN 负 / DN 正）。
- 唯一写入口：InvoiceAdjustment Apply 事务（服务端聚合）。
- 余额唯一口径不变：`AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（computeBalance 单入口，4E-1 锁定）。
- **负余额表达（Pending ②）**：CN 后 balance 可为负（= 客户多付/可退或可抵）；第一版方案 A（负 AR 余额投影），CustomerCredit 独立实体延后；负余额不参与 aging/OVERDUE 判定，可被后续收款核销/DN 补平。

### 5. 核心模型（三件套：CreditDebitNote + CreditDebitNoteLine + InvoiceAdjustment）

- `CreditDebitNote`（头）：noteType（CREDIT/DEBIT）、code（CN-/DN-2026-xxxx，DocumentSequence **创建即取号**）、sourceInvoiceId、customerId、currency、reason、adjustmentTotal（= Σ lines，服务端计算）、status（DRAFT/SUBMITTED/APPROVED/REJECTED/APPLIED）、approvalPolicyId?、workflowInstanceId?、approvalStatus、appliedAt/appliedById。
- `CreditDebitNoteLine`（明细）：逐行溯源 sourceInvoiceLineId；quantity（>0；部分行数量调整见 Pending ④）；unitPrice/discountRate/lineAmount/taxAmount/totalAmount **直接复制 InvoiceLine 快照，不重算、不调用 Pricing Engine**。
- `InvoiceAdjustment`（事实中间层）：sourceNoteId / sourceNoteLineId / invoiceId / invoiceLineId?（可空=整票调整）/ accountsReceivableId / customerId / currency / adjustmentType（CREDIT 负 / DEBIT 正）/ amount / appliedAt? / appliedById?；**Apply 前不生效**。

### 6. Apply 事务红线（Final Review 检查点，对齐 4E-2 WriteOff Apply）

```
Lock CreditDebitNote（FOR UPDATE）
 ↓
Lock 全部目标 AR（按 id ASC，FOR UPDATE——防死锁锁序）
 ↓
状态门禁：APPLIED → 409 CN_DN_ALREADY_APPLIED（幂等稳定 409）
        非 SUBMITTED → 409 CN_DN_INVALID_STATE
        命中审批但未 APPROVED → 409 CN_DN_APPROVAL_REQUIRED
        无策略 → 可直接 Apply
 ↓
校验 customerId / currency 与 AR 一致（409 CN_DN_CUSTOMER_MISMATCH / CN_DN_CURRENCY_MISMATCH）
 ↓
同事务：
  AR.adjustedAmount += Σ adjustment.amount（CN 负 / DN 正）
  AR.balanceAmount 重算（computeBalance 单入口）
  AR.status 投影（computeArStatus 统一 helper）
  Invoice.balanceAmount 投影 = AR newBalance（**Invoice 金额事实不动**）
  AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
  InvoiceAdjustment 各条 appliedAt/appliedById 回写
  CreditDebitNote status=APPLIED + appliedAt/appliedById
 ↓
事件（事务外，失败降级不阻断；DB 事实更新不静默失败）
```

- 同一 InvoiceAdjustment 只 Apply 一次（appliedAt 非空即已生效；重复 Apply → 稳定 409 CN_DN_ALREADY_APPLIED）。
- 负余额 AR 不允许再 WriteOff（WriteOff allocation ≤ AR.balanceAmount 校验自然拒绝 balance≤0）。

### 7. 审批边界（Pending ③，Workflow 唯一审批事实源）

- 对齐 WriteOff：CN/DN **按 ApprovalPolicy(module=CREDIT_DEBIT_NOTE) 条件审批**（复用 Workflow，不建 CreditDebitNoteApproval 表）。
- 时序：Create → Submit →（命中策略 → Workflow → APPROVED）→ **显式 Apply**；审批完成前禁止提前修改 AR.adjustedAmount。
- **APPROVED ≠ APPLIED**（与 WriteOff 同构：审批只回写投影，Apply 才是唯一回写 AR.adjustedAmount 的入口）。

### 8. 事件注册（EVENTS.md v1.12）

- `CreditDebitNoteCreated / Submitted / Approved / Rejected` + `InvoiceAdjustmentApplied`（4E-3 注册）。
- 联动：`AccountsReceivableAdjusted`（v1.9 已注册）4E-3 实现时发布。

### 9. 编号与溯源

- 编号：DocumentSequence **创建即取号**（CN-/DN-2026-xxxx；调整单是财务事实，创建即占号——拍板④ 语义延续）。
- 溯源：CreditDebitNoteLine.sourceInvoiceLineId（行级）+ InvoiceAdjustment.sourceNoteId/sourceNoteLineId/invoiceId/invoiceLineId（双溯源，审计可追溯）。

## 未决状态（5 个 Pending Decisions，Design Review 拍板）

| # | 问题 | 建议（待 CTO 拍板） |
| --- | --- | --- |
| ① | CN/DN 是否允许跨 Invoice 合并？ | 第一版单票制（sourceInvoiceId 单值）；跨票合并延后 |
| ② | 已全额付款后的 CN 产生负 AR 还是 Customer Credit？ | 第一版负 AR 余额投影（方案 A）；CustomerCredit 实体延后 |
| ③ | CN/DN 是否必须审批？ | 按 ApprovalPolicy(module=CREDIT_DEBIT_NOTE) 条件触发，不强制全部审批 |
| ④ | CN/DN 是否支持部分行数量调整？ | 支持（quantity ≤ 原行数量，CN 防超调） |
| ⑤ | 是否允许 Debit Note 超过原 Invoice 金额？ | 默认禁止（409 CN_DN_AMOUNT_EXCEEDED）；补价超出需单独授权 |
