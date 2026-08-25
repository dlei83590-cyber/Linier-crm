-- Migration 0053 — Customer Profile Relations（Phase 3 MVP：单客户多产品 / 单客户多供应商）
-- CustomerProduct（businessPartnerId → BusinessPartner CASCADE；itemId → Item CASCADE）
-- CustomerSupplier（customerId/supplierId → BusinessPartner CASCADE，BP-BP 自关联，命名关系区分）
-- 红线：仅 CREATE TABLE / CREATE INDEX / ADD CONSTRAINT（对齐 0048/0049/0050 手写迁移约定）
-- 复用 business-partner RBAC（view/edit）+ file-attachment RBAC（view/create/delete），不新增权限模块（ADR-0028 防漂移）
-- 客户文档/附件：复用 File Center（FileAttachment businessType="business-partner"），零新表（HOLD：附件系统重建/文档管理平台）

-- 1) CustomerProduct 表（客户 → 多产品）
CREATE TABLE "CustomerProduct" (
    "id" TEXT NOT NULL,
    "businessPartnerId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerProduct_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerProduct_businessPartnerId_itemId_key" ON "CustomerProduct"("businessPartnerId", "itemId");
CREATE INDEX "CustomerProduct_businessPartnerId_idx" ON "CustomerProduct"("businessPartnerId");
CREATE INDEX "CustomerProduct_itemId_idx" ON "CustomerProduct"("itemId");
CREATE INDEX "CustomerProduct_deletedAt_idx" ON "CustomerProduct"("deletedAt");
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_businessPartnerId_fkey" FOREIGN KEY ("businessPartnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) CustomerSupplier 表（客户 → 多供应商；BP-BP）
CREATE TABLE "CustomerSupplier" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerSupplier_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerSupplier_customerId_supplierId_key" ON "CustomerSupplier"("customerId", "supplierId");
CREATE INDEX "CustomerSupplier_customerId_idx" ON "CustomerSupplier"("customerId");
CREATE INDEX "CustomerSupplier_supplierId_idx" ON "CustomerSupplier"("supplierId");
CREATE INDEX "CustomerSupplier_deletedAt_idx" ON "CustomerSupplier"("deletedAt");
ALTER TABLE "CustomerSupplier" ADD CONSTRAINT "CustomerSupplier_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSupplier" ADD CONSTRAINT "CustomerSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
