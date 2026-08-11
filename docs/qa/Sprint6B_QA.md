# Sprint 6B QA — Inventory Transfer Vertical Slice（调拨 Vertical Slice）

> Sprint：6B（Inventory Operations）| 模块：Inventory Transfer——业务事实层（Create/Update/Submit/Cancel/Execute）+ 共享 InventoryLedgerCommand 双 atom 落账（SOURCE_OUT + DESTINATION_IN，同一 movementGroupId）| PR：#22（feature/sprint6b-inventory-operations）
> 日期：2026-08-11
> 状态：⏳ 待 CTO Inventory Transfer Review（Phase 6B-2，CTO #8233 授权；Count/Adjustment/Conversion 继续 HOLD）
> 关联：ADR-0026（FINAL APPROVED）、Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §3、Sprint6B_Inventory_Operations_Field_Matrix.md v0.5 §1、Sprint6B_CTO_Pending_Decisions.md（P2/P3/P5 Final）、EVENTS.md v1.28（InventoryTransferExecuted）、docs/test-cases/InventoryTransfer_API.md、openapi.yaml（Sprint 6B-2 段）
> 6B-2 核心事实链：**Transfer DRAFT（TRF 创建即取号）→ Submit（审批走既有 Workflow Policy；未命中 → APPROVED 投影）→ Execute（同事务：锁单 → 生成 movementGroupId → Shared LedgerCommand 双 atom SOURCE_OUT + DESTINATION_IN → 单据 EXECUTED + executedAt/ById）→ InventoryTransferExecuted（事务提交后 best-effort，不含库存余额）**

## 1. 交付范围

### 1.1 代码（均在 `apps/web/src/**`）
| 分组 | 文件/端点 | 说明 |
| --- | --- | --- |
| Seed/RBAC | `prisma/seed.ts` + `packages/shared/src/constants/index.ts` | `inventory-transfer` 动作权限（view/create/edit/delete/approve/audit/export/import/assign/close）+ `inventory-transfer-line` view/edit 受限权限 + TRF DocumentSequence（INVENTORY_TRANSFER，prefix TRF，padLength 6，创建即取号） |
| 领域函数 | `apps/web/src/lib/inventory-transfer/helpers.ts` | `nextTransferNo`（TRF 原子取号）+ `buildTransferAtoms`（SOURCE_OUT + DESTINATION_IN 双 atom，同一 movementGroupId；serial-managed 每 serial 一对 quantity=1；非 serial 一对 BULK；batch/mfg/exp 原样继承）+ `transferLineDedupeKey` |
| 事件 | `apps/web/src/lib/inventory-transfer/events.ts` | `InventoryTransferExecuted`（EVENTS v1.28 已注册；载荷不含投影余额） |
| Workflow 集成 | `apps/web/src/lib/inventory-transfer/workflow-sync.ts` | `maybeTriggerInventoryTransferApproval`（module=INVENTORY_TRANSFER 策略命中 → 创建/复用 WorkflowInstance 单实例+多轮重提；未命中 → 不触发不阻塞）+ `syncInventoryTransferApproval`（COMPLETED → APPROVED + approvedById；REJECTED → DRAFT 重提；**红线 APPROVED ≠ EXECUTED**） |
| API | `apps/web/src/app/api/inventory-transfers/route.ts` | GET 列表（分页 + transferNo/source/dest/status 过滤）+ POST 创建（DRAFT；TRF 取号；自调拨防护；DRAFT 不落账） |
| API | `apps/web/src/app/api/inventory-transfers/[id]/route.ts` | GET 详情 + PATCH 更新（仅 DRAFT；CAS version；行全量替换） |
| API | `apps/web/src/app/api/inventory-transfers/[id]/submit/route.ts` | DRAFT → SUBMITTED + maybeTriggerApproval；未命中策略 → 直接 APPROVED 投影（对齐 PO submit） |
| API | `apps/web/src/app/api/inventory-transfers/[id]/cancel/route.ts` | DRAFT/APPROVED → CANCELLED；SUBMITTED 需先 Withdraw；EXECUTED 禁止（纠错走 Reversal） |
| API | `apps/web/src/app/api/inventory-transfers/[id]/execute/route.ts` | **核心**：APPROVED → EXECUTED；FOR UPDATE 锁单 → 校验执行态事实 → 生成 movementGroupId → `executeLedgerAtoms(tx, atoms)`（同一 caller tx，全有或全无）→ 单据 EXECUTED + 证据（同事务）→ 事务提交后发 InventoryTransferExecuted |
| Workflow 回写 | `apps/web/src/app/api/workflows/instances/[id]/actions/route.ts` | businessType === 'inventory-transfer' → syncInventoryTransferApproval（COMPLETED/REJECTED） |
| OpenAPI | `docs/openapi.yaml` | Sprint 6B-2 段：/api/inventory-transfers（list/create/get/patch/submit/cancel/execute）+ components（InventoryTransferCreate/Update/Response/List/Submit/Execute） |

