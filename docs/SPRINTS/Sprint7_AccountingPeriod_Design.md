# Sprint 7 会计期间体系（Accounting Period）Design / Scope Gate

- **日期：** 2026-08-20
- **作者：** CIO（JINZA）｜审核：CTO
- **状态：** Design / Scope Gate（草案，待 CTO 拍板后进入 Schema/API 实现）
- **上游事实：** CTO_Repo_Audit_2026-08-20（中国环境对齐审计：**P1 会计期间体系缺失** §3 L44、**P2 凭证字/附件张数缺失** §3 L52、**单据编号无按期规则** §3 L50、**GL dateTo 时区错误** §4 L64、推荐轨道 **D：会计期间体系** §7 L100）；ROADMAP v1.26（Sprint 7 Finance 部分落地，GL 已落地 ADR-0033~0037/0042）；ADR-0033~0037、ADR-0042
- **关联 ADR：** ADR-0033（GL 过账）、ADR-0035（手工凭证）、ADR-0036（期末结转/期初余额）、ADR-0037（期间重开）、ADR-0042（销售侧 GL）
- **本 Gate 迁移：** 0037（若与增值税发票管理 Gate 同批合入，按 PR 合并顺序协调为 0037/0038，见 §11）
- **红线（沿用仓库纪律）：** 不可变凭证（POSTED 终态不可改，纠错追加红字）、maker-checker、fail-closed（禁静默降级）、单币种 CNY、中国市场（会计期间 = 自然月、记账凭证按月编号）

---

## 0. 决策摘要（TL;DR）

| # | 决策 | 一句话 |
| --- | --- | --- |
| D1 | 新增 `AccountingPeriod` 表（periodKey `YYYYMM` @unique / fiscalYear / startDate / endDate / status OPEN·CLOSED·LOCKED / 期末结转引用） | 期间主数据 + 状态机 |
| D2 | 与 `GlPeriodClose` **共存、同事务联动**（不删除、不迁移旧表） | close/reopen 事务内同步 status，避免破坏 ADR-0036/0037 已批准模型与 API |
| D3 | `postGlEntry`（自动过账）与手工凭证 POST **双路径期间校验，fail closed** | CLOSED/LOCKED → 409 `GL_PERIOD_CLOSED`；未来期间 → 409 `GL_PERIOD_FUTURE`；无期间行 → 409 `GL_PERIOD_NOT_FOUND` |
| D4 | `GlJournalEntry` 增 `voucherType`（记/收/付/转，默认记）+ `attachmentCount`（附件张数，默认 0） | 自动过账默认「记」；结转/冲销系统凭证=「转」（唯一自动映射点） |
| D5 | 编号引擎：`DocumentSequence` 增 `periodPattern`（`{YYYY}{MM}`）+ `perPeriodReset`；凭证号按 **(期间, 凭证字)** 重排，格式 `记202608-0001` | 中国实务：凭证字 + 月内序号；历史凭证不重编号（不可变） |
| D6 | 期间/业务日边界一律 Asia/Shanghai 解析（封装 `lib/gl/period.ts`），**顺带修复** journal-entries `dateTo` UTC 边界 bug | 审计代码 P1（route.ts L32） |

---

## 1. 背景与问题定义（审计证据 + 代码行号核实）

### 1.1 P1：无会计期间模型，凭证可过账到已关闭/未来期间

- `prisma/schema.prisma` **不存在 AccountingPeriod / FiscalPeriod 模型**（全仓 grep 无匹配）；现有唯一期间相关实体为 `GlPeriodClose`（L6212-6222）：`periodKey "YYYY-MM" @unique`（L6214）**只防重复月结**，不承载"期间是否存在/是否开放"语义。
- `GlJournalEntry.postingDate`（schema L6137，`@db.Timestamptz(3)`）**无期间校验**：
  - 自动过账 `postGlEntry`（`apps/web/src/lib/gl/posting.ts` L55-98）：接收任意 `postingDate`，无任何期间存在性/状态检查；
  - 手工凭证 POST（`apps/web/src/app/api/gl/journal-entries/[id]/[action]/route.ts` L67-73）：post 分支仅复核借贷平衡 + 取号，**不校验 postingDate 期间**。
  - 结论：凭证可过账到**已结转期间、未来期间**（审计 §3 L44 原话）。
- **业务日期与记账日期未分离**：`glPostFromEvent`（posting.ts L110-282）所有事件 `postingDate = payload.xxxAt`（业务时点，如 issuedAt/allocatedAt/accruedAt，见 L125/140/157/169/185/201/216/241/254/270）——单一日期字段兼任业务日期与记账日期，期间归属 = 业务时点。

### 1.2 P1：单据编号无按期规则（凭证号不按月重排）

