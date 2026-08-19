# ADR-0036：GL 期初余额 + 期末结转（month-end close）

- 状态：**Accepted**（CTO 解锁 Sprint 7 Finance；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0033/0034/0035（GL 凭证/余额/手工）、ADR-0034（实时聚合派生原则）

---

## 背景

ADR-0034 确立"余额 = 凭证实时派生"（不建余额投影表）。剩余闭环：期初余额（启用/切换期间时的起始余额）与期末结转（month-end close：收入/费用结转到本年利润）。

## 决策

1. **期初余额 = 凭证累计派生（不建期初投影）**：
   - `openingBalance(截至 dateFrom 前) = Σ signed 凭证行 WHERE postingDate < dateFrom`；`closingBalance(截至 dateTo) = Σ signed WHERE postingDate ≤ dateTo`。
   - 期初录入 = 手工凭证（sourceType=MANUAL，过账日期早于启用期间）——复用 ADR-0035 手工 API；**不新建期初余额表**（延续 ADR-0034 派生原则，期初与凭证同源，无投影漂移）。
2. **期末结转（month-end close）**：
   - 结转分录：**REVENUE 科目贷方净额 → 借 REVENUE / 贷 本年利润(4103, EQUITY)**；**EXPENSE 科目借方净额 → 借 本年利润 / 贷 EXPENSE**（中国惯例：损益结转至本年利润）。
   - 结转凭证：sourceType=`PERIOD_CLOSE`，sourceId=periodKey（`YYYY-MM`），自动 POSTED；借贷平衡由结转引擎保证（Σ收入净额 = Σ费用净额 + 利润？—— 实际上 收入贷方净额 + 费用借方净额 分别结转，本年利润为差额）。
   - **防重复**：`GlPeriodClose.periodKey @unique`（同期间只允许一次结转；重复 → 409 GL_PERIOD_ALREADY_CLOSED）。
   - **maker-checker**：执行结转人 ≠ 该期间任意凭证创建人？—— 简化：结转是会计操作，要求执行人 ≠ 该期间结转凭证创建人（无创建人，结转为一次性动作）；实际 maker-checker 由手工凭证录入的审核流承载（ADR-0035）。本 Gate：结转仅校验期间未关闭 + 权限 gl:create。
   - 结转只处理已 POSTED 凭证（DERIVED 实时聚合自然含全部 POSTED）。
3. **API**：
   - `POST /api/gl/month-end-close`（body: period "YYYY-MM"；权限 gl:create；执行结转；同事务写 GlPeriodClose）
   - `GET /api/gl/period-closes`（已结转期间列表；gl:view）
4. **余额 API 增强**（ADR-0034 基础上）：trial-balance / account-balances 增加 `openingBalance`（dateFrom 前累计）与 `closingBalance`（= opening + period 净额）；无 dateFrom 时 opening=0。
5. **科目**：seed 增加 4103 本年利润（EQUITY, CREDIT 方向）。
6. **前端**：/finance/gl-period-close（选择期间 → 执行结转 + 已结转列表）；余额页显示期初/期末列。

## 影响

- Migration 0035：GlPeriodClose 表（periodKey @unique / closedAt / closedById / journalEntryId 引用结转凭证）+ seed 4103
- 结转凭证进入 GlJournalEntry（sourceType=PERIOD_CLOSE），试算平衡/余额自动含结转结果
- 期初余额与凭证同源（无独立期初表）；撤销结转 = 手工冲销凭证（纠错纪律延续）

## 后续（独立 backlog）

- 多币种折算 / 合并报表
- 成本核算（D9 HOLD 延续）
- ~~GL 期间解锁/重开（先冲销结转凭证再重开）~~ ✅（2026-08-20，ADR-0037：红字冲销 + GlPeriodClose 删除）
