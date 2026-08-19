-- Sprint 5C-2（CTO 解锁 2026-08-19）：0031_supplier_payment_reversal — 付款单整体冲销（Red Reversal）
--
-- 范围：SupplierPayment 新增 reversedAt / reversedById / reverseReason（区分作废 void 与已核销后冲销）。
-- 红线：只加列；冲销逻辑（反转 allocations + 回滚 ApOpenItem/payment 投影）在应用层同事务执行；不手改 openAmount。

ALTER TABLE "SupplierPayment" ADD COLUMN "reversedAt" TIMESTAMPTZ(3);
ALTER TABLE "SupplierPayment" ADD COLUMN "reversedById" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN "reverseReason" TEXT;

CREATE INDEX "SupplierPayment_reversedAt_idx" ON "SupplierPayment"("reversedAt");
