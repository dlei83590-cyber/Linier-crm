# GL 过账消费 5C 事件 — Design / Scope Gate（Sprint 7 Finance 首块，CTO 解锁 2026-08-20）

- 版本：v0.1
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO（解锁授权已确认，2026-08-20）
- 关联：ADR-0033（GL 过账设计决策）、ADR-0031（事件 Outbox，GL 前置）、ADR-0027（D8 GL 边界）、ADR-0030（5C-2）
- 状态：**DESIGN / SCOPE GATE — 已授权**（实现 = 单批：Migration 0033 + posting 服务 + consumer handler + 查询 API + 前端只读页）

---

## 1. 背景与授权

CTO 指令 2026-08-20 解锁 Sprint 7 Finance 首块 = **GL 过账消费 5C 事件**（ADR-0031 事件 Outbox 前置已达成）。本 Gate 为解锁后正式设计。

## 2. 范围（首版最小闭环）

| 包含 | 排除（声明边界） |
|---|---|
| 会计科目 GlAccount（seed 标准中国科目最小集） | GL 余额/试算平衡/利润表/现金流 |
| 记账凭证 GlJournalEntry/Line（POSTED 一次性不可变） | GL 手工录入/审核流 UI |
| lib/gl/posting.ts 过账服务（借贷平衡/幂等/科目校验） | 多币种折算、成本核算（D9 HOLD） |
| consumer 注册 4 个 5C 事件 handler 自动过账 | GRIR 暂估/冲回过账（Accrual/Reversal 后续） |
| GET /api/gl/accounts + journal-entries 只读 API | reports（BI）仍 HOLD |
| 前端 /finance/gl-journal-entries 只读列表页 | — |

## 3. 事件 → 分录映射（账务规则）

| 事件 | 借方 | 贷方 | 金额 |
|---|---|---|---|
| SupplierInvoicePosted | 采购成本（1403）+ 进项税（222101） | 应付账款（2202） | grossAmount / inputVat |
| SupplierPaymentApplied | 应付账款（2202） | 银行存款（1002） | allocatedAmount |
| SupplierCreditDebitNoteApplied（CREDIT） | 应付账款（2202） | 采购调整（6111） | adjustmentTotal |
| SupplierCreditDebitNoteApplied（DEBIT） | 采购调整（6111） | 应付账款（2202） | adjustmentTotal |
| SupplierPaymentReversed | 银行存款（1002） | 应付账款（2202） | reversedAllocations 总额 |

## 4. 验收标准

- Migration 0033 与 schema 一致；seed 科目/权限同步；生产迁移顺序 0028→…→0033
- postGlEntry：借贷平衡 / 幂等（sourceType+sourceId 唯一）/ 科目存在 / maker-checker
- consumer handler：4 事件 → 分录同事务（handler 副作用 + Outbox PROCESSED 原子）；重复消费幂等
- 查询 API：gl:view 权限；分页/过滤；详情含行
- 前端：只读列表页消费后端契约（无手工过账 UI）
- GitHub CI 全绿；文档同步（ADR/EVENTS/CHANGELOG/ROADMAP/QA/OpenAPI）
