# Sprint 4E-3：Credit Note / Debit Note Design（发票调整与应收调整领域设计）

> 定位（CTO Final Review 2026-08-08，Sprint 4E-2 APPROVE & MERGE 后启动）：**CN/DN = Invoice Adjustment 事实源**；
> **不修改原 Invoice 金额事实**（invoiceTotal/subtotal/taxAmount 保持财务快照不变）；**不承担 Receipt/Allocation Reversal**（银行退票等收款冲销仍属 4E-2）；
> **AR.adjustedAmount 是聚合结果，不允许 PATCH**（唯一入口：InvoiceAdjustment 事实 Apply）；
> **Credit Note 负向调整 AR（减余额）、Debit Note 正向调整 AR（增余额）**；
> 所有 adjustment 必须能追溯到 `sourceInvoiceId / sourceInvoiceLineId`（含 InvoiceAdjustment 中间层双溯源）。
> 核心模型（用户建议采纳）：**CreditDebitNote + CreditDebitNoteLine + InvoiceAdjustment**——InvoiceAdjustment 作为真正影响 AR 的事实中间层，
> 比直接让 CN/DN 更新 AR 更稳，后续可统一支持折让、退货、价差、更正。
> **本阶段只做设计**：不写 Schema / Migration（Migration 0020 待 Design Review 拍板后实现）/ API；**不创建 Migration 0020**。

---

## 1. 模型范围（CTO 锁定 + Design Review 拍板）

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | CreditDebitNote | 发票调整单头（CN/DN 统一载体；type 区分 CREDIT/DEBIT；不修改原 Invoice） |
| ✅ 新增 | CreditDebitNoteLine | 调整明细（逐行溯源 sourceInvoiceLineId；支持部分行数量调整——Pending ④） |
| ✅ 新增 | InvoiceAdjustment | **事实中间层**（真正回写 AR.adjustedAmount 的载体；CN/DN 与 AR 之间唯一桥） |
| ❌ 禁止 | 修改 Invoice 金额事实 | invoiceTotal/subtotal/taxAmount/行金额快照一律不动（财务事实不可变） |
| ❌ 禁止 | 直接 PATCH AR.adjustedAmount | 前端/接口禁止直改；只能由 InvoiceAdjustment Apply 事务聚合回写 |
| ❌ 禁止 | CN/DN 承担收款冲销 | Receipt Reversal / Allocation Reversal 属 4E-2；银行退票不是 CN（ADR-0021 锁死） |
| ❌ 禁止 | 回滚已核销 Receipt | 已有付款允许开 CN，按当前 AR.balance 与 adjustedAmount 规则处理，**不回滚 Receipt** |
| ❌ 禁止 | 新建审批表 | 复用 Workflow / ApprovalPolicy（与 4A-4E-2 同构，Pending ③ 确认是否必须审批） |

**核心链路（CTO 指令）**：
```
Invoice（单据事实源，金额快照不可变）
  └── CreditDebitNote（调整单头）── CreditDebitNoteLine（明细，逐行溯源）
        └── InvoiceAdjustment（事实中间层：真正影响 AR 的唯一入口）
              └── AccountsReceivable.adjustedAmount（聚合结果，禁 PATCH）
                    └── AR.balanceAmount = original + adjusted - paid - writeOff（computeBalance 单入口）
                          └── Invoice.balanceAmount 投影 = AR newBalance（4E-2 修复后口径）
```

---

## 2. 事实源边界（CTO 锁死）

### 2.1 四个事实域的边界区分（延续 ADR-0021 最重要修正）

| 概念 | 语义 | 归属 |
| --- | --- | --- |
| `Credit Note` | 发票/应收金额发生**负向调整**（冲减：折让/退货/价差/更正） | **4E-3 发票调整域** |
| `Debit Note` | 发票/应收金额发生**正向调整**（补收：补价/更正少开） | **4E-3 发票调整域** |
| `Receipt Reversal` | 收款事实发生撤销（如银行退票：Invoice 金额没变，变的是这笔钱实际没收到） | **4E-2 收款域** |
| `Allocation Reversal` | 原核销关系被撤销（解除核销，回退 AR/Invoice/Receipt 投影） | **4E-2 核销域** |

- **红线：CN/DN 不承担收款冲销**——客户付款 RM10,000 银行退票，这不是 CN，原 Invoice 金额未变（ADR-0021 §5 锁死）。
- **红线：已有付款时允许 CN**——但必须以当前 AR.balance 与 adjustedAmount 规则处理，**不回滚 Receipt / ReceiptAllocation**（收款是已发生事实）。

