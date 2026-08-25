-- ============================================================
-- 0055 合同收口-销售出库：InventoryMovementSourceType 枚举扩展
-- 背景：SalesOrder→Delivery→READY→DISPATCHED 全链已闭环，但 DISPATCH 只用"状态变化"
--   冒充出库（红线：不能用 Delivery 状态变化冒充库存出库）。本迁移新增 SALES_DELIVERY
--   sourceType，使 Delivery DISPATCH 服务端事务内可以登记销售出库库存事实：
--   扣减对应商品 StockProjection + 写 InventoryMovement（source=Delivery/DeliveryLine，
--   role=OUT，movementGroupId=delivery.id，五元幂等）。
-- 说明：ALTER TYPE ADD VALUE 不能在事务块内执行——本迁移由 Prisma 以非事务模式应用。
-- ============================================================

ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'SALES_DELIVERY';
