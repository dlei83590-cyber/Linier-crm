-- Sprint 5C-1：Supplier Invoice / MatchRun / GRIR / AP Liability-OpenItem Foundation
-- CTO 5C Gate Final Re-review（#8925）99/100 DESIGN GATE FINAL APPROVED —— 4 Blocking 全 CLOSED，
-- P1-P12 FINAL，Migration 0027 HOLD 正式解除（仅 5C-1）；暂不开始 API（Schema Review 通过后）。
-- 8 个 Schema 不变量（CTO #8925）DB 落地：
--   ① 首版 RECEIPT_BASED：SupplierInvoiceLine.purchaseOrderLineId + warehouseReceiptLineId 双必填 FK
--   ② 供应商发票号防重：UNIQUE(supplierId, supplierInvoiceNo)（不全局误锁不同供应商相同号码）
--   ③ MatchRun revision DB 唯一：UNIQUE(supplierInvoiceId, revision)；MatchRun/MatchLine immutable trigger
--   ④ approvedMatchRunId/revision 属于当前发票：UNIQUE(id, supplierInvoiceId) 组合 FK 支持
--   ⑤ GRIR 三类源 identity 幂等：GrirRecord.sourceKey UNIQUE（accrual/reversal/consume 各自唯一）
--   ⑥ AP Liability = Fact（一票一 Fact，supplierInvoiceId UNIQUE）；OpenItem = Projection（openAmount 只读投影）
--   ⑦ vatRecoverable 语义 DB Gate：recoverable=true ⇒ nonRecoverableTaxAmount=0；
--      recoverable=false ⇒ nonRecoverableTaxAmount=taxAmount（同一税额不双计）
--   ⑧ POSTED 终态 evidence CHECK：postedAt/postedById/approvedMatchRunId/approvedMatchRevision 全非空；
--      APPROVED ≠ POSTED（枚举分离）
-- 红线：不建 GL / 不写库存成本层（Costing HOLD）/ 无 CN-DN / 无 Payment / 无 5C-2
-- 备注：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TYPE ... ADD VALUE / CREATE FUNCTION / CREATE TRIGGER

-- ============ 1. 枚举 ============
CREATE TYPE "SupplierInvoiceDocumentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MATCHED', 'APPROVED', 'POSTED', 'CANCELLED'); -- P3 Final 两维之一（documentStatus 截止 POSTED/CANCELLED；APPROVED ≠ POSTED 不变量⑧）
CREATE TYPE "SupplierInvoiceSettlementStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID'); -- P3 Final 两维之二（独立维度，5C-2 Payment 驱动）
CREATE TYPE "SupplierInvoiceMatchResult" AS ENUM ('MATCHED', 'VARIANCE', 'PENDING'); -- 三单匹配行级结果（当前投影；历史走 immutable MatchRun）
CREATE TYPE "SupplierInvoiceMatchDisposition" AS ENUM ('ACCEPT', 'REJECT', 'HOLD', 'CREATE_CN_DN'); -- 匹配差异处置（CREATE_CN_DN 5C-2 实现）
CREATE TYPE "GrirType" AS ENUM ('ACCRUAL', 'REVERSAL', 'CONSUME'); -- GRIR 生命周期类型（Blocking ①）

-- DocumentType 加 SUPPLIER_INVOICE（SINV 序列，创建即取号 P1 Final，缺失 fail closed）
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_INVOICE';

