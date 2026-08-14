# AGENTS.md — 仓库级开发指令（CI-First / No Local Server）

> **适用范围**：本文件适用于整个仓库（`apps/`、`packages/`、`prisma/`、`docs/`、`.github/` 等全部路径）。所有 AI Agent（Codex / CIO / 其他）MUST 遵守。
> **优先级**：仓库已批准的 `docs/ROADMAP.md` / `docs/ADR/*` / `docs/ARCHITECTURE_BASELINE.md` / 最新 CTO Directive（`docs/reviews/CTO_Directive_Post6B_Dual_Track_Execution_Gate_2026-08-12.md`）> 本文件 > 其他文档。冲突时以前者为准。
> `docs/AGENTS.md` 继续保留文档专属规则；本文件是仓库级规则。

你正在维护 dlei83590-cyber/nilier-crm（Linier ERP）。

## 1. 最高原则

开发采用 **CI-First / No Local Server** 模式。

### MUST

- MUST 先读取并服从 `docs/ROADMAP.md`。
- MUST 先确认当前 main、当前 Sprint 状态、相关 ADR、QA、API/Test Cases 后再修改代码。
- MUST 做最小、完整、可审查的变更。
- MUST 通过 GitHub CI 取得最终验证事实。
- MUST 根据 CI 的具体失败日志逐项修复。
- MUST 保持 Schema、Migration、API、Error Code、Events、QA、Test Cases、ADR、ROADMAP 等相关文档同步。

### MUST NOT

- MUST NOT 启动本地开发服务器。
- MUST NOT 执行 `pnpm dev`。
- MUST NOT 在本地执行 `pnpm build`。
- MUST NOT 在本地执行完整 `pnpm test`。
- MUST NOT 在本地执行 `pnpm type-check`。
- MUST NOT 在本地执行完整 `pnpm lint`。
- MUST NOT 执行 Playwright / E2E。
- MUST NOT 执行 Docker build。
- MUST NOT 为"提前确认 CI 会不会过"而运行等价的高负载验证。
- MUST NOT 将 Railway/部署成功视为 CI 验证成功。
- MUST NOT 因 CI 失败而扩大修改范围或顺手重构无关代码。
- **MUST NOT 触碰本地开发服务器进程/端口/缓存（2026-08-13 CI-First Enforcement）**：禁止启动、停止、重启、kill 或替换任何现有本地开发服务器；禁止因端口占用执行 `kill` / `pkill` / `killall`；禁止清理 `.next`、node_modules、缓存、PID、socket 来"修复环境"；禁止为验证页面而访问/操纵本地运行服务；禁止因 CI failure 在本地复现整个 CI pipeline。即使发现本地服务器异常，也只报告环境事实，不得自行修复运行环境。

本地只允许代码编辑、静态阅读以及必要的轻量检查，例如：

- `git diff` / `git status`
- `grep` / `rg` / `find` / `wc`
- 查看文件局部内容
- 检查引用关系、路由结构、Schema 定义和 migration SQL
- 对修改内容进行人工静态推理

## 2. 开始任何新开发任务之前

按以下顺序读取事实源：

1. `docs/ROADMAP.md`
2. 最新 CTO Directive（`docs/reviews/CTO_Directive_Post6B_Dual_Track_Execution_Gate_2026-08-12.md`）
3. 与任务相关的 `docs/ADR/*`
4. `docs/ARCHITECTURE_BASELINE.md`
5. `docs/DOMAIN_MODEL.md`
6. `docs/API_GUIDELINES.md`
7. `docs/ERROR_CODES.md`
8. `docs/EVENTS.md`
9. 当前 Sprint QA
10. 对应 `docs/test-cases/*`
11. Prisma Schema / 已有 Migration
12. 相关既有 API / Shared Core 实现

**如果聊天指令与仓库文档冲突**：仓库当前已批准的 ROADMAP / ADR / Architecture Baseline / CTO Directive 优先。不得依靠旧聊天记录推断已经批准的新业务范围。

## 3. 当前阶段边界

（依据 CTO Directive 2026-08-12 Post-6B 双轨执行 Gate 与 2026-08-13 CI-First Enforcement / 阶段重排；ROADMAP 更新后必须同步本节。）

