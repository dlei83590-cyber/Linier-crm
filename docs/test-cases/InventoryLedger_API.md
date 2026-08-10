# Inventory Ledger API 测试用例（Sprint 6A Inventory Ledger Foundation——Outbox Writer / Consumer / consume 端点）

> 模块：Inventory Ledger Foundation（Transactional Outbox Writer + Ledger Command + Inventory Consumer + StockProjection 物化投影）
> 关联：ADR-0025、Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md、Sprint6A_Inventory_Field_Matrix.md、EVENTS.md v1.26、API_GUIDELINES.md、ERROR_CODES.md、Migration 0025、Sprint6A_QA.md
> 端点：`POST /api/inventory-ledger/consume`（Consumer 触发）；业务触发点（非本模块 API）：`POST /api/warehouse-receipts/:id/post`（写 Outbox IN）、`POST /api/purchase-returns/:id/return`（写 Outbox OUT）
> CTO 红线（#7683 99/100 FINAL）：**Movement + StockProjection + Outbox PROCESSED 同事务**；claim FOR UPDATE SKIP LOCKED + worker lease fencing（LEASE_LOST）；Movement 五元 atom 幂等（ON CONFLICT DO NOTHING RETURNING）；五维 NULLS NOT DISTINCT Projection 唯一身份（dimensionKey 仅查询/锁键）；同维度 OUT FOR UPDATE 串行；OUT 禁负库存（onHandQty >= quantity + DB CHECK）；Movement 不可变（immutable trigger）；InventoryMovementCommitted 载荷**不含投影余额**（P10）；Transfer/Conversion/Count/Costing/ReservedQty/新 sourceType 本阶段 HOLD

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | POST /api/inventory-ledger/consume | 401 AUTHENTICATION_ERROR |
| A2 | 无 `inventory-ledger:consume` | POST /api/inventory-ledger/consume | 403 FORBIDDEN |
| A3 | 权限隔离 | 普通用户尝试 consume | 403 |

## B. consume 端点（POST /api/inventory-ledger/consume）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| B1 | 无 PENDING Outbox | 空队列触发 | 200 { claimed: 0, processed: 0, retried: 0, deadLettered: 0, leaseLost: 0, results: [] } |
| B2 | 正常批量 | limit 省略 | 200 批次统计（claimed ≤ 20） |
| B3 | limit 上限保护 | limit=500 | 200 claimed ≤ 200（上限截断） |
| B4 | limit 非法 | limit=abc | 400 VALIDATION_ERROR |
| B5 | 重复触发幂等 | 同一批 Outbox 触发两次 | 第二次全部 ALREADY_PROCESSED（五元幂等，不重复入账） |

## C. Outbox Writer（业务触发点同事务写 Outbox）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| C1 | WarehouseReceipt POST → Outbox IN | 正常 POST | 事务内写 Outbox(WarehouseReceiptPosted)；POST 失败整体回滚 |
| C2 | POST 后 Outbox 原子级 | 非 serial 行 | 1 条 Outbox（atomKey=BULK，quantity=行数量） |
| C3 | POST serial 原子级 | serial-managed 行 | 每 serial 1 条 Outbox（atomKey=serialNo、quantity=1） |
| C4 | RETURN WAREHOUSE_RECEIPT_LINE → Outbox OUT | 已入库退货 | 仅 WAREHOUSE_RECEIPT_LINE 来源行写 Outbox(PurchaseReturned)；RECEIPT_LINE/INSPECTION 不写 |
| C5 | RETURN 非 serial 来源 | 来源无 serial + 退货行无 serialNos | BULK OUT 1 条 |
| C6 | RETURN serial 来源 + 显式提交 | 来源有 serial + 退货行提交 SN | 每 SN 1 条 OUT Outbox；校验数量一致 + ∈ 来源集合 |
| C7 | RETURN serial 来源 + 未提交 SN | 来源有 serial + 退货行 serialNos 空 | 409 INVENTORY_SERIAL_REQUIRED，事务回滚 |
| C8 | RETURN 非 serial 来源 + 提交 SN | 来源无 serial + 退货行 serialNos 非空 | 409 INVENTORY_SERIAL_SOURCE_MISMATCH（对称 Gate），事务回滚 |
| C9 | itemId 缺失 | 入库行 itemId null | 409 INVENTORY_DIMENSION_INCOMPLETE，事务回滚（防 poison Outbox） |
| C10 | serial 数量不守恒 | serialNos.length != quantity | 409 INVENTORY_SERIAL_QTY_MISMATCH，事务回滚 |