### 2.2 AR.adjustedAmount 聚合规则（禁 PATCH）+ 符号口径（CTO 98/100 拍板）

- **全系统唯一符号规则（CTO 拍板）**：`Credit Note → adjustmentAmount < 0`；`Debit Note → adjustmentAmount > 0`。请求可输入正数（业务口径），但**落入 InvoiceAdjustment 的财务事实必须规范成有符号金额**（signed adjustment），禁止在不同 API 中用“CN amount 正数但 Apply 时再减”的混合语义。
- `AR.adjustedAmount` = Σ(该 AR 对应 Invoice 的全部已 Apply InvoiceAdjustment.adjustmentAmount)，**可正可负**（CN 负 / DN 正）。
- 唯一写入口：InvoiceAdjustment Apply 事务（服务端聚合，禁止前端/接口直改）。
- 余额唯一口径不变：`AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`（computeBalance 单入口，4E-1 锁定）。
  - 示例（CTO）：Invoice 1000、Paid 1000、CN -200 → AR.balance = 1000 - 200 - 1000 = **-200**（客户有 200 Credit）。

---

## 3. CreditDebitNote 模型（头）

> 编号：DocumentSequence **创建即取号**（拍板④ 语义延续：CN-/DN-2026-xxxx；调整单是财务事实，创建即占号）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | String PK | |
| code | String UK | CN-/DN-2026-xxxx（DocumentSequence 创建即取号） |
| noteType | enum | CREDIT（负向）/ DEBIT（正向） |
| sourceInvoiceId | String FK | 溯源发票（单票制；跨 Invoice 合并见 Pending ①） |
| customerId | String FK | 客户（必须与 sourceInvoice.customerId 一致——409 CN_DN_CUSTOMER_MISMATCH） |
| currency | String | 币种（必须与 sourceInvoice.currency 一致——409 CN_DN_CURRENCY_MISMATCH，第一版禁止跨币种调整） |
| reason | String | 调整原因（折让/退货/价差/更正/其他） |
| adjustmentTotal | Decimal(18,4) | 调整总额 = Σ lines（服务端计算，禁止直传头金额） |
| status | enum | DRAFT / SUBMITTED / APPROVED / REJECTED / APPLIED |
| approvalPolicyId | String? | 条件审批（可空；Pending ③） |
| workflowInstanceId | String? | 审批实例（Workflow 唯一审批事实源；不建 CreditDebitNoteApproval 表） |
| approvalStatus | ApprovalStatus | 审批投影（DRAFT/PENDING/APPROVED/REJECTED——APPROVED ≠ APPLIED） |
| appliedAt / appliedById | DateTime? / String? | **APPLIED 才回写 AR**（与 WriteOff 同构：审批通过 ≠ 自动改余额） |
| 统一审计字段 | | isActive/createdById/updatedById/version/deletedAt/createdAt/updatedAt |

### 状态机

```
DRAFT → SUBMITTED →（无策略）APPLIED /（有策略）APPROVED → APPLIED
                    （REJECTED → DRAFT 重提）
```

---

## 4. CreditDebitNoteLine 模型（明细）

> 逐行溯源 `sourceInvoiceLineId`；金额快照**直接复制** InvoiceLine 既有快照（unitPrice/discountRate），禁止重新取价/调用 Pricing Engine（与 4D 红线一致）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | String PK | |
| creditDebitNoteId | String FK | 归属调整单（Cascade） |
| sourceInvoiceLineId | String FK | **溯源发票行**（SetNull 防御；必填语义） |
| lineNo | Int | 行号（10/20/30/40 步进） |
| itemId / description | String? / String | 复制快照（继承 InvoiceLine） |
| quantity | Decimal(18,4) | 调整数量（>0；**部分行数量调整**见 Pending ④） |
| unitPrice / discountRate | Decimal(18,4) | 复制 InvoiceLine 快照（不重算） |
| lineAmount / taxAmount / totalAmount | Decimal(18,4) | 复制计算值（不重算；合计进 adjustmentTotal） |
| 统一审计字段 | | 同头 |

---

## 5. InvoiceAdjustment：事实中间层（核心）

