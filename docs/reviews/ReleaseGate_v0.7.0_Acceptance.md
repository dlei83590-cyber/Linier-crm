# Release Gate — v0.7.0-alpha Acceptance（2026-08-18）

> 依据：CTO Directive 2026-08-12 Post-6B 双轨执行 Gate §21（Release Gate）与 §23（下一次 CTO Gate 检查三结果）
> 结论：**RELEASE CANDIDATE — 候选条件达成**（5C-1 FINAL + Frontend Operations Iteration 1 可用基线）
> 存档：CIO/CTO 2026-08-18（治理同步 commit cc09c7f + 发布 commit）

---

## 1. Gate A — Accounting（WHR POST → GRIR ACCRUAL → Supplier Invoice Match → POST → GRIR CONSUME → AP Liability → AP Open Item）

| 维度 | 证据 | 状态 |
| --- | --- | --- |
| transaction | 5C-1C1 POST 同事务 = GRIR CONSUME + ApLiabilityFact + ApOpenItem + Invoice POSTED，禁止 partial success（apps/web/src/lib/supplier-invoice/post-helpers + [id]/post/route.ts） | ✅ |
| concurrency | 锁序 collect→dedupe→sort→`SELECT ... ORDER BY id FOR UPDATE`，POST 与 PurchaseReturn REVERSAL 完全一致（CTO #9678 Blocking Gate） | ✅ |
| idempotency | 已 POSTED → 409；GRIR Producer（WHR POST ACCRUAL / Return REVERSAL）Σ REVERSAL ≤ Σ ACCRUAL 无负 GRIR；0028 backfill 幂等 | ✅ |
| historical data | Migration 0028 GRIR Historical Backfill（historical ACCRUAL/REVERSAL + canonical sourceKey + source business timestamp），生产 baseline 已核验 = 0028 | ✅ |
| 验收 | PR #23 已合并 main `5a8dcae`；CTO 系列 FINAL：5C-1A #9048/#9083、5C-1B #9238/#9247/#9342、5C-1C0 #9477/#9547、5C-1C1 #9678/#9757/#9781 | ✅ |

## 2. Gate B — Frontend（真实 FINAL API 被工作台稳定消费）

| 证据 | 状态 |
| --- | --- |
| B2-2A/B2-2B **31/31 Runtime Acceptance PASS — ACCEPTED**（docs/qa/B2-2_Runtime_QA.md，Production `dcefea3e`，2026-08-17）——permission / loading / error / empty / pagination / status 全链路 | ✅ |
| F2-0~F2-6B 各批次 CTO FINAL APPROVED 99/100（IA v2 / UI 底座 / Master Data / PO-Receipt-WHR / CRM-Project Workspace / Dashboard v2 / Sales actions / Supplier Invoice 前端 submit-match-post） | ✅ |
| Project Lifecycle L0-L2-B1 已合并 main（PR #77-#83：Acceptance/Transition/Close/Attachments） | ✅ |
| RBAC drift 修复（PR #75 补 17 个 seed-only 模块）+ ADR-0028 治理规则（静态审计 308 个 API 权限码缺失归零） | ✅ |

## 3. Gate C — Governance（ROADMAP 与 main 一致、Release baseline 清晰、CI policy 清晰、HOLD 边界清晰）

| 证据 | 状态 |
| --- | --- |
| ROADMAP v1.21（2026-08-18）：Sprint 5 → ✅（5C-1 FINAL）、Frontend Operations 收口、Project Lifecycle L0-L2B1、M4.2、变更记录 | ✅ |
| CHANGELOG [Unreleased]：5C-1 / F2-6 / B2-2 / L 系列 / P0 R1-R3 条目 | ✅ |
| AGENTS.md §3 阶段边界同步（CI-First / No Local Server 不变） | ✅ |
| CI Policy：Quality Gates（lint→prisma generate→type-check→unit tests）+ Build + Gitleaks Secret Scanning；发布基线 commit CI 全绿 | ✅ |
| HOLD 边界：5C-2 / Reservation / Costing / Inventory Read Model 实现 / GL / BI / OA / Mobile（解除需 CTO 单独指令） | ✅ |

## 4. Release 基线（v0.7.0-alpha）

- **Schema baseline**：0028（Migration 0001–0028；0027 FROZEN，0028 FINAL 冻结）
- **API baseline**：Sprint 4 O2C + Sprint 5A/5B/5C-1 + Sprint 6A/6B + Master-Data Read API + Platform（Workflow/Audit/Menu/Dashboard/File）+ RBAC registry 全量
- **Frontend baseline**：F2-0~F2-6B + B2-0~B2-2B + Project Lifecycle L0-L2B1（工作台可操作，只读 API 消费）
- **版本治理**：RELEASE_VERSION manifest = v0.7.0-alpha；root package.json 不随本版修改
- **Known Limitations / HOLD 清单**：见 docs/RELEASE_NOTES.md v0.7.0-alpha 段

## 5. 声明

- 本 Acceptance 依据仓库事实（git history / CI / 生产 health 核验）签署，非本地运行结果。
- CI GREEN 为必要条件；业务不变量证据（Gate A）以 PR #23 合入的契约与测试用例为准。
- 生产部署验证：/api/health/ready 返回 status=ok / database=ok / migrationBaseline=true（expected=applied=`0028_grir_historical_fact_backfill`）。