-- ============ 2. SupplierInvoice（头）============
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL, -- SINV DocumentSequence，创建即取号（P1 Final）
    "supplierInvoiceNo" TEXT NOT NULL, -- 供应商发票号（不变量②：与 supplierId 组合唯一）
    "supplierId" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "receivedDate" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY', -- 币种（无 Currency 主数据表，String ISO 码）
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1, -- 创建时快照 FX（P2 Final）
    "documentStatus" "SupplierInvoiceDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "settlementStatus" "SupplierInvoiceSettlementStatus" NOT NULL DEFAULT 'UNPAID',
    "grossAmount" DECIMAL(18,2) NOT NULL, -- 含税总额（服务端聚合，禁客户端直传头金额）
    "netAmount" DECIMAL(18,2) NOT NULL, -- 不含税总额
    "taxAmount" DECIMAL(18,2) NOT NULL, -- 税额合计
    "currentMatchRunId" TEXT, -- 当前匹配 Run 引用（当前投影）
    "approvedMatchRunId" TEXT, -- 审批引用 immutable MatchRun（Approval references MatchRun，不 mutates——#8901）
    "approvedMatchRevision" INTEGER, -- 审批引用 revision（冗余存证）
    "postedAt" TIMESTAMPTZ(3),
    "postedById" TEXT,
    "paymentDueDate" DATE,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1, -- CAS 乐观锁
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierInvoice_invoiceNo_key" UNIQUE ("invoiceNo"),
    -- 不变量②：供应商发票号唯一（组合，不全局误锁不同供应商相同号码）
    CONSTRAINT "SupplierInvoice_supplier_supplierInvoiceNo_key" UNIQUE ("supplierId", "supplierInvoiceNo"),
    -- 不变量⑧：POSTED 终态 evidence 全非空；APPROVED ≠ POSTED（枚举分离）
    CONSTRAINT "SupplierInvoice_posted_evidence_check" CHECK ("documentStatus" <> 'POSTED' OR ("postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "approvedMatchRunId" IS NOT NULL AND "approvedMatchRevision" IS NOT NULL)),
    -- 金额一致性（服务端聚合兜底）：gross = net + tax
    CONSTRAINT "SupplierInvoice_amount_consistency_check" CHECK ("grossAmount" = "netAmount" + "taxAmount")
);
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");
CREATE INDEX "SupplierInvoice_documentStatus_idx" ON "SupplierInvoice"("documentStatus");
CREATE INDEX "SupplierInvoice_deletedAt_idx" ON "SupplierInvoice"("deletedAt");

-- ============ 3. SupplierInvoiceLine（行：RECEIPT_BASED 双溯源）============
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL, -- 不变量①：PO Line 溯源（必填）
    "warehouseReceiptLineId" TEXT NOT NULL, -- 不变量①：POSTED WHR Line 溯源（必填，数量匹配基准）
    "itemId" TEXT,
    "lineNo" INTEGER NOT NULL DEFAULT 10,
    "quantity" DECIMAL(18,4) NOT NULL, -- 开票数量
    "unitPrice" DECIMAL(18,6) NOT NULL, -- 单价（与 PO 快照单价比对）
    "netAmount" DECIMAL(18,2) NOT NULL, -- 行净额 = quantity × unitPrice（服务端）
    "taxRate" DECIMAL(18,4) NOT NULL, -- 税率快照（开票时点冻结）
    "taxAmount" DECIMAL(18,2) NOT NULL, -- 行税额 = netAmount × taxRate（服务端）
    "vatRecoverable" BOOLEAN NOT NULL DEFAULT true, -- P9 Final：recoverable=true → Input VAT component
    "nonRecoverableTaxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, -- P9 Final：recoverable=false → = taxAmount（expense-or-capitalizable 财务事实；不写库存成本层）
    "currentMatchStatus" "SupplierInvoiceMatchResult" NOT NULL DEFAULT 'PENDING',
    "currentMatchRunId" TEXT,
    "matchedQty" DECIMAL(18,4) NOT NULL DEFAULT 0, -- = min(invoiceQty, 可用入库量)；超过已收数量部分不可入 AP
    "varianceQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "variancePrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "varianceTax" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_lineNo_key" UNIQUE ("supplierInvoiceId", "lineNo"),
    CONSTRAINT "SupplierInvoiceLine_quantity_positive_check" CHECK ("quantity" > 0),
    -- 不变量⑦：vatRecoverable 语义 DB Gate（同一税额不双计）
    CONSTRAINT "SupplierInvoiceLine_non_recoverable_tax_check" CHECK (
        ("vatRecoverable" = true AND "nonRecoverableTaxAmount" = 0) OR
        ("vatRecoverable" = false AND "nonRecoverableTaxAmount" = "taxAmount")
    )
);
CREATE INDEX "SupplierInvoiceLine_supplierInvoiceId_idx" ON "SupplierInvoiceLine"("supplierInvoiceId");
CREATE INDEX "SupplierInvoiceLine_purchaseOrderLineId_idx" ON "SupplierInvoiceLine"("purchaseOrderLineId");
CREATE INDEX "SupplierInvoiceLine_warehouseReceiptLineId_idx" ON "SupplierInvoiceLine"("warehouseReceiptLineId");
CREATE INDEX "SupplierInvoiceLine_itemId_idx" ON "SupplierInvoiceLine"("itemId");
CREATE INDEX "SupplierInvoiceLine_deletedAt_idx" ON "SupplierInvoiceLine"("deletedAt");

