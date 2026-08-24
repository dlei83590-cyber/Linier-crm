/**
 * Phase 2B — BusinessPartner 查重共享匹配服务（Preflight 与 Create Guard 共用，CTO §B.2）
 *
 * 零 Schema / 零 Migration：基于既有 BusinessPartner / PartnerContact 字段 + 服务端函数。
 *
 * 语义（CTO §C/E/F，锁定版）：
 * - EXACT（USCC）：全库匹配（active/inactive/soft-deleted 均算；DB @unique 不因 deletedAt 释放）。
 *   soft-deleted → reason USCC_EXACT_DELETED（提示恢复/处理原主体，不能重复新建）。
 * - POTENTIAL：只扫 deletedAt=null 的 BP（inactive 仍提示，停用≠法律主体不存在）+ 有效联系人。
 *   NAME_EXACT / PARTNER_PHONE_EXACT / CONTACT_PHONE_EXACT / CONTACT_MOBILE_EXACT。
 * - 整体级别 EXACT > POTENTIAL > NONE；matches 上限 10，但 EXACT 检测不得被上限截断。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeUscc, normalizeCompanyName, normalizePhone } from "./normalize";

export type DuplicateMatchReason =
  | "USCC_EXACT"
  | "USCC_EXACT_DELETED"
  | "NAME_EXACT"
  | "PARTNER_PHONE_EXACT"
  | "CONTACT_PHONE_EXACT"
  | "CONTACT_MOBILE_EXACT";

export type DuplicateLevel = "EXACT" | "POTENTIAL" | "NONE";

export interface DuplicateMatch {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isDeleted: boolean;
  phoneMasked: string | null;
  usccMasked: string | null;
  matchReasons: DuplicateMatchReason[];
  level: DuplicateLevel;
}

export interface DuplicateCheckInput {
  name?: string;
  uscc?: string;
  phone?: string;
  contactMobile?: string;
  contactName?: string;
  excludePartnerId?: string;
}

export interface DuplicateCheckResult {
  duplicateLevel: DuplicateLevel;
  matches: DuplicateMatch[];
}

/** matches 返回上限（CTO §F）；EXACT 阶段独立全量判定，不受此限 */
export const MAX_MATCHES = 10;
/** POTENTIAL 粗筛候选上限（防异常数据放大） */
const POTENTIAL_CANDIDATE_LIMIT = 500;

const bpProjection = {
  id: true,
  code: true,
  name: true,
  type: true,
  isActive: true,
  uscc: true,
  phone: true,
  deletedAt: true,
} as const;

type BpProjection = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  uscc: string | null;
  phone: string | null;
  deletedAt: Date | null;
};

/** 掩码电话：13812340000 → 138****0000；+86 前缀保留 */
export function maskPhone(phone: string): string {
  const v = phone.normalize("NFKC").replace(/[\s\-()（）]/g, "");
  if (v.length <= 7) return v.slice(0, 2) + "****";
  return v.slice(0, 3) + "****" + v.slice(-4);
}

/** 掩码 USCC：91310000MA1K35L88U → 9131****88U */
export function maskUscc(uscc: string): string {
  const v = normalizeUscc(uscc);
  if (v.length <= 8) return v.slice(0, 4) + "****";
  return v.slice(0, 4) + "****" + v.slice(-3);
}

function toMatch(b: BpProjection, reasons: DuplicateMatchReason[], level: DuplicateLevel): DuplicateMatch {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    type: b.type,
    isActive: b.isActive,
    isDeleted: b.deletedAt !== null,
    phoneMasked: b.phone ? maskPhone(b.phone) : null,
    usccMasked: b.uscc ? maskUscc(b.uscc) : null,
    matchReasons: reasons,
    level,
  };
}

/**
 * 共享 matcher：先判 USCC EXACT（全库），再算 POTENTIAL（仅 active 主体）。
 * Preflight 与 Create Guard 必须都调用本函数（禁止两套规则）。
 */
