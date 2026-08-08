# CTO Final Review Cover — Sprint 4E-3 Credit Note / Debit Note Foundation

**PR:** #18 – Sprint 4E-3 Credit Note / Debit Note Foundation
**Branch:** `feature/sprint4-sales`
**Head:** `f6d3059`（最终文档同步前 HEAD；Apply 专项复核后 CI 全绿）
**Status:** Ready for CTO Final Review（PR #18 待验收合并；合并后改 APPROVED & MERGED）

## 1. Scope

本 PR 完成 Sprint 4E-3 Credit Note / Debit Note Foundation 全部计划范围：

- Credit Note / Debit Note Domain（发票调整与应收调整领域：CN/DN = Invoice Adjustment 事实源）
- Schema + Migration 0020（CreditDebitNote / CreditDebitNoteLine / InvoiceAdjustment；纯增量不改既有；DocumentType 复用 CREDIT_NOTE/DEBIT_NOTE）
- Seed + RBAC（credit-debit-note 全 10 动作 + credit-debit-note-line view/edit + invoice-adjustment view（系统事实层只读））
- Create API（POST /api/credit-debit-notes：单票制 + 快照复制 + 不做事实落账）
- Submit API（POST /{id}/submit：DRAFT→SUBMITTED + 条件审批触发）
- Apply API（POST /{id}/apply：**唯一修改 AR.adjustedAmount/balanceAmount 的入口**）
- Workflow actions 接入（businessType="credit-debit-note" 终态回写）
- 负 AR 门禁（Receipt Allocation / WriteOff Apply 两个既有入口同步加）
- OpenAPI（+4 端点/+13 schemas）/ QA（T1-T21）/ Test Cases（166 用例）/ ADR-0022（Accepted + Implemented）/ EVENTS（v1.13）/ DOMAIN_MODEL（v1.15）/ CHANGELOG / RELEASE_NOTES / ROADMAP

**未包含（边界锁死）：**

- 修改原 Invoice 金额事实（invoiceTotal/行快照/InvoiceSnapshot 一律不动）
- CustomerCredit 表 / Refund / AdjustmentAllocation（负 AR 只做读取投影；CustomerCredit 延后）
- InvoiceAdjustment 客户端直接 create/edit API（系统事实层只读，唯一入口 Apply 事务）
- CN/DN Reversal（首版不实现；reversedAt/reversedById 字段预留）
- Receipt/Allocation Reversal 承担（收款冲销仍属 4E-2）
- PATCH AR.adjustedAmount（聚合结果，禁 PATCH）

## 2. 财务不变量（Final Review 最值得再核一次）

```
AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount
Invoice.balanceAmount = AR.balanceAmount
```

- `AR.balanceAmount` 唯一口径：computeBalance 单入口（4E-2 修复后延续）；Apply 后直接回写 AR。
- `Invoice.balanceAmount` 是投影：Apply 不自行重算，直接使用 AR 计算出的 newBalance 回写（4E-2 CTO 阻断项① 修复后口径）。
- `AR.adjustedAmount` 是聚合结果：= Σ(已 APPLIED 未 reversed 的 InvoiceAdjustment.adjustmentAmount)，禁 PATCH，唯一入口 Apply 事务。
- 例：Invoice 1000 全额付款（balance=0）→ CN -200 Apply → AR.balanceAmount = -200（Customer Credit projection）；DN +200 → 拉回 0。

## 3. Checklist（16 项，财务一致性优先）

