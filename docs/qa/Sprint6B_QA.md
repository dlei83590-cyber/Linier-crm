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

---

# Sprint 6B-3 QA — Stock Count + Inventory Adjustment Vertical Slice（盘点 + 调整事实链）

> Sprint：6B（Inventory Operations）| 模块：Stock Count（实盘事实）+ Inventory Adjustment（受控库存账事实）——事实链：**StockCount → per-line snapshot → variance → InventoryAdjustment → Shared LedgerCommand ADJUSTMENT Movement** | PR：#22（feature/sprint6b-inventory-operations）
> 日期：2026-08-11
> 状态：⏳ 待 CTO Count+Adjustment Review（Phase 6B-3，CTO #8471 授权；Conversion/Reservation/Costing 继续 HOLD）
> 关联：ADR-0026（FINAL APPROVED）、Architecture Process Gate §4/§5、Field Matrix v0.5 §2/§3、Sprint6B_CTO_Pending_Decisions.md（P6/P7/P8/P9 Final）、EVENTS.md v1.28（InventoryCountCompleted / InventoryAdjustmentApplied）、docs/test-cases/StockCount_Adjustment_API.md、openapi.yaml（Sprint 6B-3 段）
> 6B-3 核心事实链：**StockCount DRAFT（CNT 创建即取号）→ 录入盘点行（per-line atomic snapshot：同事务读五维 StockProjection → bookQtyAtCount/countedAt/ledgerWatermark；varianceQty=countedQty-bookQtyAtCount）→ complete（锁定；非零差异自动生成 COUNT_VARIANCE Adjustment DRAFT）→ Adjustment submit（Workflow 审批；未命中→APPROVED 投影）→ apply（同事务：锁单 → maker-checker → executeLedgerAtoms 逐行 ADJUSTMENT Movement → 单据 APPLIED + 证据）→ InventoryAdjustmentApplied（事务提交后 best-effort）**
> **红线（CTO 6B-3 锁死）**：① StockCount **永不直接修改 StockProjection**——只有 Adjustment Apply 才允许调用 Shared LedgerCommand；② `sourceStockCountLineId @unique` 确保一条盘点差异只能正式结算一次（防双重入账）；③ Manual Adjustment 继续 maker-checker（创建人 ≠ 批准/Apply 人，DB CHECK 兜底）；④ 所有非零 Count variance 的 System Default 仍需审批；⑤ Adjustment 路由 **0 直写** InventoryMovement/StockProjection。

## 1. 交付范围

