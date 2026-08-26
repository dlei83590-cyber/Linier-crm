# ADR-0055：单据序列重构（{prefix}-LNE{YYYY}{MM}{####} 按月重排）

- 状态：Accepted（Implemented，2026-08-24）
- 日期：2026-08-24
- 维护者：CIO｜审核：CTO
- 关联：ADR-0044（编号引擎 periodPattern/perPeriodReset）、Sprint7_AccountingPeriod_Design.md §6（backlog B5：其他 docType 按月重排）

---

## 背景

全仓业务单据编号此前为 `{prefix}{6位序号}` 全局连续（如 `SO000123`），无按期规则；ADR-0044 已引入 `periodPattern`/`perPeriodReset` 编号引擎，但仅 JOURNAL 启用（凭证号 `记202608-0001`），其余 docType 为 backlog B5（"编号引擎就位后逐个启用"）。

用户指令：**单据序列统一重构为「单据前缀 + LNE + 年份 + 月份 + 4 位」**，年份/月份由单据日期自动计算。

## 决策

1. **格式**：`{prefix}-LNE{YYYY}{MM}{####}`（如 `SO-LNE2026080001`；`-` 位于前缀与 LNE 之间，按月重置 4 位序号）。
2. **数据驱动 + 零迁移**：复用 ADR-0044 已建字段——`periodPattern='LNE{YYYY}{MM}'`、`padLength=4`、`perPeriodReset=true`；无新 Schema/Migration。
3. **共享取号引擎** `lib/document-sequence/next-code.ts`：`nextDocumentCode(tx, docType, documentDate, opts?)`——模板行（docType 基准，seed 幂等 upsert）缺失 fail closed；期间行 `code={docType}:{YYYYMM}`（如 `SALES_ORDER:202608`）按需从模板行派生创建，`FOR UPDATE` 原子递增；可选 `isCodeFree` 占用校验（单号回收后软删记录仍占唯一键，跳过被占用编号）。
4. **年份/月份** = 单据日期按 Asia/Shanghai 归属月计算（复用 `lib/gl/period.ts periodKeyOf`）；单据无日期字段（创建即取号）时回退当前业务日。
5. **JOURNAL 豁免**：保留 ADR-0044 凭证字格式（`记202608-0001`，`lib/gl/voucher-number.ts`），不套用 LNE 格式。
6. **全量委托**：22 个领域 helper + Project convert 内联 + SO convert 内联 + StockCount→Adjustment 内联全部改为调用引擎（各 helper 签名新增 `documentDate: Date`）；`recycleDocumentSequence` 改为按期间行回退（解析 LNE 后 6 位 YYYYMM + 末 4 位序号；历史旧格式单号不参与回收）。
7. **seed**：业务单据 `padLength 6→4` + `periodPattern/perPeriodReset`；补齐缺失的 SCN/SDN 序列；upsert `update` 传播新字段（部署期重跑 seed 即迁移既有行）。

## 边界

- 不重编号历史单据（不可变纪律）；不改 JOURNAL；不做多租户/分支/多币种序列。

## 影响

- 新增 `apps/web/src/lib/document-sequence/next-code.ts`；改 `recycle.ts`、22 个 helpers、project/SO/stock-count 内联、各 create 路由、`prisma/seed.ts`；文档同步（ADR/QA/test-cases/CHANGELOG/ROADMAP）。
- **单据序列管理模块（基础资料 /document-sequences）适配**：列表默认隐藏期间行（code={docType}:{YYYYMM} 运行时计数器，仅模板行作为配置展示，新增「编号格式（示例）/按月重排」列）；新建/编辑支持 `periodPattern`/`perPeriodReset`；编辑移除模板行 `nextNo`（改为期间行计数）；新增 `POST /api/document-sequences/:id/reset` 重置当前（或指定）期间序号为 `startNo`（JOURNAL 由凭证字引擎管理，拒绝在此重置）。
