# Sprint 6A：Inventory Field Matrix（库存账本字段矩阵）

- 版本：v0.2（CTO Design Review 90/100 APPROVED WITH CHANGES 落实，待 Re-review；未批准前禁止 Schema / Migration 0024）
- 日期：2026-08-10
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / ADR-0025（Approved with Changes）/ Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / Sprint5B_Field_Matrix.md（5B：WarehouseReceipt 已采集批次/序列号/效期）

> **铁律（CTO #7405/#7458）**：本矩阵是**字段草案**，不是 Schema。**业务模块不得直接创建 InventoryMovement**——必须通过 Inventory Ledger command 层以受支持 `sourceType + sourceId + sourceLineId + movementRole + movementAtomKey` 生成。**一行 `InventoryMovement` = 一个不可变库存原子事实**（单层模型，无 Header/Line 两层；多笔编组用 `movementGroupId`）。字段命名在 Schema Gate 批准后再定稿。

---

## 1. InventoryMovement（库存数量唯一事实源）—— 单层原子事实（CTO #7458 修正：无 Header/Line 两层）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| movementNo | 流水号 | DocumentSequence（前缀 MV / IMV-，P10 Final） | 创建即取号 |
| sourceType | 业务来源类型 | enum（`WAREHOUSE_RECEIPT_POSTED` / `PURCHASE_RETURN_RETURNED` / 未来 SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT / REVERSAL / CORRECTION） | **来源契约**；新增须 CTO 批准 |
| sourceId | 来源单据 id | string（FK 语义，不硬 FK——多业务表） | 如 WarehouseReceipt.id / PurchaseReturn.id |
| sourceLineId | 来源行 id | string | 如 WarehouseReceiptLine.id / PurchaseReturnLine.id |
| **movementRole** | 来源行内的角色 | enum（`IN / OUT / SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION`） | **CTO #7458 Blocking ①**：一个 source line 可合法产生多笔 Movement（Transfer 同行 → SOURCE_OUT+DESTINATION_IN；Conversion → CONSUME+PRODUCE） |
| **movementAtomKey** | 原子子键（**CTO #7469 Blocking ① 新增**） | string，**DB UNIQUE 组成部分** | **非 serial = `BULK`；serial = `serialNo`**——serial-managed 每 serial 一条独立 Movement 时，五元幂等键 `sourceType+sourceId+sourceLineId+movementRole+movementAtomKey` 才不撞 UNIQUE；未来 Transfer/Conversion 多原子同 role 也用 movementAtomKey 区分（不直接把 serialNo 塞进唯一约束，更通用） |
| **idempotencyKey** | 幂等键（唯一） | string，**DB UNIQUE**（sourceType + sourceId + sourceLineId + movementRole + movementAtomKey） | 防重复生成；**Reversal/Correction 拥有自己的 source/action identity，不与原 Movement 共用幂等身份** |
| movementGroupId | 编组 id（可空） | string | **CTO #7458**：Transfer/Conversion 多笔 Movement 编组（替代 Header/Line 两层） |
| direction | 方向 | enum `IN / OUT` | 库存增减方向 |
| status | 状态 | **`COMMITTED`（创建即 COMMITTED，P2 Final；无 PENDING）** | **COMMITTED = 生效点（库存账落定）**；COMMITTED 后不可变 |
| movementType | 类型 | enum `INBOUND / OUTBOUND / TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION` | 细分业务语义（Transfer/Conversion/Count 规则见 ADR D8-D10） |
| reversalOfMovementId | 冲销引用 | FK → InventoryMovement（可空，**DB UNIQUE——CTO #7469 Minor ②**） | **纠错只能追加**：REVERSAL 引用原 Movement；**一笔 Movement 最多被完整冲销一次**（单次语义；未来部分/多次冲销须先明确数量 ceiling 再放开） |
| correctionOfMovementId | 修正引用 | FK → InventoryMovement（可空） | CORRECTION 引用原 Movement |
| warehouseId | 仓库 | FK → Warehouse（5B 已建最小主数据） | 维度键之一 |
| locationId | 库位 | FK → Location（可空） | 维度键之一 |
| itemId | 物料 | FK → Item | 维度键之一 |
| batchNo | 批次号 | string（可空） | **继承 5B WarehouseReceipt（P6 Final），不重建** |
| **serialNo** | 序列号（**单值**） | string（可空） | **CTO #7458 Blocking ②**：serial-managed Item 原子化——每个 serial 独立 Movement 事实（serialNo=exactly one、quantity=1）；**不用 `serialNos[]`**（一个 Movement 无法稳定投影成多个独立 serial dimension）；5B WarehouseReceipt 可继续批量采集 `serialNos[]`，**6A command 层负责展开成多个库存事实** |
| mfgDate / expDate | 生产日期/有效期 | date（可空） | 继承 5B |
| quantity | 数量 | Decimal(18,4)；**非序列号管理：quantity > 0、serialNo=null；序列号管理：quantity=1、serialNo=exactly one** | 方向由 direction 承载（IN/OUT 均为正数） |
| uomId | 单位 | FK → UoM | 与来源事实一致 |
| referenceNo | 业务单据号（冗余可读） | string（可空） | 追溯可读性 |
| remark | 备注 | string(500) | |
| committedAt / committedById | 落定时间/人 | date-time / FK → User | COMMITTED 时写入 |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | | **COMMITTED 行禁止 DELETE**（数据库约束；软删也不允许） |

