# B2-2A / B2-2B Runtime Acceptance QA — Project Budgets / Expenses / Progresses

> 批次：B2-2A（Budgets + Expenses）+ B2-2B（Progresses）｜PR：#70-#75｜日期：2026-08-17
> 状态：✅ **FINAL CLOSED**（owner 签署；Production `dcefea3e`，31/31 Runtime Acceptance PASS — ACCEPTED）
> 关联：CHANGELOG（B2-2A/B2-2B 条目）、ADR-0028（RBAC drift root cause + 治理规则）、ROADMAP v1.20、EVENTS.md（ProjectAccepted/ProjectClosed/ProjectForceClosed/ProjectStageChanged 注册位）
> 验证环境：`https://nilier-crm-app-production.up.railway.app`（部署 SHA = `dcefea3eb0`，GitHub deployments 2026-08-17T05:24:31Z）

---

## 1. 验收范围

| 能力                                                         | 交付物                                                             | PR                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| B2-0 CLOSED write gate（budgets/expenses/progresses 子资源） | `assertProjectWritable` transactional gate（锁序 Project → Child） | #70 `2bb40d7`                                                           |
| B2-2A Budgets + Expenses 前端 Add/Edit/Delete                | Project Detail 财务工作台                                          | #71 `a3c789c` + #72 `a866d10`（changed-only PATCH + amount blank gate） |
| B2-2B Progresses 前端 Add/Edit/Delete                        | Project Detail 进度工作台                                          | #73 `8b0af12`                                                           |
| B2-2B backend aggregate integrity                            | `Project.progressPercent` create/edit/delete 全链路维护            | #74 `fc7cc82` + `096a7f2`（recordedAt 时区转换）                        |
| RBAC drift 修复（Runtime Blocking ①）                        | `PERMISSION_MODULES`/`PROJECT_MODULES` 补 17 个 seed-only 模块     | #75 `dcefea3e`                                                          |

## 2. 背景：RBAC drift root cause（PR #75）

- **现象**：首次 smoke 在 `ee4d6ff` 部署上 Budget/Expense/Progress 全 403 FORBIDDEN（SUPER_ADMIN 被拒）。
- **根因**：`packages/shared/src/constants/index.ts` 的 `PERMISSION_MODULES` 缺注册 17 个 seed-only 模块（project-budget / project-expense / project-product / project-progress / project-acceptance / project-closure / project-tag / project-attachment + exchange-rate / partner-price / price-policy / price-rule / price-list-version / promotion / tax-rate / pricing-engine / price-audit）→ `ALL_ACTION_PERMISSIONS` 不含这些 action → SUPER_ADMIN/ADMIN 静态授权缺失 → `requirePermission` 403。`seed.ts` 的 `SEED_ACTION_MODULES` 已含（DB catalog 有），**static RBAC 与 DB permission catalog 漂移**。
- **修复（PR #75，head `654d40c9`，CI run #426 success）**：一次性补齐全部 17 个模块并同步 `PROJECT_MODULES`；静态审计 308 个 API 引用权限码对 SUPER_ADMIN 的缺失数归零；未改 permission code / requirePermission / seed 语义 / 权限-业务 Gate 顺序。
- **治理规则（backlog，本轮不实现）**：任何新增 `requirePermission("x:y")` 或 seed action module 必须有自动检查保证可从 shared `PERMISSION_MODULES` 生成（`API referenced permission ⊆ ALL_ACTION_PERMISSIONS` CI static Gate 评估，独立 Governance Audit，见 ADR-0028）。

## 3. Runtime Acceptance 结果（31/31 PASS）

### 3.1 横切项（4/4）

| #     | 项                                                           | 结果                                                             |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| 01    | health 200 + version                                         | ✅ 200 v0.6.0-alpha / db ok                                      |
| 02    | ready 200 + migration baseline                               | ✅ 200 baseline=true expected=0028_grir_historical_fact_backfill |
| 03    | login token（SUPER_ADMIN）                                   | ✅ 200                                                           |
| 04-05 | fixture：真实 businessPartner id + fresh OPEN project create | ✅ 201                                                           |

### 3.2 B2-2A Budgets（4/4）

| #   | 项                                                                | 结果                                    |
| --- | ----------------------------------------------------------------- | --------------------------------------- |
| 06  | Budget create + 数据完整性（category/amount/currency round-trip） | ✅ 201 cat=研发 amt=12500.5 cur=CNY v=1 |
| 07  | Budget PATCH version CAS（v1→v2）                                 | ✅ 200 amount=15000                     |
| 08  | Budget stale version → 409                                        | ✅ 409 VERSION_CONFLICT                 |
| 09  | Budget soft delete                                                | ✅ 200 deleted=true                     |

