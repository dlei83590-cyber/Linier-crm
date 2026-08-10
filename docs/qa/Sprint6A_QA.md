# Sprint 6A QA — Inventory Ledger Foundation（库存账本基础设施闭环）

> Sprint：6A（China ERP Process & Field Gate）| 模块：Inventory Ledger Foundation——Transactional Outbox Writer（5B 两触发点同事务写 Outbox）+ Inventory Ledger Command + Inventory Consumer（claim/lease/幂等/五维锁/禁负库存/同事务三件套）+ StockProjection 物化投影 + InventoryMovementCommitted 发布 | PR：#21（feature/sprint6a-inventory-ledger，Open 待 Final Review 合并）
> 日期：2026-08-10
> 状态：✅ **CTO 签字链**：Schema FINAL 99/100（#7508）→ Outbox Writer FINAL 99/100（#7588）→ Consumer + Ledger Command FINAL 99/100（#7683）——**6A 核心库存账闭环成立**；本 QA 文档为 PR #21 Finalization 收口产物（待 CTO Sprint 6A Final Review；通过后 Merge PR #21 并进入下一阶段独立分支）
> 关联：ADR-0025（Inventory Ledger SSOT）、Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md、Sprint6A_Inventory_Field_Matrix.md、Sprint6A_CTO_Pending_Decisions.md、EVENTS.md v1.26、openapi.yaml（Sprint 6A 段）、docs/test-cases/InventoryLedger_API.md
> 6A 核心库存事实链（实现层面闭环）：**WarehouseReceipt POSTED → 同事务写 Outbox → Consumer claim+lease fencing → 五元幂等 → 锁五维 StockProjection → InventoryMovement(IN) → Projection 增加 → Outbox PROCESSED**；**PurchaseReturn RETURNED（WAREHOUSE_RECEIPT_LINE）→ 同事务写 Outbox → 精确 warehouse/location/item/batch/serial OUT → 五维锁 → 禁负库存 → InventoryMovement(OUT) → Projection 减少 → Outbox PROCESSED**

## 1. 交付范围

### 1.1 代码（均在 `apps/web/src/**`）
| 分组 | 文件/端点 | 说明 |
| --- | --- | --- |
| Outbox Writer | `apps/web/src/lib/inventory-ledger/outbox-writer.ts` | 原子级 Outbox 写入 helper：`writeInventoryOutboxAtom`（五元幂等键）+ `expandSourceLineAtoms`（serial 原子化/数量守恒/去重/canonical dimensions 必填）+ `InventoryOutboxError`（稳定错误码 → 409，事务回滚） |
| 触发点① | `apps/web/src/app/api/warehouse-receipts/[id]/post/route.ts` | POST 事务内 CAS 落定后写 `OutboxMessage(WarehouseReceiptPosted)` → IN 原子（业务事实 + Outbox 同事务） |
| 触发点② | `apps/web/src/app/api/purchase-returns/[id]/return/route.ts` | RETURN 事务内仅 `WAREHOUSE_RECEIPT_LINE` 来源行写 `OutboxMessage(PurchaseReturned)` → OUT 原子（serial 四象限 Gate：来源有 serial 必须显式提交且 ∈ 来源集合；来源无 serial 禁止提交） |
| Ledger Command + Consumer | `apps/web/src/lib/inventory-ledger/consumer.ts` | claim（FOR UPDATE SKIP LOCKED + PROCESSING lease）→ validate payload / resolve source → 五元幂等（ON CONFLICT DO NOTHING RETURNING）→ 锁五维 StockProjection（IS NOT DISTINCT FROM + FOR UPDATE）→ OUT 禁负库存 → INSERT Movement(COMMITTED) + UPSERT Projection + MARK Outbox PROCESSED 同事务 → 发布 InventoryMovementCommitted |
| 事件发布 | `apps/web/src/lib/inventory-ledger/events.ts` | `InventoryMovementCommitted`（writeAuditLog 模式；载荷不含投影余额——P10 Final） |
| 触发端点 | `POST /api/inventory-ledger/consume` | 鉴权 `inventory-ledger:consume` + limit 校验（默认 20/上限 200）→ 批次统计 |

### 1.2 RBAC（权限码，动作级）
- `inventory-ledger:consume`（Consumer 触发端点；SUPER_ADMIN/ADMIN 覆盖）

### 1.3 Domain Events（EVENTS.md v1.26）
- `InventoryMovementCommitted` ⏳ → **✅ implemented/final**（Consumer 单事务提交后发布；P10：暂不发布 StockProjectionChanged）

## 2. 业务事实边界核验（CTO Gate）

