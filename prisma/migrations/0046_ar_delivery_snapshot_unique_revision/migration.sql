-- ============================================================
-- 0046 快照唯一约束放宽：多轮事件同 snapshotType 可并存
-- 背景（用户生产反馈 2026-08-21）：
--   ① CN/DN 反冲减报 INTERNAL_ERROR：reverse 与 apply 都对同一 AR 写 snapshotType=ADJUSTED 快照，
--      旧唯一约束 [accountsReceivableId, snapshotType] 冲突（P2002）→ 事务回滚 → 500
--   ② 收款核销多选/再次核销报 INTERNAL_ERROR：同一 AR 第二次核销写 PARTIALLY_PAID/PAID 快照冲突
--   ③ 送货单反签收/再确认：unconfirm 与 confirm-delivery 都写 snapshotType=DELIVERED 快照冲突
-- 修复（对齐 PurchaseOrderSnapshot 先例 Migration 0022）：
--   唯一约束 [X, snapshotType] -> [X, snapshotType, revisionNo]
--   revisionNo 递增使每轮快照可并存；不 DROP 表/列/数据。
-- ============================================================
DROP INDEX "AccountsReceivableSnapshot_accountsReceivableId_snapshotType_key";
CREATE UNIQUE INDEX "AccountsReceivableSnapshot_accountsReceivableId_snapshotType_revisionNo_key" ON "AccountsReceivableSnapshot"("accountsReceivableId", "snapshotType", "revisionNo");
DROP INDEX "DeliverySnapshot_deliveryId_snapshotType_key";
CREATE UNIQUE INDEX "DeliverySnapshot_deliveryId_snapshotType_revisionNo_key" ON "DeliverySnapshot"("deliveryId", "snapshotType", "revisionNo");