- `DocumentSequence`（schema L978-998）：`prefix`（L983）/ `nextNo`（L984）/ `padLength`（L985）静态结构，**无 periodPattern / 按月重置**（审计 §3 L50）。
- 取号三处重复实现，均为「静态 prefix + 全局 nextNo」：
  - `posting.ts` `nextGlVoucherNo` L32-42（JRN 全局连续）；
  - `period-close.ts` L95-98（重开冲销）与 L216-219（结转）；
  - `[action]/route.ts` `nextVoucherNo` L23-30（手工 POST）。
  - seed（`prisma/seed.ts` L572）：`{ code: "JRN", docType: "JOURNAL", prefix: "JRN", nextNo: 1, padLength: 6 }` → 当前凭证号形如 `JRN000001` **全局连续、不按月重排**（中国惯例：记账凭证按月编号，用友/金蝶按月+凭证字连续）。

### 1.3 P2：凭证字（记/收/付/转）与附件张数缺失

- `GlJournalEntry`（schema L6134-6159）无 `voucherType`、无 `attachmentCount`（审计 §3 L52）；`GlJournalEntryLine`（L6163-6177）同样无附件字段（附件张数为凭证头级字段，不放行）。

### 1.4 已知 P1 时区 bug（本 Gate 顺带修复）

- `apps/web/src/app/api/gl/journal-entries/route.ts` L32：`lte: new Date(dateTo + 'T23:59:59.999Z')` —— 把业务日按 **UTC** 解释，东八区查询漏掉当天 00:00-08:00 的凭证（审计 §4 L64）。
- 与会计期间的关系：期间归属/聚合本就必须按 Asia/Shanghai 业务日解析（DB 存 UTC）。本 Gate 引入统一业务日工具后，该 bug 顺带用同一工具修复（见 §8.4）。

### 1.5 现有实现基线（复用，不重写）

- `lib/gl/posting.ts`：`postGlEntry`（借贷平衡/幂等 @@unique(sourceType,sourceId)/取号 JRN/科目 fail-closed）——**期间校验挂载点**；
- `lib/gl/period-close.ts`：`closePeriod`（L130-250，结转凭证 + GlPeriodClose 同事务）、`reopenPeriod`（L62-128，红字冲销 + 删 GlPeriodClose）、`RETAINED_EARNINGS_CODE='4103'`（L15）——**期间状态联动点**；
- `api/gl/period-closes/[id]/reopen/route.ts`、`api/gl/period-closes/route.ts`（列表）；
- `api/gl/journal-entries` 系列路由（列表 / manual 创建 / [id] 详情 / [id]/[action] 状态流）；
- Migration 基线：0036 最新（0033 GL 过账 → 0034 手工凭证 → 0035 期末结转 → 0036 库存成本）；**下一迁移号 = 0037**。

---

## 2. Scope：本 Gate 做什么 / 不做什么

### 2.1 做（In Scope）

1. **会计期间表 `AccountingPeriod`**：期间主数据 + 状态机（OPEN / CLOSED / LOCKED），backfill 历史期间（有 GlPeriodClose → CLOSED，否则 OPEN）。
2. **凭证过账期间校验（fail closed）**：`postGlEntry`（自动过账全部路径）与手工凭证 POST 双路径，postingDate 归属期间必须 OPEN；CLOSED/LOCKED → 409；未来期间 → 409；无期间行 → 409。
3. **凭证字与附件张数**：`GlJournalEntry.voucherType`（记/收/付/转，默认记）+ `attachmentCount`（默认 0）；手工凭证创建可指定；自动过账默认「记」。
4. **编号引擎按月重排**：`DocumentSequence` 增 `periodPattern`（`{YYYY}{MM}`）+ `perPeriodReset`；凭证号按 (期间, 凭证字) 连续，格式 `记202608-0001`；历史凭证不重编号。
5. **期间状态与结转联动**：closePeriod 成功后置 CLOSED（写 periodCloseId），reopen 后置 OPEN（清引用）——同事务。
6. **时区工具 + dateTo 修复**：封装 `lib/gl/period.ts`（Asia/Shanghai 业务日解析），GL 列表查询 dateTo 改用该工具。
7. **文档同步**：ADR-0043（新）、ERROR_CODES 注册、openapi、QA、test-cases、CHANGELOG、ROADMAP v1.27。

### 2.2 不做（Out of Scope / 边界）

