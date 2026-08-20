# ADR-0044：会计期间体系（Sprint 7，CTO 拍板实现）

- 状态：**Accepted（Implemented，2026-08-20）**；Design Gate 见 docs/SPRINTS/Sprint7_AccountingPeriod_Design.md
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：CTO_Repo_Audit_2026-08-20（中国环境审计 P1 会计期间缺失 / P2 凭证字 + 编号按期）、ADR-0033~0037、Migration 0038

---

## 背景

中国环境审计 P1：无会计期间模型，凭证可过账到已关闭/未来期间；P2：无凭证字（记/收/付/转）与附件张数、凭证号不按月重排；代码审计 P1：GL dateTo 按 UTC 日边界 bug。Design Gate 已批准，本 ADR 记录实现决策。

## 决策（实现 Gate）

1. **Schema + Migration 0038**：`AccountingPeriod`（periodKey "YYYYMM" @unique / fiscalYear / startDate+endDate DATE / status OPEN·CLOSED·LOCKED / periodCloseId 引用结转记录）+ `AccountingPeriodStatus` + `GlVoucherType`（记/收/付/转）枚举；`GlJournalEntry + voucherType（默认记）+ attachmentCount（≥0 CHECK）`；`DocumentSequence + periodPattern + perPeriodReset`。与 GlPeriodClose **共存 + 同事务联动**（close→CLOSED+periodCloseId；reopen→OPEN+清引用），不破坏 ADR-0036/0037 API。
2. **期间校验（INV1，fail closed）**：`lib/gl/period.ts assertPeriodOpen`——postGlEntry（幂等检查后）与手工 POST 双路径；CLOSED/LOCKED → 409、未来期间 → 409、无期间行 → 409；**系统凭证豁免白名单仅 PERIOD_CLOSE / PERIOD_CLOSE_REVERSAL**（INV6）。
3. **凭证字/附件**：手工创建可指定（默认记）；自动过账默认记；结转/冲销=转；POSTED 后不可变。
4. **编号按月重排（INV3）**：`lib/gl/voucher-number.ts nextVoucherNo` 按 (期间, 凭证字) 连续（DocumentSequence code=`JRN:{periodKey}:{voucherType}`，FOR UPDATE 原子），格式 `记202608-0001`；替换 posting/period-close/[action] 三处重复实现；历史凭证不重编号（旧 JRN 行 backfill 停用）。
5. **时区（INV7）**：`lib/gl/period.ts` Asia/Shanghai 业务日工具（periodKeyOf/businessDayStart/businessDayEnd）；GL 列表 dateTo/dateFrom 改用该工具（修复 UTC 日边界 bug）。
6. **backfill**：`scripts/backfill-accounting-periods.ts`（部署期一次，幂等）——从 MIN(postingDate) 或 --from 至当月逐月建档，status 由 GlPeriodClose 推导，停用旧 JRN。
7. **错误码 +8**：GL_PERIOD_NOT_FOUND/CLOSED/LOCKED/FUTURE/ALREADY_CLOSED/INVALID + GL_VOUCHER_TYPE_INVALID/GL_ATTACHMENT_COUNT_INVALID（ERROR_CODES 自动生成 269 码）。

## 边界（本 ADR 不做）

- 业务日期/记账日期彻底分离、跨年结转新逻辑、期初余额表、期间 CRUD/LOCKED 解锁管理 API、其他 docType 按月重排、凭证字自动推断（收款→收/付款→付）、GlPeriodClose 并入 AccountingPeriod——均为 backlog（Design Gate §10 B1-B8）。

## 影响

- Migration 0038；lib/gl/period.ts + voucher-number.ts + period.test.ts（19 用例）；posting.ts/period-close.ts/manual/[action]/list 路由改造；errors.ts +8 码；backfill 脚本；文档（ADR-0044/QA/test-cases/CHANGELOG/ROADMAP v1.29）；EVENTS 无事件变更。
