import type { InvoiceInvoiceType } from '@prisma/client';

/**
 * 增值税发票管理工具（ADR-0043，中国审计 P1）
 * - validateUscc：统一社会信用代码 GB 32100-2015（18 位格式 + 模 31 校验码）
 * - validateTaxInvoiceFields：税务发票代码/号码按发票类型校验（12+8 / 数电 20 位）
 * - normalizeUscc / normalizeTaxNo：存储前归一化（去空格/全角转半角/统一大写）
 */

/** GB 32100-2015 字符映射表（31 字符，剔除 I/O/S/V/Z） */
const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
/** GB 32100-2015 加权因子（18 位中前 17 位） */
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
const USCC_FORMAT = /^[0-9A-HJ-NPQRTUWXY]{18}$/;

/** 归一化：全角→半角、去空白、统一大写 */
export function normalizeUscc(raw: string): string {
  return raw
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * 校验统一社会信用代码（GB 32100-2015）：
 * 1) 格式：18 位，字符集 0-9+A-Z（剔除 I/O/S/V/Z），末位允许 X；
 * 2) 校验码：前 17 位按加权因子模 31，与第 18 位比对。
 * 返回 true = 合法。
 */
export function validateUscc(raw: string): boolean {
  const uscc = normalizeUscc(raw);
  if (!USCC_FORMAT.test(uscc)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const idx = USCC_CHARS.indexOf(uscc[i]);
    if (idx === -1) return false;
    sum += idx * USCC_WEIGHTS[i];
  }
  // GB 32100-2015：C18 = 字符集[(31 - (Σ mod 31)) mod 31]——余数为 0 时取字符集[0]='0'（原实现越界 → 合法 '0' 校验码误报）
  const checkChar = USCC_CHARS[(31 - (sum % 31)) % 31];
  return uscc[17] === checkChar;
}

/** 归一化税务发票号码（去空格/连字符/全角转半角） */
export function normalizeTaxInvoiceNumber(raw: string): string {
  return raw
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '');
}

export type TaxInvoiceValidationResult =
  | { ok: true }
  | { ok: false; code: 'TAX_INVOICE_CODE_INVALID' | 'TAX_INVOICE_NO_INVALID' | 'INVOICE_TYPE_REQUIRED'; message: string };

/**
 * 按发票类型校验税务发票代码/号码（I7）：
 * - SPECIAL_VAT / ORDINARY_VAT：code ^[0-9]{12}$ + no ^[0-9]{8}$（必须同时提供）
 * - ELECTRONIC_VAT：code 必须为空 + no ^[0-9]{20}$
 * - EXPORT / OTHER：可空（不强制）
 * - invoiceType 为空：开票动作必须显式提供（I4）
 */
export function validateTaxInvoiceFields(
  invoiceType: InvoiceInvoiceType | null | undefined,
  taxInvoiceCode: string | null | undefined,
  taxInvoiceNo: string | null | undefined,
): TaxInvoiceValidationResult {
  if (!invoiceType) {
    return { ok: false, code: 'INVOICE_TYPE_REQUIRED', message: '开票时必须指定发票类型（专票/普票/数电票/出口/其他）' };
  }
  if (invoiceType === 'EXPORT' || invoiceType === 'OTHER') {
    return { ok: true }; // 出口/其他不强制税务号码
  }
  const code = taxInvoiceCode == null ? '' : normalizeTaxInvoiceNumber(taxInvoiceCode);
  const no = taxInvoiceNo == null ? '' : normalizeTaxInvoiceNumber(taxInvoiceNo);
  if (invoiceType === 'ELECTRONIC_VAT') {
    if (code !== '') {
      return { ok: false, code: 'TAX_INVOICE_CODE_INVALID', message: '数电票无 12 位发票代码（taxInvoiceCode 必须为空）' };
    }
    if (!/^[0-9]{20}$/.test(no)) {
      return { ok: false, code: 'TAX_INVOICE_NO_INVALID', message: '数电票号码须为 20 位数字' };
    }
    return { ok: true };
  }
  if (!/^[0-9]{12}$/.test(code)) {
    return { ok: false, code: 'TAX_INVOICE_CODE_INVALID', message: '专票/普票发票代码须为 12 位数字' };
  }
  if (!/^[0-9]{8}$/.test(no)) {
    return { ok: false, code: 'TAX_INVOICE_NO_INVALID', message: '专票/普票发票号码须为 8 位数字' };
  }
  return { ok: true };
}