-- ============ 4. SupplierInvoiceMatchRun（immutable Match Snapshot 头）============
CREATE TABLE "SupplierInvoiceMatchRun" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "runNo" INTEGER NOT NULL DEFAULT 1, -- 每发票递增 1,2,3…
    "revision" INTEGER NOT NULL DEFAULT 1, -- 不可变快照标识（审批引用；重新匹配 → 追加新 Run revision+1）
    "runAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runById" TEXT,
    "result" "SupplierInvoiceMatchResult" NOT NULL,
    "disposition" "SupplierInvoiceMatchDisposition" NOT NULL DEFAULT 'HOLD',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoiceMatchRun_pkey" PRIMARY KEY ("id"),
    -- 不变量③：invoice + revision 唯一识别
    CONSTRAINT "SupplierInvoiceMatchRun_invoice_revision_key" UNIQUE ("supplierInvoiceId", "revision"),
    -- 不变量④：支持 SupplierInvoice(approvedMatchRunId, id) 组合 FK 引用（必须属于同一发票）
    CONSTRAINT "SupplierInvoiceMatchRun_id_invoice_key" UNIQUE ("id", "supplierInvoiceId")
);
CREATE INDEX "SupplierInvoiceMatchRun_supplierInvoiceId_idx" ON "SupplierInvoiceMatchRun"("supplierInvoiceId");

-- ============ 5. SupplierInvoiceMatchLine（immutable Match Snapshot 行）============
CREATE TABLE "SupplierInvoiceMatchLine" (
    "id" TEXT NOT NULL,
    "matchRunId" TEXT NOT NULL,
    "supplierInvoiceLineId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL, -- 匹配时点快照引用
    "warehouseReceiptLineId" TEXT NOT NULL, -- 匹配时点快照引用
    "poQty" DECIMAL(18,4) NOT NULL,
    "receiptQty" DECIMAL(18,4) NOT NULL,
    "invoiceQty" DECIMAL(18,4) NOT NULL,
    "poUnitPrice" DECIMAL(18,6) NOT NULL,
    "invoiceUnitPrice" DECIMAL(18,6) NOT NULL,
    "qtyVariance" DECIMAL(18,4) NOT NULL,
    "priceVariance" DECIMAL(18,6) NOT NULL,
    "taxVariance" DECIMAL(18,2) NOT NULL,
    "result" "SupplierInvoiceMatchResult" NOT NULL,
    "disposition" "SupplierInvoiceMatchDisposition" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierInvoiceMatchLine_pkey" PRIMARY KEY ("id"),
    -- 一行发票行每次匹配一条 Run 行
    CONSTRAINT "SupplierInvoiceMatchLine_run_line_key" UNIQUE ("matchRunId", "supplierInvoiceLineId")
);
CREATE INDEX "SupplierInvoiceMatchLine_matchRunId_idx" ON "SupplierInvoiceMatchLine"("matchRunId");
CREATE INDEX "SupplierInvoiceMatchLine_supplierInvoiceLineId_idx" ON "SupplierInvoiceMatchLine"("supplierInvoiceLineId");

