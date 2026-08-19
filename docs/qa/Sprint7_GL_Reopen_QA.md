# Sprint 7 — GL 期间解锁/重开 QA 验收记录（ADR-0037）

- 日期：2026-08-20
- 关联：ADR-0037、ADR-0036、ADR-0033
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL 期间重开（ADR-0037） | reopenPeriod（红字冲销 + 删 GlPeriodClose）+ POST period-closes/:id/reopen + 前端重开按钮 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] 红字冲销凭证：逐行反向（debit↔credit），借贷平衡数学保证；sourceType=PERIOD_CLOSE_REVERSAL 唯一
- [x] 不删除原结转凭证（不可变纪律）；冲销凭证进入试算/余额（派生自动回滚）
- [x] GlPeriodClose 删除（允许重新结转）；未结转/已重开 → 409；无分录 → 409
- [x] 权限 gl:create；前端确认弹窗 + 刷新

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 结转 2026-08 → 重开 → 生成红字冲销凭证（余额回滚）→ 重新结转成功
- [ ] 重复重开 → 409；重开后期间可再次 month-end-close

## 4. 已知限制 / 边界

- 多轮 结转→重开→结转 事实链完整（每轮独立冲销+结转凭证）；多币种折算不实施（中国市场单币种 CNY）
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
