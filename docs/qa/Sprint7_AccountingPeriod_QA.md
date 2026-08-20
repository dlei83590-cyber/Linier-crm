# Sprint7 会计期间 QA（ADR-0044）

- **日期：** 2026-08-20
- **范围：** 会计期间表/过账期间校验/凭证字+附件/编号按月重排/GL dateTo 时区修复
- **验证策略：** CI-First——单测由 CI Unit tests 验证；Migration 0038 由 CI Prisma generate 把关；backfill 为部署脚本（不跑本地）

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | schema：AccountingPeriod + AccountingPeriodStatus + GlVoucherType；GlJournalEntry.voucherType/attachmentCount；DocumentSequence.periodPattern/perPeriodReset | ✅ |
| S2 | Migration 0038 DDL（枚举/表/加列/CHECK/唯一/FK） | ✅ |
| S3 | lib/gl/period.ts（periodKeyOf/businessDayStart/End/toKey/assertPeriodOpen + 豁免白名单） | ✅ |
| S4 | lib/gl/voucher-number.ts（(期间,凭证字) 连续 + FOR UPDATE 原子） | ✅ |
| S5 | postGlEntry 期间校验（幂等后、建行前）；手工 POST 双路径 | ✅ |
| S6 | close/reopen 同事务 AccountingPeriod 状态联动（CLOSED+periodCloseId / OPEN+清引用） | ✅ |
| S7 | 编号替换：posting/period-close/[action] 三处 → 新引擎（记/转） | ✅ |
| S8 | GL 列表 dateTo/dateFrom Asia/Shanghai 业务日（修复 UTC bug） | ✅ |
| S9 | errors.ts +8 码 + ERROR_CODES 自动生成（269 码） | ✅ |
| S10 | backfill 脚本（幂等，--from 参数） | ✅ |

## 不变量清单（单测覆盖）

| # | 不变量 | 单测 | 预期 |
| --- | --- | --- | --- |
| INV1 | 期间校验 fail-closed（CLOSED/LOCKED/FUTURE/NOT_FOUND） | period.test.ts 5 用例 | 4 种拒绝 + OPEN 放行 |
| INV6 | 系统凭证豁免仅 PERIOD_CLOSE/REVERSAL | period.test.ts 2 用例 | 豁免/业务凭证无豁免 |
| INV7 | Asia/Shanghai 业务日（跨月/跨年/日边界） | period.test.ts 8 用例 | 归属月与日边界正确 |
| INV3 | 凭证号 (期间,凭证字) 连续 | posting.test.ts 断言更新 | 记202608-0042 |
| INV2 | 期间状态联动原子（close/reopen） | period-close.test.ts mock 更新 | CLOSED/OPEN 同步 |

## 已知限制

1. 期间行需部署期 backfill 初始化（fail-closed：未建档期间过账被 409 拒绝，消息指引）。
2. 业务日期/记账日期分离、期间 CRUD/LOCKED 解锁、其他 docType 按月重排为 backlog。
3. 前端凭证字徽标/附件张数展示为后续批次。