- **Track A Frontend Tier 1 Reference（Batch 1/2）— CLOSED**：Purchase Requisition / Inventory Transfer（PR #27）、Inspection / Purchase Return（PR #32）Create + DRAFT Edit 均已合入 main。
- **Frontend Auth Transport Contract Repair — CLOSED（PR #34）**：统一认证传输 `apiFetch` + Bearer（same-origin `/api/*` 自动附加 + 401 统一收敛）已合入。
- **Master-Data Read API（P0）— CLOSED（PR #33）**：`GET /api/warehouses`、`/api/warehouse-locations`、`/api/unit-of-measures` 只读端点 + `warehouse`/`warehouse-location` RBAC registry 注册；Batch 3/4 selector 依赖已解除。
- **Frontend Release Metadata + Dashboard Stale Cleanup（P0.5）— CLOSED（PR #35）**：version SSOT = root `package.json`；build-time 注入 `APP_VERSION/GIT_SHA/BUILD_ID/DEPLOYMENT_ENV`（生产来源 = 构建平台变量 Railway/GitHub，不依赖 .git）；Footer + Dashboard System Overview 只消费构建注入值；Dashboard 删除 Sprint 编号卡与静态“认证服务：正常”等健康状态声称。
- **5C-1 Supplier Invoice / GRIR / AP Liability / AP Open Item — CLOSED / Accounting Baseline（PR #23 已合入）**。
- **5C-2（Supplier Payment / AP Allocation / Payment Reversal / Supplier CN/DN / AP Write-Off / GL Posting）— HOLD**。
- **Batch 3（PO/Receipt/WHR）、Batch 4（Count/Adjustment/Conversion）— HOLD pending next Gate**：P0.5 与 Governance CLOSED 后先做 Batch 3 Readiness Recheck（selector 映射 / 权限 / 返回 envelope），确认无新 contract gap 再解除 implementation HOLD。
- **Tier 2/3（Submit/Approve/Confirm/Complete/Post/Execute/Return/Cancel 等）— HOLD**。
- **GRIR 是不可变会计事实**：只允许 ACCRUAL / REVERSAL / CONSUME，禁止 `UPDATE GrirRecord SET quantity = ...`。
- **WHR POST 与 GRIR ACCRUAL 必须同一事务**；Purchase Return（sourceRefType=WAREHOUSE_RECEIPT_LINE）必须产生 GRIR REVERSAL，且 Σ REVERSAL ≤ Σ ACCRUAL，任何并发路径不得制造负 GRIR。
- **Invoice POST 同事务必须产生 GRIR CONSUME + AP Liability + AP Open Item**，禁止 partial success；金额一律 Server-side Decimal canonical 计算，禁止信任 client amount/tax/matched quantity。
- **并发锁序（Blocking Gate）**：collect IDs → deduplicate → sort → `SELECT ... ORDER BY id FOR UPDATE`；POST 与 Return REVERSAL 必须使用完全一致锁序。
- **Migration 0027 = FROZEN BASELINE**，禁止修改；Migration 0028 通过 Final Gate 后立即冻结。
- **Inventory Read Model（P1）**：只允许设计 StockProjection Query / InventoryMovement Query 的 Query Contract，实现 HOLD until Contract Review；禁止前端自拼余额、SUM Movement 当权威余额、客户端重建 StockProjection。
- **HOLD（解除需 CTO 单独指令）**：Reservation / AvailableQty / FIFO / Moving Average / Inventory Costing / General Ledger / Financial Statements / BI / OA / Mobile。
- **UI 状态机红线**：APPROVED ≠ CONFIRMED、CREATED ≠ POSTED、APPROVED ≠ APPLIED、COMPLETED ≠ ADJUSTED、DRAFT ≠ SUBMITTED；前端按钮显隐只能消费后端状态契约。
- 下一阶段开发必须先进行 **Design / Scope Gate**，再进入 Schema/API 实现。

## 4. 每个任务的执行循环

### Phase A — Repository Inspection

先检查：当前分支 / main 最新状态、最近相关提交、当前 ROADMAP、现有 Schema / Migration、相关 API、Shared Core、ADR、QA、Test Cases、OpenAPI、Error Codes、Events。

输出：当前事实 / 任务范围 / 不允许修改的边界 / 预计修改文件 / 验收标准。

**没有完成这一步，不开始编码。**

### Phase B — Implementation

实现时：

- 优先复用既有领域模式。
- 不创建平行业务真相。
- 不绕过 Shared Core。
- 不信任客户端提供的 canonical/business facts。
- `posting` / `execute` / `approve` 等最终事实边界必须重新验证必要的不变量。
- 涉及库存、财务、审批等业务事实时必须考虑：transaction、idempotency、concurrency、immutable facts、maker-checker、audit evidence、domain event、failure atomicity。
- 只做当前 Gate 明确授权的能力。

### Phase C — Static Review

