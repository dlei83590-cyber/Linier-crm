# Linier ERP — Sprint 4 Sales & Finance O2C Total Acceptance

**Release:** `v0.6.0-alpha`（Linier ERP — Sales & Finance O2C Foundation）
**Base:** main `f0dabac`（PR #12-#18 全部 merged；Sprint 4A-4E-3 完整闭环）
**Review Type:** 只读审查（Read-only Review，不修改业务代码）
**Gate Model:** 硬门禁（Hard Gate）——PASS → RELEASE CANDIDATE / BLOCKED → 修复后重新验收
**Result:** **PASS → RELEASE CANDIDATE ✅**
**Date:** 2026-08-08
**Reviewer:** CIO（JINZA）执行取证 ｜ 拍板：sk（负责人）

> 本报告是 `v0.6.0-alpha` 的 **Release Gate 证据**（非普通项目文档）：
> 9/9 O2C 节点 PASS、6/6 系统级不变量 PASS、Blocking Issues = 0；
> 6 项 Known Risks 作为 Release Notes 已知限制记录，不阻止 Alpha 发布。

## 1. 版本治理声明

- **当前版本治理以 Git Tag 为发布事实源**（`vX.Y.Z-alpha` 语义化版本 tag）。
- `package.json = 0.1.0` 保持现状，**不为本次发布单独修改**；package version 策略后续统一治理。
- 现有 tags：`v0.1.0-alpha` ~ `v0.5.0-alpha`；**`v0.5.0-alpha` 已存在，不可复用**。
- 历史规则：每次发布主版本号递增、无预发布序号（无 `.1/.2` 后缀）→ 本次目标 **`v0.6.0-alpha`**。

## 2. O2C 主链（验收范围）

```
Quotation → Sales Order → Delivery → Invoice → AR → Receipt → Allocation/Reversal → WriteOff → Credit/Debit Note
```

覆盖 Sprint 4A（Quotation）/ 4B（Sales Order）/ 4C（Delivery）/ 4D（Invoice）/ 4E-1（AR）/ 4E-2（Receipt & Payment Allocation + WriteOff）/ 4E-3（Credit Note / Debit Note）。

## 3. 9 节点 × 4 维度核验结果

| # | O2C 节点 | 事实源 | 投影/一致性 | Workflow / Events | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | Quotation | ✅ `Quotation` + `QuotationPriceSnapshot`（priceSnapshotId 冻结） | ✅ 价格红线（ADR-0015）：行价必须来自 `PricingEngine.resolvePrice()` → Snapshot（quotations/route.ts L60） | ✅ workflow-sync.ts + QuotationSnapshot（@@unique 类型） | **PASS** |
| 2 | Sales Order | ✅ `SalesOrder` | ✅ 唯一创建入口 `POST /api/quotations/{id}/convert`（溯源 quotationId） | ✅ workflow-sync + 状态事件 | **PASS** |
| 3 | Delivery | ✅ `Delivery/DeliveryLine` | ✅ **无 POST /api/deliveries**（Direct Delivery 未获批准，锁定项①）；防超交 `quantity > alloc.availableQty → 409`；READY 后行冻结 | ✅ confirm-delivery + delivery-aggregation（SO deliveredQty/remainingQty 回写） | **PASS** |
| 4 | Invoice | ✅ `Invoice/InvoiceLine` | ✅ **无 POST /api/invoices**（Direct Invoice 禁止）；唯一入口 `POST /api/deliveries/{id}/invoice`；防超开票 `qty > remainingInvoiceQty → 409`（锁内读） | ✅ Issue `DocumentSequence(INVOICE)` 原子取号 + maybeTriggerInvoiceApproval（keyFinancialChanged） | **PASS** |
| 5 | AR | ✅ `AccountsReceivable` | ✅ **computeBalance 单入口**：`original + adjusted - paid - writeOff` | ✅ Aging/OVERDUE 惰性投影（不落库） | **PASS** |
| 6 | Receipt | ✅ `Receipt` | ✅ 创建≠核销（UNALLOCATED，unallocatedAmount=amount） | ✅ ReceiptCreated 事件（publishReceiptEvent） | **PASS** |
| 7 | Allocation/Reversal | ✅ `ReceiptAllocation` | ✅ AR+Invoice 双投影一致（allocate 锁 AR id ASC + 防超核销 + Reversal 三方投影恢复，computeBalance 单入口） | ✅ Allocation/Reversal 事件 | **PASS** |
| 8 | WriteOff | ✅ `WriteOff` | ✅ **writeOffAmount→AR，绝不增加 Invoice.paidAmount**（否则报表误判坏账为客户付款） | ✅ **APPROVED ≠ APPLIED**（Apply 唯一回写入口；重复 Apply 409） | **PASS** |
| 9 | CN/DN | ✅ `InvoiceAdjustment`（事实中间层，客户端禁直接创建） | ✅ **CN<0 / DN>0** signed；负 AR = Customer Credit 投影（不新增 CREDIT 状态） | ✅ **APPROVED ≠ APPLIED**；Workflow 条件审批（businessType=credit-debit-note） | **PASS** |