| # | 检查项 | 结果 | 验证要点 |
| --- | --- | --- | --- |
| 1 | **单 Invoice 来源（单票制）** | ✅ | sourceInvoiceId 必填唯一（schema + create 路由）；跨票 Consolidated 延后 |
| 2 | **原 Invoice 金额事实不可变** | ✅ | Apply 只更新 Invoice.balanceAmount 投影；invoiceTotal/行快照/InvoiceSnapshot 一律不动（QA K1-K3） |
| 3 | **InvoiceAdjustment 唯一调整事实** | ✅ | 事实中间层，客户端禁直接创建/编辑（OpenAPI 只读 schema）；Create 不落 InvoiceAdjustment（QA T1） |
| 4 | **CN<0 / DN>0（符号口径）** | ✅ | `CREDIT → lineTotal.negated()`、`DEBIT → lineTotal`；AR.adjustedAmount = Σ signed（CTO 98/100 全系统唯一符号口径） |
| 5 | **累计 CN 数量 ceiling** | ✅ | remainingAdjustableQty = 原行数量 - Σ(已 APPLIED 未 reversed CREDIT quantity)；超限 409 CN_DN_QUANTITY_EXCEEDED（锁内重算） |
| 6 | **累计 DN 金额 ceiling** | ✅ | 累计同类型 abs + 本次 ≤ 原行金额；超限 409 CN_DN_AMOUNT_EXCEEDED（DN 第一版禁超原票） |
| 7 | **Apply 锁内重算** | ✅ | 事务内先锁后读既有 InvoiceAdjustment 再校验；非事务外读 |
| 8 | **固定锁序** | ✅ | Lock Note → Invoice → InvoiceLines（id ASC）→ AR；并发不穿透（QA L1-L2） |
| 9 | **APPROVED ≠ APPLIED** | ✅ | 审批终态只回写投影（syncCreditDebitNoteApproval）；Apply 才是唯一回写 AR.adjustedAmount 的入口；重复 Apply 409 |
| 10 | **负 AR 不新增 CREDIT 状态** | ✅ | AccountsReceivableStatus 无 CREDIT；computeArStatus 五态统一口径；负 AR 只做读取投影（QA J2） |
| 11 | **负 AR 禁 Receipt Allocation** | ✅ | balanceAmount < 0 → 409 RECEIPT_AR_NEGATIVE_BALANCE（receipts/[id]/allocate 门禁，锁内校验） |
| 12 | **负 AR 禁 WriteOff** | ✅ | balanceAmount < 0 → 409 WRITE_OFF_AR_NEGATIVE_BALANCE（write-offs/[id]/apply 门禁，锁内校验） |
| 13 | **Invoice.balanceAmount 跟随 AR** | ✅ | Apply 直接回写 AR newBalance（computeBalance 单入口）；不自行重算（4E-2 阻断项① 口径） |
| 14 | **重复 Apply 409** | ✅ | CN_DN_ALREADY_APPLIED（幂等稳定 409；并发双请求一个 201 一个 409） |
| 15 | **Workflow 唯一审批事实源** | ✅ | 复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE) + Workflow；不建 Approval 表；条件审批（命中→PENDING / 未命中→可直接 Apply） |
| 16 | **无范围越界** | ✅ | 无 CustomerCredit / Refund / AdjustmentAllocation / CreditNoteApproval 表；不修改原 Invoice 金额事实；不承担 Receipt/Allocation Reversal；不 PATCH AR.adjustedAmount |

## 4. 架构验证

### CN/DN = Invoice Adjustment 事实源（唯一）

- **InvoiceAdjustment = 事实中间层（4E-3 最核心事实层）**：真正影响 AR.adjustedAmount 的唯一入口；双溯源（sourceNoteId/sourceNoteLineId + invoiceId/invoiceLineId）+ accountsReceivableId；客户端禁直接创建/编辑（只读）。
- **事实链**：`Invoice → CreditDebitNote → CreditDebitNoteLine → InvoiceAdjustment → AR.adjustedAmount → AR.balanceAmount → Invoice.balanceAmount（投影）`。
- **单票制（CTO 拍板①）**：sourceInvoiceId 必填唯一；Customer/Currency 从原 Invoice 继承；只接受已 ISSUED 的 Invoice（409 CN_DN_SOURCE_INVOICE_INVALID）。
- **Create 不做事实落账**：只生成 CreditDebitNote(DRAFT) + Lines（金额快照复制，不调 Pricing Engine）；不创建 InvoiceAdjustment、不改 AR、不改 Invoice.balanceAmount。

### Apply 事务红线（CTO 98/100 + Apply 专项复核 100/100 锁定顺序）

```
Lock CreditDebitNote（FOR UPDATE）
 ↓
状态门禁：APPLIED → 409 CN_DN_ALREADY_APPLIED（幂等稳定 409）
         非 SUBMITTED → 409 CN_DN_INVALID_STATE
         命中审批未 APPROVED → 409 CN_DN_APPROVAL_REQUIRED
         无策略 → 可直接 Apply
 ↓
Lock Invoice（FOR UPDATE）
 ↓
Lock source InvoiceLines（按 id ASC，FOR UPDATE——防死锁锁序）
 ↓
Lock AccountsReceivable（FOR UPDATE）
 ↓
校验 customerId / currency 与 AR 一致（409 CN_DN_SOURCE_NOT_COMPATIBLE）
 ↓
累计 CN/DN 防超调（锁内重算）：
  CREDIT：remainingAdjustableQty = originalInvoiceLine.quantity - cumulativeAppliedCreditQty
          newCreditQty ≤ remainingAdjustableQty（否则 409 CN_DN_QUANTITY_EXCEEDED）
  金额：累计已 APPLIED 未 reversed 调整金额（**同类型** abs）+ 本次 ≤ 原行金额 ceiling
        （否则 409 CN_DN_AMOUNT_EXCEEDED；DN 第一版禁超原行金额）
 ↓
Create InvoiceAdjustment facts（signed adjustmentAmount：CN<0 / DN>0；部分行按数量比例折算快照金额，不重算、不调 Pricing Engine）
 ↓
AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合）
 ↓
AR.balanceAmount = computeBalance(...)（单入口：original + adjusted - paid - writeOff）
 ↓
AR status = computeArStatus(...)（统一口径；负 AR 不新增 CREDIT 状态，只做读取投影）
 ↓
Invoice.balanceAmount = AR newBalance（**Invoice 金额事实不动**）
 ↓
AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
 ↓
CreditDebitNote = APPLIED + appliedAt/appliedById
 ↓
Audit / Events（事务外：InvoiceAdjustmentApplied + AccountsReceivableAdjusted 同时发布，失败降级不阻断；DB 事实更新不因事件失败回滚）
```

