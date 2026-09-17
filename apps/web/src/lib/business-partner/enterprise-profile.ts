/**
 * 往来单位企业画像 — BusinessPartner 企业资质 / 所有制性质 / 上市状态 SSOT
 *
 * 固定枚举第一版（用户指令「往来单位 修改二」2026-09-17，Migration 0057）：
 * - qualifications（企业资质）：政府/主管部门认定的企业资格，多选（勾选）；扩展需追加枚举值 + Migration。
 * - ownershipType（所有制性质）与 listingStatus（上市状态）：两个独立维度（用户确认拆分），各自单选。
 * 服务端 z.enum 校验 fail closed；前端 Create/Edit 勾选 + 详情展示共用本清单，禁止两处漂移。
 * 红线：不复用 SupplierQualification（供应商认证资质=ISO9001 等，含证书号/有效期/附件，另一维度）。
 */

/** 企业资质（政府认定资格；BusinessPartner.qualifications 多选） */
export const ENTERPRISE_QUALIFICATIONS = [
  "TECH_SME",
  "INNOVATIVE_SME",
  "HIGH_TECH_ENTERPRISE",
  "SPECIALIZED_SME",
  "LITTLE_GIANT",
] as const;

export type EnterpriseQualification = (typeof ENTERPRISE_QUALIFICATIONS)[number];

export const ENTERPRISE_QUALIFICATION_LABELS: Record<EnterpriseQualification, string> = {
  TECH_SME: "科技型中小企业",
  INNOVATIVE_SME: "创新型中小企业",
  HIGH_TECH_ENTERPRISE: "高新技术企业",
  SPECIALIZED_SME: "专精特新中小企业",
  LITTLE_GIANT: "专精特新「小巨人」企业",
};

/** 所有制性质（BusinessPartner.ownershipType 单选） */
export const ENTERPRISE_OWNERSHIP_TYPES = ["STATE_OWNED", "PRIVATE", "FOREIGN", "JOINT"] as const;

export type EnterpriseOwnershipType = (typeof ENTERPRISE_OWNERSHIP_TYPES)[number];

export const ENTERPRISE_OWNERSHIP_LABELS: Record<EnterpriseOwnershipType, string> = {
  STATE_OWNED: "国有",
  PRIVATE: "私企",
  FOREIGN: "外资",
  JOINT: "合资",
};

/** 上市状态（BusinessPartner.listingStatus 单选） */
export const ENTERPRISE_LISTING_STATUSES = ["LISTED", "UNLISTED"] as const;

export type EnterpriseListingStatus = (typeof ENTERPRISE_LISTING_STATUSES)[number];

export const ENTERPRISE_LISTING_LABELS: Record<EnterpriseListingStatus, string> = {
  LISTED: "上市",
  UNLISTED: "非上市",
};

/** 勾选组选项（前端 Create/Edit 共用；顺序 = 枚举声明顺序） */
export const ENTERPRISE_QUALIFICATION_OPTIONS = ENTERPRISE_QUALIFICATIONS.map((v) => ({
  value: v,
  label: ENTERPRISE_QUALIFICATION_LABELS[v],
}));

export const ENTERPRISE_OWNERSHIP_OPTIONS = ENTERPRISE_OWNERSHIP_TYPES.map((v) => ({
  value: v,
  label: ENTERPRISE_OWNERSHIP_LABELS[v],
}));

export const ENTERPRISE_LISTING_OPTIONS = ENTERPRISE_LISTING_STATUSES.map((v) => ({
  value: v,
  label: ENTERPRISE_LISTING_LABELS[v],
}));

/** 企业资质 code → 中文标签（未知 code 回退原值，前端展示用） */
export function enterpriseQualificationLabel(code: string): string {
  return ENTERPRISE_QUALIFICATION_LABELS[code as EnterpriseQualification] ?? code;
}

/** 所有制性质 code → 中文标签 */
export function enterpriseOwnershipLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ENTERPRISE_OWNERSHIP_LABELS[code as EnterpriseOwnershipType] ?? code;
}

/** 上市状态 code → 中文标签 */
export function enterpriseListingLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return ENTERPRISE_LISTING_LABELS[code as EnterpriseListingStatus] ?? code;
}