> **设计动机（用户建议）**：不直接让 CN/DN 更新 AR——中间加 `InvoiceAdjustment` 事实层，使 AR.adjustedAmount 的每次变动都有独立可追溯的事实记录；后续折让/退货/价差/更正全部经此层，不污染 CN/DN 语义。
> 类比：ReceiptAllocation（收款↔AR 中间层）/ WriteOffAllocation（写销↔AR 明细）——**InvoiceAdjustment 是调整↔AR 的事实中间层**。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | String PK | |
| sourceNoteId | String FK | 溯源调整单（CreditDebitNote） |
| sourceNoteLineId | String FK | 溯源调整行（CreditDebitNoteLine） |
| invoiceId | String FK | 目标发票（**冗余双溯源：sourceNote→sourceInvoice 也推导，此处落库便于查询**） |
| invoiceLineId | String? FK | 目标发票行（可空：整票调整时为空） |
| accountsReceivableId | String FK | 目标 AR（invoiceId 1:1 推导，落库便于 Apply 锁定） |
| customerId / currency | String | 冗余（Apply 事务校验与 AR 一致） |
| adjustmentType | enum | CREDIT（负向）/ DEBIT（正向） |
| quantity | Decimal(18,4) | 调整数量（与 CreditDebitNoteLine.quantity 一致；累计防超调用） |
| adjustmentAmount | Decimal(18,4) | **有符号调整金额（CTO 拍板：CN < 0、DN > 0）**——全系统唯一符号口径，禁止“请求正数/落库负数”混合语义 |
| appliedAt / appliedById | DateTime? / String? | Apply 回写时间（null = 未生效） |
| reversedAt / reversedById | DateTime? / String? | **预留**（CTO：4E-3 首版可不实现 reversal，但字段预留） |
| 统一审计字段 | | 同头 |

### 事务红线（Apply，Final Review 检查点——CTO 98/100 锁定顺序）

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
  按 sourceInvoiceLineId 聚合所有已 APPLIED、未撤销的 InvoiceAdjustment：
  remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty
  newCreditQty ≤ remainingAdjustableQty（否则 409 CN_DN_QUANTITY_EXCEEDED）
  金额同样累计上限校验（否则 409 CN_DN_AMOUNT_EXCEEDED）
 ↓
同事务：
  Create InvoiceAdjustment facts（signed adjustmentAmount：CN<0 / DN>0）
  AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合）
  AR.balanceAmount 重算（computeBalance 单入口）
  AR status / credit projection（isCreditBalance / effectiveBalanceType——CTO 拍板）
  Invoice.balanceAmount 投影 = AR newBalance（4E-2 修复后口径；**Invoice 金额事实不动**）
  AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
  InvoiceAdjustment 各条 appliedAt/appliedById 回写
  CreditDebitNote status=APPLIED + appliedAt/appliedById
 ↓
