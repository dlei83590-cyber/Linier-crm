-- Sprint 4D Invoice Foundation（发票领域，CTO Review 96/100 APPROVED WITH CHANGES 2026-08-07）
-- 红线：仅 CREATE TYPE / CREATE TABLE / ALTER TABLE ADD COLUMN / UPDATE 初始化 / CREATE INDEX / ADD CONSTRAINT
-- 禁止 DROP/RENAME/TRUNCATE/改旧字段类型/重建旧表（Delivery/Quotation/SalesOrder 一律不动）
-- 设计依据：ADR-0015（PricingEngine 唯一入口）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、
-- ADR-0018（Delivery Domain）、ADR-0019（Invoice Domain）、Sprint4D_Invoice_Design.md（Schema 草案）、
-- EVENTS.md v1.7（Invoice 事件 5 个已注册：Created/Issued/Cancelled + PartiallyPaid/Paid 4E 先注册后实现）
-- onDelete（CTO Review 锁定）：Invoice→Delivery/Customer Restrict；Line→Invoice Cascade、→DeliveryLine/Item/UOM/PriceSnapshot 按列；
-- Revision/Snapshot→Invoice Cascade；Invoice→WorkflowInstance SetNull
-- CTO 拍板项：① Partial Billing（DeliveryLine 加 invoicedQty/remainingInvoiceQty 投影，创建时重算禁止超开票 409）
-- ② Consolidated Invoice（Header Customer/Currency/TaxProfile/PaymentTerm 一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE）
-- ③ 禁止编辑 Line（金额复制快照）④ 仅 DRAFT 可取消（ISSUED+ 走 Credit Note）
-- CTO 必改①：Invoice.code 可空（DRAFT 不占号，ISSUE 时从 DocumentSequence 取号 INV-2026-000123）
-- CTO 必改②：InvoiceSnapshot 增加完整税务/汇率快照（taxProfileId/taxRate/sstNo/currencyRate/exchangeRate，多年后 100% 还原）
-- 金额红线：Invoice 永不重算价格——经四段溯源链复制 SalesOrderLine 价格快照，不调用 Pricing Engine
-- DeliveryLine 追加 invoicedQty/remainingInvoiceQty 投影列；remainingInvoiceQty 初始化 = quantity（DB default 无法引用 quantity）

-- CreateEnum: InvoiceStatus（主状态不含 VOID——VOID 语义后续交 Credit Note；Payment 由 4E 回写投影）
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum: InvoiceSnapshotType（仅固化节点；PARTIALLY_PAID/PAID 待 4E 补充）
CREATE TYPE "InvoiceSnapshotType" AS ENUM ('CREATED', 'ISSUED', 'CANCELLED');

-- CreateEnum: InvoiceRevisionStatus（与 Delivery/SalesOrder/Quotation 同构）
CREATE TYPE "InvoiceRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum: InvoiceLineStatus（预留；4D 仅枚举）
CREATE TYPE "InvoiceLineStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterTable: DeliveryLine 追加开票投影列（仅新增列，不改既有列/索引）
-- invoicedQty：已开票数量（仅 ISSUED+ Invoice 累计；防超开票基准）
ALTER TABLE "DeliveryLine" ADD COLUMN "invoicedQty" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- remainingInvoiceQty：剩余可开票数量 = quantity - invoicedQty（无 default——DB default 无法引用 quantity）
ALTER TABLE "DeliveryLine" ADD COLUMN "remainingInvoiceQty" DECIMAL(18,4);

-- 初始化：存量数据 remainingInvoiceQty = quantity（新 DeliveryLine 由 Invoice 创建逻辑维护）
-- 原则以 quantity 为基准；仅允许 DELIVERED 行开票的限制由 API 层校验，不在 Migration 做业务判断
UPDATE "DeliveryLine" SET "remainingInvoiceQty" = "quantity" WHERE "remainingInvoiceQty" IS NULL;

-- 投影列非空约束（初始化完成后收紧）
ALTER TABLE "DeliveryLine" ALTER COLUMN "remainingInvoiceQty" SET NOT NULL;

