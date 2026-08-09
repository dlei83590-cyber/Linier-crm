-- Sprint 5A Phase 4B：多轮审批 Snapshot 唯一约束修复 + PO Header 采购员/采购部门落地
-- CTO Phase 4B 指令（2026-08-09）：
--   ① PurchaseOrderSnapshot 唯一约束 [purchaseOrderId, snapshotType] -> [purchaseOrderId, snapshotType, revisionNo]
--      （多轮审批时同一 snapshotType 会重复生成，旧约束撞唯一键；revisionNo 使每轮快照可并存）
--   ② PurchaseOrder Header 增加 purchaserId（采购员）/ departmentId（采购部门）
--      （中国 ERP：采购员绩效/供应商分布/交期达成率均需 purchaserId；Direct PO 无 PR，无法从 requester 推导）
-- 纯增量：仅 DROP 旧唯一索引 + CREATE 新唯一索引 + ADD COLUMN + ADD FK + CREATE INDEX；不 DROP 表/列/数据。

-- ① PurchaseOrderSnapshot：放宽唯一约束（加入 revisionNo 支持多轮审批）
DROP INDEX "PurchaseOrderSnapshot_purchaseOrderId_snapshotType_key";
CREATE UNIQUE INDEX "PurchaseOrderSnapshot_purchaseOrderId_snapshotType_revisionNo_key" ON "PurchaseOrderSnapshot"("purchaseOrderId", "snapshotType", "revisionNo");

-- ② PurchaseOrder Header：采购员 / 采购部门
ALTER TABLE "PurchaseOrder" ADD COLUMN "purchaserId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "departmentId" TEXT;

-- Foreign Keys（onDelete SetNull：采购员/部门删除不影响 PO 历史）
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_purchaserId_fkey" FOREIGN KEY ("purchaserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "PurchaseOrder_purchaserId_idx" ON "PurchaseOrder"("purchaserId");
CREATE INDEX "PurchaseOrder_departmentId_idx" ON "PurchaseOrder"("departmentId");
