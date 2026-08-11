# Inventory Transfer API 测试用例（Sprint 6B-2 Inventory Transfer Vertical Slice）

> 模块：Inventory Transfer（调拨业务事实层 + Shared InventoryLedgerCommand 双 atom 落账）
> 关联：ADR-0026（FINAL APPROVED）、Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §3、Field Matrix v0.5 §1、EVENTS.md v1.28、Sprint6B_QA.md、Migration 0026、openapi.yaml（Sprint 6B-2 段）
> 端点：`/api/inventory-transfers`（list/create）、`/api/inventory-transfers/{id}`（get/patch）、`/api/inventory-transfers/{id}/submit`、`/api/inventory-transfers/{id}/cancel`、`/api/inventory-transfers/{id}/execute`
> CTO 红线（#8233 Phase 6B-2）：**Execute 三不变量**——① SOURCE_OUT + DESTINATION_IN 共用同一非空 movementGroupId；② 单据 EXECUTED + 两笔 Movement + 两侧 Projection 同一 caller transaction 全有或全无；③ 重试必须通过 Shared Core identity+immutable-fact 幂等，禁止 Transfer 自实现库存扣增。**Transfer API 绝不直接 INSERT InventoryMovement / UPDATE StockProjection**。Count/Adjustment/Conversion/Reservation/Costing 本阶段 HOLD。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/inventory-transfers | 401 AUTHENTICATION_ERROR |
| A2 | 无 `inventory-transfer:view` | GET /api/inventory-transfers | 403 FORBIDDEN |
| A3 | 无 `inventory-transfer:create` | POST /api/inventory-transfers | 403 FORBIDDEN |
| A4 | 无 `inventory-transfer:edit` | PATCH /{id} / submit / execute | 403 FORBIDDEN |
| A5 | 无 `inventory-transfer:close` | POST /{id}/cancel | 403 FORBIDDEN |

## B. 创建（POST /api/inventory-transfers）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| B1 | 正常创建（跨仓） | 有效 warehouse/lines | 201 DRAFT；transferNo 前缀 TRF；transferType=INTER_WAREHOUSE；行落库 |
| B2 | 正常创建（同仓不同库位） | 同 warehouse 不同 location | 201 transferType=INTRA_WAREHOUSE |
| B3 | 源仓库不存在/停用 | sourceWarehouseId 无效 | 400 INVENTORY_TRANSFER_WAREHOUSE_INVALID |
| B4 | 目标仓库不存在/停用 | destinationWarehouseId 无效 | 400 INVENTORY_TRANSFER_WAREHOUSE_INVALID |
| B5 | 源库位不属于源仓库 | 组合 FK 破坏 | 400 INVENTORY_TRANSFER_LOCATION_INVALID |
| B6 | 目标库位不属于目标仓库 | 组合 FK 破坏 | 400 INVENTORY_TRANSFER_LOCATION_INVALID |
| B7 | 自调拨（同仓同库位） | 源=目标 warehouse+location | 409 INVENTORY_TRANSFER_SELF_TRANSFER |
| B8 | 自调拨（同仓双 NULL location） | 同 warehouse 且都无 location | 409 INVENTORY_TRANSFER_SELF_TRANSFER |
| B9 | 无行 | lines 空 | 400 VALIDATION_ERROR（至少一行） |
| B10 | 重复行 | 同 itemId+batchNo+serialNos 两次 | 400 INVENTORY_TRANSFER_DUPLICATE_LINE |
| B11 | item 不存在 | line.itemId 无效 | 400 INVENTORY_TRANSFER_ITEM_INVALID |
| B12 | serial 数量不守恒 | serialNos.length != quantity | 400 INVENTORY_TRANSFER_SERIAL_QTY_MISMATCH |
| B13 | serial 重复 | serialNos 内重复 | 400 INVENTORY_TRANSFER_SERIAL_DUPLICATE |
| B14 | 创建不落账 | 创建后查询 | InventoryMovement / StockProjection 0 变更（红线 B4） |

## C. 查询与更新（GET/PATCH /api/inventory-transfers/{id}）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 详情 | GET /{id} | 200 Header + 仓库/库位 + Lines(Item/UOM) |
| C2 | 不存在 | GET /{id} | 404 INVENTORY_TRANSFER_NOT_FOUND |
| C3 | 更新 DRAFT | PATCH 改行/头 | 200；version+1；行全量替换生效 |
| C4 | 更新非 DRAFT | PATCH SUBMITTED/APPROVED | 409 INVENTORY_TRANSFER_INVALID_STATE |
| C5 | 版本冲突 | PATCH 旧 version | 409 VERSION_CONFLICT |
| C6 | 更新自调拨 | PATCH 改到同仓同库位 | 409 SELF_TRANSFER |
| C7 | DRAFT 更新不发领域事件 | PATCH 后 | 仅 AuditLog；无 InventoryTransferExecuted |

## D. 提交与审批（POST /{id}/submit + Workflow）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常提交（未命中策略） | DRAFT → submit，无 INVENTORY_TRANSFER 策略 | 200 status=APPROVED + approvedById=提交人（直接审批投影，**绝不 EXECUTED**） |
| D2 | 正常提交（命中策略） | 配置 ApprovalPolicy(module=INVENTORY_TRANSFER) | 200 status=SUBMITTED；WorkflowInstance RUNNING + PENDING Approver |
| D3 | 提交非 DRAFT | APPROVED/SUBMITTED 再 submit | 409 INVALID_STATE |
| D4 | 审批 COMPLETED 回写 | Workflow action APPROVE 终态 | syncInventoryTransferApproval → status=APPROVED + approvedById |
| D5 | 审批 REJECTED 回写 | Workflow action REJECT 终态 | status=DRAFT（可重提）+ approvedById 清空 |
| D6 | 审批回写不落账 | COMPLETED 后 | 无 Movement（**APPROVED ≠ EXECUTED 红线**） |
| D7 | 版本冲突 | submit 旧 version | 409 VERSION_CONFLICT |
| D8 | 无行提交 | DRAFT 无行 | 400 INVENTORY_TRANSFER_NO_LINES |