- ❌ **不做业务日期/记账日期全量分离**（businessDate + postingDate 双字段的激进改造）。**最小方案**：维持单一 `postingDate`（自动过账=业务时点、手工=录入日期），期间按 `postingDate` 归属校验；彻底分离放 backlog（§10）。
- ❌ **不做跨年结转新逻辑**：沿用 ADR-0036 本年利润（4103）结转；`AccountingPeriod.fiscalYear` 仅作为归档/查询维度预留，本年利润跨年清零放 backlog。
- ❌ **不做期初余额表**：沿用 ADR-0036「期初 = 手工凭证派生」；期初录入场景由部署脚本提前建期间行覆盖（§7.2）。
- ❌ **不做期间 CRUD / 未来期间预建 / LOCKED 解锁管理 API**：本 Gate 期间行由 backfill 脚本初始化（部署期一次性），LOCKED 状态仅定义 + 数据支持（拒绝过账/结转/重开），进入/退出 LOCKED 的操作放 backlog。
- ❌ **不做其他 docType（PO/SO/INV/…）的按月重排**：审计 P2 全仓单据编号问题，编号引擎就位后逐个启用（backlog）。
- ❌ **不做凭证字自动映射扩展**（收款事件→「收」、付款事件→「付」）：本 Gate 唯一自动映射 = 结转/冲销系统凭证=「转」；其余自动过账保持「记」。
- ❌ **不修改既有迁移**（0027/0028 FROZEN；0033-0036 不动）；不改 `GlPeriodClose` 表结构与 periodKey 格式（保持 `YYYY-MM` 向后兼容）。

---

## 3. 模型设计：AccountingPeriod 与 GlPeriodClose 的关系

### 3.1 新增模型（Prisma schema 草案）

```prisma
enum AccountingPeriodStatus {
  OPEN    // 可过账、可结转
  CLOSED  // 已结转（GlPeriodClose 存在）——不可过账，可重开
  LOCKED  // 人为锁定——不可过账/结转/重开（本 Gate 仅定义 + 拒绝语义，无解锁操作）
}

enum GlVoucherType {
  GENERAL   // 记
  RECEIPT   // 收
  PAYMENT   // 付
  TRANSFER  // 转
}

/// 会计期间（自然月，中国市场；Sprint 7，Migration 0037，ADR-0043）
/// periodKey @unique 防重复建档；status 与 GlPeriodClose 同事务联动（close→CLOSED，reopen→OPEN）
model AccountingPeriod {
  id            String   @id @default(cuid())
  periodKey     String   @unique // "YYYYMM"（如 202608）；与 GlPeriodClose.periodKey "YYYY-MM" 转换兼容
  fiscalYear    Int      // 会计年度（= 自然年；跨年结转逻辑后续）
  startDate     DateTime @db.Date // 当月 1 日（Asia/Shanghai 业务日，无时区）
  endDate       DateTime @db.Date // 当月最后一日（含）
  status        AccountingPeriodStatus @default(OPEN)
  periodCloseId String?  @unique // status=CLOSED 时指向 GlPeriodClose.id（期末结转引用）
  periodClose   GlPeriodClose? @relation(fields: [periodCloseId], references: [id])
  closedById    String?
  closedAt      DateTime? @db.Timestamptz(3)
  createdById   String?
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime @updatedAt @db.Timestamptz(3)

  @@index([fiscalYear])
  @@index([status])
}

// GlJournalEntry 增列：
//   voucherType     GlVoucherType @default(GENERAL) // 凭证字：记/收/付/转（P2）
//   attachmentCount Int           @default(0)       // 附件张数（P2；DB CHECK ≥ 0）

// GlPeriodClose 增反向关系（可选字段，表结构不变）：
//   accountingPeriod AccountingPeriod?
```

**字段语义**
- `periodKey = "YYYYMM"`（中国会计期间惯例，如 202608）：与 `GlPeriodClose.periodKey "YYYY-MM"`（2026-08）格式不同，通过纯函数转换：`toAccountingPeriodKey(glKey) = glKey.replace('-', '')`、`toGlPeriodKey(accKey)`——**不改旧表格式**（向后兼容既有 API/数据/测试）。
- `startDate/endDate` 用 **DATE（无时区）**：期间边界与 Asia/Shanghai 业务日一致，从根上避免 UTC 边界 bug；取号/校验时由 `lib/gl/period.ts` 把 DATE 边界转 UTC 比较。
- `periodCloseId` 即「期末结转引用」：指向结转记录而非直接指向凭证（结转凭证已由 GlPeriodClose.journalEntryId 引用，不重复建边）。

