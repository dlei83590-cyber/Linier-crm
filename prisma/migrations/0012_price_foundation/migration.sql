/*
  Warnings:

  - The `approvalStatus` column on the `Customer` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `CustomerAddress` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `CustomerContact` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `CustomerCredit` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `CustomerTag` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `DashboardChart` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `DashboardKpi` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `DashboardLayout` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `DashboardWidget` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `File` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `FileAttachment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `FileFolder` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `FileVersion` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `Industry` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `customerItemNo` on the `Item` table. All the data in the column will be lost.
  - You are about to drop the column `supplierItemNo` on the `Item` table. All the data in the column will be lost.
  - The `approvalStatus` column on the `Menu` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `MenuGroup` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvalStatus` column on the `Tag` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `_PermissionToRole` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PricePolicyType" AS ENUM ('STANDARD', 'VIP', 'PROJECT', 'DEALER', 'REGIONAL', 'PROMOTION');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaxRateType" AS ENUM ('ZERO', 'SIX', 'THIRTEEN', 'EXEMPT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('MANUAL', 'IMPORT', 'FORMULA', 'PROMOTION', 'SUPPLIER', 'MARKET');

-- CreateEnum
CREATE TYPE "PriceMatchStrategy" AS ENUM ('FIRST_MATCH', 'BEST_PRICE', 'LOWEST_PRICE', 'HIGHEST_PRIORITY', 'COMBINE');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "ExchangeRateType" AS ENUM ('CENTRAL_BANK', 'BANK', 'MANUAL');

-- CreateEnum
CREATE TYPE "PriceRuleType" AS ENUM ('CUSTOMER_LEVEL', 'REGION', 'QUANTITY_BREAK', 'BRAND', 'PROJECT_TYPE', 'CURRENCY', 'CHANNEL');

-- DropForeignKey
ALTER TABLE "_PermissionToRole" DROP CONSTRAINT "_PermissionToRole_A_fkey";

-- DropForeignKey
ALTER TABLE "_PermissionToRole" DROP CONSTRAINT "_PermissionToRole_B_fkey";

-- AlterTable
ALTER TABLE "ApprovalDelegate" ALTER COLUMN "validFrom" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "validTo" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApprovalEscalation" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApprovalReminder" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApprovalTimeout" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Approver" ALTER COLUMN "decidedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApproverGroup" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApproverGroupMember" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessPartner" ALTER COLUMN "foundedDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessPartnerRole" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CommercialTerm" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "foundedDate" SET DATA TYPE TIMESTAMP(3),
DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerAddress" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerContact" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerCredit" ALTER COLUMN "reviewDate" SET DATA TYPE TIMESTAMP(3),
DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CustomerTag" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DashboardChart" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DashboardKpi" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DashboardLayout" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DashboardWidget" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DictionaryItem" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DictionaryType" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentSequence" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "File" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileAttachment" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileFolder" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileVersion" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Industry" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "customerItemNo",
DROP COLUMN "supplierItemNo",
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ItemCategory" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ItemCost" ALTER COLUMN "effectiveFrom" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "effectiveTo" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ItemRevision" ALTER COLUMN "releasedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ItemSpecification" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ItemTag" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Menu" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MenuGroup" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationChannel" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationLog" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationMessage" ALTER COLUMN "sentAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "readAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationTemplate" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerAddress" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerBankAccount" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerContact" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerCredit" ALTER COLUMN "reviewDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PartnerTag" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PriceList" ADD COLUMN     "baseCurrency" TEXT NOT NULL DEFAULT 'CNY',
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "policyType" "PricePolicyType",
ADD COLUMN     "pricePolicyId" TEXT,
ADD COLUMN     "priceSource" "PriceSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "quoteCurrency" TEXT NOT NULL DEFAULT 'CNY',
ADD COLUMN     "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "validFrom" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "validTo" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PriceListItem" ADD COLUMN     "discountRate" DECIMAL(5,2),
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "priceSource" "PriceSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "taxProfileId" TEXT,
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectAcceptance" ALTER COLUMN "expectedDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "actualDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectBudget" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectClosure" ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectExpense" ALTER COLUMN "incurredAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMember" ALTER COLUMN "joinedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "leftAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectMilestone" ALTER COLUMN "plannedDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "actualDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectOpportunity" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectProduct" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectProgress" ALTER COLUMN "recordedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectRisk" ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectStakeholder" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectTask" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProjectVisit" ALTER COLUMN "visitedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "reminderAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SpecificationDefinition" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierCertificate" ALTER COLUMN "issueDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expireDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierItem" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierQualification" ALTER COLUMN "issueDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expireDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierSettlement" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SystemSetting" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tag" DROP COLUMN "approvalStatus",
ADD COLUMN     "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TechnicalStandard" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantSetting" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UnitOfMeasure" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UomConversion" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserSetting" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowAction" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowCondition" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowDefinition" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowHistory" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowInstance" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowStep" ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMP(3);

-- DropTable
DROP TABLE "_PermissionToRole";

-- CreateTable
CREATE TABLE "PricePolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "policyType" "PricePolicyType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchStrategy" "PriceMatchStrategy" NOT NULL DEFAULT 'HIGHEST_PRIORITY',
    "stopOnMatch" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PricePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "ruleType" "PriceRuleType" NOT NULL,
    "ruleName" TEXT NOT NULL,
    "conditions" JSONB,
    "discountRate" DECIMAL(5,2),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListVersion" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "workflowInstanceId" TEXT,
    "changeSummary" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PriceListVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPrice" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerRoleType" "PartnerRoleType" NOT NULL,
    "partnerRoleName" TEXT,
    "itemId" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "taxProfileId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "priceSource" "PriceSource" NOT NULL DEFAULT 'MANUAL',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PartnerPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "promotionType" "PromotionType" NOT NULL,
    "discountValue" DECIMAL(18,4) NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "priceSource" "PriceSource" NOT NULL DEFAULT 'PROMOTION',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PromotionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "rateType" "TaxRateType" NOT NULL,
    "rate" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "taxProfileId" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxProfileRule" (
    "id" TEXT NOT NULL,
    "country" TEXT,
    "itemCategory" TEXT,
    "customerType" TEXT,
    "supplierType" TEXT,
    "taxCode" TEXT NOT NULL,
    "taxProfileId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxProfileRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effectiveDate" TIMESTAMPTZ(3) NOT NULL,
    "provider" TEXT,
    "source" TEXT,
    "rateType" "ExchangeRateType" NOT NULL DEFAULT 'MANUAL',
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationPriceSnapshot" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "quotationLineId" TEXT,
    "itemId" TEXT NOT NULL,
    "priceListId" TEXT,
    "pricePolicyId" TEXT,
    "promotionRuleId" TEXT,
    "promotionDiscount" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "exchangeRateId" TEXT,
    "exchangeRate" DECIMAL(18,8),
    "taxProfileId" TEXT,
    "taxRate" DECIMAL(5,2),
    "baseUnitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "finalUnitPrice" DECIMAL(18,4) NOT NULL,
    "finalAmount" DECIMAL(18,4) NOT NULL,
    "pricingTime" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pricingEngineVersion" TEXT NOT NULL DEFAULT 'v1',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuotationPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAudit" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldPrice" DECIMAL(18,4),
    "newPrice" DECIMAL(18,4),
    "reason" TEXT,
    "approvedBy" TEXT,
    "workflowInstanceId" TEXT,
    "effectiveTime" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PriceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RolePermissions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RolePermissions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricePolicy_code_key" ON "PricePolicy"("code");

-- CreateIndex
CREATE INDEX "PricePolicy_policyType_idx" ON "PricePolicy"("policyType");

-- CreateIndex
CREATE INDEX "PricePolicy_deletedAt_idx" ON "PricePolicy"("deletedAt");

-- CreateIndex
CREATE INDEX "PriceRule_policyId_idx" ON "PriceRule"("policyId");

-- CreateIndex
CREATE INDEX "PriceRule_ruleType_idx" ON "PriceRule"("ruleType");

-- CreateIndex
CREATE INDEX "PriceRule_deletedAt_idx" ON "PriceRule"("deletedAt");

-- CreateIndex
CREATE INDEX "PriceListVersion_priceListId_idx" ON "PriceListVersion"("priceListId");

-- CreateIndex
CREATE INDEX "PriceListVersion_status_idx" ON "PriceListVersion"("status");

-- CreateIndex
CREATE INDEX "PriceListVersion_deletedAt_idx" ON "PriceListVersion"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListVersion_priceListId_versionNo_key" ON "PriceListVersion"("priceListId", "versionNo");

-- CreateIndex
CREATE INDEX "PartnerPrice_partnerId_idx" ON "PartnerPrice"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerPrice_itemId_idx" ON "PartnerPrice"("itemId");

-- CreateIndex
CREATE INDEX "PartnerPrice_partnerRoleType_idx" ON "PartnerPrice"("partnerRoleType");

-- CreateIndex
CREATE INDEX "PartnerPrice_deletedAt_idx" ON "PartnerPrice"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionRule_code_key" ON "PromotionRule"("code");

-- CreateIndex
CREATE INDEX "PromotionRule_startAt_endAt_idx" ON "PromotionRule"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "PromotionRule_deletedAt_idx" ON "PromotionRule"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_code_key" ON "TaxProfile"("code");

-- CreateIndex
CREATE INDEX "TaxProfile_deletedAt_idx" ON "TaxProfile"("deletedAt");

-- CreateIndex
CREATE INDEX "TaxRate_taxProfileId_idx" ON "TaxRate"("taxProfileId");

-- CreateIndex
CREATE INDEX "TaxRate_deletedAt_idx" ON "TaxRate"("deletedAt");

-- CreateIndex
CREATE INDEX "TaxProfileRule_country_itemCategory_customerType_supplierTy_idx" ON "TaxProfileRule"("country", "itemCategory", "customerType", "supplierType");

-- CreateIndex
CREATE INDEX "TaxProfileRule_priority_idx" ON "TaxProfileRule"("priority");

-- CreateIndex
CREATE INDEX "TaxProfileRule_deletedAt_idx" ON "TaxProfileRule"("deletedAt");

-- CreateIndex
CREATE INDEX "ExchangeRate_effectiveDate_idx" ON "ExchangeRate"("effectiveDate");

-- CreateIndex
CREATE INDEX "ExchangeRate_deletedAt_idx" ON "ExchangeRate"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_effectiveDate_key" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "effectiveDate");

-- CreateIndex
CREATE INDEX "QuotationPriceSnapshot_quotationId_idx" ON "QuotationPriceSnapshot"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationPriceSnapshot_itemId_idx" ON "QuotationPriceSnapshot"("itemId");

-- CreateIndex
CREATE INDEX "QuotationPriceSnapshot_deletedAt_idx" ON "QuotationPriceSnapshot"("deletedAt");

-- CreateIndex
CREATE INDEX "PriceAudit_entityType_entityId_idx" ON "PriceAudit"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "PriceAudit_workflowInstanceId_idx" ON "PriceAudit"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "_RolePermissions_B_index" ON "_RolePermissions"("B");

-- CreateIndex
CREATE INDEX "PriceList_status_idx" ON "PriceList"("status");

-- CreateIndex
CREATE INDEX "PriceList_pricePolicyId_idx" ON "PriceList"("pricePolicyId");

-- CreateIndex
CREATE INDEX "PriceListItem_taxProfileId_idx" ON "PriceListItem"("taxProfileId");

-- CreateIndex
CREATE INDEX "Supplier_code_idx" ON "Supplier"("code");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_pricePolicyId_fkey" FOREIGN KEY ("pricePolicyId") REFERENCES "PricePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PricePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListVersion" ADD CONSTRAINT "PriceListVersion_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPrice" ADD CONSTRAINT "PartnerPrice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPrice" ADD CONSTRAINT "PartnerPrice_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerPrice" ADD CONSTRAINT "PartnerPrice_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfileRule" ADD CONSTRAINT "TaxProfileRule_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "TaxProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_A_fkey" FOREIGN KEY ("A") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RolePermissions" ADD CONSTRAINT "_RolePermissions_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
