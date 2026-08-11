# Inventory Conversion / Repack API — Test Cases（Sprint 6B-4）

> Sprint 6B-4（CTO #8658 授权：解除 Conversion HOLD，同 item Repack / UOM Conversion）｜ 分支 feature/sprint6b-inventory-operations（PR #22）
> 事实链：**Conversion DRAFT（CVT 创建即取号）→ 恰好 1 CONSUME + 1 PRODUCE → baseQuantity 服务端 canonical 计算 → submit（DRAFT→SUBMITTED，无审批状态机）→ execute（同事务：锁单 → 守恒校验 → 生成/复用 movementGroupId → Shared LedgerCommand 双 atom CONSUME+PRODUCE → 单据 EXECUTED + 证据）→ InventoryConversionExecuted**
> 四条锁死（CTO #8658）：① baseQuantity 服务端 canonical 计算（不信任客户端）；② CONSUME.baseQuantity == PRODUCE.baseQuantity 才 Execute；③ 首版 same item（禁止 BOM/组装/拆解/多物料）；④ batch 精确继承、serial 不允许重新生成。
> Reservation/ReservedQty/AvailableQty/Costing/FIFO/Moving Average 继续 HOLD。

## A. 权限（RBAC）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| A1 | inventory-conversion:view | 无权限用户 GET /api/inventory-conversions | 403 |
| A2 | inventory-conversion:create | 无权限用户 POST /api/inventory-conversions | 403 |
| A3 | inventory-conversion:edit | 无权限用户 PATCH /:id、POST /:id/submit、POST /:id/execute | 403 |
| A4 | inventory-conversion:close | 无权限用户 POST /:id/cancel | 403 |
| A5 | line 受限权限 | 客户端直接访问 inventory-conversion-line 资源 | 仅 view/edit 存在，无独立业务入口 |

## B. Conversion 创建（Create — DRAFT，CVT 取号）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| B1 | 正常创建（UOM Conversion） | item 有 stockUomId；CONSUME（10 box × rate 10 → base 100）+ PRODUCE（100 pcs × rate 1 → base 100） | 201 DRAFT；conversionNo 前缀 CVT；**baseQuantity 服务端计算=100/100（客户端未提交）**；**不产生 Movement/Projection** |
| B2 | CVT Sequence 缺失（fail closed） | 删除 INVENTORY_CONVERSION DocumentSequence 后创建 | **500 INVENTORY_CONVERSION_SEQUENCE_MISSING**；**零 fallback 临时编号** |
| B3 | 行角色不是恰好 1+1 | 2 条 CONSUME / 2 条 PRODUCE / 仅 1 条 | 400 INVENTORY_CONVERSION_LINE_ROLE_REQUIRED（zod length(2) + service 角色集合校验 + DB UNIQUE 兜底） |
| B4 | baseUomId != item.stockUomId | baseUomId 传其他 UOM | **400 INVENTORY_CONVERSION_BASE_UOM_INVALID**（P11 Final Gate：不允许任意 UOM 冒充库存基准） |
| B5 | item 无效 | itemId 不存在/停用 | 400 INVENTORY_CONVERSION_ITEM_INVALID |
| B6 | 仓库/库位无效 | 组合 FK 校验 | 400 WAREHOUSE_INVALID / LOCATION_INVALID |
| B7 | uom 无效 | uomId 不存在/停用 | 400 INVENTORY_CONVERSION_UOM_INVALID |
| B8 | quantity <= 0 / rate <= 0 | 非法数量/换算率 | 400（zod positive + DB CHECK uomToBaseRate>0 / baseQuantity>0） |
| B9 | **batch 不继承（锁死④）** | CONSUME batch=A、PRODUCE batch=B | **400 INVENTORY_CONVERSION_BATCH_MISMATCH**（P5 精确继承，首版不拆批不换批） |
| B10 | 客户端提交 baseQuantity | 尝试传 baseQuantity 字段 | **schema 不收**（zod strip 未知字段）；服务端 canonical 计算为准（不信任客户端） |
| B11 | serial 提交 | 尝试传 serialNos | **schema 不收**（ConversionLine 无 serialNo 字段——serial 不允许重新生成） |

## C. Conversion 详情/更新（Get / Patch 仅 DRAFT）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 详情 | GET /:id | Header + Item + BaseUom + Lines（行级 uomToBaseRate/baseQuantity） |
| C2 | 仅 DRAFT 编辑 | 已 SUBMITTED/EXECUTED PATCH | 409 INVENTORY_CONVERSION_INVALID_STATE |
| C3 | CAS version | version 不匹配 | 409 VERSION_CONFLICT |
| C4 | itemId/baseUomId 不可编辑 | PATCH 尝试改 itemId/baseUomId | schema 不收；保留原值 |
| C5 | 行整体替换 | PATCH lines | 重校验角色集合/组合 FK/batch 继承；**baseQuantity 重新服务端计算** |

