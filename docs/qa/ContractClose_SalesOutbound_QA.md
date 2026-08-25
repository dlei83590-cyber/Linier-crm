# 合同收口-销售出库（CC-01 Sales Outbound）QA 验收记录

- 日期：2026-08-25
- 关联：Migration 0055（InventoryMovementSourceType.SALES_DELIVERY）、ADR-0025/0026（Inventory Ledger SSOT / Operations Boundary）、InventoryLedgerCommand Core、EVENTS.md v1.45
- 状态：**CI 验证（GitHub Actions Quality Gates / Build / Secret Scanning）为最终验证；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

| 提交 | 内容 | CI |
| --- | --- | --- |
| 销售出库真正库存扣减（0055） | Delivery DISPATCH 服务端事务内：登记 SALES_DELIVERY 库存事实 → 扣减 StockProjection → 写 InventoryMovement（五元幂等 + movementGroupId=delivery.id）；复用 InventoryLedgerCommand Core（不复制库存算法） | 待 CI |

## 2. 静态验收（本地已核）

- [x] **DISPATCH ≠ 状态变化冒充出库**：READY→DISPATCHED 事务内 executeLedgerAtoms 同事务写入 SALES_DELIVERY/OUT Movement + StockProjection 扣减；任一失败整体回滚（单据保持 READY）
- [x] 发运前库存检查 + 库存不足 → 409 INVENTORY_INSUFFICIENT_STOCK（InventoryInsufficientStockError 语义；Movement 不写/Projection 不变）
- [x] 多行统一事务：全部物料行 OUT 原子同一 movementGroupId=delivery.id；非物料行（itemId=null）跳过；数量 > 0 校验
- [x] 五元幂等：sourceType|delivery.id|line.id|OUT|BULK；重复 dispatch 状态门禁 409；并发 dispatch FOR UPDATE 串行化；幂等 immutable-fact 冲突 → 409
- [x] Movement 可追溯 Delivery：sourceType=SALES_DELIVERY / sourceId=delivery.id / sourceLineId=deliveryLine.id / referenceNo=delivery.code；Inventory Ledger 按来源过滤可查
- [x] 出库仓库 canonical 输入：warehouseId 必填 + warehouse 有效；locationId 可选且属于该仓库（组合 FK 语义）
- [x] **DISPATCHED 删除恢复库存**：DELETE（DISPATCHED）同事务写 REVERSAL/IN 原子（reversalOfMovementId=原 Movement id，五维/数量原样）→ StockProjection 恢复；禁止 delete movement / 无 movement 直接加回投影；CANCELLED 删除无冲销
- [x] 复用既有 moving-average 出库成本（applyOutboundCost）与 GL COGS 过账（postGlEntry）——ledger-command 内既有链路，未重复接线
- [x] 前端最小接线：dispatch 对话框出库仓库选择；SO/Delivery 详情展示「已出库（库存已扣减）」

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 订单→创建 Delivery→READY→记录出库前库存→Dispatch（选仓库）→查看库存减少→Inventory Ledger 找到 Delivery 来源→Delivery 显示已出库
- [ ] 多行出库 → StockProjection 逐行扣减正确；库存不足 → 409 前端可见
- [ ] DISPATCHED 删除 → 库存恢复（REVERSAL）；重复删除 → 404
- [ ] 并发 dispatch 同单 → 单胜出另一 409；重复 dispatch → 409

## 4. 已知限制 / 边界

- 销售出库暂不支持 serial-managed 物料的序列号选择（BULK OUT 按非 serial 维度；serial 维度库存不足 → 409 fail-closed，不做隐式选号）
- Delivery 无批次/效期维度（出库按五维 BULK；批次/效期精确出库属后续）
- 删除 DISPATCHED Delivery 恢复库存数量（REVERSAL），不自动冲回成本层/GL COGS（保持 ledger-command 既有行为——REVERSAL/IN 不触发 applyOutboundCost/postGlEntry；如后续需成本/GL 冲回另行 Gate）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
