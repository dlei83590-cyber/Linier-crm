# ADR-0038：成本核算首块 — 移动加权平均成本层（D9 HOLD 解除）

- 状态：**Accepted**（CTO 授权解除 D9 成本核算 HOLD；2026-08-20）
- 日期：2026-08-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0027（D9 明确排除 Costing/FIFO/Moving Average/Cost Layer/Valuation/Landed Cost——本 ADR 解除首块）、6A（InventoryMovement/StockProjection SSOT 红线）、5C-1（GRIR baseAmount 未税暂估口径 P9）

---

## 背景

CTO 2026-08-20 授权解除 D9 成本核算 HOLD。首块范围收敛为**移动加权平均（Moving Average）**——中国市场工业企业最常用的库存成本方法，且与现有 InventoryMovement（数量 SSOT）/StockProjection（数量投影）解耦（成本层独立，不写 Movement/Projection——6A 红线延续）。

## 决策

1. **首版范围（最小闭环）**：
   - **InventoryCostBalance**（itemId @unique：onHandQty / totalCost / avgUnitCost / version CAS）——item 级移动加权平均成本层（不按仓库/批号分层，首版 item 全局；仓库维度成本后续 backlog）。
   - **入库成本更新**：WHR POSTED 同事务（GRIR ACCRUAL 创建后）按 **PO 未税单价快照**（= GRIR baseAmount/quantity，P9 口径）更新移动平均：`avg' = (totalCost + baseAmount) / (onHandQty + qty)`（Decimal 精确，round HALF_UP 到 4dp）。
   - **查询 API**：GET /api/inventory-costs（item 级 avg/total/onHand；分页 + itemId/category 过滤；inventory-cost:view 权限，仅 SUPER_ADMIN/ADMIN——成本敏感）。
2. **明确排除（本 Gate 不做，后续 backlog）**：
   - **出库结转/COGS**（需要 InventoryMovementCommitted OUT 消费按 avg 结转 totalCost −= qty×avg + GL COGS 分录——涉及 6A consumer 改造，独立 Gate）
   - FIFO / Cost Layer / Valuation / Landed Cost / 仓库维度成本 / 成本差异分析
3. **幂等**：入库成本更新以 WHR Line 的 sourceKey（`COST:WAREHOUSE_RECEIPT_LINE:{lineId}`）唯一，重复 POST 幂等跳过；与 GRIR ACCRUAL 同事务（全有或全无）。
4. **权限（ADR-0028）**：新增 `inventory-cost` 模块（view/create/edit/close——首版仅 view 用于查询；成本敏感仅 SUPER_ADMIN/ADMIN 静态授权，与 supplier-invoice 一致）；shared PERMISSION_MODULES + seed 同步。
5. **前端**：/inventory/costs 只读列表页（物料/平均成本/总成本/在库数量；无写入口——成本由入库事实驱动）。

## 影响

- Migration 0036（InventoryCostBalance + Item 反向关系）；生产迁移顺序 0028→…→0036
- WHR POST 事务追加成本层更新（同 GRIR ACCRUAL 同事务，无额外事务边界）
- 6A Movement/StockProjection 零改动（成本层独立，红线延续）

## 后续（独立 backlog）

- 出库结转 + COGS GL 过账（Movement OUT 消费）
- FIFO / Cost Layer / Landed Cost / 仓库维度成本
- 成本差异分析 / 期末成本重估
