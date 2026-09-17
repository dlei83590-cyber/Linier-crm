-- Migration 0057 — 往来单位企业资质 + 所有制性质 + 上市状态（用户指令「往来单位 修改二」2026-09-17）
-- 业务：①企业资质（科技型中小企业/创新型中小企业/高新技术企业/专精特新中小企业/专精特新「小巨人」）多选勾选；
--       ②企业类型 = 所有制性质（国有/私企/外资/合资）+ 上市状态（上市/非上市）两个独立维度，各自单选（用户确认拆分）。
-- 边界：不复用 SupplierQualification（供应商认证资质 ISO9001 等，含证书号/有效期/附件）——语义不同，零改动。
-- 红线：仅 CREATE TYPE / ALTER TABLE ... ADD COLUMN（不重建表、不改既有列、不删列）。

-- 1) 新枚举
CREATE TYPE "EnterpriseQualification" AS ENUM ('TECH_SME', 'INNOVATIVE_SME', 'HIGH_TECH_ENTERPRISE', 'SPECIALIZED_SME', 'LITTLE_GIANT');
CREATE TYPE "EnterpriseOwnershipType" AS ENUM ('STATE_OWNED', 'PRIVATE', 'FOREIGN', 'JOINT');
CREATE TYPE "EnterpriseListingStatus" AS ENUM ('LISTED', 'UNLISTED');

-- 2) BusinessPartner 企业画像列
--    qualifications：枚举数组，NOT NULL DEFAULT 空数组（存量行零回填即得 []=未设置任何资质）
ALTER TABLE "BusinessPartner"
  ADD COLUMN "qualifications" "EnterpriseQualification"[] NOT NULL DEFAULT ARRAY[]::"EnterpriseQualification"[],
  ADD COLUMN "ownershipType" "EnterpriseOwnershipType",
  ADD COLUMN "listingStatus" "EnterpriseListingStatus";