| # | 边界 | 实现 | 核验 |
| --- | --- | --- | --- |
| B1 | 业务事实 + Outbox 同事务 | POST/RETURN 事务内 CAS 后写 Outbox；抛错整体回滚 | ✅ |
| B2 | Outbox 幂等键 = Movement 五元键 | `sourceType|sourceId|sourceLineId|movementRole|movementAtomKey` 一致 | ✅ |
| B3 | serial 原子化 | serial-managed 每 serial 一条（atomKey=serialNo、quantity=1）；非 serial BULK | ✅ |
| B4 | canonical dimensions 必填 | warehouseId/itemId/quantity>0 缺失 → INVENTORY_DIMENSION_INCOMPLETE → 事务回滚（防 poison Outbox） | ✅ |
| B5 | 已入库退货精确 OUT | P9：warehouse/location/batch/serial 取原 WarehouseReceiptLine | ✅ |
| B6 | lease fencing | 消费前验证 status=PROCESSING + lockedBy=workerId → LEASE_LOST | ✅ |
| B7 | Movement 五元幂等 | ON CONFLICT (五元) DO NOTHING RETURNING + 预检（lease 超时/重试不重复入账） | ✅ |
| B8 | 五维库存身份 | 五维 NULLS NOT DISTINCT 唯一索引；dimensionKey 仅查询/锁键 | ✅ |
| B9 | 禁负库存 | 锁五维后 onHandQty >= outQty；DB CHECK onHandQty >= 0 兜底 | ✅ |
| B10 | Movement 不可变 | COMMITTED 后 immutable trigger；纠错 = Reversal/Correction 追加 | ✅ |

## 3. 核心 Gate 验证记录

### 3.1 Outbox Writer Gate（CTO #7543 → #7563 → #7574 → #7588）
- 90/100 REQUEST CHANGES（#7543）：serial 数量守恒 + itemId 必填维度 → `a80345c` 修复
- 96/100 APPROVED WITH 1 SMALL BLOCKING（#7574）：非 serial 来源禁止提交 serialNos（对称 Gate）→ `dbc509e` 修复
- **99/100 FINAL APPROVED（#7588）**：四象限 serial Gate 完整

### 3.2 Consumer + Ledger Command Gate（#7644 → #7667 → #7683）
- 84/100 REQUEST CHANGES（#7644）：① lease fencing ② Projection ON CONFLICT DO NOTHING ③ Movement ON CONFLICT RETURNING → `31bb5f1` 修复
- 90/100 REQUEST CHANGES（#7667）：① StockProjection raw INSERT 显式 id ② InventoryMovement raw INSERT 显式 id ③ movementNo 删 fallback → `0c15e84` 修复
- **99/100 FINAL APPROVED（#7683）**：Runtime Blocking 0 / Concurrency Blocking 0 / Ledger Command FINAL / Inventory Consumer FINAL

## 4. 回归与并发专项（覆盖 CTO #7683 Finalization 场景清单）

| # | 场景 | 预期 |
| --- | --- | --- |
| C1 | WarehouseReceipt POSTED → IN | Outbox 同事务写入；Consumer 生成 IN Movement + Projection 增加 + Outbox PROCESSED |
| C2 | PurchaseReturn RETURNED（WAREHOUSE_RECEIPT_LINE）→ OUT | 精确五维 OUT；禁负库存；Projection 减少 |
| C3 | serial atomization | serial-managed 每 serial 一条 Movement（quantity=1、atomKey=serialNo） |
| C4 | duplicate Outbox | Outbox.idempotencyKey UNIQUE 拒绝重复写入（同事务回滚） |
| C5 | duplicate Movement | 五元 UNIQUE + ON CONFLICT DO NOTHING → ALREADY_PROCESSED（幂等重放） |
| C6 | lease reclaim / LEASE_LOST | 过期 lease 被新 worker claim；旧 worker 事务开始验证 ownership → LEASE_LOST 放弃 |
| C7 | two-worker claim | FOR UPDATE SKIP LOCKED 原子领取，双 worker 不消费同一 Outbox |
| C8 | concurrent OUT | 同五维行 FOR UPDATE 串行；第二个 OUT 看到新余额，防一起扣负 |
| C9 | insufficient stock | OUT 时 onHandQty < quantity → 事务回滚（Movement 不写/Projection 不变/Outbox 不误标 PROCESSED）→ RETRY 退避 → 超阈值 DEAD_LETTER |
| C10 | poison Outbox / DEAD_LETTER | payload 非法 / source 不存在或状态不符 → 稳定 409 语义 + Outbox DEAD_LETTER（不落 500） |
| C11 | projection reconciliation | SUM(COMMITTED Movement) vs StockProjection.onHandQty 可核对（Movement=事实源，Projection=同事务物化） |

## 5. 已知限制（Known Limitations）

- **本阶段（6A Ledger Foundation）不做**：Transfer / Conversion / Count（盘点）/ Reservation（ReservedQty/availableQty）/ Costing（FIFO/移动平均）/ 新 sourceType / InventoryMovement/StockProjection read model API（CTO #7683 明令 HOLD，后续独立阶段）
- Event bus 未落地（Known Risk）：`InventoryMovementCommitted` 当前以 AuditLog 留痕；总线落地后替换为 publish
- raw SQL 路径（ON CONFLICT / FOR UPDATE SKIP LOCKED）依赖 PG16（NULLS NOT DISTINCT）；静态 CI 无法覆盖 DB 运行时路径，需真实 PG 验证

## 6. Release Gate

- **CTO Sprint 6A Final Review 待签**：通过后 Merge PR #21 → main（归档 tag），然后新建独立下一阶段分支（Transfer/Conversion/Count/Reservation/Costing）
- 服务器保护：OpenClaw 全程未跑本地高资源验证；所有验证事实源 = GitHub CI（Quality Gates ✅ / Build ✅ / Secret Scanning ✅，@ `0c15e84` run #205）
