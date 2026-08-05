-- Sprint 3C-2 - Supplier Foundation：BusinessPartnerRole + Partner 共享（Contact/Address/Tag/BankAccount/Credit）+ Supplier + Qualification/Certificate/Settlement
-- 策略：仅新增表，不修改既有表（CTO 规则）；BusinessPartner 为唯一主体，Customer/Supplier 均围绕其扩展

-- CreateEnum
CREATE TYPE "PartnerRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH', 'LOGISTICS', 'OUTSOURCING');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('POTENTIAL', 'QUALIFIED', 'PREFERRED', 'SUSPENDED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "QualificationType" AS ENUM ('BUSINESS_LICENSE', 'ISO9001', 'ISO14001', 'IATF16949', 'CE', 'ROHS', 'OTHER');

-- CreateEnum
CREATE TYPE "PartnerAddressType" AS ENUM ('REGISTERED', 'BILLING', 'SHIPPING', 'WAREHOUSE', 'FACTORY', 'INVOICING', 'CONTACT');

-- CreateTable
CREATE TABLE "BusinessPartnerRole" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "roleType" "PartnerRoleType" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "BusinessPartnerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerContact" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "wechat" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "PartnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAddress" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "addressType" "PartnerAddressType" NOT NULL DEFAULT 'REGISTERED',
    "recipient" TEXT,
    "phone" TEXT,
    "province" TEXT,
    "city" TEXT,
    "district" TEXT,
    "detail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "PartnerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerTag" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
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

    CONSTRAINT "PartnerTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerBankAccount" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNo" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "swiftCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "PartnerBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCredit" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "creditLimit" DECIMAL(18,2),
    "usedCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rating" "CustomerCreditRating" NOT NULL DEFAULT 'B',
    "status" "CustomerCreditStatus" NOT NULL DEFAULT 'NORMAL',
    "reviewDate" TIMESTAMP(3) WITH TIME ZONE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "PartnerCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'POTENTIAL',
    "rating" INTEGER,
    "defaultLeadTime" INTEGER,
    "minOrderQty" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQualification" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "qualType" "QualificationType" NOT NULL,
    "qualName" TEXT NOT NULL,
    "certNo" TEXT,
    "issueDate" TIMESTAMP(3) WITH TIME ZONE,
    "expireDate" TIMESTAMP(3) WITH TIME ZONE,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "attachment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SupplierQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCertificate" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "certType" TEXT NOT NULL,
    "certName" TEXT NOT NULL,
    "certNo" TEXT,
    "issueDate" TIMESTAMP(3) WITH TIME ZONE,
    "expireDate" TIMESTAMP(3) WITH TIME ZONE,
    "attachment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SupplierCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSettlement" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "creditDays" INTEGER,
    "paymentMethod" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "SupplierSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPartnerRole_partnerId_roleType_key" ON "BusinessPartnerRole"("partnerId", "roleType");
CREATE INDEX "BusinessPartnerRole_roleType_idx" ON "BusinessPartnerRole"("roleType");
CREATE INDEX "BusinessPartnerRole_deletedAt_idx" ON "BusinessPartnerRole"("deletedAt");
CREATE INDEX "PartnerContact_partnerId_idx" ON "PartnerContact"("partnerId");
CREATE INDEX "PartnerContact_deletedAt_idx" ON "PartnerContact"("deletedAt");
CREATE INDEX "PartnerAddress_partnerId_idx" ON "PartnerAddress"("partnerId");
CREATE INDEX "PartnerAddress_deletedAt_idx" ON "PartnerAddress"("deletedAt");
CREATE UNIQUE INDEX "PartnerTag_partnerId_tagId_key" ON "PartnerTag"("partnerId", "tagId");
CREATE INDEX "PartnerTag_tagId_idx" ON "PartnerTag"("tagId");
CREATE INDEX "PartnerTag_deletedAt_idx" ON "PartnerTag"("deletedAt");
CREATE INDEX "PartnerBankAccount_partnerId_idx" ON "PartnerBankAccount"("partnerId");
CREATE INDEX "PartnerBankAccount_deletedAt_idx" ON "PartnerBankAccount"("deletedAt");
CREATE UNIQUE INDEX "PartnerCredit_partnerId_key" ON "PartnerCredit"("partnerId");
CREATE INDEX "PartnerCredit_deletedAt_idx" ON "PartnerCredit"("deletedAt");
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");
CREATE UNIQUE INDEX "Supplier_partnerId_key" ON "Supplier"("partnerId");
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");
CREATE INDEX "Supplier_deletedAt_idx" ON "Supplier"("deletedAt");
CREATE INDEX "SupplierQualification_supplierId_idx" ON "SupplierQualification"("supplierId");
CREATE INDEX "SupplierQualification_deletedAt_idx" ON "SupplierQualification"("deletedAt");
CREATE INDEX "SupplierCertificate_supplierId_idx" ON "SupplierCertificate"("supplierId");
CREATE INDEX "SupplierCertificate_deletedAt_idx" ON "SupplierCertificate"("deletedAt");
CREATE INDEX "SupplierSettlement_supplierId_idx" ON "SupplierSettlement"("supplierId");
CREATE INDEX "SupplierSettlement_deletedAt_idx" ON "SupplierSettlement"("deletedAt");

-- AddForeignKey
ALTER TABLE "BusinessPartnerRole" ADD CONSTRAINT "BusinessPartnerRole_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerContact" ADD CONSTRAINT "PartnerContact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerAddress" ADD CONSTRAINT "PartnerAddress_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerTag" ADD CONSTRAINT "PartnerTag_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerTag" ADD CONSTRAINT "PartnerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerBankAccount" ADD CONSTRAINT "PartnerBankAccount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerCredit" ADD CONSTRAINT "PartnerCredit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BusinessPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierQualification" ADD CONSTRAINT "SupplierQualification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCertificate" ADD CONSTRAINT "SupplierCertificate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierSettlement" ADD CONSTRAINT "SupplierSettlement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
