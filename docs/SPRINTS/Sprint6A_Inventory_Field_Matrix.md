# Sprint 6A：Inventory Field Matrix（库存账本字段矩阵）

- 版本：v0.1（草案，待 CTO Design Review；未批准前禁止 Schema / Migration 0024）
- 日期：2026-08-10
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / ADR-0025（草案）/ Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / Sprint5B_Field_Matrix.md（5B：WarehouseReceipt 已采集批次/序列号/效期）

> **铁律（CTO #7405）**：本矩阵是**字段草案**，不是 Schema。**业务模块不得直接创建 InventoryMovement**——必须通过 Inventory Ledger command 层以受支持 sourceType/sourceId/sourceLineId 生成。字段命名在 Schema Gate 批准后再定稿。

---

## 1. InventoryMovement（库存数量唯一事实源）—— Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| movementNo | 流水号 | DocumentSequence（前缀 MV / IMV-，P10 待拍板） | 创建即取号 |
| sourceType | 业务来源类型 | enum（`WAREHOUSE_RECEIPT_POSTED` / `PURCHASE_RETURN_RETURNED` / 未来 SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT / REVERSAL / CORRECTION） | **来源契约**；新增须 CTO 批准 |
| sourceId | 来源单据 id | string（FK 语义，不硬 FK——多业务表） | 如 WarehouseReceipt.id / PurchaseReturn.id |
| sourceLineId | 来源行 id | string | 如 WarehouseReceiptLine.id / PurchaseReturnLine.id；**与 sourceType+sourceId 构成幂等键** |
| **idempotencyKey** | 幂等键（唯一） | string，**DB UNIQUE**（sourceType + sourceId + sourceLineId） | 防重复生成（事件重放/重复调用 → 跳过） |
| direction | 方向 | enum `IN / OUT` | 库存增减方向 |
| status | 状态 | `PENDING（可选暂存）/ COMMITTED` | **COMMITTED = 生效点（库存账落定）**；COMMITTED 后不可变 |
| movementType | 类型 | enum `INBOUND / OUTBOUND / TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION` | 细分业务语义（Transfer/Conversion/Count 规则见 ADR D8-D10） |
| reversalOfMovementId | 冲销引用 | FK → InventoryMovement（可空） | **纠错只能追加**：REVERSAL 引用原 Movement |
| correctionOfMovementId | 修正引用 | FK → InventoryMovement（可空） | CORRECTION 引用原 Movement |
| warehouseId | 仓库 | FK → Warehouse（5B 已建最小主数据） | 维度键之一 |
| locationId | 库位 | FK → Location（可空） | 维度键之一 |
| itemId | 物料 | FK → Item | 维度键之一 |
| batchNo | 批次号 | string（可空） | **继承 5B WarehouseReceipt（P6 Final），不重建** |
| serialNos | 序列号列表 | string[]（可空） | 继承 5B |
| mfgDate / expDate | 生产日期/有效期 | date（可空） | 继承 5B |
| quantity | 数量 | Decimal(18,4)，**IN > 0 / OUT > 0（方向承载正负语义）** | 或允许 signed（±）——P6 负库存策略待拍板 |
| uomId | 单位 | FK → UoM | 与来源事实一致 |
| costSnapshot | 成本快照/引用（只读） | Decimal / string（可空） | **P4：仅快照/引用，禁止成本计算逻辑**（移动平均/FIFO 单独 Gate） |
| referenceNo | 业务单据号（冗余可读） | string（可空） | 追溯可读性 |
| remark | 备注 | string(500) | |
| committedAt / committedById | 落定时间/人 | date-time / FK → User | COMMITTED 时写入 |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | | **COMMITTED 行禁止 DELETE**（数据库约束；软删也不允许） |

> **历史不可变（D5）**：COMMITTED 行禁止 UPDATE / DELETE（含软删）。纠错 = 追加 REVERSAL / CORRECTION。

---

## 2. Stock Projection（库存投影——不是事实）

| 字段（草案） | 语义 | 说明 |
| --- | --- | --- |
| id | 主键 | |
| warehouseId + locationId + itemId + batchNo + serialNo | **维度键** | 共同决定一条库存投影（D6） |
| onHandQty | 在手数量 | = Σ IN - Σ OUT（COMMITTED Movement 聚合） |
| availableQty | 可用数量 | onHand - reserved（**ReservedQty 是否进 6A 待 P3 拍板**；未拍板前 availableQty 仅 = onHand 的别名或由上层算） |
| reservedQty | 预留量 | **默认不进 6A**（P3）；若拍板进入才建此字段 |
| lastMovementAt | 最后变动时间 | 投影维护（聚合时更新） |
| version | 乐观锁 | 投影并发读改写防抖 |

> **红线（D1/D2）**：Stock Projection **不能成为独立业务事实**——业务永远通过 Movement 改变库存；投影由 Inventory Ledger 聚合维护，**业务模块不得直接写投影**。

---

## 3. Batch / Serial 账本（批次/序列号维度）

| 项 | 规则 |
| --- | --- |
| canonical source | **继承 5B WarehouseReceiptLine（P6 Final）**——batchNo / serialNos / mfgDate / expDate 已在入库层采集 |
| 6A 职责 | 按 batch / serial 聚合 Movement 生成批次/序列号库存投影（维度键的一部分） |
| **红线** | 6A **不得重新创建第二份批次/序列号追溯事实**（不建独立 Batch/Serial 主数据；只引用 + 聚合） |

---

## 4. Outbox（Transactional Outbox——6A 前置能力，P1）

| 字段（草案） | 语义 | 说明 |
| --- | --- | --- |
| id | 主键 | UUID |
| eventType | 事件类型 | `WarehouseReceiptPosted` / `PurchaseReturned` / 未来各业务事件 |
| aggregateType / aggregateId | 聚合标识 | 如 WarehouseReceipt / PurchaseReturn |
| payload | 事件载荷 | JSON（对齐 EVENTS.md 载荷；**不含库存余额**） |
| idempotencyKey | 幂等键 | = sourceType + sourceId + sourceLineId（与 Movement 幂等键一致） |
| status | 状态 | `PENDING / SENT / FAILED` |
| retryCount | 重试次数 | consumer 失败重试 |
| createdAt / processedAt | 创建/处理时间 | |

> **P1 默认方案**：业务事实事务 + Outbox **同事务落库** → Inventory consumer 幂等消费生成 Movement。**红线：6A 上线前 Outbox 必须落地，不再容忍 best-effort 事件发布**（库存不能接受"偶尔少一笔"）。

---

## 5. 字段矩阵红线

1. **业务模块不得直接创建 InventoryMovement**（必须走 Inventory Ledger command 层 + 受支持 sourceType/sourceId/sourceLineId）；
2. **Stock / OnHandQty / AvailableQty 只能是投影**，不能直接写入；
3. **COMMITTED Movement 不可修改、不可删除**（纠错 = 追加 Reversal / Correction）；
4. **幂等键 = sourceType + sourceId + sourceLineId（DB UNIQUE）**；
5. **批次/序列号不重建**（canonical = 5B WarehouseReceipt）；
6. **ReservedQty 默认不进 6A**（P3 单独拍板）；
7. **Costing 不混入**（仅 costSnapshot/reference；移动平均/FIFO 单独 Gate 6B+）；
8. 本矩阵为**字段草案**，Schema/Migration 0024 在 CTO Design Review 批准后才允许。