-- ============ 6. GrirRecord（GRIR 暂估应付事实：Accrual / Reversal / Consume）============
CREATE TABLE "GrirRecord" (
    "id" TEXT NOT NULL,
    "grirType" "GrirType" NOT NULL,
    "supplierInvoiceId" TEXT, -- consume 时关联发票（accrual/reversal 时为空）
    "supplierInvoiceLineId" TEXT, -- consume 源（POSTED 时）
    "warehouseReceiptLineId" TEXT, -- accrual 源（WHR Posted 时）
    "purchaseReturnLineId" TEXT, -- reversal 源（WHR-based PurchaseReturned 时）
    "baseAmount" DECIMAL(18,2) NOT NULL, -- 不含税暂估净额（P9 Final：GRIR baseAmount = 不含税；进项税只在合规发票进入时确认）
    "quantity" DECIMAL(18,4) NOT NULL, -- 暂估数量
    "unitPrice" DECIMAL(18,6) NOT NULL, -- PO 快照单价（暂估基准）
    "taxRate" DECIMAL(18,4) NOT NULL, -- 税率快照（normalize 用）
    "sourceKey" TEXT NOT NULL, -- 服务端幂等键："{grirType}:{sourceType}:{sourceLineId}"
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GrirRecord_pkey" PRIMARY KEY ("id"),
    -- 不变量⑤：GRIR 三类源 identity 幂等唯一（accrual/reversal/consume 各自唯一，防重复冲回）
    CONSTRAINT "GrirRecord_sourceKey_key" UNIQUE ("sourceKey")
);
CREATE INDEX "GrirRecord_grirType_idx" ON "GrirRecord"("grirType");
CREATE INDEX "GrirRecord_supplierInvoiceId_idx" ON "GrirRecord"("supplierInvoiceId");
CREATE INDEX "GrirRecord_warehouseReceiptLineId_idx" ON "GrirRecord"("warehouseReceiptLineId");
CREATE INDEX "GrirRecord_purchaseReturnLineId_idx" ON "GrirRecord"("purchaseReturnLineId");
CREATE INDEX "GrirRecord_supplierInvoiceLineId_idx" ON "GrirRecord"("supplierInvoiceLineId");

-- ============ 7. ApLiabilityFact（AP 应付债务事实——POSTED 生成、不可变；OpenItem 是投影）============
CREATE TABLE "ApLiabilityFact" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL, -- 不变量⑥：一票一 Liability Fact（POSTED 时生成）
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "grossAmount" DECIMAL(18,2) NOT NULL, -- AP 总债务 = net + total tax（不因 recoverability 改变）
    "netAmount" DECIMAL(18,2) NOT NULL,
    "inputVatAmount" DECIMAL(18,2) NOT NULL, -- recoverable=true 部分（Input VAT component）
    "nonRecoverableTaxAmount" DECIMAL(18,2) NOT NULL, -- recoverable=false 部分（expense-or-capitalizable 财务事实；不写库存成本层）
    "dueDate" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApLiabilityFact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ApLiabilityFact_supplierInvoiceId_key" UNIQUE ("supplierInvoiceId") -- 不变量⑥：一票一 Fact
);
CREATE INDEX "ApLiabilityFact_supplierId_idx" ON "ApLiabilityFact"("supplierId");

-- ============ 8. ApOpenItem（AP Open Item——materialized projection / read model）============
CREATE TABLE "ApOpenItem" (
    "id" TEXT NOT NULL,
    "apLiabilityFactId" TEXT NOT NULL, -- 一 Fact 一 OpenItem 投影
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "openAmount" DECIMAL(18,2) NOT NULL, -- 投影（= Liability + CN/DN - Allocations；5C-1 阶段 = grossAmount 初始；服务端 reconciliation，不手改）
    "settlementStatus" "SupplierInvoiceSettlementStatus" NOT NULL DEFAULT 'UNPAID',
    "dueDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1, -- 投影刷新 CAS（reconciliation 服务端更新）
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApOpenItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ApOpenItem_apLiabilityFactId_key" UNIQUE ("apLiabilityFactId")
);
CREATE INDEX "ApOpenItem_supplierId_idx" ON "ApOpenItem"("supplierId");
CREATE INDEX "ApOpenItem_settlementStatus_idx" ON "ApOpenItem"("settlementStatus");

