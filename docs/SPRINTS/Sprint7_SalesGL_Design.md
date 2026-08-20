# Sprint 7 Finance — 销售侧 GL 记账闭环（Design / Scope Gate）

- **日期：** 2026-08-20
- **作者：** CTO（AI Agent 代理执行）
- **上游事实：** CTO_Repo_Audit_2026-08-20（中国环境对齐审计 **P0：销售侧 GL 闭环缺失，利润表失真**）；ROADMAP v1.25 "GL 过账其余子项（AR/Expense/...）仍后续"；ADR-0033~0037（GL 过账/余额/手工凭证/月结基线）；EVENTS v1.38（GL consumer 注册 4 个 5C 事件）
- **范围：** 本 Gate 只做**销售侧收入确认与收款入账**的 GL 记账；不扩展发票管理、不引入会计期间表、不动 5C/库存/成本逻辑。

---

## 1. 问题定义（审计证据）

- `lib/domain-events/consumer.ts` L27-34：GL_POSTED_EVENTS 仅 6 个采购/库存事件；**InvoiceIssued / ReceiptAllocated 不在其中**。
- `lib/invoice/events.ts` / `lib/receipt/events.ts`：销售侧事件仍为 **AuditLog 留痕（事务外、best-effort）**，未走 Outbox（v1.35 只迁移了 5C 事件）。
- `gl/balances.ts` computeProfitStatement：收入 = category=REVENUE 的贷方净额。当前 seed 无 6001 主营业务收入 → **收入恒为 0，利润表失真**（只有 6401 成本）。
- 缺科目：1122 应收账款、6001 主营业务收入、22210102 销项税额。

## 2. 目标（Definition of Done）

1. **Invoice ISSUE（DRAFT→ISSUED）** 同事务原子写 Outbox `InvoiceIssued`（含 subtotal/taxAmount/invoiceTotal）；GL consumer 注册 handler → 凭证：**借 1122 应收账款（含税总额）/ 贷 6001 主营业务收入（未税）/ 贷 22210102 销项税额（税额）**。
2. **Receipt Allocation（核销）** 同事务原子写 Outbox `ReceiptAllocated`（每 ReceiptAllocation 一行，含 allocatedAmount/paymentMethod）；GL handler → **借 1002 银行存款（CASH→1001）/ 贷 1122 应收账款**。
3. **Receipt Allocation Reversal（核销反转）** 同事务原子写 Outbox `ReceiptAllocationReversed`；GL handler → **红字：借 1122 / 贷 1002**。
4. seed 补 3 科目（1122/6001/22210102）；GL 单测覆盖新 handler（平衡/幂等/零税额/科目缺失 fail-closed）。
5. 利润表/试算平衡自动反映销售侧（派生聚合，无新表、无新 API）。
6. 文档同步：EVENTS（3 事件载荷升级 + Outbox）、ADR-0042、QA、test-cases、CHANGELOG、ROADMAP v1.26。

## 3. 非目标（边界）

- ❌ 不做销售侧 CN/DN（4E-3）GL、坏账核销（WriteOff）GL、预收/预付——**后续 backlog**（设计文档记录）。
- ❌ 不做增值税发票管理字段（P1 中国缺口，独立 Gate）。
- ❌ 不做会计期间表/凭证字（P1，独立 Gate）。
- ❌ 不新增 API 端点、不新增表（复用 OutboxMessage/GlJournalEntry）。
- ❌ 不修改 5C/库存/成本/GRIR 过账逻辑与科目映射。

## 4. 账务规则（不变量，Blocking Gate）