### 3.2 与 GlPeriodClose：迁移 vs 共存（推荐共存 + 同事务联动）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 迁移合并 | 删除 GlPeriodClose，状态/结转引用全部并入 AccountingPeriod | 单一事实源 | 破坏 ADR-0036/0037 已批准 API 与现有数据/测试；迁移风险大；期间状态与结转历史纠缠 | ❌ |
| B. 纯共存（无联动） | 两表独立，各管各的 | 改动最小 | status 与结转记录可能漂移（双写不一致） | ❌ |
| **C. 共存 + 同事务联动（推荐）** | AccountingPeriod = 期间主数据（存在性 + status 权威）；GlPeriodClose = 结转凭证引用记录（保留防重复月结职责）；close/reopen **同事务**同步 status + periodCloseId | ① 不破坏已批准模型/API/测试；② 单一事务消除漂移；③ 历史 backfill 直接由 GlPeriodClose 存在性推出 status；④ LOCKED 可独立演进不污染结转记录；⑤ 未来若需「期间主数据 CRUD」，演进路径清晰（GlPeriodClose 逐步并入，见 backlog） | 两表 periodKey 格式不同需转换函数（纯函数 + 单测） | ✅ **推荐** |

**联动语义（同事务）**
- `closePeriod(periodKey)`：解析 AccountingPeriod（`YYYY-MM`→`YYYYMM`）→ 校验存在且 OPEN → 生成结转凭证（voucherType=TRANSFER，白名单豁免校验，见 §4.3）→ 创建 GlPeriodClose → `UPDATE AccountingPeriod SET status='CLOSED', periodCloseId=?, closedById, closedAt`。
- `reopenPeriod(periodCloseId)`：锁结转记录 → 校验 AccountingPeriod 非 LOCKED → 红字冲销凭证（TRANSFER，白名单豁免）→ 删除 GlPeriodClose → `UPDATE AccountingPeriod SET status='OPEN', periodCloseId=NULL, closedById=NULL, closedAt=NULL`。
- 幂等/并发：沿用现有 FOR UPDATE 锁结转记录（ADR-0037）；AccountingPeriod 的 periodKey @unique 防重复建档。

---

## 4. 凭证过账期间校验规则（fail closed）

### 4.1 统一校验入口

新增 `lib/gl/period.ts`：

```ts
// periodKeyOf(date, tz='Asia/Shanghai'): string        // Date → "YYYYMM"
// periodBoundaries(key): { start: Date; end: Date }    // 当月 1 日 00:00 CST → 次月 1 日 00:00 CST（end 排他，转 UTC）
// currentPeriodKey(): string                           // Asia/Shanghai 当月
// toAccountingPeriodKey('YYYY-MM') / toGlPeriodKey('YYYYMM')
// assertPeriodOpen(tx, postingDate): Promise<{ periodKey: string; status: ... }>  // fail closed，异常即抛
```

**校验规则（顺序）**

| 步骤 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 幂等命中（sourceType+sourceId 已存在） | 直接返回幂等跳过，**不校验期间**（不误伤已过账凭证） |
| 2 | postingDate 归属月（CST）> 当前会计期间 | 409 `GL_PERIOD_FUTURE`（禁止未来期间过账） |
| 3 | AccountingPeriod 无对应 periodKey 行 | 409 `GL_PERIOD_NOT_FOUND`（fail closed；backfill 覆盖后正常不应出现，消息指引实施初始化） |
| 4 | status = CLOSED 或 LOCKED | 409 `GL_PERIOD_CLOSED`（消息区分：已结转 / 已锁定） |
| 5 | status = OPEN | 放行 |

- 挂载点 A：`postGlEntry`（posting.ts）——幂等检查之后、建行之前，覆盖**全部自动过账**（5C/GRIR/销售侧事件 consumer 同事务调用）。
- 挂载点 B：`[action]/route.ts` post 分支——基于 `existing.postingDate`（DRAFT 录入的业务日期）最终复核；**DRAFT 创建时（manual/route.ts）同样校验**（早期反馈，避免用户录入未来/关闭期间后 POST 才被拒），POST 为最终边界双保险。

### 4.2 期间状态机

```
OPEN ──closePeriod──▶ CLOSED
CLOSED ──reopenPeriod──▶ OPEN
OPEN/CLOSED ──(管理操作, backlog)──▶ LOCKED   // LOCKED 为终态（本 Gate 无解锁）
```

- 结转仅允许 OPEN 期间（CLOSED → 409 `GL_PERIOD_ALREADY_CLOSED`，LOCKED → 409 `GL_PERIOD_LOCKED`）；重开仅允许 CLOSED 且非 LOCKED。

### 4.3 系统凭证豁免（唯一校验豁免点）

- 豁免 sourceType 白名单：**`PERIOD_CLOSE`（结转）、`PERIOD_CLOSE_REVERSAL`（冲销）**——它们是期间状态机自身的产物，期间归属由 close/reopen 事务决定，若对其执行普通期间校验会形成自锁（重开历史期时冲销凭证记当期，当期若已关闭则互锁）。
- 实现：豁免硬编码于校验函数（单测断言仅这两个 sourceType 可豁免）；**业务凭证（事件自动过账 + MANUAL）一律无豁免**。