-- ============ 9. FK 约束 ============
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_approvedMatchRunId_fkey" FOREIGN KEY ("approvedMatchRunId", "id") REFERENCES "SupplierInvoiceMatchRun"("id", "supplierInvoiceId") ON DELETE RESTRICT ON UPDATE CASCADE; -- 不变量④：组合 FK 保证审批引用的 MatchRun 属于当前发票

ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE; -- 不变量①：PO Line 溯源
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_warehouseReceiptLineId_fkey" FOREIGN KEY ("warehouseReceiptLineId") REFERENCES "WarehouseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE; -- 不变量①：POSTED WHR Line 溯源（service Gate 保证来源已 POSTED）
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoiceMatchRun" ADD CONSTRAINT "SupplierInvoiceMatchRun_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceMatchRun" ADD CONSTRAINT "SupplierInvoiceMatchRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoiceMatchLine" ADD CONSTRAINT "SupplierInvoiceMatchLine_matchRunId_fkey" FOREIGN KEY ("matchRunId") REFERENCES "SupplierInvoiceMatchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceMatchLine" ADD CONSTRAINT "SupplierInvoiceMatchLine_supplierInvoiceLineId_fkey" FOREIGN KEY ("supplierInvoiceLineId") REFERENCES "SupplierInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceMatchLine" ADD CONSTRAINT "SupplierInvoiceMatchLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceMatchLine" ADD CONSTRAINT "SupplierInvoiceMatchLine_warehouseReceiptLineId_fkey" FOREIGN KEY ("warehouseReceiptLineId") REFERENCES "WarehouseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GrirRecord" ADD CONSTRAINT "GrirRecord_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrirRecord" ADD CONSTRAINT "GrirRecord_supplierInvoiceLineId_fkey" FOREIGN KEY ("supplierInvoiceLineId") REFERENCES "SupplierInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrirRecord" ADD CONSTRAINT "GrirRecord_warehouseReceiptLineId_fkey" FOREIGN KEY ("warehouseReceiptLineId") REFERENCES "WarehouseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrirRecord" ADD CONSTRAINT "GrirRecord_purchaseReturnLineId_fkey" FOREIGN KEY ("purchaseReturnLineId") REFERENCES "PurchaseReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApLiabilityFact" ADD CONSTRAINT "ApLiabilityFact_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApLiabilityFact" ADD CONSTRAINT "ApLiabilityFact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApOpenItem" ADD CONSTRAINT "ApOpenItem_apLiabilityFactId_fkey" FOREIGN KEY ("apLiabilityFactId") REFERENCES "ApLiabilityFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ 10. immutable trigger（不变量③：MatchRun/MatchLine 自创建后禁止业务字段 UPDATE/DELETE）============
-- 对齐 0025 InventoryMovement 不可变触发器模式；审批事实存 SupplierInvoice approval evidence（approvedMatchRunId/revision），不 mutates MatchRun（#8901）
CREATE OR REPLACE FUNCTION forbid_matchrun_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SupplierInvoiceMatchRun is immutable: UPDATE/DELETE forbidden (append new revision instead)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoice_match_run_immutable
BEFORE UPDATE OR DELETE ON "SupplierInvoiceMatchRun"
FOR EACH ROW EXECUTE FUNCTION forbid_matchrun_mutation();

CREATE OR REPLACE FUNCTION forbid_matchline_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SupplierInvoiceMatchLine is immutable: UPDATE/DELETE forbidden (append new revision instead)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_supplier_invoice_match_line_immutable
BEFORE UPDATE OR DELETE ON "SupplierInvoiceMatchLine"
FOR EACH ROW EXECUTE FUNCTION forbid_matchline_mutation();