修改完成后，不启动服务器，也不运行高负载验证。人工检查：

- diff 是否只包含当前 Scope。
- 是否存在明显 TypeScript 类型问题。
- import / export 是否一致。
- Prisma 字段和代码引用是否匹配。
- migration 与 schema 是否一致。
- 状态转换是否完整。
- Error Code 是否注册。
- Event 是否注册。
- OpenAPI 是否同步。
- QA / Test Cases 是否包含新增不变量。
- 是否存在直接写入本应由 Shared Core 管理的数据。
- 是否存在 fallback、silent degradation 或伪造业务事实。
- 是否有敏感信息进入仓库。

### Phase D — Commit / Push / CI

只有在获得对应 Git 操作授权后：

1. stage 当前任务明确文件
2. commit
3. push
4. 等待 GitHub CI
5. 读取 CI checks / Actions logs

**验证标准是 GitHub CI，而不是本地执行结果。**

### Phase E — CI Repair Loop

若 CI 失败：

1. 找到第一个真实失败步骤。
2. 阅读失败日志。
3. 定位最小根因。
4. 只修复该根因及必要关联。
5. 静态复核 diff。
6. commit / push。
7. 再看 CI。

禁止：

- 猜测式大面积修改。
- 因 Type Check 失败顺带重构。
- 因测试失败降低测试要求。
- 删除断言来让 CI 变绿。
- 使用 `any`、`@ts-ignore` 等手段掩盖领域模型问题，除非有明确技术依据。
- 把失败归因于"CI 环境问题"而没有日志证据。

## 5. CI Gate

当前正式 Gate 至少包括：

- **Quality Gates**：dependency install → lint → Prisma Client generation → type-check → unit tests
- **Build Gate**：dependency install → Prisma Client generation → production build
- **Security Gate**：Gitleaks secret scanning

只有这些 required CI 验证全部成功，才能声明 **CODE VERIFIED**。Railway deployment success 只能说明部署状态，不替代上述 Gate。CI GREEN 是合并的必要条件，但不是充分条件（业务不变量错误不能因 CI GREEN 而合并）。

## 6. 完成定义

一个开发阶段只有同时满足以下条件才可收口：

- Scope 已全部实现。
- 无未经授权的扩展。
- Schema / Migration 一致。
- API / Error Code / Event 文档一致。
- QA 更新。
- Test Cases 更新。
- 必要 ADR 更新。
- ROADMAP / CHANGELOG / Release docs 按 Gate 要求同步。
- GitHub CI 全绿。
- Review blocking comments 已处理。
- 没有遗留未声明风险。

如果 CI 尚未成功，只能报告：**IMPLEMENTATION COMPLETE — CI PENDING/FAILED**，不得报告"完成""验证通过"或"可合并"。

## 7. Agent 汇报格式

每轮开发只汇报四类事实：

- **完成**：说明本轮实际修改。
- **边界**：说明明确没有修改什么。
- **CI**：列出实际远程 CI 状态和失败/成功 Gate。
- **下一步**：只给一个最接近当前 Gate 的下一动作。

不要用本地服务器输出作为验证证据。不要伪造未执行的测试结果。不要把代码静态检查表述成测试通过。

## 8. Agent Commit Rule（Server Safe Mode）

AI/OpenClaw commits MUST bypass local Husky/lint-staged hooks:

```shell
HUSKY=0 git commit -m "..."
```

Reason: local hooks are local validation and violate Remote-CI-Only execution mode.

This does NOT weaken quality gates: GitHub CI remains mandatory before merge.

- 本地只允许低资源静态操作（编辑 / git status / git diff / git add 明确文件 / git log / git show / 窄范围 grep / fetch / branch / commit / push）。
- 禁止本地运行 build / test / type-check / lint / lint-staged / eslint / tsc / turbo / Prisma / Docker / dev server / 全仓 formatter。
- 禁止为 commit 自动执行的本地质量 Gate（Husky pre-commit validation）。
- 禁止 kill / pkill / killall / systemctl restart / pm2 restart / rm -rf .next / rm -rf node_modules。发现服务器资源异常时只汇报 SERVER_RESOURCE_ANOMALY — STOP。
- 人类开发者本地环境是否继续使用 Husky 不受影响；不需要删除 `.husky/pre-commit`，只规定 AI/服务器执行账户 bypass hook。
- CI 失败修复：只读 GitHub 失败 job 的第一个真实 error → 定位相关文件 → 静态修改 → `HUSKY=0 git commit` → push → 再等 CI，一次只修第一个 root cause。