---

## 5. 凭证字（voucherType）与附件张数

### 5.1 字段设计

- `GlJournalEntry.voucherType GlVoucherType @default(GENERAL)`（记/收/付/转）+ `attachmentCount Int @default(0)`（DB CHECK ≥ 0，上限建议 999，应用层校验）。
- 凭证字编码（中国《会计基础工作规范》惯例）：记=一般记账凭证，收=收款凭证，付=付款凭证，转=转账凭证。

### 5.2 与自动过账的关系

| 路径 | voucherType | 说明 |
| --- | --- | --- |
| 自动过账事件（glPostFromEvent 全部 8 个 case） | **GENERAL（记）** | 默认记；不改事件载荷、不改映射（行为不变，P2 修复只增字段） |
| 手工凭证创建（manual/route.ts） | 可指定（记/收/付/转，默认记） | Zod enum 校验 + attachmentCount |
| 系统凭证：结转 / 冲销（period-close.ts） | **TRANSFER（转）** | 本 Gate 唯一自动映射点（结转/冲销属转账性质；ADR-0037 冲销同） |

- **不扩展**收款→收、付款→付的自动推断（backlog，见 §10），避免与既有 5C/销售事件耦合造成凭证语义漂移。

### 5.3 展示与校验

- 前端 GL 列表/详情/录入页展示「记/收/付/转」徽标与附件张数；openapi 同步；凭证字参与编号（§6）。**DRAFT 状态允许修改凭证字/附件张数（未定稿属性），POSTED 后不可变（不可变纪律）。**

---

## 6. 编号引擎扩展（periodPattern / 按月重排）

### 6.1 DocumentSequence 扩展

```prisma
model DocumentSequence {
  // ...现有字段不变（code/name/docType/prefix/nextNo/padLength/isActive/...）
  periodPattern  String? // 期间前缀模板，如 "{YYYY}{MM}"（凭证 JOURNAL 启用；其余 docType 暂空 = 现状）
  perPeriodReset Boolean @default(false) // 是否按月重排（JOURNAL = true）
}
```

### 6.2 取号引擎（共享，替换 3 处重复实现）

新增 `lib/gl/voucher-number.ts`（或并入 sequence 工具）：

```ts
// nextVoucherNo(tx, { periodKey, voucherType }): Promise<string>
// 1) 目标 DocumentSequence 行：code = "JRN:" + periodKey + ":" + voucherType（如 JRN:202608:GENERAL）
// 2) 事务内 SELECT ... FOR UPDATE（行不存在则先 CREATE，nextNo=1）→ nextNo 递增
// 3) voucherNo = 凭证字 + periodKey + "-" + pad(nextNo)
//    例：记 + 202608 + - + 0001 → "记202608-0001"
// 字映射：GENERAL→记 / RECEIPT→收 / PAYMENT→付 / TRANSFER→转
```

- **替换点**：posting.ts `nextGlVoucherNo`（L32-42）、period-close.ts 两处（L95-98 / L216-219）、[action]/route.ts `nextVoucherNo`（L23-30）→ 统一调用新引擎。
- **历史数据**：**不重编号**（不可变纪律，ADR-0033）。旧 JRN 全局行（seed L572）迁移时置 `isActive=false` 停用；历史凭证保留 `JRN0000xx` 原号，期间归属 = postingDate（派生），不受编号引擎影响。
- **唯一性**：voucherNo 含期间+凭证字 → 全表天然唯一，兼容现有 `@unique`（schema L6136 / migration 0033 唯一索引）。

### 6.3 重排粒度取舍：按 (期间) vs 按 (期间, 凭证字)

| 方案 | 凭证号示例 | 实务贴合度 | 实现成本 | 结论 |
| --- | --- | --- | --- | --- |
| 按 (期间) 单一连续 | `记202608-0001`（月内唯一） | 一般（字仅分类不参与编号） | 低（1 行/期间） | 备选 |
| **按 (期间, 凭证字)** 分别连续 | 记202608-0001 / 收202608-0001 / 付202608-0001 / 转202608-0001 | **高**（用友/金蝶惯例：收、付、转各自按月编号） | 中（每组合一行计数，≈12×4 行/年，可忽略） | ✅ **推荐** |

- 建议主推 **按 (期间, 凭证字)**：中国财务实务中收/付/转凭证各自连续编号，凭证字是排序维度而非装饰。若评审偏好 ASCII 键（避免中文入键），备选 `JRN202608-0001` 仅改字映射，引擎不变。
- `perPeriodReset=true` 语义：该 docType 的 nextNo 按 periodKey 作用域计数（引擎按 code 行实现，天然按月重置）；对非期间单据（periodPattern 空）行为退化为现状（全局连续）。