## D. Conversion 提交（Submit — DRAFT → SUBMITTED）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常提交 | DRAFT → submit | 200 SUBMITTED；守恒/换算率/batch 前置校验通过；**不落账（SUBMITTED ≠ EXECUTED）** |
| D2 | 守恒破坏前置 | CONSUME.baseQuantity != PRODUCE.baseQuantity（数据异常） | 400 INVENTORY_CONVERSION_BASE_QTY_MISMATCH |
| D3 | 非 DRAFT 提交 | 已 SUBMITTED/EXECUTED/CANCELLED | 409 INVALID_STATE |
| D4 | 无审批状态机 | submit 后 | **无 Workflow 实例创建**（Conversion 计量事实，DRAFT/SUBMITTED/EXECUTED/CANCELLED 无 APPROVED） |

## E. Conversion 执行（Execute — **核心**：SUBMITTED → EXECUTED）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 正常 Execute（UOM Conversion） | SUBMITTED → execute | 200 EXECUTED；CONSUME OUT + PRODUCE IN 两笔 Movement（sourceType=CONVERSION/role=CONSUME|PRODUCE/type=CONSUME|PRODUCE/atomKey=BULK）；同一 movementGroupId；quantity=baseQuantity canonical、uomId=baseUomId；Projection 两侧更新；movementGroupId/executedAt/executedById 写入；version+1；InventoryConversionExecuted 发布（行级 rate+baseQuantity） |
| E2 | **守恒（锁死②）** | 数据被改导致 CONSUME.baseQuantity != PRODUCE.baseQuantity | 400 INVENTORY_CONVERSION_BASE_QTY_MISMATCH（Execute 时重校验） |
| E3 | **same item（锁死③）** | 行 itemId 试图不同 | 结构上不可能（行无 itemId）；Movement itemId 统一 = conversion.itemId（grep 审计） |
| E4 | **batch 继承 + serial 禁（锁死④）** | CONSUME batch != PRODUCE batch / 传 serial | 400 BATCH_MISMATCH / schema 不收 serial（atom serialNo=null） |
| E5 | 重复 Execute | 已 EXECUTED 再 execute | 409 INVENTORY_CONVERSION_ALREADY_EXECUTED（幂等拒绝） |
| E6 | 非 SUBMITTED | DRAFT/CANCELLED execute | 409 INVALID_STATE（SUBMITTED ≠ EXECUTED） |
| E7 | 源库存不足（CONSUME OUT） | 输入维度余额不足 | InventoryInsufficientStockError → 409 INVENTORY_INSUFFICIENT_STOCK；事务回滚，单据保持 SUBMITTED，Movement/Projection 0 落账 |
| E8 | CONSUME 成功但 PRODUCE 故障 | executeLedgerAtoms 同 tx 顺序执行，PRODUCE 抛错 | 整事务 0 落账（**无 CONSUME 残留**） |
| E9 | 幂等 immutable-fact conflict | 同五元 identity 不同 fact | InventoryLedgerIdempotencyConflictError → 409；绝不静默重放 |
| E10 | **movementGroupId 稳定** | 重试/恢复 Execute | `conversion.movementGroupId ?? crypto.randomUUID()`——已有值复用，无值首次生成并冻结；**不随机重造**（CTO Transfer Blocking ② 教训） |
| E11 | 版本冲突 | version 不匹配 | 409 VERSION_CONFLICT |
| E12 | 并发 execute / cancel | 同单并发 | FOR UPDATE 串行；败者 409 VERSION_CONFLICT / INVALID_STATE |

## F. Conversion 取消（Cancel）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | DRAFT/SUBMITTED 取消 | 未落账 cancel | 200 CANCELLED；不触碰库存账 |
| F2 | EXECUTED 取消 | 已落账 cancel | 409（纠错走 Reversal/Correction，不允许 Cancel 回滚库存） |

## G. 事件与审计

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| G1 | InventoryConversionExecuted 注册 | EVENTS.md | v1.28 已注册；execute 后发布（conversionId/conversionNo/itemId/baseUomId/movementGroupId/lines[行级 uomToBaseRate+baseQuantity]/executedById/executedAt，**不含投影余额**） |
| G2 | DRAFT 不发领域事件 | create/patch/submit/cancel | 仅 AuditLog（对齐 5B/6B-2/6B-3 惯例） |
| G3 | AuditLog | 全部动作 | create/update/submit/execute/cancel 均写 AuditLog |

## H. 红线核验（grep 审计）

| # | 红线 | 预期 |
| --- | --- | --- |
| H1 | Conversion 路由 0 直写 | 全仓 grep：inventory-conversions 路由无 `inventoryMovement.create` / `stockProjection.update` 直接调用（只经 `executeLedgerAtoms`） |
| H2 | 禁 fallback 编号 | grep 无 `CVT000001` 常量 fallback（Sequence 缺失 fail closed 抛错） |
| H3 | **baseQuantity 服务端 canonical（锁死①）** | schema 不收 baseQuantity；`computeBaseQuantity` 唯一入口（quantity × uomToBaseRate，toDecimalPlaces(4) ROUND_HALF_UP）；grep 无客户端 baseQuantity 直写 |
| H4 | movementGroupId 稳定 | execute 统一 `conversion.movementGroupId ?? crypto.randomUUID()`（复用已有值） |
| H5 | 守恒/同 item/batch/serial | execute 校验 BASE_QTY_MISMATCH；Movement itemId=conversion.itemId；batch 继承；serialNo=null |
| H6 | Reservation/Costing 零实现 | 无 reservation / costing API |
