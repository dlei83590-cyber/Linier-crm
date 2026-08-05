-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('FINISHED_GOOD', 'RAW_MATERIAL', 'ACCESSORY', 'PURCHASED_PART', 'SERVICE', 'PACKAGING');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH');

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mnemonic" TEXT,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "spec" TEXT,
    "category" "ItemCategory" NOT NULL DEFAULT 'FINISHED_GOOD',
    "unitId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinearGuideSpecification" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "series" TEXT,
    "slideBlockType" TEXT,
    "railType" TEXT,
    "interchangeability" TEXT,
    "precisionGrade" TEXT,
    "preload" TEXT,
    "railLength" DECIMAL(12,2),
    "ratedDynamicLoad" DECIMAL(12,2),
    "ratedStaticLoad" DECIMAL(12,2),
    "ratedMoment" JSONB,
    "lubrication" TEXT,
    "dustProtection" TEXT,
    "material" TEXT,
    "hardness" TEXT,
    "mountingType" TEXT,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "LinearGuideSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalStandard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "TechnicalStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemStandard" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPartner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mnemonic" TEXT,
    "name" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL DEFAULT 'SUPPLIER',
    "uscc" TEXT,
    "taxpayerType" TEXT,
    "legalRepresentative" TEXT,
    "registeredAddress" TEXT,
    "invoiceInfo" JSONB,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "settlementTerms" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "BusinessPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "validFrom" TIMESTAMP(3) WITH TIME ZONE,
    "validTo" TIMESTAMP(3) WITH TIME ZONE,
    "freightIncluded" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "unitPriceExclTax" DECIMAL(14,4) NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(14,4) NOT NULL,
    "unitPriceInclTax" DECIMAL(14,4) NOT NULL,
    "minOrderQty" DECIMAL(14,2),
    "tieredPricing" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialTerm" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "CommercialTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT,
    "nextNo" INTEGER NOT NULL DEFAULT 1,
    "padLength" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_code_key" ON "UnitOfMeasure"("code");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_name_idx" ON "UnitOfMeasure"("name");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_deletedAt_idx" ON "UnitOfMeasure"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_model_idx" ON "Item"("model");

-- CreateIndex
CREATE INDEX "Item_mnemonic_idx" ON "Item"("mnemonic");

-- CreateIndex
CREATE INDEX "Item_category_idx" ON "Item"("category");

-- CreateIndex
CREATE INDEX "Item_deletedAt_idx" ON "Item"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinearGuideSpecification_itemId_key" ON "LinearGuideSpecification"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalStandard_code_key" ON "TechnicalStandard"("code");

-- CreateIndex
CREATE INDEX "TechnicalStandard_name_idx" ON "TechnicalStandard"("name");

-- CreateIndex
CREATE INDEX "TechnicalStandard_deletedAt_idx" ON "TechnicalStandard"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemStandard_itemId_standardId_key" ON "ItemStandard"("itemId", "standardId");

-- CreateIndex
CREATE INDEX "ItemStandard_standardId_idx" ON "ItemStandard"("standardId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartner_code_key" ON "BusinessPartner"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartner_uscc_key" ON "BusinessPartner"("uscc");

-- CreateIndex
CREATE INDEX "BusinessPartner_name_idx" ON "BusinessPartner"("name");

-- CreateIndex
CREATE INDEX "BusinessPartner_mnemonic_idx" ON "BusinessPartner"("mnemonic");

-- CreateIndex
CREATE INDEX "BusinessPartner_type_idx" ON "BusinessPartner"("type");

-- CreateIndex
CREATE INDEX "BusinessPartner_deletedAt_idx" ON "BusinessPartner"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_code_key" ON "PriceList"("code");

-- CreateIndex
CREATE INDEX "PriceList_name_idx" ON "PriceList"("name");

-- CreateIndex
CREATE INDEX "PriceList_deletedAt_idx" ON "PriceList"("deletedAt");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId");

-- CreateIndex
CREATE INDEX "PriceListItem_itemId_idx" ON "PriceListItem"("itemId");

-- CreateIndex
CREATE INDEX "PriceListItem_deletedAt_idx" ON "PriceListItem"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialTerm_code_key" ON "CommercialTerm"("code");

-- CreateIndex
CREATE INDEX "CommercialTerm_name_idx" ON "CommercialTerm"("name");

-- CreateIndex
CREATE INDEX "CommercialTerm_deletedAt_idx" ON "CommercialTerm"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_code_key" ON "DocumentSequence"("code");

-- CreateIndex
CREATE INDEX "DocumentSequence_name_idx" ON "DocumentSequence"("name");

-- CreateIndex
CREATE INDEX "DocumentSequence_deletedAt_idx" ON "DocumentSequence"("deletedAt");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearGuideSpecification" ADD CONSTRAINT "LinearGuideSpecification_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStandard" ADD CONSTRAINT "ItemStandard_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemStandard" ADD CONSTRAINT "ItemStandard_standardId_fkey" FOREIGN KEY ("standardId") REFERENCES "TechnicalStandard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
