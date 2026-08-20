# Sprint7 Sales GL QA（销售侧 GL 记账闭环，ADR-0042）

- **日期：** 2026-08-20
- **范围：** Invoice ISSUE 收入确认 / 收款核销入账 / 核销反转红字 的 GL 闭环
- **验证策略：** CI-First——单测由 GitHub CI Unit tests 验证；本 QA 记录静态验收 + 不变量清单（本地不运行测试/服务器）
- **关联：** docs/SPRINTS/Sprint7_SalesGL_Design.md、ADR-0042、EVENTS v1.40

## 静态验收清单（Phase C 人工核对）

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | GL_POSTED_EVENTS 注册 InvoiceIssued/ReceiptAllocated/ReceiptAllocationReversed | ✅ |
| S2 | issue 路由事务内 writeDomainEvent(InvoiceIssued)，载荷含 subtotal/taxAmount/invoiceTotal（服务端 canonical） | ✅ |
| S3 | allocate 路由逐 ReceiptAllocation 行 writeDomainEvent(ReceiptAllocated)，载荷含 receiptAllocationId/paymentMethod | ✅ |
| S4 | reverse 路由事务内 writeDomainEvent(ReceiptAllocationReversed)，载荷含 reversedAmount/paymentMethod | ✅ |
| S5 | posting.ts +3 handler 借贷方向正确（1122=6001+税；1002↔1122），零税额省略税行 | ✅ |
| S6 | seed SEED_GL_ACCOUNTS +1122/6001/22210102（category REVENUE 已存在，免迁移） | ✅ |
| S7 | 幂等键唯一（sourceType+sourceId；outbox idempotencyKey eventType|aggregateId） | ✅ |
| S8 | 无新表 / 无新 API / 无 Migration（纯增量代码 + seed） | ✅ |
| S9 | VOID 边界确认：仅 UNALLOCATED 可 VOID → 无 GL 影响（不注册 VOID handler） | ✅ |
| S10 | Invoice cancel 仅 DRAFT → 无 GL 影响 | ✅ |

## 不变量清单（单测覆盖，CI 验证）

| # | 不变量 | 单测 | 预期 |
| --- | --- | --- | --- |
| G1 | InvoiceIssued 借贷平衡：1122 借 = 6001 贷 + 22210102 贷（含税 113 = 未税 100 + 税 13） | InvoiceIssued 平衡用例 | 创建凭证，借贷相等 |
| G2 | 零税额发票：省略销项税行（1122 = 6001） | 零税额用例 | 仅 2 行 |
| G3 | 金额不一致（subtotal+tax ≠ invoiceTotal）→ 409 GL_UNBALANCED（fail-closed） | 金额不一致用例 | ok=false, GL_UNBALANCED |
| G4 | ReceiptAllocated：借 1002 贷 1122（按核销行金额） | 核销入账用例 | 借贷平衡，sourceId=receiptAllocationId |
| G5 | CASH 收款 → 借 1001 库存现金 | CASH 用例 | 科目 1001 |
| G6 | ReceiptAllocationReversed：红字反向 借 1122 贷 1002 | 反转用例 | 方向正确，sourceType=ReceiptAllocationReversed |
| G7 | 幂等：重复消费同事件 → 跳过创建（idempotent=true） | 既有幂等用例（复用） | 不重复过账 |

## 已知限制（本 QA 接受）

1. 收款仅区分 CASH→1001 / 其余→1002；承兑票据/电汇分科目为 backlog。
2. 销售 CN/DN、坏账核销、预收款的 GL 为 backlog（ADR-0042 后续）。
3. 凭证号 JRN 全局连续（不按月重排）——期间体系独立 Gate。
4. 生产环境需重跑 seed 以补 3 个科目（1122/6001/22210102）——CI 验证 seed 编译，生产 seed 由部署流程执行。
