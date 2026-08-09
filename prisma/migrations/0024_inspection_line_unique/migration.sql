-- Sprint 5B - Inspection：one Inspection per PurchaseReceiptLine（CTO #7115 Blocking）
-- 业务不变量落数据库：一次检验 = 最终结果，不支持复检轮次；
-- 并发 Create 由 DB unique 拒绝（Prisma P2002 → API 稳定返回 INSPECTION_ALREADY_EXISTS / 409）。
-- 纯增量（CREATE UNIQUE INDEX；0 DROP / 0 RENAME / 0 TRUNCATE）；0023 冻结为批准基线，不重写。

CREATE UNIQUE INDEX "Inspection_purchaseReceiptLineId_key" ON "Inspection"("purchaseReceiptLineId");