### 1.1 代码（均在 `apps/web/src/**`）
| 分组 | 文件/端点 | 说明 |
| --- | --- | --- |
| Seed/RBAC | `prisma/seed.ts` + `packages/shared/src/constants/index.ts` | `stock-count` / `inventory-adjustment` 动作权限 + `stock-count-line` / `inventory-adjustment-line` view/edit 受限权限 + **`inventory-adjustment:apply` 受限系统权限**（SYSTEM_PERMISSIONS，仅 SUPER_ADMIN/ADMIN——P8/P9 Final）+ CNT（STOCK_COUNT）/ ADJ（INVENTORY_ADJUSTMENT）DocumentSequence（创建即取号，缺失 fail closed） |
| 领域函数 | `apps/web/src/lib/stock-count/helpers.ts` | `nextCountNo`（CNT 原子取号 fail closed）+ `countLineDedupeKey`（五维去重）+ `readProjectionSnapshot`（同事务读五维 StockProjection → bookQtyAtCount/ledgerWatermark）+ `computeVarianceQty`（countedQty - bookQtyAtCount，无动态补偿公式） |
| 领域函数 | `apps/web/src/lib/inventory-adjustment/helpers.ts` | `nextAdjustmentNo`（ADJ 原子取号 fail closed）+ `adjustmentLineDedupeKey` + `buildAdjustmentAtoms`（每行一笔 ADJUSTMENT Movement：sourceType=ADJUSTMENT/sourceId/sourceLineId/movementRole=ADJUSTMENT/movementAtomKey=BULK 或 serialNo；movementGroupId=adjustment.id 稳定；direction 行级 IN/OUT；quantity 恒正） |
| 事件 | `apps/web/src/lib/stock-count/events.ts` | `InventoryCountCompleted`（EVENTS v1.28 已注册；载荷含 variance 明细，**不含投影余额**） |
| 事件 | `apps/web/src/lib/inventory-adjustment/events.ts` | `InventoryAdjustmentApplied`（EVENTS v1.28 已注册；载荷含行级 direction + sourceStockCountLineId） |
| Workflow 集成 | `apps/web/src/lib/inventory-adjustment/workflow-sync.ts` | `maybeTriggerInventoryAdjustmentApproval`（module=INVENTORY_ADJUSTMENT，单实例+多轮重提）+ `syncInventoryAdjustmentApproval`（COMPLETED→APPROVED+approvedById / REJECTED→DRAFT；**红线 APPROVED≠APPLIED**） |
| API | `apps/web/src/app/api/stock-counts/route.ts` | GET 列表 + POST 创建（DRAFT；CNT 取号；**红线 DRAFT 不落账**） |
| API | `apps/web/src/app/api/stock-counts/[id]/route.ts` | GET 详情 + PATCH 更新 header（仅 DRAFT；CAS） |
| API | `apps/web/src/app/api/stock-counts/[id]/lines/route.ts` | POST 录入盘点行（**per-line atomic snapshot 核心**：同事务读五维 Projection → varianceQty 服务端计算；五维唯一；首次录入自动转 COUNTING） |
| API | `apps/web/src/app/api/stock-counts/[id]/complete/route.ts` | **事实链核心**：COUNTING → COMPLETED/ADJUSTED；非零差异自动生成 COUNT_VARIANCE Adjustment（DRAFT，仍需审批）→ ADJUSTED；零差异 → COMPLETED |
| API | `apps/web/src/app/api/stock-counts/[id]/cancel/route.ts` | DRAFT/COUNTING → CANCELLED（COMPLETED/ADJUSTED 禁） |
| API | `apps/web/src/app/api/inventory-adjustments/route.ts` | GET 列表 + POST 创建（DRAFT；ADJ 取号；Manual 或引用 Count 差异；Minor Hardening ② 来源一致性） |
| API | `apps/web/src/app/api/inventory-adjustments/[id]/route.ts` | GET 详情 + PATCH 更新（仅 DRAFT；CAS；行全量替换） |
| API | `apps/web/src/app/api/inventory-adjustments/[id]/submit/route.ts` | DRAFT → SUBMITTED + maybeTriggerApproval；未命中策略 → 直接 APPROVED 投影（maker-checker：提交人=创建人时 approvedById 留空，Apply 时补录） |
| API | `apps/web/src/app/api/inventory-adjustments/[id]/apply/route.ts` | **核心**：APPROVED → APPLIED；FOR UPDATE 锁单 → maker-checker（apply 人 ≠ 创建人）→ executeLedgerAtoms（同一 caller tx，全有或全无）→ 单据 APPLIED + 证据（approvedById/appliedById/appliedAt 全非空） |
| API | `apps/web/src/app/api/inventory-adjustments/[id]/cancel/route.ts` | DRAFT/SUBMITTED/APPROVED → CANCELLED；APPLIED 禁（纠错走 Reversal） |
| Workflow 回写 | `apps/web/src/app/api/workflows/instances/[id]/actions/route.ts` | businessType === 'inventory-adjustment' → syncInventoryAdjustmentApproval |
| OpenAPI | `docs/openapi.yaml` | Sprint 6B-3 段：/api/stock-counts（list/create/get/patch/lines/complete/cancel）+ /api/inventory-adjustments（list/create/get/patch/submit/apply/cancel）+ components |

