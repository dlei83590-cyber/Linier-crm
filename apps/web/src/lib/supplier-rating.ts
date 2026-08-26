/**
 * cc-06 客户等级→供应商评级匹配（Contract Close）共享常量
 *
 * - 客户等级复用 CustomerLevel 枚举（VIP/KEY/REGULAR/PROSPECT）——不造平行枚举
 * - 供应商评级复用 CustomerCreditRating 枚举（PartnerCredit.rating canonical 取值）——不造平行评级
 * - RATING_RANK 是评级的有序语义（AAA 最高 → C 最低），规则门槛过滤与推荐排序共用同一实现
 */
export const CUSTOMER_LEVELS = ["VIP", "KEY", "REGULAR", "PROSPECT"] as const;
export type CustomerLevelValue = (typeof CUSTOMER_LEVELS)[number];

export const SUPPLIER_RATINGS = ["AAA", "AA", "A", "BBB", "BB", "B", "C"] as const;
export type SupplierRatingValue = (typeof SUPPLIER_RATINGS)[number];

/** 评级有序语义（AAA=7 最高 → C=1 最低）；未知评级 → 0（视为不满足门槛） */
export const RATING_RANK: Record<string, number> = { AAA: 7, AA: 6, A: 5, BBB: 4, BB: 3, B: 2, C: 1 };

export function ratingRank(rating: string | null | undefined): number {
  return rating ? RATING_RANK[rating] ?? 0 : 0;
}

export const CUSTOMER_LEVEL_LABELS: Record<string, string> = {
  VIP: "VIP",
  KEY: "重点",
  REGULAR: "普通",
  PROSPECT: "潜在",
};

export const SUPPLIER_RATING_LABELS: Record<string, string> = {
  AAA: "AAA",
  AA: "AA",
  A: "A",
  BBB: "BBB",
  BB: "BB",
  B: "B",
  C: "C",
};
