# Stock Count + Inventory Adjustment API — Test Cases（Sprint 6B-3）

> Sprint 6B-3（CTO #8471 授权：Count + Adjustment 事实链一起做）｜ 分支 feature/sprint6b-inventory-operations（PR #22）
> 事实链：**StockCount → per-line snapshot → variance → InventoryAdjustment → Shared LedgerCommand ADJUSTMENT Movement**
> 红线：StockCount 永不直接改 StockProjection；只有 Adjustment Apply 允许调用 Shared LedgerCommand；
> `sourceStockCountLineId @unique` 防双重入账；Manual Adjustment maker-checker；非零 Count variance 仍需审批；
> Conversion/Reservation/Costing 继续 HOLD。

## A. 权限（RBAC）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| A1 | stock-count:view | 无权限用户 GET /api/stock-counts | 403 |
| A2 | stock-count:create | 无权限用户 POST /api/stock-counts | 403 |
| A3 | stock-count:edit | 无权限用户 POST /api/stock-counts/:id/lines、/:id/complete、PATCH /:id | 403 |
| A4 | stock-count:close | 无权限用户 POST /api/stock-counts/:id/cancel | 403 |
| A5 | inventory-adjustment:view | 无权限用户 GET /api/inventory-adjustments | 403 |
| A6 | inventory-adjustment:create | 无权限用户 POST /api/inventory-adjustments | 403 |
| A7 | inventory-adjustment:edit | 无权限用户 PATCH /:id、POST /:id/submit | 403 |
| A8 | **inventory-adjustment:apply（受限系统权限）** | Manager/Member/Viewer POST /:id/apply | **403（仅 SUPER_ADMIN/ADMIN——P8/P9 Final）** |
| A9 | inventory-adjustment:close | 无权限用户 POST /:id/cancel | 403 |
| A10 | line 受限权限 | 客户端直接访问 stock-count-line / inventory-adjustment-line 资源 | 仅 view/edit 存在，无独立业务入口 |

## B. Stock Count 创建（Create）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| B1 | 正常创建 | 有效 body（remark 可选） | 201 DRAFT；countNo 前缀 CNT；freezeStrategy=DYNAMIC；**不产生 Movement/Projection** |
| B2 | CNT Sequence 缺失（fail closed） | 删除 STOCK_COUNT DocumentSequence 后创建 | **500 INVENTORY_TRANSFER_SEQUENCE_MISSING 同款治理：STOCK_COUNT_SEQUENCE_MISSING**；**零 fallback 临时编号** |
| B3 | 重复创建 | 连续创建 | 每次 countNo 递增（CNT000001 → CNT000002） |

## C. 盘点行录入（Lines — per-line atomic snapshot）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常录入（bulk） | 五维 + countedQty=110，五维 Projection.onHandQty=100 | 200；bookQtyAtCount=100；varianceQty=+10（IN 差异）；countedAt 写入；ledgerWatermark 记录 lastMovementAt（仅审计）；状态 DRAFT→COUNTING |
| C2 | 正常录入（负差异） | countedQty=90，bookQtyAtCount=100 | varianceQty=-10（OUT 差异） |
| C3 | 无 Projection 维度 | 五维无库存记录 | bookQtyAtCount=0；varianceQty=countedQty |
| C4 | 五维重复 | 同一 Count 内相同五维两行 | 400 STOCK_COUNT_DUPLICATE_LINE（API + DB UNIQUE NULLS NOT DISTINCT 兜底） |
| C5 | 仓库无效 | warehouseId 不存在/停用 | 400 STOCK_COUNT_WAREHOUSE_INVALID |
| C6 | 库位跨仓 | locationId 不属于 warehouseId | 400 STOCK_COUNT_LOCATION_INVALID（组合 FK） |
| C7 | item 无效 | itemId 不存在/停用 | 400 STOCK_COUNT_ITEM_INVALID |
| C8 | countedQty < 0 | 负实盘数 | 400（zod nonnegative + DB CHECK countedQty >= 0） |
| C9 | 已 COMPLETED 后录入 | complete 后 POST lines | 409 STOCK_COUNT_INVALID_STATE |
| C10 | serial-managed 逐 serial | serialNo=X 单值一行 | 正常 snapshot（每 serial 独立行） |