### 1.2 RBAC（权限码，动作级，零新造）
- `stock-count:view`（list/get）｜ `stock-count:create`（创建）｜ `stock-count:edit`（PATCH/lines/complete）｜ `stock-count:close`（cancel）
- `inventory-adjustment:view`（list/get）｜ `inventory-adjustment:create`（创建）｜ `inventory-adjustment:edit`（PATCH/submit）｜ `inventory-adjustment:close`（cancel）｜ `inventory-adjustment:approve`（Workflow 审批沿用 workflow-instance:approve）｜ **`inventory-adjustment:apply`（受限系统权限，仅 SUPER_ADMIN/ADMIN——P8/P9 Final）**
- `stock-count-line:view/edit`、`inventory-adjustment-line:view/edit`（受限，行由单据驱动）

### 1.3 Domain Events（EVENTS.md v1.28）
- `InventoryCountCompleted` ⏳ → **✅ implemented**（complete 事务提交后 best-effort 发布；载荷 countId/countNo/freezeStrategy/lines[countedQty/bookQtyAtCount/varianceQty]/countedById/completedAt，**不含投影余额**）
- `InventoryAdjustmentApplied` ⏳ → **✅ implemented**（apply 事务提交后 best-effort 发布；载荷 adjustmentId/adjustmentNo/reasonCode/sourceStockCountId/lines[行级 direction + sourceStockCountLineId]/appliedById/appliedAt）
- DRAFT 创建/编辑/提交/取消**不发领域事件**（仅 AuditLog），对齐 5B/6B-2 惯例

## 2. 业务事实边界核验（CTO Gate）

| # | 边界 | 实现 | 核验 |
| --- | --- | --- | --- |
| B1 | Count = 实盘事实 ≠ 库存账事实 | StockCount 永不产生 Movement/更新 Projection——只有 Adjustment Apply 经 Shared LedgerCommand 落账（grep 审计） | ✅ |
| B2 | per-line atomic snapshot（P6） | lines 录入同事务读五维 StockProjection → bookQtyAtCount/countedAt/ledgerWatermark；varianceQty = countedQty - bookQtyAtCount（无动态补偿公式） | ✅ |
| B3 | watermark 仅审计（Blocking ②） | ledgerWatermark 记录 lastMovementAt，不参与 variance 算法、不作并发时序主键 | ✅ |
| B4 | 五维唯一（Schema 问题③） | 同一 Count 内五维唯一（API 去重 + DB UNIQUE NULLS NOT DISTINCT 兜底） | ✅ |
| B5 | 差异处理（§4.2） | 零差异 → 不生成 Movement；非零差异 → 自动生成 COUNT_VARIANCE Adjustment（正差异=IN 补账，负差异=OUT 冲减，quantity=|variance|） | ✅ |
| B6 | 一条盘点差异只能结算一次（Blocking ②） | sourceStockCountLineId @unique（DB UNIQUE 允许多个 NULL，Manual 不受影响）；重复引用 → 409 SOURCE_LINE_ALREADY_SETTLED | ✅ |
| B7 | Count Adjustment 仍需审批（P7） | complete 自动生成的 Adjustment 为 DRAFT，走 submit → 审批 → apply；绝不自动 APPLIED | ✅ |
| B8 | maker-checker（P9 + Integrity ②） | createdById NOT NULL；approvedById/appliedById ≠ createdById（DB CHECK×2 + service 校验）；apply 人=创建人 → 409 MAKER_CHECKER | ✅ |
| B9 | 终态证据（Integrity ①） | APPLIED ⇒ approvedById/appliedById/appliedAt 全非空（同事务写入 + Migration 0026 CHECK 兜底） | ✅ |
| B10 | 来源一致性（Minor Hardening ②） | 非空 sourceStockCountId ⇒ 每个非空 sourceStockCountLineId 必须属于该盘点单（service Gate 事务内校验） | ✅ |
| B11 | 状态机 | Count：DRAFT → COUNTING → COMPLETED → ADJUSTED / CANCELLED；Adjustment：DRAFT → SUBMITTED → APPROVED → APPLIED / CANCELLED；**APPROVED ≠ APPLIED** | ✅ |
| B12 | Cancel 边界 | Count：COMPLETED/ADJUSTED 禁取消；Adjustment：APPLIED 禁取消（纠错走 Reversal/Correction，不允许 Cancel 回滚库存） | ✅ |
| B13 | 审批走既有 Workflow Policy | maybeTriggerApproval（module=INVENTORY_ADJUSTMENT）；未命中 → 直接 APPROVED 投影（不发明第二套审批规则） | ✅ |
| B14 | **Complete 锁定并冻结全部盘点行（CTO Review Blocking ①）** | complete 事务内 header FOR UPDATE 锁单 → 读全部 StockCountLine → 每行四字段冻结校验（countedQty/bookQtyAtCount/countedAt/varianceQty 全非空）→ variance 一致性确认（以行录入固化值为准，绝不重读 StockProjection/重算）→ Complete 后禁新增/删除/重新计数/修改（lines route 状态门禁：COMPLETED/ADJUSTED 后录入被拒） | ✅ |
| B15 | **variance 属 Count 时点事实（Blocking ① 核心）** | AdjustmentLine 创建时复制冻结的 variance fact（direction=冻结值正负、quantity=\|冻结值\|）；Adjustment Create/Apply **只读 adjustment.lines 冻结值，绝不重读当前 StockProjection 计算差异**（grep 审计：complete/create/apply 零 `readProjectionSnapshot` 调用） | ✅ |
| B16 | **Complete 并发幂等（CTO Review Blocking ②）** | 同一 StockCount 的 Complete 被 header FOR UPDATE 串行化；锁后重判终态：已 COMPLETED → 稳定幂等响应（返回既有 count）；已 ADJUSTED 且已有对应 Count Adjustment（`sourceStockCountId` 唯一）→ 返回既有事实不重新创建；CANCELLED → 拒绝；合法 counting 状态才继续；Count 状态 + Adjustment Header + Lines 同一 DB transaction（全有或全无，无孤立 Header） | ✅ |