---

## 7. Migration 0037（或 0038，与 VAT Gate 协调）DDL 草案

### 7.1 DDL

```sql
-- 0037_accounting_period（Sprint 7 会计期间体系；ADR-0043）
-- 若与增值税发票管理 Gate 同批合入：先合入者用 0037，后者 0038（见 §11）

-- 1) 枚举 + GlJournalEntry 加列（凭证字 / 附件张数，审计 P2）
CREATE TYPE "GlVoucherType" AS ENUM ('GENERAL', 'RECEIPT', 'PAYMENT', 'TRANSFER');
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

ALTER TABLE "GlJournalEntry" ADD COLUMN "voucherType" "GlVoucherType" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "GlJournalEntry" ADD COLUMN "attachmentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GlJournalEntry" ADD CONSTRAINT "GlJournalEntry_attachmentCount_nonneg" CHECK ("attachmentCount" >= 0);

-- 2) AccountingPeriod（期间主数据）
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "periodCloseId" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingPeriod_periodKey_key" ON "AccountingPeriod"("periodKey");
CREATE UNIQUE INDEX "AccountingPeriod_periodCloseId_key" ON "AccountingPeriod"("periodCloseId");
CREATE INDEX "AccountingPeriod_status_idx" ON "AccountingPeriod"("status");
CREATE INDEX "AccountingPeriod_fiscalYear_idx" ON "AccountingPeriod"("fiscalYear");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_periodKey_format" CHECK ("periodKey" ~ '^[0-9]{6}$');
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_periodCloseId_fkey"
    FOREIGN KEY ("periodCloseId") REFERENCES "GlPeriodClose"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) DocumentSequence 扩展（编号引擎，审计 P1/P2 单据编号）
ALTER TABLE "DocumentSequence" ADD COLUMN "periodPattern" TEXT;
ALTER TABLE "DocumentSequence" ADD COLUMN "perPeriodReset" BOOLEAN NOT NULL DEFAULT false;
```

### 7.2 backfill（应用层脚本，幂等可重跑）

> 数据行由**应用层 backfill 脚本**生成（需 Asia/Shanghai 时区数学，纯 SQL 易错），部署期执行一次：

1. 取 `MIN(GlJournalEntry.postingDate)`（CST 归属月）与系统启用基线（默认 2026-01，可 `--from` 参数提前以覆盖期初录入）至**当月**，逐月插入 AccountingPeriod（startDate/endDate = 当月 1 日 / 末日，CST DATE）。
2. status 由 GlPeriodClose 存在性决定：存在 → CLOSED + periodCloseId；否则 OPEN。
3. 旧 JRN 全局序列行置 `isActive=false`（历史凭证不重编号）；JOURNAL 期间行按需（首张凭证时）创建。
4. 未来月份**不建档**——未来期间过账由 `GL_PERIOD_FUTURE` / `GL_PERIOD_NOT_FOUND` 双防线拦截。

---

## 8. 影响面