## D. 盘点完成（Complete — 事实链核心）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 零差异完成 | 所有行 varianceQty=0 | Count → COMPLETED；**不生成 Adjustment**；InventoryCountCompleted 发布（variance 明细） |
| D2 | 非零差异完成 | 有 +10/-3 差异行 | Count → ADJUSTED；**自动生成 COUNT_VARIANCE Adjustment（DRAFT）**；lines 引用 sourceStockCountLineId @unique；正差异=IN/quantity=10，负差异=OUT/quantity=3；createdById=盘点完成人（明确 actor，maker-checker） |
| D3 | 重复 complete | 已 COMPLETED/ADJUSTED 再 complete | 409 STOCK_COUNT_ALREADY_COMPLETED（不重复生成 Adjustment） |
| D4 | 无行完成 | 空盘点单 complete | 400 STOCK_COUNT_NO_LINES |
| D5 | snapshot 缺失 | 存在 bookQtyAtCount 空行 | 400 STOCK_COUNT_SNAPSHOT_MISSING |
| D6 | 版本冲突 | version 不匹配 | 409 VERSION_CONFLICT |
| D7 | ADJ Sequence 缺失 | complete 触发生成但 INVENTORY_ADJUSTMENT Sequence 缺失 | **500 INVENTORY_ADJUSTMENT_SEQUENCE_MISSING（fail closed，零 fallback）**；事务回滚 Count 不锁定 |
| D8 | 事件载荷 | complete 成功后 | InventoryCountCompleted 载荷含 countedQty/bookQtyAtCount/varianceQty，**不含投影余额** |

## E. 盘点取消（Cancel）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | DRAFT 取消 | DRAFT → cancel | 200 CANCELLED；不触碰库存账 |
| E2 | COUNTING 取消 | 已录入行 → cancel | 200 CANCELLED |
| E3 | COMPLETED/ADJUSTED 取消 | 已锁定/已生成差异 → cancel | 409 STOCK_COUNT_INVALID_STATE |

## F. Adjustment 创建（Create — Manual / Count 差异）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | Manual 创建（IN） | reasonCode=MANUAL，行 direction=IN quantity=10 | 201 DRAFT；adjustmentNo 前缀 ADJ；createdById=操作人 |
| F2 | Manual 创建（OUT） | direction=OUT quantity=5 | 201 DRAFT |
| F3 | 引用 Count 差异 | sourceStockCountId + sourceStockCountLineId | 201；行追溯盘点行 |
| F4 | 跨单引用（Minor Hardening ②） | sourceStockCountId=CountA 但 line 属于 CountB | 400 INVENTORY_ADJUSTMENT_SOURCE_COUNT_INVALID（service Gate 事务内校验） |
| F5 | sourceStockCountLineId 无来源 Count | 提供 line 但无 sourceStockCountId | 400 SOURCE_COUNT_INVALID |
| F6 | 双重入账 | 同一 sourceStockCountLineId 已属其他 Adjustment | 409 INVENTORY_ADJUSTMENT_SOURCE_LINE_ALREADY_SETTLED（UNIQUE 防双重入账） |
| F7 | 五维重复 | 同一 Adjustment 内相同五维 | 400 INVENTORY_ADJUSTMENT_DUPLICATE_LINE |
| F8 | quantity <= 0 | 非法数量 | 400 INVENTORY_ADJUSTMENT_QUANTITY_INVALID（zod positive + DB CHECK quantity > 0） |
| F9 | 仓库/库位/item 无效 | 组合 FK 校验 | 400 WAREHOUSE_INVALID / LOCATION_INVALID / ITEM_INVALID |
| F10 | ADJ Sequence 缺失 | 删除 INVENTORY_ADJUSTMENT Sequence | **500 INVENTORY_ADJUSTMENT_SEQUENCE_MISSING（fail closed）** |
| F11 | 行级 direction | 同一 Adjustment 同时含 IN + OUT 行 | 201（同一 maker-checker 审批事实下原子承载盘盈+盘亏——Blocking ①） |

## G. Adjustment 提交/审批（Submit / Workflow）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| G1 | 命中策略 | ApprovalPolicy(module=INVENTORY_ADJUSTMENT) 存在 | SUBMITTED + WorkflowInstance RUNNING；批准后 COMPLETED → APPROVED + approvedById=审批人（≠创建人，maker-checker） |
| G2 | 未命中策略 | 无策略/无 rule | **直接 APPROVED 投影**；提交人≠创建人 → approvedById=提交人；提交人=创建人 → approvedById 留空（Apply 时由 apply 人补录，两 CHECK 满足） |
| G3 | REJECTED | Workflow 驳回 | Adjustment → DRAFT（可重提）；清 approvedById |
| G4 | 仅 DRAFT 提交 | 非 DRAFT submit | 409 INVENTORY_ADJUSTMENT_INVALID_STATE |
| G5 | 无行提交 | 空行 submit | 400 INVENTORY_ADJUSTMENT_NO_LINES |