## 3. 核心不变量（CTO 6B-3 Apply 三不变量）

| # | 不变量 | 实现证据 |
| --- | --- | --- |
| I1 | Adjustment 只能经 Shared LedgerCommand 追加 ADJUSTMENT Movement | apply/route.ts：只调用 `executeLedgerAtoms(tx, atoms)`；**0 直写** InventoryMovement/StockProjection（grep 审计） |
| I2 | 单据 APPLIED + 每行 ADJUSTMENT Movement + 五维 Projection 同一 caller transaction 全有或全无 | 全部在 `prisma.$transaction` 内：executeLedgerAtoms(tx, atoms) → CAS updateMany(status=APPLIED + 证据 + version+1)；任何失败抛错 → 事务回滚，Adjustment 保持 APPROVED |
| I3 | 重试通过 Shared Core identity+immutable-fact 幂等；禁止自实现扣增 | 只调用 `executeLedgerAtoms`；InventoryInsufficientStockError / InventoryLedgerIdempotencyConflictError 上抛 → 409；五元幂等 sourceType=ADJUSTMENT/sourceId/sourceLineId/movementRole=ADJUSTMENT/movementAtomKey=BULK 或 serialNo；**movementGroupId=adjustment.id 稳定业务事实（重试复用，不随机重造——CTO Transfer Blocking ② 教训沿用）** |

## 4. 并发与回滚（Concurrency & Rollback）

