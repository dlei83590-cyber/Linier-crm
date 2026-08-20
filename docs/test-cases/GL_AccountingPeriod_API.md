# GL 会计期间 API 测试用例（ADR-0044）

- **日期：** 2026-08-20
- **范围：** 过账期间校验 / 凭证字+附件张数 / 编号按月重排 / GL 列表日期过滤（Asia/Shanghai）

## A. 期间校验（fail-closed）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | OPEN 期间过账 | 自动过账/手工 POST（202608） | 放行，凭证落库 |
| A2 | CLOSED 期间过账 | 已结转期间 | 409 GL_PERIOD_CLOSED |
| A3 | LOCKED 期间过账 | 锁定期间 | 409 GL_PERIOD_LOCKED |
| A4 | 未来期间过账 | 209901 | 409 GL_PERIOD_FUTURE |
| A5 | 未建档期间 | 无 AccountingPeriod 行 | 409 GL_PERIOD_NOT_FOUND |
| A6 | 幂等命中不校验 | 重复消费同事件 | 幂等跳过，不误伤 |
| A7 | 系统凭证豁免 | PERIOD_CLOSE/REVERSAL | 豁免（重开历史期不互锁） |

## B. 凭证字 / 附件张数

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 手工创建指定凭证字 | manual create voucherType=PAYMENT | 落库 voucherType=PAYMENT |
| B2 | 默认凭证字 | 未指定 | GENERAL（记） |
| B3 | 附件张数 | attachmentCount=3 | 落库 3 |
| B4 | 附件张数非法 | -1 / 1000 | 400 GL_ATTACHMENT_COUNT_INVALID |
| B5 | 凭证字非法 | voucherType=XXX | 400（zod enum） |
| B6 | 自动过账凭证字 | 事件驱动 | GENERAL（记） |
| B7 | 结转/冲销凭证字 | closePeriod/reopen | TRANSFER（转） |

## C. 编号按月重排

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 格式 | 202608 首张 GENERAL | 记202608-0001 |
| C2 | 月内连续 | 同月同凭证字多张 | 记202608-0002... |
| C3 | 跨月重置 | 202609 首张 | 记202609-0001（不续 202608） |
| C4 | (期间,凭证字) 独立 | 收/付/转 各自编号 | 收202608-0001 / 付202608-0001 |
| C5 | 唯一性 | voucherNo @unique | 重复 → 数据库拒绝 |
| C6 | 历史凭证 | 旧 JRN0000xx | 不重编号（不可变） |

## D. 列表日期过滤（Asia/Shanghai）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | dateTo 当地 24:00 | dateTo=2026-08-01 | 含当地 00:00-08:00（UTC 00:00-08:00 段）凭证（旧实现漏） |
| D2 | dateFrom 当地 00:00 | dateFrom=2026-08-01 | 含当地 8/1 全天 |

> 合计：7（A）+ 7（B）+ 6（C）+ 2（D）= **22 用例**
