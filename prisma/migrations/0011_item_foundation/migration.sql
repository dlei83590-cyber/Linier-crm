-- Sprint 3C-3 - Item Foundation（Item Master，CTO #2075 定稿）
-- 策略：仅新增表/加列/枚举演进，不重建既有表（CTO 规则）；Item 表 ALTER 加列保持既有引用稳定

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItemCostType" AS ENUM ('STANDARD', 'LAST_PURCHASE', 'AVERAGE', 'CURRENT');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('DRAWING', 'CERTIFICATE', 'PHOTO', 'MANUAL', 'MODEL_3D', 'VIDEO', 'INSPECTION_REPORT');

-- AlterEnum: ItemType 扩展（原 ItemCategory 6 类 → CTO 10 类；ALTER TYPE ADD VALUE 需在事务外或独立执行）
ALTER TYPE "ItemCategory" RENAME TO "ItemType";
ALTER TYPE "ItemType" ADD VALUE 'SEMI_FINISHED';
ALTER TYPE "ItemType" ADD VALUE 'CONSUMABLE';
ALTER TYPE "ItemType" ADD VALUE 'ASSET';
ALTER TYPE "ItemType" ADD VALUE 'TOOLING';

-- AlterEnum: ItemLifecycle 值对齐 CTO 五值（DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE）
ALTER TYPE "ItemLifecycle" RENAME VALUE 'INTRO' TO 'DESIGN';
ALTER TYPE "ItemLifecycle" RENAME VALUE 'GROWTH' TO 'TRIAL';
ALTER TYPE "ItemLifecycle" RENAME VALUE 'MATURE' TO 'MASS_PRODUCTION';
ALTER TYPE "ItemLifecycle" RENAME VALUE 'DECLINE' TO 'DISCONTINUED';
ALTER TYPE "ItemLifecycle" RENAME VALUE 'EOL' TO 'OBSOLETE';

-- AlterTable: Item 升级为 Item Master（加列，不改既有列）
ALTER TABLE "Item" RENAME COLUMN "category" TO "itemType";
ALTER TABLE "Item" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Item" ADD COLUMN "series" TEXT;
ALTER TABLE "Item" ADD COLUMN "variant" TEXT;
ALTER TABLE "Item" ADD COLUMN "barcode" TEXT;
ALTER TABLE "Item" ADD COLUMN "qrCode" TEXT;
ALTER TABLE "Item" ADD COLUMN "revision" TEXT;
ALTER TABLE "Item" ADD COLUMN "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Item" ADD COLUMN "stockUomId" TEXT;
ALTER TABLE "Item" ADD COLUMN "purchaseUomId" TEXT;
ALTER TABLE "Item" ADD COLUMN "salesUomId" TEXT;
ALTER TABLE "Item" ADD COLUMN "isSalable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Item" ADD COLUMN "isPurchasable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Item" ADD COLUMN "isManufacturable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: FileAttachment 增加统一附件类型（CTO #2075：放 File Center）
ALTER TABLE "FileAttachment" ADD COLUMN "attachmentType" "AttachmentType";

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSpecification" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "specKey" TEXT NOT NULL,
    "specValue" TEXT NOT NULL,
    "unit" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ItemSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UomConversion" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fromUomId" TEXT NOT NULL,
    "toUomId" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "UomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCost" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "costType" "ItemCostType" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "effectiveFrom" TIMESTAMP(3) WITH TIME ZONE,
    "effectiveTo" TIMESTAMP(3) WITH TIME ZONE,
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ItemCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "moq" DECIMAL(18,4),
    "leadTime" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "purchasePrice" DECIMAL(18,4),
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "incoterm" TEXT,
    "paymentTerm" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SupplierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRevision" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revision" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'RELEASED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemTag" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemCategory_code_key" ON "ItemCategory"("code");
CREATE INDEX "ItemCategory_parentId_idx" ON "ItemCategory"("parentId");
CREATE INDEX "ItemCategory_level_idx" ON "ItemCategory"("level");
CREATE INDEX "ItemCategory_deletedAt_idx" ON "ItemCategory"("deletedAt");
CREATE INDEX "ItemSpecification_itemId_idx" ON "ItemSpecification"("itemId");
CREATE INDEX "ItemSpecification_deletedAt_idx" ON "ItemSpecification"("deletedAt");
CREATE UNIQUE INDEX "UomConversion_itemId_fromUomId_toUomId_key" ON "UomConversion"("itemId", "fromUomId", "toUomId");
CREATE INDEX "UomConversion_itemId_idx" ON "UomConversion"("itemId");
CREATE INDEX "UomConversion_deletedAt_idx" ON "UomConversion"("deletedAt");
CREATE INDEX "ItemCost_itemId_idx" ON "ItemCost"("itemId");
CREATE INDEX "ItemCost_costType_idx" ON "ItemCost"("costType");
CREATE INDEX "ItemCost_deletedAt_idx" ON "ItemCost"("deletedAt");
CREATE UNIQUE INDEX "SupplierItem_itemId_supplierId_key" ON "SupplierItem"("itemId", "supplierId");
CREATE INDEX "SupplierItem_itemId_idx" ON "SupplierItem"("itemId");
CREATE INDEX "SupplierItem_supplierId_idx" ON "SupplierItem"("supplierId");
CREATE INDEX "SupplierItem_deletedAt_idx" ON "SupplierItem"("deletedAt");
CREATE UNIQUE INDEX "ItemRevision_itemId_revisionNo_key" ON "ItemRevision"("itemId", "revisionNo");
CREATE INDEX "ItemRevision_itemId_idx" ON "ItemRevision"("itemId");
CREATE INDEX "ItemRevision_deletedAt_idx" ON "ItemRevision"("deletedAt");
CREATE UNIQUE INDEX "ItemTag_itemId_tagId_key" ON "ItemTag"("itemId", "tagId");
CREATE INDEX "ItemTag_itemId_idx" ON "ItemTag"("itemId");
CREATE INDEX "ItemTag_tagId_idx" ON "ItemTag"("tagId");
CREATE INDEX "ItemTag_deletedAt_idx" ON "ItemTag"("deletedAt");

-- Item 索引调整（category → itemType；新增 categoryId）
DROP INDEX "Item_category_idx";
CREATE INDEX "Item_itemType_idx" ON "Item"("itemType");
CREATE INDEX "Item_categoryId_idx" ON "Item"("categoryId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_stockUomId_fkey" FOREIGN KEY ("stockUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_purchaseUomId_fkey" FOREIGN KEY ("purchaseUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Item" ADD CONSTRAINT "Item_salesUomId_fkey" FOREIGN KEY ("salesUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemSpecification" ADD CONSTRAINT "ItemSpecification_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_fromUomId_fkey" FOREIGN KEY ("fromUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_toUomId_fkey" FOREIGN KEY ("toUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemCost" ADD CONSTRAINT "ItemCost_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemRevision" ADD CONSTRAINT "ItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemTag" ADD CONSTRAINT "ItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
