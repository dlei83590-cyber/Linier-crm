# Release Gate — v0.8.0-alpha Acceptance（2026-08-19）

> 依据：CTO 推荐顺序执行（P0-2 发布收口）；前置：v0.7.0-alpha（2026-08-18）已发布
> 结论：**RELEASE CANDIDATE — 候选条件达成**（Frontend 全模块打通 + 5C-2 FINAL + Read Models FINAL + 会计单测）
> 存档：CIO/CTO 2026-08-19

---

## 1. Gate A — 5C-2 会计（Supplier CN/DN + Payment Allocation，ADR-0030）

| 维度 | 证据 | 状态 |
| --- | --- | --- |
| transaction | CN/DN APPLY 与 Payment APPLY 均为同事务（状态终态 + ApOpenItem.openAmount 投影重算，禁止 partial success） | ✅ |
| concurrency | 锁序一致（业务头 FOR UPDATE → 目标 ApOpenItem FOR UPDATE；与 5C-1 collect→dedupe→sort 纪律一致） | ✅ |
| invariants | 防超调（CREDIT 不得使 openAmount<0）/ 防超核销（≤ openAmount 且 ≤ 未核销余额）/ 同供应商同币种 / maker-checker / 幂等 | ✅ |
| tests | 5C-2 会计单测 21 条不变量路径（apply-helper.test.ts ×2，CI Unit tests 通过 `4fc7470`） | ✅ |
| 事件 | SupplierCreditDebitNoteApplied / SupplierPaymentApplied（EVENTS v1.34，事务提交后发布） | ✅ |
| 验收 | Migration 0029/0030 + 两批实现合入 main（`b0d68e7` / `9be51c5` / `8b5c3a7` CI 全绿）；ADR-0030 | ✅ |

## 2. Gate B — Frontend 全模块打通 + Read Models

| 证据 | 状态 |
| --- | --- |
| 9 个待开发页面全部打通（7 CRUD + 2 引导）+ registry ready（Batch 1/2/3，`8ca5f06`/`053e256`/`05183cc`） | ✅ |
| 中文化审计（labels.ts 角色/权限中文映射 + uscc GB 32100-2015 校验，`890bf76`） | ✅ |
| AP Open Items 只读查询页（`7a445fe`） | ✅ |
| Inventory Read Model FINAL（CTO #8845 解除；stock-projections / inventory-movements Query API + 前端两页） | ✅ |
| 前端页面无 Placeholder（全模块可操作或引导） | ✅ |

## 3. Gate C — Governance / CI / HOLD 边界

| 证据 | 状态 |
| --- | --- |
| ROADMAP v1.24（5C-2 ✅、HOLD 清单更新）、ADR-0029/0030、CHANGELOG [Unreleased] 全量条目 | ✅ |
| CI Policy：Quality Gates（lint→prisma generate→type-check→**unit tests**）+ Build + Gitleaks；发布基线 commit CI 全绿 | ✅ |
| HOLD 边界：GL / Costing / Reservation / BI / OA / Mobile（解除需 CTO 单独指令）；reports 信息架构待 20 份报表清单 | ✅ |

## 4. Release 基线（v0.8.0-alpha）

- **Schema baseline**：0030（Migration 0001–0030；0027 FROZEN，0028 FINAL，0029/0030 5C-2 增量）
- **API baseline**：Sprint 4-6 + 5C-1/5C-2 + Read Models + Master-Data/System CRUD + Platform 全量 + ap-open-items
- **Frontend baseline**：全模块工作台（36 ready + 引导/规划中）
- **测试基线**：5C-2 会计单测 21 条（CI Unit tests 非空）
- **版本治理**：RELEASE_VERSION manifest = v0.8.0-alpha；root package.json 不随本版修改
- **Known Limitations / HOLD 清单**：见 docs/RELEASE_NOTES.md v0.8.0-alpha 段

## 5. 声明

- 本 Acceptance 依据仓库事实（git history / CI）签署，非本地运行结果。
- CI GREEN 为必要条件；业务不变量证据（Gate A）以单测 + 合入契约为准。
- 生产部署验证：/api/health/ready 返回 migrationBaseline=true（expected=`0030_supplier_payment_allocation`）——待部署后执行（如实声明：本 Gate 未在部署环境执行 Runtime smoke）。