# ADR-0033：GL 过账消费 5C 事件（Sprint 7 Finance 首块，CTO 解锁）

- 状态：**Accepted**（CTO 解锁指令 2026-08-20；Design/Scope Gate → 实现）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0027（D8 GL 边界）、ADR-0031（Domain Event Outbox，GL 解锁前置）、ADR-0030（5C-2）、EVENTS v1.37、Sprint 6A Outbox 先例

---

## 背景

ADR-0027 D8（P11 Final）：5C 阶段不建 GL 总账，只产出"财务事实 + 稳定会计事件"，GL 过账留给 Finance 阶段消费。ADR-0031 已落地通用 Domain Event Outbox（业务事务内原子写 OutboxMessage + 通用 Consumer），GL 解锁前置条件达成。CTO 指令 2026-08-20：解锁 Sprint 7 Finance 首块 = **GL 过账消费 5C 事件**。

## 决策

1. **首版最小闭环（Scope）**：会计科目（GlAccount）+ 记账凭证（GlJournalEntry/GlJournalEntryLine）+ 过账服务（lib/gl/posting.ts）+ 消费 5C 事件自动过账（consumer handler）+ 只读查询 API + 前端列表页。**不做**：GL 余额/试算平衡表、利润表/现金流量表、GL 手工录入/审核流、多币种折算、成本核算（D9 HOLD 延续）。
2. **模型（Migration 0033）**：
   - `GlAccount`（会计科目：code @unique / name / category（ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE）/ direction（DEBIT/CREDIT 余额方向）/ isActive；seed 标准中国会计科目最小集）
   - `GlJournalEntry`（凭证头：voucherNo @unique（DocumentSequence docType=JOURNAL 创建即取号 JRN，seed 已存在）/ postingDate / status=POSTED（一次性终态，不可变）/ sourceType / sourceId / **@@unique([sourceType, sourceId]) 幂等防重复过账** / maker-checker（createdById ≠ postedById）/ version CAS）
   - `GlJournalEntryLine`（凭证行：entryId / accountId / debit / credit（Decimal 18,2，**每行恰一侧 > 0**，另一侧为 0）/ summary / sourceRef）
3. **过账不变量（lib/gl/posting.ts `postGlEntry`）**：
   - **借贷平衡**：Σdebit = Σcredit（服务端 Decimal 校验，不平衡 → 409 GL_UNBALANCED）
   - **幂等**：sourceType+sourceId 唯一（DB @unique + 查重；重复 → 409 GL_ALREADY_POSTED）
   - **不可变**：POSTED 后禁改禁删；纠错 → 追加红字冲销凭证（追加新事实，不手改）
   - **科目存在**：每行 accountId 必须存在且 isActive（fail closed）
   - **锁序**：无需业务头锁（凭证由事件驱动）；幂等键唯一约束兜底并发
4. **事件 → 分录映射（consumer handler 注册，EVENTS 同事务消费）**：
   - `SupplierInvoicePosted` → 借 采购成本（net + nonRecoverableTax）+ 借 应交税费-进项税（inputVat）贷 应付账款（grossAmount）
   - `SupplierPaymentApplied` → 借 应付账款 贷 银行存款（allocatedAmount）
   - `SupplierCreditDebitNoteApplied` → CREDIT：借 应付账款 贷 采购调整；DEBIT：借 采购调整 贷 应付账款（adjustmentTotal）
   - `SupplierPaymentReversed` → 反向红字（借 银行存款 贷 应付账款，reversedAllocations 总额）
   - 科目 code 映射：`GL_ACCOUNT_PURCHASE=1403`（原材料）/ `GL_ACCOUNT_TAX_INPUT=222101`（进项税）/ `GL_ACCOUNT_AP=2202`（应付账款）/ `GL_ACCOUNT_BANK=1002`（银行存款）/ `GL_ACCOUNT_ADJUST=6111`（采购调整）；seed GlAccount 必须包含（缺失 fail closed，不静默降级）
5. **权限（ADR-0028）**：新增 `gl` 模块（view/create/edit/close——过账动作映射 create→gl:create；会计敏感仅 SUPER_ADMIN/ADMIN 静态授权，与 supplier-invoice 一致；MANAGER 无）；查询 API 用 gl:view；GL 过账由 consumer 触发（domain-event:consume SYSTEM_PERMISSIONS）
6. **GL 只读 API**：GET /api/gl/accounts（科目表）、GET /api/gl/journal-entries（分页 + sourceType/sourceId/dateFrom/dateTo 过滤）、GET /api/gl/journal-entries/:id（详情含行）
7. **前端**：/finance/gl-journal-entries 只读列表页（凭证号/日期/借贷合计/来源/状态）+ 详情弹层或独立页（消费后端状态契约，无手工过账 UI——首版事件驱动）

## 影响

- Migration 0033（3 表 + seed 科目/权限）；生产迁移顺序 0028 → … → 0033
- consumer 注册 4 个 eventType handler（SupplierInvoicePosted/SupplierPaymentApplied/SupplierCreditDebitNoteApplied/SupplierPaymentReversed），与 Outbox PROCESSED 同事务（handler 副作用 + PROCESSED 原子）
- GrirConsumed/GrirAccrued 等 GRIR 事件**本 Gate 不过账**（GRIR 暂估/冲回属 Costing/GL 深化，后续 backlog；声明边界）
- reports（BI）仍 HOLD（待 20 份报表清单）

## 后续（独立 backlog）

- ~~GRIR 暂估/冲回过账（Accrual/Reversal 事件消费）~~ ✅（2026-08-20：GrirAccrued/GrirReversed outbox 化 + GL 分录映射，EVENTS v1.39）
- ~~GL 余额/试算平衡/利润表~~ ✅（2026-08-20，ADR-0034：实时聚合只读 API + 前端；不建余额投影表）
- GL 手工录入 + 审核流（maker-checker UI）
- 成本核算（D9 HOLD 延续）