### 负 AR = Customer Credit projection（CTO 拍板②）

- `balanceAmount < 0`（= Customer Credit / 可退可抵）：**不新增 AccountsReceivableStatus.CREDIT 数据库状态**；读取投影 `isCreditBalance = balance < 0` / `creditAmount = abs(balance)` / `effectiveBalanceType = DEBIT/SETTLED/CREDIT`。
- **门禁（真实生效）**：Receipt Allocation → 409 `RECEIPT_AR_NEGATIVE_BALANCE`；WriteOff Apply → 409 `WRITE_OFF_AR_NEGATIVE_BALANCE`（两个既有入口同步加，锁内校验）。
- **不参与 Aging**（projection 只对 balance>0 计算）；**DN 可把负余额向 0 拉回**（DEBIT ceiling 内合法）。

### Workflow 唯一审批事实源 + APPROVED ≠ APPLIED

- **条件审批**：复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE)（不建 Approval 表）；submit 同事务 maybeTriggerCreditDebitNoteApproval（命中策略 → PENDING + workflowInstanceId；未命中 → 可直接 Apply；**Workflow 配置异常事务回滚 409 CN_DN_WORKFLOW_FAILED**）。
- actions 路由终态回写：businessType="credit-debit-note" → COMPLETED→`syncCreditDebitNoteApproval(APPROVED)` / REJECTED→REJECTED；**绝不碰 AR**。
- **APPROVED ≠ APPLIED**：审批只回写投影；**Apply 是唯一修改 AR.adjustedAmount / balanceAmount 的入口**。

## 5. 质量门禁

| 门禁 | 结果 |
| --- | --- |
| CI（Quality Gates / Build / Secret Scanning） | ✅ 全绿（head `f6d3059`，Generate Lockfile skipped 正常） |
| OpenAPI | ✅ 174 paths / 466 schemas（+4 端点/+13 schemas；5 条财务边界 + 累计防超调公式写入描述） |
| QA | ✅ docs/qa/Sprint4E3_QA.md（T1-T21 核心场景） |
| Test Cases | ✅ docs/test-cases/CreditDebitNote_API.md（**166 用例**，A-O 15 组；Concurrency 5 重点：L1 两张 CN 并发 / L2 两张 DEBIT 并发 / L3 同一 Note 双 Apply / L4 CN∥Receipt Allocation / L5 CN∥WriteOff Apply） |
| ADR-0022 | ✅ Accepted + Implemented（保留 Design Review 98/100 + Apply 专项复核 100/100 记录；PR #18 合并后改 Completed） |
| EVENTS | ✅ v1.13（5 事件 ✅ + AccountsReceivableAdjusted 一致，复用不重复注册） |
| DOMAIN_MODEL | ✅ v1.15（第 25 章 Credit Note / Debit Note Foundation） |
| 文档同步 | ✅ CHANGELOG / RELEASE_NOTES（Ready for CTO Final Review）/ ROADMAP（v1.15，4E-3 🟡 Ready for Final Review） |

## 6. Review Result

**Sprint 4E-3 Credit Note / Debit Note Foundation：Ready for CTO Final Review（待审批）**

- 提交链：Schema `07d98a3` → Migration 0020 `f84c887` → Seed/RBAC `196068c` → Create `3d0e75b` → Submit `70f4daf` → Apply `b49629c` → Workflow Actions `21098ce` → OpenAPI `23fa11e` → QA/Test Cases `f6d3059`
- CTO Apply 专项复核：**APPROVED — 100/100（专项范围），0 Blocking，5/5 核心项通过**
- 财务不变量复核点：`AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`；`Invoice.balanceAmount = AR.balanceAmount`
