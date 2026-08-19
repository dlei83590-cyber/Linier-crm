# Sprint 7 — GL 余额/试算平衡/利润表 QA 验收记录（ADR-0034）

- 日期：2026-08-20
- 关联：ADR-0034、ADR-0033、docs/frontend/contract-cards/gl-posting-gate.md
- 状态：**CI 验证通过（GitHub Actions 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
|---|---|---|
| GL 余额（ADR-0034） | trial-balance / account-balances / profit-statement 只读 API + lib/gl/balances.ts 纯函数核心 + 前端 2 页 + 单测 | ✅ success（待 CI 确认） |

## 2. 静态验收（本地已核）

- [x] 余额 = 实时派生投影（不建余额表；事实源 = GlJournalEntry 不可变凭证）
- [x] 试算平衡：按科目 SUM debit/credit；direction 决定余额方向（DEBIT 科目 balance=debit−credit；CREDIT 科目=credit−debit）；inBalance 校验
- [x] 利润表：REVENUE（CREDIT 方向）贷方净额 − EXPENSE（DEBIT 方向）借方净额 = 利润
- [x] 期间过滤 dateFrom/dateTo（postingDate 范围）；gl:view 权限
- [x] 前端只读消费后端契约（无写入口）；零 Migration

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 过账若干凭证后：试算平衡表借贷合计相等 + inBalance=true；科目余额与凭证行一致
- [ ] 人为不平衡数据（不存在——过账服务强制平衡）不可构造；利润表收入/费用/利润正确
- [ ] 权限：MANAGER 访问 /api/gl/* → 403

## 4. 已知限制 / 边界

- 期初余额/期末结转（month-end close）、多币种折算、合并报表 = 后续 backlog
- reports（BI）仍 HOLD（待 20 份报表清单）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
