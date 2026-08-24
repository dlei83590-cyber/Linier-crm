/**
 * Phase 2B — BusinessPartner identity normalization（共享服务端函数）
 *
 * 查重 Preflight（duplicate-check API）与 Create Guard（POST /api/business-partners）
 * 必须共用同一套 normalize 函数，禁止两处规则漂移（CTO Directive §B.2）。
 *
 * 规则来源：docs/SPRINTS/Phase2B_Duplicate_Check_Design.md §5
 */
export function normalizeUscc(uscc: string): string {
  // trim + 去除合法格式空格（如 "9131 0000 MA1K 35L 88U"）+ 大写
  return uscc.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * GB 32100-2015：统一社会信用代码 = 18 位大写字母/数字（不含 I/O/S/V/Z）。
 * 入参须已 normalizeUscc（调用方负责）。
 */
export function isValidUscc(uscc: string): boolean {
  return /^[0-9A-HJ-NPQRTUWXY]{18}$/.test(uscc);
}

export function normalizeCompanyName(name: string): string {
  // Unicode NFKC（全角→半角）+ trim + collapse whitespace + Latin case 归一
  // 不删除「有限公司/集团/科技」等法律名称组成部分
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 电话归一化：仅去除显示格式字符（空格 / - / 全角半角括号）。
 * 保留明确国家码语义（+86 不剥离）；禁止简单截取后 11 位导致误报。
 */
export function normalizePhone(phone: string): string {
  return phone.normalize("NFKC").replace(/[\s\-()（）]/g, "");
}
