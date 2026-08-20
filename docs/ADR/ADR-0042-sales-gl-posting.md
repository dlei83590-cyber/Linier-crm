# ADR-0042：销售侧 GL 记账闭环（Sprint 7 Finance 续，CTO 解锁）

- 状态：**Accepted**（CTO 2026-08-20 拍板下一开发项 A；Design/Scope Gate 见 docs/SPRINTS/Sprint7_SalesGL_Design.md）
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：ADR-0033（GL 过账消费 5C 事件）、ADR-0034（余额/试算/利润）、ADR-0031（Domain Event Outbox）、EVENTS v1.40、CTO_Repo_Audit_2026-08-20（中国环境审计 **P0：销售侧 GL 闭环缺失，利润表失真**）

---

## 背景

ADR-0033 落地后，GL consumer 只消费 6 类采购/库存事件（SupplierInvoicePosted / SupplierPaymentApplied / SupplierCreditDebitNoteApplied / SupplierPaymentReversed / GrirAccrued / GrirReversed）。**销售侧财务闭环缺失**：Invoice ISSUE 与收款核销不产生任何凭证——无 1122 应收账款、无 6001 主营业务收入、无销项税额科目；试算平衡表与利润表只反映采购侧 + COGS，**收入恒为 0，利润表失真**（CTO 仓库巡检中国环境审计 P0）。EVENTS 已有 InvoiceIssued / ReceiptAllocated / ReceiptAllocationReversed 事件注册位，但仅 AuditLog 留痕、未 Outbox 化（v1.35 只迁移了 5C 事件）。

## 决策

1. **Scope（最小闭环）**：① Invoice ISSUE → 收入确认凭证；② 收款核销（ReceiptAllocation）→ 收款入账凭证；③ 核销反转 → 红字冲销凭证。**不做**：销售 CN/DN（4E-3）GL、坏账核销 GL、预收/预付、增值税发票管理字段、会计期间表/凭证字（各自独立 Gate / backlog）。
2. **事件 Outbox 化**：`InvoiceIssued`（issue 事务内）、`ReceiptAllocated`（**逐 ReceiptAllocation 行**，allocate 事务内）、`ReceiptAllocationReversed`（reverse 事务内）由「事务提交后 AuditLog」升级为**业务事务内原子写 OutboxMessage**（复用 writeDomainEvent，幂等键 `eventType|aggregateId`）；AuditLog 留痕保留。
3. **GL 分录映射（consumer handler，EVENTS v1.40）**：
   - `InvoiceIssued` → 借 应收账款 **1122**（invoiceTotal 含税）/ 贷 主营业务收入 **6001**（subtotal 未税）/ 贷 销项税额 **22210102**（taxAmount）；**零税额省略税额行**；收入确认时点 = ISSUE（DRAFT/取消无凭证）。
   - `ReceiptAllocated` → 借 银行存款 **1002**（paymentMethod=CASH → 库存现金 **1001**）/ 贷 应收账款 **1122**（allocatedAmount，按核销行）。
   - `ReceiptAllocationReversed` → 红字反向：借 应收账款 **1122** / 贷 银行存款 **1002**（CASH→1001）。
4. **科目（seed 扩展，无 Migration）**：1122 应收账款（ASSET/DEBIT）、6001 主营业务收入（REVENUE/CREDIT）、22210102 应交税费-应交增值税-销项税额（LIABILITY/CREDIT）；GlAccountCategory 已有 REVENUE（免枚举迁移）。
5. **幂等与不变量**：沿用 ADR-0033——GlJournalEntry @@unique(sourceType, sourceId)（InvoiceIssued|invoiceId / ReceiptAllocated|receiptAllocationId / ReceiptAllocationReversed|receiptAllocationId）；postGlEntry 借贷平衡/科目 fail-closed/不可变；handler 副作用 + Outbox PROCESSED 同事务。
6. **金额权威**：InvoiceIssued 载荷 subtotal/taxAmount/invoiceTotal 取发票服务端 canonical 头字段（创建时行聚合）；ReceiptAllocated 取 ReceiptAllocation.allocatedAmount（锁内值）；**不信任客户端金额**。

## 影响

- 代码：lib/gl/posting.ts（+3 handler）、lib/domain-events/consumer.ts（GL_POSTED_EVENTS +3）、invoices/[id]/issue、receipts/[id]/allocate、receipt-allocations/[id]/reverse 三路由事务内 writeDomainEvent；prisma/seed.ts（+3 科目）；posting.test.ts（+7 用例）。
- 文档：EVENTS v1.40、QA Sprint7_SalesGL_QA.md、test-cases（Invoice_API / Receipt_WriteOff_API +GL 段）、CHANGELOG、ROADMAP v1.26。
- 派生效果：利润表/试算平衡自动反映销售侧（ADR-0034 实时聚合，无新表、无新 API）。
- **零 Migration、零新表、零新 API 端点**。

## 后续（独立 backlog）

- 销售侧 CN/DN（4E-3 CreditDebitNote APPLIED）GL：收入调整（借/贷 1122 ↔ 6001/销项税）。
- 坏账核销（WriteOff APPLIED）GL：借 信用减值损失 贷 应收账款。
- 预收/预付专项 GL；凭证字（记/收/付/转）与会计期间体系（与 ADR-0035/0036 联动）。
- 增值税发票管理字段（发票类型/代码/号码/红字，中国审计 P1，独立 Design Gate）。