-- CreateTable: Invoice（发票头；财务事实源；deliveryId NOT NULL——Direct Invoice 禁止；code 可空——DRAFT 不占号）
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "deliveryId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceDate" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) WITH TIME ZONE,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "taxProfileId" TEXT,
    "paymentTerm" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiceTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balanceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "workflowInstanceId" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3) WITH TIME ZONE,
    "approvedById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Invoice.code 唯一（可空——DRAFT 为 NULL 不占号；ISSUE 时写入 INV-2026-000123）
CREATE UNIQUE INDEX "Invoice_code_key" ON "Invoice"("code");

-- CreateIndex
CREATE INDEX "Invoice_deliveryId_idx" ON "Invoice"("deliveryId");

-- CreateIndex
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_workflowInstanceId_idx" ON "Invoice"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");

-- CreateTable: InvoiceLine（发票行；金额快照直接复制；sourceDeliveryLineId 必填溯源——四段溯源链末端）
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sourceDeliveryLineId" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uomId" TEXT,
    "priceSnapshotId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 行号唯一（10/20/30/40 步进）
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNo_key" ON "InvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_sourceDeliveryLineId_idx" ON "InvoiceLine"("sourceDeliveryLineId");

-- CreateIndex
CREATE INDEX "InvoiceLine_itemId_idx" ON "InvoiceLine"("itemId");

-- CreateIndex
CREATE INDEX "InvoiceLine_deletedAt_idx" ON "InvoiceLine"("deletedAt");

-- CreateTable: InvoiceRevision（统一版本载体，系统生成，不开放自由编辑）
CREATE TABLE "InvoiceRevision" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionStatus" "InvoiceRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeReason" TEXT NOT NULL,
    "snapshotData" JSONB,
    "createdById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "InvoiceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 修订号唯一
CREATE UNIQUE INDEX "InvoiceRevision_invoiceId_revisionNo_key" ON "InvoiceRevision"("invoiceId", "revisionNo");

-- CreateIndex
CREATE INDEX "InvoiceRevision_invoiceId_idx" ON "InvoiceRevision"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceRevision_deletedAt_idx" ON "InvoiceRevision"("deletedAt");

-- CreateTable: InvoiceSnapshot（关键状态证据，不可变；金额统一 Decimal 字符串，禁止 toNumber()；税务/汇率完整快照 CTO 必改②）
CREATE TABLE "InvoiceSnapshot" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "snapshotType" "InvoiceSnapshotType" NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "snapshotData" JSONB,
    "taxProfileId" TEXT,
    "taxRate" DECIMAL(18,4),
    "sstNo" TEXT,
    "currencyRate" DECIMAL(18,8),
    "exchangeRate" DECIMAL(18,8),
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "InvoiceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 每单据每节点一个快照（CREATED/ISSUED/CANCELLED）
CREATE UNIQUE INDEX "InvoiceSnapshot_invoiceId_snapshotType_key" ON "InvoiceSnapshot"("invoiceId", "snapshotType");

-- CreateIndex
CREATE INDEX "InvoiceSnapshot_invoiceId_idx" ON "InvoiceSnapshot"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceSnapshot_deletedAt_idx" ON "InvoiceSnapshot"("deletedAt");

-- AddForeignKey: Invoice → Delivery（Restrict：发票为财务事实源，来源交付单不可物理删；Direct Invoice 禁止）
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Invoice → Customer（Restrict：开票客户）
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Invoice → WorkflowInstance（SetNull：Workflow 为唯一审批事实源，实例删除不影响发票投影）
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: InvoiceLine → Invoice（Cascade：行随单据软删）
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: InvoiceLine → DeliveryLine（SetNull：交付行软删不影响发票行，保留溯源字段）
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_sourceDeliveryLineId_fkey" FOREIGN KEY ("sourceDeliveryLineId") REFERENCES "DeliveryLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: InvoiceLine → Item（Restrict）
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: InvoiceLine → UnitOfMeasure（SetNull）
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: InvoiceLine → QuotationPriceSnapshot（SetNull：价格快照直接复制，不重算）
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "QuotationPriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: InvoiceRevision → Invoice（Cascade：修订历史随单据）
ALTER TABLE "InvoiceRevision" ADD CONSTRAINT "InvoiceRevision_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: InvoiceSnapshot → Invoice（Cascade：快照证据随单据）
ALTER TABLE "InvoiceSnapshot" ADD CONSTRAINT "InvoiceSnapshot_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