> **历史不可变（D5）**：COMMITTED 行禁止 UPDATE / DELETE（含软删）。纠错 = 追加 REVERSAL / CORRECTION。
> **P6 Final（禁止负库存）**：所有 OUT 在锁定库存维度后必须保证 `onHandQty >= outQty`；不足稳定拒绝（409）。
> **P4 Final**：**无 costSnapshot 字段**（Costing 不进入 6A；移动平均/FIFO 单独 Gate 6B+）。

---

## 2. Stock Projection（库存投影——不是事实；P7 Final：物化 + 与 Movement 同事务更新 + reconciliation）

| 字段（草案） | 语义 | 说明 |
| --- | --- | --- |
| id | 主键 | |
| warehouseId + locationId + itemId + batchNo + serialNo | **维度键** | 共同决定一条库存投影（D6）；**数据库级唯一（PG16 `UNIQUE NULLS NOT DISTINCT` 五维约束，CTO #7469 Blocking ②）** |
| dimensionKey | 查询/锁键（**非唯一防线**） | string NOT NULL（CHECK 非空） | command 层生成、NULL 归一为占位符；**唯一性由五维 DB 约束直接表达**，不依赖手工字符串 |
| **onHandQty** | 在手数量 | = Σ IN - Σ OUT（COMMITTED Movement 聚合）；**与 Movement 同事务 UPSERT 更新**（P7 Final） |
| lastMovementAt | 最后变动时间 | 投影维护（聚合时更新） |
| version | 乐观锁 | 投影并发读改写防抖 |

> **P3 Final**：**无 `availableQty` / `reservedQty` 字段**（ReservedQty 不进入 6A；availableQty 本阶段不作为 canonical 库存字段）。
> **P7 Final 一致性模型（CTO #7458 Blocking ④）**：
> - Inventory consumer 单事务 = `BEGIN → 幂等检查 → INSERT InventoryMovement(COMMITTED) → UPSERT StockProjection(onHandQty += signed) → MARK Outbox PROCESSED → COMMIT`
> - **Movement 是事实源；Projection 是缓存/投影，但与 Movement commit 原子更新**
> - ❌ 不采用"Movement 先提交、以后另一个异步 consumer 再更新 StockProjection"的双重最终一致链
> - **Reconciliation**：`SUM(COMMITTED Movement)` vs `StockProjection.onHandQty`（按维度键）→ 发现差异 → **报警/修复投影，不修改历史 Movement**

> **红线（D1/D2）**：Stock Projection **不能成为独立业务事实**——业务永远通过 Movement 改变库存；投影由 Inventory Ledger 聚合维护，**业务模块不得直接写投影**。

---

## 3. Batch / Serial 账本（批次/序列号维度）