## 4. 6 条系统级不变量核验

| # | 不变量 | 证据 | 结论 |
| --- | --- | --- | --- |
| 1 | **价格唯一事实链**：Pricing Engine → Snapshot → Quote → SO → Invoice；Delivery 不持价格，Invoice 不重新定价 | DeliveryLine **无价格字段**（仅 quantity/remainingInvoiceQty）；InvoiceLine.priceSnapshotId **直接复制** SO Line 快照（unitPrice/lineAmount 复制计算值，不重算） | **PASS** |
| 2 | **物流唯一事实链**：SO → Delivery；不存在 Direct Delivery，任何并发不能 Over-delivery | 无 POST /api/deliveries；防超交锁内校验（computeDeliveryAllocation 动态 availableQty） | **PASS** |
| 3 | **开票唯一事实链**：Delivery → Invoice；不能 Quote/SO 直接生成 Invoice，不能 Over-billing | 无 POST /api/invoices；防超开票锁内校验 remainingInvoiceQty | **PASS** |
| 4 | **余额唯一公式**：`AR.balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount` | computeBalance 单入口（lib/accounts-receivable/projection.ts） | **PASS** |
| 5 | **Invoice 投影不变量**：`Invoice.balanceAmount = AR.balanceAmount`；WriteOff/CN/DN 不得污染 `Invoice.paidAmount` | allocate/writeOff/CN-DN apply 均直接回写 AR newBalance 到 Invoice.balanceAmount；write-off 注释明文 paidAmount 绝不增加、CN/DN apply 不动 paidAmount | **PASS** |
| 6 | **历史财务事实不可变**：ISSUED Invoice 原始金额、行价格快照、InvoiceSnapshot 不因 Receipt/WriteOff/CN/DN 被重写 | Invoice 域 **0 处 snapshot.update**（全 append-only；唯一 updateMany 为 QuotationSnapshot 软删标记，非财务事实重写）；Invoice PATCH 仅允许 remark/dueDate/paymentTerm/changeReason/version（无金额字段） | **PASS** |

## 5. Blocking Issues

**0（无）**

## 6. Known Risks（Release Notes 已知限制，不阻止 Alpha 发布）

1. **事件总线未落地**：领域事件以 AuditLog 留痕承载（项目既定 Known Risk），总线落地后需替换 publish 语义（EVENTS.md 已注明）
2. **package.json version = 0.1.0**：未跟随 Tag 递增；本报告明确"当前版本治理以 Git Tag 为发布事实源"，package version 策略后续统一治理
3. **Apply 逐行 FOR UPDATE**：大量行场景可优化批量锁（CTO Apply 专项复核非阻断观察项，不在验收范围）
4. **CN/DN Reversal 首版未实现**（字段预留）；**CustomerCredit 表/Refund 延后**（负 AR 仅投影）
5. **跨币种核销/开票未开放**（第一版禁跨币种，同 Customer+Currency 硬规则）
6. 成熟度 ≈92% 为估算口径，不阻塞发布

## 7. Release Recommendation

- **Gate 结论：PASS → RELEASE CANDIDATE ✅**（9/9 节点 PASS，6/6 不变量 PASS，Blocking 0）
- **目标版本：`v0.6.0-alpha`**（历史规则主版本递增；`v0.5.0-alpha` 已存在不可复用）
- **Release 标题：** Linier ERP v0.6.0-alpha — Sales & Finance O2C Foundation
- **Release 摘要：** Sprint 4 establishes the complete Sales & Finance Order-to-Cash foundation, covering Quotation → Sales Order → Delivery → Invoice → Accounts Receivable → Receipt & Allocation → Write-Off → Credit/Debit Note, with unified workflow, audit, financial projections, concurrency controls, and traceable business facts.
- **后续动作（Release Gate Review 通过后）**：冻结 RELEASE_NOTES（v0.6.0-alpha 段，汇总 Sprint 4A–4E-3）→ 最终 release commit 上 annotated tag `v0.6.0-alpha` → Push Tag → GitHub Release（**Pre-release**）→ ROADMAP 记录发布完成 → 启动 Sprint 5 规划
