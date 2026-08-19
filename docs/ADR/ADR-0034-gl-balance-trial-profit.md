# ADR-0034：GL 余额/试算平衡/利润表（实时聚合只读查询，Finance 深化）

- 状态：**Accepted**（CTO 解锁 Sprint 7 Finance；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0033（GL 过账）、ADR-0027（D8 GL 边界）、Sprint 6A StockProjection 投影教训、EVENTS v1.39

---

## 背景

ADR-0033 已落地 GL 过账（凭证头行 + 5C/GRIR 事件自动过账）。Finance 深化下一块 = 科目余额 / 试算平衡 / 利润表。决策核心：**余额是派生投影还是持久化余额表？**

## 决策

1. **实时聚合只读查询（不建余额投影表）**：
   - `GlJournalEntry`（含行）为 immutable 会计事实源；余额 = Σdebit − Σcredit（按科目），试算平衡 = 全科目 Σdebit = Σcredit，利润 = REVENUE − EXPENSE（期间）。
   - **不新建 GlAccountBalance 等投影表**——避免投影漂移/重算一致性负担；对齐 6A 教训（StockProjection 曾引入投影 vs 事实链漂移风险，本仓库红线 = 事实源 SSOT，余额一律派生）。
   - 数据量边界：凭证量受事件驱动（5C 单据量），首版聚合可直接 SQL；若未来凭证量增长 → 引入物化余额表需新 ADR。
2. **查询 API（全部 gl:view 权限，只读）**：
   - `GET /api/gl/trial-balance?dateFrom&dateTo&accountId`：按科目聚合 debit/credit（Decimal 精确），输出 balance（按 GlAccount.direction：DEBIT 科目 balance=debit−credit；CREDIT 科目 balance=credit−debit）+ 全表 Σdebit/Σcredit 校验（不平衡 = 数据异常，返回 inBalance:false）。
   - `GET /api/gl/account-balances?dateFrom&dateTo`：科目级余额清单（含 category/direction/期初不可得——首版只给期间借贷发生额 + 期末余额，期初余额需累计期初凭证，属后续 backlog）。
   - `GET /api/gl/profit-statement?dateFrom&dateTo`：REVENUE 科目贷方净额 − EXPENSE 科目借方净额 = 期间利润（简化利润表：收入/成本/费用/利润 四行 + 明细）。
3. **不新增领域事件**（只读查询，无事实变化）；EVENTS 不变。
4. **前端**：/finance/gl-trial-balance（试算平衡表，科目/借贷/余额/平衡校验）+ /finance/gl-profit-statement（利润表，期间过滤）——只读页，复用 GL 模块 gl:view 权限。

## 影响

- 零 Migration（无 schema 变更）；新增 3 个只读 API + 2 前端页
- GL 余额/试算/利润为实时派生，无投影漂移；期初余额/期间结转/多币种折算 = 后续 backlog

## 后续（独立 backlog）

- 期初余额 + 期末结转（month-end close）
- 多币种折算 / 合并报表
- ~~GL 手工录入 + 审核流（maker-checker UI）~~ ✅（2026-08-20，ADR-0035：Migration 0034 + manual API + 状态机）
- 成本核算（D9 HOLD 延续）