| # | 不变量 | 实现点 |
| --- | --- | --- |
| I1 | 金额一律服务端 Decimal canonical：InvoiceIssued 用 invoice.subtotal/taxAmount/invoiceTotal（创建时行聚合，非客户端传值）；ReceiptAllocated 用 ReceiptAllocation.allocatedAmount | issue 路由快照字段；allocate 路由锁内值 |
| I2 | 借贷平衡：1122 = 6001 + 22210102（零税额 → 省略税额行）；1002 = 1122（反转反向） | postGlEntry GL_UNBALANCED 校验兜底 |
| I3 | 幂等：GlJournalEntry @@unique(sourceType, sourceId)——InvoiceIssued|invoiceId、ReceiptAllocated|receiptAllocationId、ReceiptAllocationReversed|receiptAllocationId | postGlEntry 已实现；重复消费幂等跳过 |
| I4 | 业务事实 + Outbox 同事务（writeDomainEvent）；handler 副作用 + Outbox PROCESSED 同事务 | issue/allocate/reverse 事务内写；consumer 事务 |
| I5 | 收入确认时点 = ISSUE（DRAFT/取消不产生 GL）；核销 GL 仅对未反转 allocation | 事件只在 ISSUED/核销成功事务发布；ALREADY_REVERSED 409 已守卫 |
| I6 | 科目缺失 fail-closed（resolveAccountId 抛 GL_ACCOUNT_MISSING，禁静默降级） | postGlEntry 现有行为 |
| I7 | VOID 边界确认：仅 UNALLOCATED 可 VOID（void 路由 L45-47）→ **VOID 无 GL 影响**，本 Gate 不注册 VOID handler | 复核 void 路由 |
| I8 | 过账日期 = 业务时点（issuedAt / allocatedAt / reversedAt），非消费时间 | glPostFromEvent postingDate |

## 5. 变更文件清单

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/lib/domain-events/consumer.ts` | GL_POSTED_EVENTS += InvoiceIssued / ReceiptAllocated / ReceiptAllocationReversed |
| `apps/web/src/lib/gl/posting.ts` | glPostFromEvent += 3 个 case（账务规则 §4）；条件行（零税额省略） |
| `apps/web/src/app/api/invoices/[id]/issue/route.ts` | 事务内 writeDomainEvent(InvoiceIssued, 载荷含 subtotal/taxAmount)；审计载荷同步 |
| `apps/web/src/app/api/receipts/[id]/allocate/route.ts` | 事务内逐 allocation writeDomainEvent(ReceiptAllocated)（含 receiptAllocationId/paymentMethod） |
| `apps/web/src/app/api/receipt-allocations/[id]/reverse/route.ts` | 事务内 writeDomainEvent(ReceiptAllocationReversed) |
| `apps/web/src/lib/gl/posting.test.ts` | +3 组 handler 单测 |
| `prisma/seed.ts` | SEED_GL_ACCOUNTS += 1122 应收账款 / 6001 主营业务收入 / 22210102 销项税额 |
| `docs/EVENTS.md` | InvoiceIssued/ReceiptAllocated/ReceiptAllocationReversed 载荷升级 + Outbox 标注；v1.40 日志 |
| `docs/ADR/ADR-0042-sales-gl-posting.md` | 新 ADR（销售侧 GL 记账闭环） |
| `docs/qa/Sprint7_SalesGL_QA.md` | 新 QA（静态 + 单测不变量清单） |
| `docs/test-cases/Invoice_API.md` / `docs/test-cases/Receipt_WriteOff_API.md` | +GL 不变量用例 |
| `docs/CHANGELOG.md` / `docs/ROADMAP.md` | 变更记录 / v1.26 |

## 6. 验收标准

1. 单测：posting.test.ts 新用例全绿（CI Unit tests）。
2. CI：Quality Gates（lint/RBAC gate/type-check/unit）+ Build + Secret Scanning 全绿。
3. 静态核对：issue/allocate/reverse 三路由事务内 Outbox 写入与现有 5C 模式（supplier-invoice/events.ts）一致。
4. 派生验证：EVENTS.md 载荷与 posting.ts 消费字段一一对应（人工核对表）。

## 7. 已知限制（Known Limitations，本 Gate 接受）

1. 收款按 paymentMethod 只区分 CASH→1001 / 其余→1002；不做银行明细/承兑票据分科目（后续）。
2. 销售 CN/DN、坏账核销、预收款的 GL 记账为 backlog（记录在 ADR-0042）。
3. 凭证号 JRN 全局连续（不按月重排）——沿用现有 GL 行为，期间体系独立 Gate。
4. 利润表按 REVENUE/EXPENSE 类别聚合；6001 计入后收入即显现；销项税不进利润表（负债科目，正确）。