| # | 场景 | 预期 |
| --- | --- | --- |
| R1 | 重复 apply（同版本） | 第二次 409 ALREADY_APPLIED（幂等拒绝） |
| R2 | 并发 apply / cancel 同单 | FOR UPDATE 串行；CAS version+status 原子条件，败者 409 VERSION_CONFLICT / INVALID_STATE |
| R3 | 源库存不足（OUT 方向） | InventoryInsufficientStockError → 409 INVENTORY_INSUFFICIENT_STOCK；事务回滚，单据保持 APPROVED，Movement/Projection 0 落账 |
| R4 | 多行 Adjustment 中途失败 | executeLedgerAtoms 同 tx 顺序执行，某行抛错 → 整事务 0 落账（**无部分行残留**） |
| R5 | 幂等 immutable-fact conflict | 同五元 identity 但 fact 不同 → InventoryLedgerIdempotencyConflictError → 409；绝不静默重放 |
| R6 | Count complete 重复（终态幂等） | 已 COMPLETED/ADJUSTED 再 complete | **200 幂等返回既有事实**（已 COMPLETED → 返回既有 count；已 ADJUSTED → 返回既有 count + 既有 Count Adjustment，`sourceStockCountId` 唯一）；**不重复创建 Adjustment、不重复发事件** |
| R7 | sourceStockCountLineId 并发占用 | UNIQUE 冲突 → 409 SOURCE_LINE_ALREADY_SETTLED（一条盘点差异只能正式结算一次） |
| R8 | maker-checker 并发 | apply 人=创建人 → 409 MAKER_CHECKER（service 校验 + DB CHECK 兜底） |
| R9 | **并发 Complete 串行（Blocking ②）** | A、B 同时 complete 同一 Count | header FOR UPDATE 串行化：只有一个进入创建路径（Count→终态 + Adjustment 创建）；另一个锁后读到终态 → **幂等返回既有事实**；不产生重复/孤立 Adjustment、无 500/P2002、Count 与 Adjustment 状态一致 |
| R10 | **Complete 原子性（Blocking ②）** | Count 状态变化 + Adjustment Header + Lines 同事务；中途 unique/DB 失败 | **整事务回滚，不留孤立 Adjustment Header**；Count 保持原状态 |
| R11 | **事件一次性（Blocking ② 事件侧）** | 首次真实 complete 后幂等重放 | `if (!result.idempotent)` 门控：InventoryCountCompleted **只在首次真实 Complete 发布一次**；幂等重放不重复发布 |

## 5. 已知限制（Known Limitations）

1. 事件总线未落地（既有债务）：InventoryCountCompleted / InventoryAdjustmentApplied 以 AuditLog 留痕，发布失败不阻断（事务已提交）；
2. **Conversion / Reservation / Costing 继续 HOLD**（CTO 6B-3 明令，本轮不实现 CVT，也不扩 Reservation/Costing）；
3. Adjustment Reversal / Correction（纠错）本轮不实现——APPLIED 后纠错走未来 Reversal slice（REVERSAL/CORRECTION role 已预留）；
4. reasonCode 为 String（系统保留码 + 可扩展字典），未做字典表强约束（P8 Final：不把所有原因永久写死 enum）；
5. serial-managed Adjustment 逐 serial 原子化（每行 serialNo 单值 + quantity 恒正），未做多 serial 批量行的自动展开（客户端按 serial 拆行）。

## 6. Release Gate

Sprint 6B-3 Count+Adjustment Vertical Slice 进入 CTO Count+Adjustment Review 前必须满足：

1. docs/test-cases/StockCount_Adjustment_API.md 全部核验，无 Blocking；
2. Count 核心链 DRAFT → COUNTING → COMPLETED/ADJUSTED 全链通过（含零差异直接 COMPLETED 分支 + 非零差异自动生成 Adjustment）；
3. Adjustment 核心链 DRAFT → SUBMITTED → APPROVED → APPLIED 全链通过（含未命中策略直接 APPROVED 分支 + maker-checker）；
4. Apply 三不变量（I1/I2/I3）代码证据 + 并发/回滚场景（R1-R8）核验；
5. **Count/Adjustment API 全程 0 直写** InventoryMovement / StockProjection（grep 代码审计）；
6. CI Quality Gates + Build 全绿（GitHub Actions run 待出）；
7. OpenAPI Sprint 6B-3 段（端点 + components）已补齐；
8. EVENTS.md v1.28 载荷对齐（InventoryCountCompleted / InventoryAdjustmentApplied 已注册，无需扩事件）；
9. Conversion/Reservation/Costing 零实现（HOLD 保持）。