### 1.2 RBAC（权限码，动作级，零新造）
- `inventory-transfer:view`（list/get）｜ `inventory-transfer:create`（创建）｜ `inventory-transfer:edit`（PATCH/submit/execute）｜ `inventory-transfer:close`（cancel）｜ `inventory-transfer:approve`（Workflow 审批动作沿用 workflow-instance:approve，Transfer 侧不新增）
- `inventory-transfer-line:view / edit`（受限，行由单据驱动）

### 1.3 Domain Events（EVENTS.md v1.28）
- `InventoryTransferExecuted` ⏳ → **✅ implemented**（Execute 事务提交后 best-effort 发布；载荷 transferId/transferNo/movementGroupId/源目标仓库位/lines/executedById/executedAt，**不含库存余额**——P10 Final）
- DRAFT 创建/编辑/提交/取消**不发领域事件**（仅 AuditLog），对齐 5B 惯例

## 2. 业务事实边界核验（CTO Gate）

| # | 边界 | 实现 | 核验 |
| --- | --- | --- | --- |
| B1 | Transfer = 双边原子事实（D2） | Execute 构造 SOURCE_OUT + DESTINATION_IN 双 atom，同一 movementGroupId，同一 caller tx | ✅ |
| B2 | 全有或全无（CTO #7895） | executeLedgerAtoms 任一失败 → 整事务回滚，单据保持 APPROVED（不提前写 EXECUTED） | ✅ |
| B3 | 同一 movementGroupId | Execute 锁单后**复用已有值或首次生成**（`transfer.movementGroupId ?? crypto.randomUUID()`）并冻结；**禁止每次 attempt 随机重造**（CTO Transfer Review Blocking ②：同五元 identity 不同 group fact → Shared Core 判幂等 conflict）；Create/Submit/Approve 阶段不生成（Schema 可空，EXECUTE 后必有） | ✅ |
| B4 | 六A 红线：不经 Ledger Command 直写 | Transfer API **绝不直接 INSERT InventoryMovement / UPDATE StockProjection**——只调用 `executeLedgerAtoms`（grep 审计） | ✅ |
| B5 | 幂等重试走 Shared Core | 五元 identity（sourceType=TRANSFER/sourceId/sourceLineId/role/atomKey）+ immutable-fact equality；重复 execute → 409 ALREADY_EXECUTED；Core 幂等防并发重放 | ✅ |
| B6 | serial-managed 守恒 | serialNos.length == quantity 且整数、去重；双边**完全相同 serial 集合**（每 serial 一对） | ✅ |
| B7 | batch/mfg/exp 精确继承（P5） | buildTransferAtoms 原样复制 SOURCE→DESTINATION；首版禁止换批 | ✅ |
| B8 | 自调拨防护（P3） | 同仓同库位（含都 NULL）→ 409 SELF_TRANSFER（Create/Update/Submit/Execute 四层复核 + DB CHECK 兜底） | ✅ |
| B9 | 状态机（P2） | DRAFT → SUBMITTED → APPROVED → EXECUTED / CANCELLED；**APPROVED ≠ EXECUTED** | ✅ |
| B10 | Cancel 边界 | DRAFT/APPROVED 可 Cancel；SUBMITTED 需先 Withdraw；EXECUTED 禁止（纠错走整组 Reversal） | ✅ |
| B11 | 审批走既有 Workflow Policy | maybeTriggerApproval（module=INVENTORY_TRANSFER）；未命中 → 直接 APPROVED 投影（对齐 PO submit，不发明第二套审批规则） | ✅ |
| B12 | 终态证据（Integrity ①） | EXECUTED ⇒ movementGroupId/executedAt/executedById 全非空（同事务写入 + Migration 0026 CHECK 兜底） | ✅ |