export async function findBusinessPartnerDuplicates(
  input: DuplicateCheckInput,
): Promise<DuplicateCheckResult> {
  const usccNorm = input.uscc ? normalizeUscc(input.uscc) : "";
  const nameNorm = input.name ? normalizeCompanyName(input.name) : "";
  const phoneNorm = input.phone ? normalizePhone(input.phone) : "";
  const contactMobileNorm = input.contactMobile ? normalizePhone(input.contactMobile) : "";
  const exclude = input.excludePartnerId;
  const excludeWhere: Prisma.BusinessPartnerWhereInput | undefined = exclude
    ? { id: { not: exclude } }
    : undefined;

  // ① EXACT：USCC 全库（含 soft-deleted）
  if (usccNorm) {
    const exact = await prisma.businessPartner.findMany({
      where: { uscc: usccNorm, ...excludeWhere },
      select: bpProjection,
      take: MAX_MATCHES + 1,
    });
    if (exact.length > 0) {
      return {
        duplicateLevel: "EXACT",
        matches: exact
          .slice(0, MAX_MATCHES)
          .map((b) => toMatch(b, b.deletedAt ? ["USCC_EXACT_DELETED"] : ["USCC_EXACT"], "EXACT")),
      };
    }
  }

  // ② POTENTIAL：deletedAt=null 的 BP（inactive 仍提示）
  const byPartner = new Map<string, { bp: BpProjection; reasons: Set<DuplicateMatchReason> }>();

  const nameSeed = nameNorm ? nameNorm.slice(0, 6) : "";
  const phoneSeed = phoneNorm ? phoneNorm.slice(0, 3) : "";

  if (nameSeed || phoneSeed) {
    const bpCandidates = await prisma.businessPartner.findMany({
      where: {
        deletedAt: null,
        ...excludeWhere,
        OR: [
          ...(nameSeed ? [{ name: { contains: nameSeed, mode: "insensitive" as const } }] : []),
          ...(phoneSeed ? [{ phone: { contains: phoneSeed, mode: "insensitive" as const } }] : []),
        ],
      },
      select: bpProjection,
      take: POTENTIAL_CANDIDATE_LIMIT,
    });
    for (const c of bpCandidates) {
      if (c.deletedAt) continue; // POTENTIAL 只扫有效主体（查询层已过滤，应用层防御）
      const reasons: DuplicateMatchReason[] = [];
      if (nameNorm && c.name && normalizeCompanyName(c.name) === nameNorm) reasons.push("NAME_EXACT");
      if (phoneNorm && c.phone && normalizePhone(c.phone) === phoneNorm) reasons.push("PARTNER_PHONE_EXACT");
      if (reasons.length > 0) {
        const existing = byPartner.get(c.id);
        if (existing) reasons.forEach((r) => existing.reasons.add(r));
        else byPartner.set(c.id, { bp: c, reasons: new Set(reasons) });
      }
    }
  }

  // ③ POTENTIAL：有效联系人（deletedAt=null && isActive）的 phone/mobile
  const contactSeed = phoneNorm ? phoneNorm.slice(0, 3) : "";
  const mobileSeed = contactMobileNorm ? contactMobileNorm.slice(0, 3) : "";
  const anyContactSeed = contactSeed || mobileSeed;

  if (anyContactSeed) {
    const contactCandidates = await prisma.partnerContact.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(exclude
          ? { partner: { deletedAt: null, id: { not: exclude } } }
          : { partner: { deletedAt: null } }),
        OR: [
          ...(contactSeed ? [{ phone: { contains: contactSeed } }] : []),
          ...(contactSeed ? [{ mobile: { contains: contactSeed } }] : []),
          ...(mobileSeed ? [{ phone: { contains: mobileSeed } }] : []),
          ...(mobileSeed ? [{ mobile: { contains: mobileSeed } }] : []),
        ],
      },
      select: {
        partnerId: true,
        phone: true,
        mobile: true,
        partner: { select: bpProjection },
      },
      take: POTENTIAL_CANDIDATE_LIMIT,
    });
    for (const pc of contactCandidates) {
      const reasons: DuplicateMatchReason[] = [];
      if (pc.phone) {
        const pn = normalizePhone(pc.phone);
        if (phoneNorm && pn === phoneNorm) reasons.push("CONTACT_PHONE_EXACT");
        if (contactMobileNorm && pn === contactMobileNorm) reasons.push("CONTACT_PHONE_EXACT");
      }
      if (pc.mobile) {
        const mn = normalizePhone(pc.mobile);
        if (phoneNorm && mn === phoneNorm) reasons.push("CONTACT_MOBILE_EXACT");
        if (contactMobileNorm && mn === contactMobileNorm) reasons.push("CONTACT_MOBILE_EXACT");
      }
      if (reasons.length > 0) {
        const existing = byPartner.get(pc.partnerId);
        if (existing) reasons.forEach((r) => existing.reasons.add(r));
        else byPartner.set(pc.partnerId, { bp: pc.partner, reasons: new Set(reasons) });
      }
    }
  }

  if (byPartner.size === 0) {
    return { duplicateLevel: "NONE", matches: [] };
  }

  const matches: DuplicateMatch[] = [...byPartner.entries()]
    .map(([, v]) => toMatch(v.bp, [...v.reasons], "POTENTIAL"))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
    .slice(0, MAX_MATCHES);

  return { duplicateLevel: "POTENTIAL", matches };
}