## H. Adjustment Apply（**核心** — APPROVED → APPLIED）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| H1 | 正常 Apply（bulk IN） | APPROVED → apply | 200 APPLIED；一笔 ADJUSTMENT Movement（sourceType=ADJUSTMENT/role=ADJUSTMENT/type=ADJUSTMENT/direction=IN/atomKey=BULK）；Projection +10；movementGroupId=adjustment.id（稳定）；appliedById/appliedAt 写入；version+1；InventoryAdjustmentApplied 发布（行级 direction + sourceStockCountLineId） |
| H2 | 正常 Apply（OUT） | direction=OUT | Movement OUT；Projection -5；禁负库存检查生效 |
| H3 | serial-managed | serialNo=X 行 | Movement atomKey=serialNo；quantity 恒正 |
| H4 | 重复 Apply | 已 APPLIED 再 apply | 409 INVENTORY_ADJUSTMENT_ALREADY_APPLIED（幂等拒绝） |
| H5 | 非 APPROVED | DRAFT/SUBMITTED/CANCELLED apply | 409 INVALID_STATE（APPROVED ≠ APPLIED） |
| H6 | maker-checker | apply 人 = 创建人 | **409 INVENTORY_ADJUSTMENT_MAKER_CHECKER**（service 校验 + DB CHECK 兜底） |
| H7 | 源库存不足（OUT） | Projection 不足 | InventoryInsufficientStockError → 409 INVENTORY_INSUFFICIENT_STOCK；事务回滚，单据保持 APPROVED，Movement/Projection 0 落账 |
| H8 | 多行中途失败 | 第 2 行 OUT 余额不足 | 整事务 0 落账（**无部分行残留**——全有或全无） |
| H9 | 幂等 immutable-fact conflict | 同五元 identity 不同 fact | InventoryLedgerIdempotencyConflictError → 409；绝不静默重放 |
| H10 | 终态证据 CHECK | APPLIED 单据 | approvedById/appliedById/appliedAt 全非空（同事务写入 + Migration 0026 CHECK 兜底） |
| H11 | 版本冲突 | version 不匹配 | 409 VERSION_CONFLICT |
| H12 | 并发 apply / cancel | 同单并发 | FOR UPDATE 串行；败者 409 VERSION_CONFLICT / INVALID_STATE |
| H13 | 权限 | 非 SUPER_ADMIN/ADMIN apply | 403（inventory-adjustment:apply 受限系统权限） |

## I. Adjustment 取消（Cancel）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| I1 | DRAFT/SUBMITTED/APPROVED 取消 | 未落账 cancel | 200 CANCELLED；不触碰库存账 |
| I2 | APPLIED 取消 | 已落账 cancel | 409（纠错走 Reversal/Correction，不允许 Cancel 回滚库存） |

## J. 事件与审计

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| J1 | InventoryCountCompleted 注册 | EVENTS.md | v1.28 已注册；complete 后发布（countId/countNo/freezeStrategy/lines[countedQty/bookQtyAtCount/varianceQty]/countedById/completedAt，**不含投影余额**） |
| J2 | InventoryAdjustmentApplied 注册 | EVENTS.md | v1.28 已注册；apply 后发布（adjustmentId/adjustmentNo/reasonCode/sourceStockCountId/lines[行级 direction + sourceStockCountLineId]/appliedById/appliedAt） |
| J3 | DRAFT 不发领域事件 | create/patch/submit/cancel | 仅 AuditLog（对齐 5B/6B-2 惯例） |
| J4 | AuditLog | 全部动作 | create/update/lines/complete/cancel/submit/apply 均写 AuditLog |

## K. 红线核验（grep 审计）

| # | 红线 | 预期 |
| --- | --- | --- |
| K1 | Count/Adjustment 路由 0 直写 | 全仓 grep：inventory-transfers 之外，stock-counts/inventory-adjustments 路由无 `inventoryMovement.create` / `stockProjection.update` 直接调用（只经 `executeLedgerAtoms`） |
| K2 | 禁 fallback 编号 | grep 无 `CNT000001` / `ADJ000001` 常量 fallback（Sequence 缺失 fail closed 抛错） |
| K3 | movementGroupId 稳定 | Adjustment atom 统一 `movementGroupId: adjustment.id`（稳定业务事实，重试复用） |
| K4 | Conversion/Reservation/Costing 零实现 | 无 inventory-conversions / reservation / costing API |