| 文件 | 变更 |
| --- | --- |
| `apps/web/src/lib/gl/period.ts`（新） | 期间/业务日工具：periodKeyOf / periodBoundaries / currentPeriodKey / toAccountingPeriodKey / toGlPeriodKey / assertPeriodOpen（含系统凭证豁免白名单） |
| `apps/web/src/lib/gl/voucher-number.ts`（新） | 共享取号引擎（periodKey + voucherType → 记202608-0001；FOR UPDATE 原子） |
| `apps/web/src/lib/gl/posting.ts` | ① postGlEntry 挂载 assertPeriodOpen；② nextGlVoucherNo → 新引擎（period=postingDate 归属月，voucherType=GENERAL）；③ 建行写入 voucherType/attachmentCount |
| `apps/web/src/lib/gl/period-close.ts` | ① closePeriod：校验 AccountingPeriod OPEN → 结转凭证 voucherType=TRANSFER → 同事务 UPDATE status=CLOSED + periodCloseId；② reopenPeriod：校验非 LOCKED → 冲销凭证 TRANSFER → 同事务 UPDATE status=OPEN + 清引用；③ 两处取号 → 新引擎（归属期间：结转凭证=结转期间，冲销凭证=当期） |
| `apps/web/src/app/api/gl/journal-entries/manual/route.ts` | 创建 schema += voucherType（enum，默认 GENERAL）/ attachmentCount（≥0，默认 0）；创建时校验 postingDate 期间（早期反馈） |
| `apps/web/src/app/api/gl/journal-entries/[id]/[action]/route.ts` | post 分支：assertPeriodOpen(existing.postingDate) + 新取号引擎（period=postingDate 归属月，voucherType=existing.voucherType） |
| `apps/web/src/app/api/gl/journal-entries/route.ts` | ① 列表返回 voucherType/attachmentCount；② **dateTo 时区修复**：`businessDayRange(dateTo)`（Asia/Shanghai 业务日）替代 `dateTo + 'T23:59:59.999Z'`（L32）；dateFrom 同理 |
| `apps/web/src/app/api/gl/period-closes/route.ts` | 列表可加 status 投影（AccountingPeriod.status），其余不变 |
| `apps/web/src/app/api/gl/periods/**`（本 Gate 不新增） | 期间 CRUD 管理 API → **backlog**（仅部署脚本初始化） |
| 前端 `finance/gl-journal-entries`（list/detail/new）、`finance/gl-period-close` | 凭证字徽标 + 附件张数展示/录入；期间状态展示；无新页面 |
| `apps/web/src/lib/gl/posting.test.ts` / `period-close.test.ts` | 取号断言更新（JRNxxxxx → 记202608-xxxx）；新增期间校验单测（CLOSED/LOCKED/FUTURE/NOT_FOUND/豁免白名单/幂等不校验） |
| `apps/web/src/lib/api/errors.ts` + `docs/ERROR_CODES.md` | 注册：GL_PERIOD_NOT_FOUND / GL_PERIOD_CLOSED / GL_PERIOD_FUTURE / GL_PERIOD_LOCKED / GL_PERIOD_INVALID / GL_VOUCHER_TYPE_INVALID / GL_ATTACHMENT_COUNT_INVALID（描述性码，与 errors.ts 现有风格一致；顺带收敛审计 P1 错误码漂移的 GL 域） |
| `docs/openapi.yaml` | journal-entries manual 创建 body += voucherType/attachmentCount；列表响应 += 两字段 |
| `docs/EVENTS.md` | 无新事件（凭证字为凭证头属性，非领域事件）——记录本 Gate 无事件变更 |
| `docs/ADR/ADR-0043-accounting-period.md`（新） | 会计期间体系决策记录 |
| `docs/qa/Sprint7_AccountingPeriod_QA.md`（新）+ `docs/test-cases/GL_AccountingPeriod_API.md`（新） | 不变量用例 + 验收清单 |
| `docs/CHANGELOG.md` / `docs/ROADMAP.md` | 变更记录 / v1.27 |

### 8.4 dateTo 时区修复与本 Gate 的关系

- 修复依赖本 Gate 新增的 `lib/gl/period.ts` 业务日工具（同一 Asia/Shanghai 解析逻辑，含单测），故**随本 Gate 合入**（审计代码 P1「时区策略落地」推荐项 #6 的 GL 部分）；审计其余时区点（全仓业务日边界）仍为独立 backlog。

---

## 9. 验收标准与不变量（Blocking Gate）

### 9.1 验收标准

1. **P1 修复**：自动过账（postGlEntry）与手工 POST 双路径，postingDate 归属期间为 CLOSED/LOCKED/未来/不存在 → 409（GL_PERIOD_CLOSED / GL_PERIOD_FUTURE / GL_PERIOD_NOT_FOUND），凭证不落库；单测覆盖 4 种拒绝 + 1 种放行。
2. **期间状态联动原子**：closePeriod → AccountingPeriod.status=CLOSED + periodCloseId（同事务）；reopenPeriod → status=OPEN + 清引用（同事务）；事务失败回滚后状态一致。
3. **凭证字/附件**：voucherType 枚举落地；手工创建可指定（默认记）；自动过账默认记；结转/冲销=转；attachmentCount ≥ 0 默认 0；POSTED 后不可变。
4. **编号**：voucherNo 按 (期间, 凭证字) 连续、无重复（`@unique` 保持）；格式 `记202608-0001`；历史凭证号不变；旧 JRN 全局行停用。
5. **时区**：dateTo 过滤按 Asia/Shanghai 业务日（东八区当天 00:00-24:00 完整命中，含 00:00-08:00）；period 工具单测覆盖跨月/年末边界。
6. **回归**：余额/试算/利润表派生口径不变（只读聚合未改）；结转/重开既有流程走通（含历史期间 backfill 数据）；幂等（重复消费事件）不受期间校验影响。
7. **CI**：Quality Gates（lint / RBAC gate / type-check / unit）+ Build + Secret Scanning 全绿；文档同步（ADR-0043 / ERROR_CODES / openapi / QA / test-cases / CHANGELOG / ROADMAP v1.27）。

### 9.2 不变量（设计级，实现时逐一断言）