## 3. 核心不变量（CTO 6B-2 Execute 三不变量）

| # | 不变量 | 实现证据 |
| --- | --- | --- |
| I1 | SOURCE_OUT + DESTINATION_IN 共用同一非空 movementGroupId | execute/route.ts：`const movementGroupId = transfer.movementGroupId ?? crypto.randomUUID()`（已有值复用，无值首次生成）→ buildTransferAtoms 全部 atom 携带 → 单据 movementGroupId 同值落库 |
| I2 | 单据 EXECUTED + 两笔 Movement + 两侧 Projection 同一 caller transaction 全有或全无 | 全部在 `prisma.$transaction` 内：executeLedgerAtoms(tx, atoms) → CAS updateMany(status=EXECUTED + 证据 + version+1)；任何失败抛错 → 事务回滚 |
| I3 | 重试通过 Shared Core identity+immutable-fact 幂等；禁止自实现扣增 | 只调用 `executeLedgerAtoms`；InventoryInsufficientStockError / InventoryLedgerIdempotencyConflictError 上抛 → 409；无任何自行 INSERT Movement/UPDATE Projection 代码 |

## 4. 并发与回滚（Concurrency & Rollback）

| # | 场景 | 预期 |
| --- | --- | --- |
| R1 | 重复 execute（同版本） | 第二次 409 ALREADY_EXECUTED（幂等拒绝） |
| R2 | 并发 execute / cancel 同单 | FOR UPDATE 串行；CAS version+status 原子条件，败者 409 VERSION_CONFLICT / INVALID_STATE |
| R3 | 源库存不足（execute） | InventoryInsufficientStockError → 409 INVENTORY_INSUFFICIENT_STOCK；事务回滚，单据保持 APPROVED，Movement/Projection 0 落账 |
| R4 | SOURCE_OUT 成功但 DESTINATION_IN 故障 | executeLedgerAtoms 同 tx 顺序执行，第二个抛错 → 整事务 0 落账（**无 SOURCE_OUT 残留**） |
| R5 | 幂等 immutable-fact conflict | 同五元 identity 但 fact 不同 → InventoryLedgerIdempotencyConflictError → 409；绝不静默重放 |
| R6 | serial 双边一致性 | serial-managed 行每 serial 恰好一对（SOURCE_OUT X + DESTINATION_IN X）；数量守恒校验在 Create/Execute 双层 |
| R7 | 自调拨并发 | 同仓同库位请求 → 409 SELF_TRANSFER（Create 即拒） |

## 5. 已知限制（Known Limitations）

1. 事件总线未落地（既有债务）：InventoryTransferExecuted 以 AuditLog 留痕，发布失败不阻断（事务已提交）；
2. **Count / Adjustment / Conversion 继续 HOLD**（CTO 6B-2 明令，本轮不实现 ADJ/CNT/CVT，也不扩 Reservation/Costing）；
3. Transfer Reversal（整组冲销）本轮不实现——EXECUTED 后纠错走未来 Reversal slice（REVERSAL role 已预留，CTO #7975 Blocking ④ 已锁设计）；
4. 跨仓/同仓审批差异由 Workflow Policy 配置驱动（P2 Final：跨仓默认需审、同仓策略配置，不硬编码）——未配置策略时 submit 直接 APPROVED。

## 6. Release Gate

Sprint 6B-2 Transfer Vertical Slice 进入 CTO Inventory Transfer Review 前必须满足：

1. A-I（docs/test-cases/InventoryTransfer_API.md）全部核验，无 Blocking；
2. Transfer 核心链 DRAFT → SUBMITTED → APPROVED → EXECUTED 全链通过（含未命中策略直接 APPROVED 分支）；
3. Execute 三不变量（I1/I2/I3）代码证据 + 并发/回滚场景（R1-R7）核验；
4. **Transfer API 全程 0 直写** InventoryMovement / StockProjection（grep 代码审计）；
5. CI Quality Gates + Build 全绿（GitHub Actions run 待出）；
6. OpenAPI Sprint 6B-2 段（端点 + components）已补齐；
7. EVENTS.md v1.28 载荷对齐（InventoryTransferExecuted 已注册，无需扩事件）；
8. Count/Adjustment/Conversion 零实现（HOLD 保持）。