Audit / Events（事务外：InvoiceAdjustmentApplied + AccountsReceivableAdjusted 同时发布，失败降级不阻断；DB 事实更新不静默失败）
```

### 累计防超调（CTO 98/100 拍板，本轮最重要补充）

- **不能只检查本次** `quantity ≤ InvoiceLine.quantity`——连续多张 CN 会累计超调（例：原 100 PCS，CN#1=60、CN#2=60，单张均合法但累计 120）。
- **Apply 时必须按 sourceInvoiceLineId 聚合所有已 APPLIED、未撤销的 Credit Adjustment**：
  ```
  remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty
  newCreditQty ≤ remainingAdjustableQty
  ```
- **金额同样累计上限校验**（CN_DN_AMOUNT_EXCEEDED）。
- **并发 Apply 锁序（CTO 锁定）**：Lock Note → Lock Invoice/InvoiceLine → Lock AR，统一稳定锁序——否则两张 CN 同时 Apply 仍可能双双通过累计检查。

### 防重复/幂等

- 同一 InvoiceAdjustment 只 Apply 一次（appliedAt 非空即已生效；重复 Apply → 稳定 409 CN_DN_ALREADY_APPLIED）。
- 并发 Apply 同一 CN → 锁内重读状态，第二个 409。

---

## 6. 已有付款的 CN / 负余额场景（Pending ②，必须明确）

### 6.1 场景

- Invoice = 100，已全额收款（AR.paidAmount=100，balance=0，status=PAID）。
- 客户退货开 CN = 20 → AR.adjustedAmount = -20 → balance = 100 + (-20) - 100 - 0 = **-20（负余额）**。

### 6.2 负余额的含义与投影（CTO 98/100 拍板：不新增数据库状态）

- **负余额 = 客户多付/可退或可抵**（应收为负 → 形成对客户负债方向，非收款事实）。
- **不回滚 Receipt**：收款 RM100 是已发生事实，Receipt/ReceiptAllocation 原样保留；负余额是调整后的净额投影。
- **CTO 拍板：不扩展 AccountsReceivableStatus**（不加 CREDIT 枚举）——数据库状态保持生命周期/付款状态语义（OPEN/PARTIALLY_PAID/PAID/CLOSED + OVERDUE effective），**负 AR 只做读取时投影**：
  ```
  isCreditBalance = balanceAmount < 0
  creditAmount     = abs(balanceAmount)
  effectiveBalanceType = balance < 0 ? "CREDIT" : balance == 0 ? "SETTLED" : "DEBIT"
  ```
- **锁死规则（CTO）**：
  - balance < 0 → **不参与 Aging / OVERDUE 判定**
  - balance < 0 → **禁止 WriteOff**（allocation ≤ AR.balanceAmount 校验自然拒绝 balance≤0）
  - balance < 0 → **Receipt Allocation 不得继续核销到该 AR**（禁止向负余额 AR 再核销）
  - 后续 **DN 可以把负余额向 0 拉回**（正向调整）
  - 后续真正 Refund / CustomerCredit 模块再消费这笔 Credit（4E-3 不实现）

### 6.3 处理方案（Pending ② 已拍板：方案 A）

| 方案 | 语义 | 结论 |
| --- | --- | --- |
| **A. 负 AR 余额投影（CTO 拍板采纳）** | balanceAmount 允许为负（=Customer Credit/可退可抵），只做读取投影 isCreditBalance/creditAmount/effectiveBalanceType，不新增数据库状态 | **✅ 第一版采用** |
| B. Customer Credit 独立实体 | CN 触发 AR 归零 + 生成独立 CustomerCredit | ❌ 延后（模型膨胀，后续 Refund/CustomerCredit 模块） |

### 6.4 已付款 CN 的校验边界（不回滚）

- CN Apply 不校验 AR.paidAmount 是否覆盖调整额——只按 `adjustedAmount 聚合 + balance 重算` 处理。
- 若 balance 因 CN 变负，**禁止 WriteOff / 禁止继续 Receipt Allocation 核销**（CTO 锁死：balance<0 → 不参与 Aging、禁止 WriteOff、Receipt Allocation 不得继续核销到该 AR）。
- 负余额 AR 允许后续 **DN 正向调整把余额向 0 拉回**（拉回至 ≥0 后恢复 normal 语义）。

---

## 7. 事件注册（EVENTS.md v1.12，先注册后开发）

| 事件 | 归属 | 说明 |
| --- | --- | --- |
| `CreditDebitNoteCreated` | 4E-3 | 创建调整单（DRAFT） |
| `CreditDebitNoteSubmitted` | 4E-3 | 提交审批（命中策略触发 Workflow） |
| `CreditDebitNoteApproved` | 4E-3 | 审批通过（Workflow 回调，投影回写） |
| `CreditDebitNoteRejected` | 4E-3 | 审批驳回（→ DRAFT 重提） |
| `InvoiceAdjustmentApplied` | 4E-3 | **Apply 完成（AR.adjustedAmount 聚合回写）** |
| `AccountsReceivableAdjusted` | **v1.9 已注册（复用，不重复注册）** | **Apply 成功时与 InvoiceAdjustmentApplied 同时发布**（CTO 拍板） |

> 注：`AccountsReceivableAdjusted`（v1.9 已注册待实现）为 4E-3 核心联动事件——**Apply 成功时同时发布 InvoiceAdjustmentApplied + AccountsReceivableAdjusted**，不重复定义新事件名。

---

## 8. Migration 0020 草案（实现阶段——**本次不创建**）

- 纯增量：`CreditDebitNote` / `CreditDebitNoteLine` / `InvoiceAdjustment`（+3 模型 / +2 枚举：CreditDebitNoteType（CREDIT/DEBIT）/ CreditDebitNoteStatus；DocumentSequence +CN/DN 序列）
- **红线：不动 Invoice / AccountsReceivable 既有表**（AR 已含 adjustedAmount/balanceAmount；Invoice 金额事实不可变）
- 备注：`InvoiceAdjustment` 落 invoiceLineId（可空）支持整票调整；`@@unique([sourceNoteId, invoiceId, invoiceLineId])` 防重复调整行

---

## 9. CTO Pending Decisions 拍板结果（Design Review 98/100 APPROVED WITH CHANGES）

| # | 问题 | CTO 拍板 |
| --- | --- | --- |
| ① | CN/DN 是否允许跨 Invoice 合并？ | **第一版禁止，单票制**——sourceInvoiceId 必填且唯一；跨票 Consolidated Adjustment 延后 |
| ② | 已全额付款后的 CN 产生负 AR 还是 Customer Credit？ | **负 AR 方案 A**——第一版允许 balanceAmount < 0（=Customer Credit/可退可抵余额）；**不新增数据库状态**（不加 CREDIT 枚举），只做读取投影 isCreditBalance/creditAmount/effectiveBalanceType；暂不建 CustomerCredit 实体 |
| ③ | CN/DN 是否必须审批？ | **条件审批**——复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE)，不建 Approval 表；未命中策略可直接进入可 Apply 状态 |
| ④ | CN/DN 是否支持部分行数量调整？ | **批准支持，但必须累计防超调**——不能只检查本次 quantity ≤ invoiceLine.quantity；按 sourceInvoiceLineId 聚合已 APPLIED 未撤销的 Credit：remainingAdjustableQty = originalInvoiceQty - cumulativeAppliedCreditQty，newCreditQty ≤ remainingAdjustableQty；金额同样累计上限校验（409 CN_DN_QUANTITY_EXCEEDED / CN_DN_AMOUNT_EXCEEDED）；并发 Apply 锁序：Lock Note → Lock Invoice/InvoiceLine → Lock AR（统一稳定锁序） |
| ⑤ | 是否允许 Debit Note 超过原 Invoice 金额？ | **第一版禁止**——行级可调整上限：cumulative debit + current debit ≤ ceiling（第一版 ceiling = 原行金额）；超过 409；未来无上限补价（运输费/利息/额外费用）需单独 ADR + ADDITIONAL_CHARGE 类调整模型 + 权限/审批策略 |

### 3 项设计调整（CTO 98/100 指令，进入 Schema 前必须落实）

1. **CN 累计数量/金额防超调 + Apply 并发锁定规则**（见 §5 事务红线）——剩余可调 = 原数量 - 累计已生效 Credit；并发 Apply 统一锁序防止双双通过。
2. **负 AR 只做 credit projection，不新增数据库状态**（见 §6）——isCreditBalance / creditAmount / effectiveBalanceType；锁死：balance<0 → 不参与 Aging、禁止 WriteOff、Receipt Allocation 不得继续核销到该 AR；DN 可拉回 0；Refund/CustomerCredit 后续消费。
3. **CN/DN 符号口径统一**（见 §2.2）——CN → adjustmentAmount < 0；DN → adjustmentAmount > 0；AR 公式不变 balance = original + adjusted - paid - writeOff；请求可输入正数，但落 InvoiceAdjustment 的财务事实必须规范成有符号金额，禁止混合语义。

---

## 10. 边界红线（本阶段无越界实现）

- ❌ 不写 Schema / Migration（Migration 0020 待拍板后实现）
- ❌ 不修改 Invoice 金额事实（invoiceTotal/subtotal/taxAmount/行快照一律不动；只允许 Invoice.balanceAmount 投影 = AR newBalance）
- ❌ 不直接 PATCH AR.adjustedAmount / balanceAmount / paidAmount / writeOffAmount
- ❌ CN/DN 不承担收款冲销（Receipt Reversal / Allocation Reversal 属 4E-2）
- ❌ 不开 CN/DN 时不回滚已核销 Receipt / ReceiptAllocation
- ❌ 不新建审批表（复用 Workflow / ApprovalPolicy；不建 CreditDebitNoteApproval / CreditNoteApproval / DebitNoteApproval）
- ❌ 不新增数据库状态表达负 AR（AccountsReceivableStatus 不加 CREDIT；只做读取投影 isCreditBalance/creditAmount/effectiveBalanceType）
- ❌ 不建 CustomerCredit / Refund / AdjustmentAllocation / ADDITIONAL_CHARGE 实体（4E-3 范围不膨胀；未来单独 ADR）
- ❌ 不调用 Pricing Engine（金额快照直接复制，与 4D 红线一致）