## D. Consumer 消费（claim / lease / 幂等）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常 IN 消费 | WarehouseReceiptPosted Outbox | INSERT InventoryMovement(IN, COMMITTED) + StockProjection.onHandQty += quantity + Outbox PROCESSED（同事务） |
| D2 | 正常 OUT 消费 | PurchaseReturned Outbox | INSERT InventoryMovement(OUT) + onHandQty -= quantity + Outbox PROCESSED |
| D3 | 五元幂等重放 | 同五元 Movement 已存在 | ALREADY_PROCESSED（不重复入账、Projection 不动） |
| D4 | claim SKIP LOCKED | 双 worker 并发触发 | 同一 Outbox 只被一个 worker 消费 |
| D5 | lease reclaim / LEASE_LOST | worker A 处理超 10 分钟 → B 回收 | B 可 claim；A 事务开始验证 ownership 失败 → LEASE_LOST，禁止继续 |
| D6 | payload 非法 | Outbox payload 缺 sourceId | Outbox → DEAD_LETTER（INVENTORY_OUTBOX_PAYLOAD_INVALID 语义，不落 500） |
| D7 | source 不存在 | WarehouseReceipt 已删除/状态非 POSTED | Outbox → DEAD_LETTER（INVENTORY_SOURCE_NOT_FOUND） |
| D8 | OUT 库存不足 | onHandQty < OUT quantity | 事务回滚（Movement 不写/Projection 不变/Outbox 不误标 PROCESSED）→ RETRY 退避 → 超阈值 DEAD_LETTER |
| D9 | 同五维并发 OUT | 两 OUT 同时扣同一维度 | FOR UPDATE 串行；第二个看到新余额，防一起扣负 |
| D10 | DocumentSequence 缺失 | INVENTORY_MOVEMENT sequence 未 Seed | 抛配置错误 → RETRY（不生成 MV000001） |

## E. 事件（EVENTS.md v1.26）

| # | 用例 | 预期 |
| --- | --- | --- |
| E1 | InventoryMovementCommitted | Consumer 单事务提交后发布（best-effort）；载荷含 movementId/movementNo/五元来源/方向/五维/quantity/committedAt，**不含投影余额** |
| E2 | 幂等重放不发 | ALREADY_PROCESSED 不重复发布 |

## F. 边界红线（6A 锁死）

| # | 红线 | 核验 |
| --- | --- | --- |
| F1 | 业务模块禁直写 InventoryMovement | 仅 Consumer 写 Movement；5B 路由零直接写入 |
| F2 | dimensionKey 不当身份 | 锁/查询用五维 IS NOT DISTINCT FROM；dimensionKey 仅 buildDimensionKey 辅助 |
| F3 | 负库存 | 命令层 onHandQty >= quantity + DB CHECK onHandQty >= 0 |
| F4 | Movement 不可变 | COMMITTED 后 UPDATE/DELETE 被 immutable trigger 拒绝 |
| F5 | 同事务三件套 | Movement + Projection + Outbox PROCESSED 同事务提交/回滚 |
| F6 | 本阶段不建 | Transfer / Conversion / Count / Costing / ReservedQty / 新 sourceType / read model API |

## G. Real Business Acceptance（Sprint 6A Ledger Foundation Gate）

| # | 场景 | 预期 |
| --- | --- | --- |
| G1 | 采购入库全链 | PO CONFIRMED → PurchaseReceipt RECEIVED → Inspection Completed → WarehouseReceipt POSTED（写 Outbox）→ Consumer → InventoryMovement(IN) + Projection 增加 → InventoryMovementCommitted |
| G2 | 已入库退货全链 | PurchaseReturn RETURNED（WAREHOUSE_RECEIPT_LINE）→ 写 Outbox → Consumer → 精确五维 OUT + Projection 减少（禁负库存） |
| G3 | Projection reconciliation | SUM(COMMITTED Movement) == StockProjection.onHandQty（Movement=事实源，Projection=同事务物化） |

## H. Release Gate

- **CTO Sprint 6A Final Review 待签**（QA 文档为 PR #21 Finalization 收口产物）；通过后 Merge PR #21 → main + 归档 tag；下一阶段（Transfer/Conversion/Count/Reservation/Costing）新建独立分支
- 服务器保护：OpenClaw 未跑本地高资源验证；验证事实源 = GitHub CI（@ `0c15e84` run #205 全绿）
