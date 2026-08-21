-- ============================================================
-- 0043 P-2 生产入库：DocumentType + InventoryMovementSourceType 枚举扩展
-- 背景：ProductionInbound（P-1，Migration 0040）API 落地——
--   ① DocumentType.PRODUCTION_INBOUND：inboundNo 走 DocumentSequence 创建即取号（prefix PIN）
--   ② InventoryMovementSourceType.PRODUCTION：POSTED 同事务库存效应（半成品 OUT + 产成品 IN，
--      role 复用 CONSUME/PRODUCE，direction 区分；与 CONVERSION 区分：生产为跨 item 成本结转）
-- 说明：ALTER TYPE ADD VALUE 不能在事务块内执行——本迁移由 Prisma 以非事务模式应用。
-- ============================================================

ALTER TYPE "DocumentType" ADD VALUE 'PRODUCTION_INBOUND';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'PRODUCTION';
