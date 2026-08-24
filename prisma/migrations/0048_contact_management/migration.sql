-- Migration 0048 — 联系人管理（2A，CTO Directive Phase 2A-1）
-- PartnerContact +mobile/contactNote + ContactSpecialDate（recurrence）+ ContactRelation + 主联系人 partial unique index
-- 红线：仅 CREATE TYPE / CREATE TABLE / CREATE INDEX / ADD CONSTRAINT / ALTER TABLE ADD COLUMN

-- 1) 新枚举
CREATE TYPE "ContactSpecialDateType" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'OTHER');
CREATE TYPE "ContactSpecialDateRecurrence" AS ENUM ('NONE', 'YEARLY');
CREATE TYPE "ContactRelationType" AS ENUM ('COLLEAGUE', 'REPORTS_TO', 'DECISION_MAKER', 'INFLUENCER', 'RELATIVE', 'OTHER');

-- 2) PartnerContact 扩展：手机（与 phone 座机区分）+ 联系备注（精细画像）
ALTER TABLE "PartnerContact" ADD COLUMN "mobile" TEXT;
ALTER TABLE "PartnerContact" ADD COLUMN "contactNote" TEXT;

-- 3) 主联系人唯一性（CTO Amendment 2）：同一 partner 至多一个 active primary
--    Prisma DSL 无法表达 partial index → 手写 SQL，migration history 为 SSOT
CREATE UNIQUE INDEX "PartnerContact_one_primary_per_partner" ON "PartnerContact"("partnerId") WHERE "isPrimary" = true AND "isActive" = true AND "deletedAt" IS NULL;

-- 4) CreateTable ContactSpecialDate（特殊日期 + 前置提醒）
CREATE TABLE "ContactSpecialDate" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ContactSpecialDateType" NOT NULL,
    "date" DATE NOT NULL,
    "recurrence" "ContactSpecialDateRecurrence" NOT NULL DEFAULT 'NONE',
    "title" TEXT,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 0,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactSpecialDate_pkey" PRIMARY KEY ("id")
);

-- 5) CreateTable ContactRelation（联系人关系）
CREATE TABLE "ContactRelation" (
    "id" TEXT NOT NULL,
    "sourceContactId" TEXT NOT NULL,
    "targetContactId" TEXT NOT NULL,
    "relationType" "ContactRelationType" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactRelation_pkey" PRIMARY KEY ("id")
);

-- 6) CreateIndex
CREATE INDEX "ContactSpecialDate_contactId_idx" ON "ContactSpecialDate"("contactId");
CREATE INDEX "ContactSpecialDate_deletedAt_idx" ON "ContactSpecialDate"("deletedAt");
CREATE INDEX "ContactRelation_sourceContactId_idx" ON "ContactRelation"("sourceContactId");
CREATE INDEX "ContactRelation_targetContactId_idx" ON "ContactRelation"("targetContactId");
CREATE INDEX "ContactRelation_deletedAt_idx" ON "ContactRelation"("deletedAt");

-- 7) AddForeignKey
ALTER TABLE "ContactSpecialDate" ADD CONSTRAINT "ContactSpecialDate_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "PartnerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactRelation" ADD CONSTRAINT "ContactRelation_sourceContactId_fkey" FOREIGN KEY ("sourceContactId") REFERENCES "PartnerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactRelation" ADD CONSTRAINT "ContactRelation_targetContactId_fkey" FOREIGN KEY ("targetContactId") REFERENCES "PartnerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