| # | 不变量 | 实现点 |
| --- | --- | --- |
| INV1 | 期间校验 fail closed：未知/关闭/锁定/未来期间一律拒绝，绝不静默放行 | assertPeriodOpen（period.ts） |
| INV2 | 期间状态机：OPEN→(close)→CLOSED→(reopen)→OPEN；LOCKED 为终态（无解锁） | closePeriod/reopenPeriod |
| INV3 | 凭证号在 (期间, 凭证字) 内连续且全表唯一；取号原子（FOR UPDATE） | voucher-number.ts |
| INV4 | 不可变：历史凭证不重编号、POSTED 内容不可改（纠错追加红字） | backfill 不改 voucherNo；既有纪律 |
| INV5 | 幂等：sourceType+sourceId @unique 保持；幂等命中跳过期间校验 | postGlEntry 顺序 |
| INV6 | 系统凭证豁免仅限 PERIOD_CLOSE / PERIOD_CLOSE_REVERSAL（白名单硬编码 + 单测） | assertPeriodOpen |
| INV7 | 期间/业务日边界一律经 Asia/Shanghai 工具解析，禁止再拼 `T23:59:59.999Z` | period.ts / 列表路由 |
| INV8 | 结转仅 OPEN 期间；重开仅 CLOSED 且非 LOCKED | closePeriod/reopenPeriod |
| INV9 | 期间归属与余额/试算派生口径一致（postingDate CST 归属月） | 派生聚合不变 |

---

## 10. 边界与 backlog

| # | 项 | 说明 |
| --- | --- | --- |
| B1 | 业务日期/记账日期彻底分离 | 本 Gate 最小方案 = 单一 postingDate（自动=业务时点、手工=录入日期）按期间校验；双字段（businessDate 用于业务归期 + postingDate 用于记账期间）需全链路事件/单据改造，独立 Gate |
| B2 | 跨年结转（本年利润 4103 → 留存收益） | 沿用 ADR-0036 本年利润结转；fiscalYear 字段就位，跨年清零逻辑 backlog |
| B3 | 期初余额 | 不建期初表（ADR-0036 派生）；期初录入需目标月期间行存在——部署脚本 `--from` 提前建行覆盖 |
| B4 | 期间 CRUD / 未来期间预建 / LOCKED 解锁管理 API | 本 Gate 仅部署脚本初始化 + LOCKED 拒绝语义；管理操作（含解锁、预建未来期间）backlog |
| B5 | 其他 docType 按月重排（PO/SO/INV/WHR/…） | 审计 P2 全仓单据编号；编号引擎就位后逐个启用（periodPattern 配置即可） |
| B6 | 凭证字自动映射（收款→收、付款→付） | 本 Gate 仅结转/冲销=转；事件驱动自动推断 backlog |
| B7 | GlPeriodClose 逐步并入 AccountingPeriod | 演进路径（远期）：期间 CRUD 成熟后迁移结转引用，消除双表 periodKey 转换 |
| B8 | 辅助核算（部门/项目/客户维度）、出纳与银行对账、错误码注册表自动化 | 独立 backlog（审计 §6） |

---

## 11. 与增值税发票管理 Gate（VAT）的协调

- **迁移号**：两 Gate 均含 migration 且都可能 `ALTER GlJournalEntry`（VAT 加发票类型/代码/号码字段，本 Gate 加 voucherType/attachmentCount）。协调规则：**PR 合并顺序决定编号**——先合入者用 0037，后者用 0038；同一 PR 内两迁移顺序执行无冲突（不同 migration 文件，串行应用）。
- **依赖**：本 Gate **不依赖** VAT 字段；VAT Gate 的发票字段与本 Gate 凭证字/期间彼此正交。唯一约束：若同批合入，merge 后需同步更新两份设计文档的迁移号标注与 ROADMAP 基线。
- **建议**：本 Gate（D 轨道）与 VAT Gate（C 轨道）并行开发、按评审顺序合入；本文档按「0037（本 Gate）/ 0038（VAT）」默认标注，实际以合并顺序为准。

---

## 附：实现阶段同步文档清单（DoD）

- [ ] `docs/ADR/ADR-0043-accounting-period.md`（新）
- [ ] `docs/ERROR_CODES.md`（GL 域注册 7 个新码）+ `apps/web/src/lib/api/errors.ts`
- [ ] `docs/openapi.yaml`（manual 创建 body / 列表响应）
- [ ] `docs/qa/Sprint7_AccountingPeriod_QA.md`（新）+ `docs/test-cases/GL_AccountingPeriod_API.md`（新）
- [ ] `docs/CHANGELOG.md` / `docs/ROADMAP.md`（v1.27）
- [ ] `docs/EVENTS.md`（记录本 Gate 无事件变更）
- [ ] 前端三页（list/detail/new + period-close）字段同步