| 项 | 规则 |
| --- | --- |
| canonical source | **继承 5B WarehouseReceiptLine（P6 Final）**——batchNo / serialNos / mfgDate / expDate 已在入库层采集 |
| 6A 职责 | 按 batch / serial 聚合 Movement 生成批次/序列号库存投影（维度键的一部分）；**serial-managed：每 serial 独立 Movement（quantity=1、serialNo 单值）** |
| **红线** | 6A **不得重新创建第二份批次/序列号追溯事实**（不建独立 Batch/Serial 主数据；只引用 + 聚合 + 展开） |

---

## 4. Outbox（Transactional Outbox——6A 前置能力；P8 Final：平台级持久 Outbox + lease/retry/dead-letter）

| 字段（草案） | 语义 | 说明 |
| --- | --- | --- |
| id | 主键 | UUID |
| eventType | 事件类型 | `WarehouseReceiptPosted` / `PurchaseReturned` / 未来各业务事件 |
| aggregateType / aggregateId | 聚合标识 | 如 WarehouseReceipt / PurchaseReturn |
| payload | 事件载荷 | JSON（对齐 EVENTS.md 载荷；**不含库存余额**） |
| idempotencyKey | 幂等键 | = sourceType + sourceId + sourceLineId + movementRole + movementAtomKey（与 Movement 五元幂等键一致，CTO #7469） |
| status | 状态 | **`PENDING / PROCESSING / PROCESSED / DEAD_LETTER`**（CTO #7458 Blocking ③：语义 = 库存消费成功才确认完成，不混"投递/消费/投影"） |
| attemptCount | 尝试次数 | 失败重试 |
| nextAttemptAt | 下次尝试时间 | retry 调度 |
| lockedAt / lockedBy | 租约（lease） | 多 worker 防重复处理（worker crash 可恢复） |
| lastError | 最后错误 | 毒消息诊断 |
| processedAt | 处理完成时间 | |
| createdAt | 创建时间 | |

> **P8 Final（CTO #7458）**：状态机 `PENDING → PROCESSING → PROCESSED`；失败 `PROCESSING → PENDING(retry)` 或超阈值 → `DEAD_LETTER`；**处理成功不删除 Outbox（保留审计记录）**。
> **P1 Final**：业务事实事务 + Outbox **同事务落库** → Inventory consumer 幂等消费生成 Movement。**红线：6A 上线前 Outbox 必须落地，不再容忍 best-effort 事件发布**（库存不能接受"偶尔少一笔"）。

---

## 5. 字段矩阵红线（CTO #7458 落实后）

1. **业务模块不得直接创建 InventoryMovement**（必须走 Inventory Ledger command 层 + 受支持 sourceType/sourceId/sourceLineId/movementRole/movementAtomKey）；
2. **Stock / OnHandQty 只能是投影**，不能直接写入；投影与 Movement 同事务更新（P7 Final）；**负库存 DB CHECK（onHandQty >= 0）为最后防线**；
3. **COMMITTED Movement 不可修改、不可删除**（纠错 = 追加 Reversal / Correction；Reversal/Correction 独立幂等身份；**一笔 Movement 最多被完整冲销一次**）；
4. **幂等键 = sourceType + sourceId + sourceLineId + movementRole + movementAtomKey（DB UNIQUE）**；
5. **批次/序列号不重建**（canonical = 5B WarehouseReceipt）；serial-managed 原子化（每 serial 独立 Movement、quantity=1、serialNo 单值）；
6. **ReservedQty / availableQty / reservedQty 不进 6A**（P3 Final）；
7. **Costing（含 costSnapshot）不进入 6A**（P4 Final）；
8. **禁止负库存**（P6 Final：OUT 前 command 层锁行 onHandQty >= outQty + DB CHECK onHandQty >= 0）；
9. **Movement 单层原子事实 + 可选 movementGroupId**（无 Header/Line 两层）；
10. 本矩阵为**字段草案**，Schema/Migration 0025 待 CTO 6A Schema Re-review（#7469 5 项落实）通过后定稿；API/Consumer 仍 HOLD。
