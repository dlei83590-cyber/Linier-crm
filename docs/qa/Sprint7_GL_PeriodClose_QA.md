# Sprint 7 — GL 期初余额 + 期末结转 QA 验收记录（ADR-0036）

- 日期：2026-08-20
- 关联：ADR-0036、ADR-0035、ADR-0034、ADR-0033
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL 期末结转（ADR-0036） | Migration 0035（GlPeriodClose）+ closePeriod 结转引擎 + month-end-close/period-closes API + account-balances openingBalance + 前端期间结转页 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] 结转分录：REVENUE 贷方净额 → 借 REVENUE 贷 本年利润(4103)；EXPENSE 借方净额 → 借 4103 贷 EXPENSE；净额入 4103（借贷平衡断言）
- [x] 防重复：GlPeriodClose.periodKey @unique（同期间只允许一次 → 409）
- [x] 结转凭证 sourceType=PERIOD_CLOSE/sourceId=periodKey（幂等；进入试算/余额）
- [x] 期初余额 = dateFrom 前凭证派生累计（不建期初投影表）；closing = opening + 期间净额
- [x] 期间格式 YYYY-MM 校验；无收入/费用凭证 → 409 NO_ACTIVITY；JOURNAL 序列缺失 fail closed
- [x] 权限：gl:create（结转）/ gl:view（列表）；前端结转页消费后端契约

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 录入手工凭证（收入/费用）→ 执行月末结转 → 生成结转凭证 + 本年利润正确；重复结转 409
- [ ] account-balances 带 dateFrom → openingBalance 正确（期初累计）；profit-statement 期间正确
- [ ] 权限：MANAGER 访问 /api/gl/month-end-close → 403

## 4. 已知限制 / 边界

- 期初 = 凭证派生（手工凭证录入期初）；撤销结转 = 手工冲销结转凭证；多币种折算/合并报表仍后续
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