### 3.3 B2-2A Expenses（6/6）

| #   | 项                                                                                  | 结果                                                              |
| --- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 10  | Expense create + incurredAt 时区 round-trip（本地 +08 10:30 → UTC 02:30Z 往返一致） | ✅ 201 returned=2026-08-16T02:30:00.000Z                          |
| 11  | **Expense note-only PATCH 前后 incurredAt 完整 ISO 不变（KEY）**                    | ✅ before=2026-08-16T02:30:00.000Z after=2026-08-16T02:30:00.000Z |
| 12  | Expense incurredAt clear → null                                                     | ✅ 200 incurredAt=None                                            |
| 13  | Expense amount blank gate                                                           | ✅ 400 VALIDATION_ERROR                                           |
| 14  | Expense stale version → 409                                                         | ✅ 409 VERSION_CONFLICT                                           |
| 15  | Expense soft delete                                                                 | ✅ 200 deleted=true                                               |

> 测试方法学：后端 zod `datetime()` 默认只收 UTC Z（offset:false），前端 `toIso()` 本就转 UTC Z——smoke 按真实契约发 UTC Z 验瞬时等价（`+08:00` 字面量被 400 拒属契约行为，非 defect）；`progressPercent` 为 Decimal-string，断言 float 归一化。

### 3.4 B2-2B Progresses（7/7）

| #   | 项                                                                           | 结果                                                      |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| 16  | **Progress POST 30 → header=30（KEY）**                                      | ✅ POST 201 header=30.0                                   |
| 17  | **Progress PATCH 60 → header=60（KEY）**                                     | ✅ PATCH 200 header=60.0                                  |
| 18  | **Progress PATCH 80 → header=80（KEY）**                                     | ✅ PATCH 200 header=80.0                                  |
| 19  | Progress POST 50 + recordedAt 时区 round-trip（本地 +08 09:00 → UTC 01:00Z） | ✅ POST 201 header=50.0 returned=2026-08-16T01:00:00.000Z |
| 20  | **Progress DELETE 次新 → header fallback=80（KEY）**                         | ✅ DELETE 200 header=80.0                                 |
| 21  | **Progress DELETE 最后 → header=null（KEY）**                                | ✅ DELETE 200 header=None                                 |
| 22  | Progress stale version → 409                                                 | ✅ 409 VERSION_CONFLICT                                   |

### 3.5 CLOSED 双层 Gate（4/4）

| #   | 项                                           | 结果                                                |
| --- | -------------------------------------------- | --------------------------------------------------- |
| 23  | Close project（force，SUPER_ADMIN 双权限）   | ✅ POST 200 stage=CLOSED                            |
| 24  | **CLOSED budget direct POST → 409（KEY）**   | ✅ 409 CONFLICT「项目已结项，不允许修改项目子资源」 |
| 25  | **CLOSED expense direct POST → 409（KEY）**  | ✅ 409 CONFLICT                                     |
| 26  | **CLOSED progress direct POST → 409（KEY）** | ✅ 409 CONFLICT                                     |

### 3.6 B2-1B regression（2/2，PR #75 顺带修复的潜伏项封口）

| #     | 项                                  | 结果         |
| ----- | ----------------------------------- | ------------ |
| 27    | capabilities.products / tags = true | ✅ 200       |
| 28-29 | Product Add / Tag Add 不再 403      | ✅ 201 / 201 |

### 3.7 页面（2/2）

| #     | 项                        | 结果         |
| ----- | ------------------------- | ------------ |
| 30-31 | /projects、/projects/[id] | ✅ 200 / 200 |

## 4. 已知问题 / 风险

- 无 Blocking。`/api/projects/None`（早期测试脚本因 fixture 失败产生的 URL 噪声）不记 defect，不开 PR。
- Domain Event（ProjectAccepted / ProjectClosed / ProjectForceClosed / ProjectStageChanged）按项目惯例以 AuditLog + EVENTS.md 注册为准（事件总线落地前不实际发布），EVENTS.md 注册位已存在。

## 5. 验收人

- Runtime 执行：CIO（JINZA）
- FINAL CLOSED 签署：owner（sk ook，2026-08-17 14:21 GMT+8）
- 签署结论：**B2-2A FINAL CLOSED ✅ / B2-2B FINAL CLOSED ✅（Production `dcefea3e` — 31/31 PASS — ACCEPTED）**