## E. 取消（POST /{id}/cancel）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 取消 DRAFT | DRAFT → cancel | 200 CANCELLED |
| E2 | 取消 APPROVED | APPROVED → cancel | 200 CANCELLED |
| E3 | 取消 SUBMITTED | SUBMITTED → cancel | 409 INVALID_STATE（先 Withdraw 再 Cancel） |
| E4 | 取消 EXECUTED | EXECUTED → cancel | 409 INVALID_STATE（纠错走 Reversal，禁止 Cancel 回滚库存） |
| E5 | 取消不触碰库存 | EXECUTED 外 cancel 后 | InventoryMovement / StockProjection 0 变更 |
| E6 | 版本冲突 | cancel 旧 version | 409 VERSION_CONFLICT |

## F. 执行（POST /{id}/execute）—— 最高风险点

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | 正常执行（bulk，跨仓） | APPROVED → execute | 200 EXECUTED；两笔 Movement（SOURCE_OUT/OUT/TRANSFER_OUT + DESTINATION_IN/IN/TRANSFER_IN）；同一 movementGroupId；Projection 两侧更新；version+1 |
| F2 | 正常执行（serial） | serial-managed 行 | 每 serial 一对 Movement（SOURC_OUT X + DESTINATION_IN X），quantity=1，atomKey=serialNo |
| F3 | 同仓不同库位 | INTRA_WAREHOUSE execute | 两笔 Movement warehouseId 相同、location 不同 |
| F4 | 重复 execute（幂等） | 同 version 第二次 | 409 INVENTORY_TRANSFER_ALREADY_EXECUTED |
| F5 | 并发 execute | 双请求同单 | FOR UPDATE 串行；败者 409 VERSION_CONFLICT / ALREADY_EXECUTED |
| F6 | 源库存不足 | onHandQty < SOURCE_OUT quantity | 409 INVENTORY_INSUFFICIENT_STOCK；事务回滚；单据保持 APPROVED；Movement/Projection 0 落账 |
| F7 | 双边原子回滚 | 构造 DESTINATION_IN 侧故障（如目标维度冲突） | executeLedgerAtoms 抛错 → 整事务 0 落账（**无 SOURCE_OUT 残留**）；单据保持 APPROVED |
| F8 | 幂等 immutable-fact conflict | 同五元 identity 但 fact 不同（如 quantity 被改） | 409（InventoryLedgerIdempotencyConflictError）；绝不静默重放 |
| F9 | 执行非 APPROVED | DRAFT/SUBMITTED execute | 409 INVALID_STATE（审批未完成） |
| F10 | 执行 CANCELLED | CANCELLED execute | 409 INVALID_STATE |
| F11 | 执行态事实复核 | warehouse/location/item 在 execute 时失效 | 400 对应错误；事务回滚 |
| F12 | batch/mfg/exp 继承 | SOURCE 行有 batchNo/mfgDate/expDate | DESTINATION_IN Movement 同值（首版禁止换批） |
| F13 | 版本冲突 | execute 旧 version | 409 VERSION_CONFLICT |
| F14 | 事件发布 | execute 事务提交后 | InventoryTransferExecuted 发布（载荷含 movementGroupId/lines，**不含库存余额**） |
| F15 | 直写红线审计 | grep Transfer 路由 | 0 处直接 INSERT InventoryMovement / UPDATE StockProjection（只调 executeLedgerAtoms） |

## G. movementGroupId 生命周期

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| G1 | DRAFT 无 groupId | 创建后查询 | movementGroupId = null |
| G2 | SUBMITTED/APPROVED 无 groupId | 提交/审批后查询 | movementGroupId = null（**只在 EXECUTE 时生成/复用**） |
| G3 | EXECUTED 有 groupId | 执行后查询 | movementGroupId 非空；与两笔 Movement.movementGroupId 一致 |
| G4 | 双边同组 | 查询执行后 Movement | SOURCE_OUT 与 DESTINATION_IN 的 movementGroupId 完全相同 |
| G5 | 重试复用（CTO Review Blocking ②） | 已生成 groupId 的 Execute 重试/恢复 | 锁单后**复用已有 movementGroupId**（`transfer.movementGroupId ?? crypto.randomUUID()`），**禁止每次 attempt 随机重造**——同五元 identity 不同 group fact → Shared Core 判幂等 conflict |

## H. 串行化与并发

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| H1 | 同源维度并发 execute | 两单同源仓同 item 并发 Execute | 五维 FOR UPDATE 串行；第二个按新余额校验（防并发超扣） |
| H2 | execute 与 cancel 并发 | execute 锁单后 cancel 到达 | FOR UPDATE 串行；败者按最新状态 409 |
| H3 | 双 execute 同五元 | 同一行两次不同事实 | 第二次 immutable-fact conflict → 409（不重复入账） |

## I. 领域事件与审计（EVENTS v1.28）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| I1 | InventoryTransferExecuted 注册 | EVENTS.md | v1.28 已注册；载荷含 transferId/transferNo/movementGroupId/lines/executedById/executedAt，**不含投影余额** |
| I2 | DRAFT 不发领域事件 | create/update | 仅 AuditLog |
| I3 | AuditLog 全覆盖 | create/update/submit/cancel/execute | 每个动作 writeAuditLog 留痕 |
