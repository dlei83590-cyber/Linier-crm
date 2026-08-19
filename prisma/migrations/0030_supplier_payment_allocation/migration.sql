-- Sprint 5C-2（CTO 解锁 2026-08-19）：0030_supplier_payment_allocation — 供应商付款 + 核销（Settlement Fact，ADR-0027 D7）
--
-- 范围：新增 SupplierPaymentStatus 枚举；SupplierPayment（付款单）+ SupplierPaymentAllocation（核销行）。
-- 红线：只建模型；Apply 对 ApOpenItem.openAmount 投影的更新在应用层（同事务锁内重算）；纠错 → 追加 reversal。
--
-- ============ 1. 枚举 ============
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('UNALLOCATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED'); -- 受控投影（事务更新，禁止 PATCH）

-- ============ 2. SupplierPayment（付款单头） ============
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "amount" DECIMAL(18,4) NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paymentDate" TIMESTAMPTZ(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "referenceNo" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'UNALLOCATED',
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPayment_code_key" ON "SupplierPayment"("code");
CREATE INDEX "SupplierPayment_supplierId_idx" ON "SupplierPayment"("supplierId");
CREATE INDEX "SupplierPayment_status_idx" ON "SupplierPayment"("status");
CREATE INDEX "SupplierPayment_deletedAt_idx" ON "SupplierPayment"("deletedAt");

ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============ 3. SupplierPaymentAllocation（核销行） ============
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "apOpenItemId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(18,4) NOT NULL,
    "allocatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "allocatedBy" TEXT,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedBy" TEXT,
    "reverseReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierPaymentAllocation_paymentId_idx" ON "SupplierPaymentAllocation"("paymentId");
CREATE INDEX "SupplierPaymentAllocation_apOpenItemId_idx" ON "SupplierPaymentAllocation"("apOpenItemId");
CREATE INDEX "SupplierPaymentAllocation_reversedAt_idx" ON "SupplierPaymentAllocation"("reversedAt");

ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_apOpenItemId_fkey" FOREIGN KEY ("apOpenItemId") REFERENCES "ApOpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
