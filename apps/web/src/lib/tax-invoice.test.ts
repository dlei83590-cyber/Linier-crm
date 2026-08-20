import { describe, it, expect } from 'vitest';
import { validateUscc, validateTaxInvoiceFields, normalizeUscc } from '@/lib/tax-invoice';

/**
 * Sprint 7 VAT 发票管理（ADR-0043）校验单测
 * 覆盖：uscc GB 32100-2015（合法/校验码错误/字符集非法/长度边界）、税务号码格式（12+8/数电 20/EXPORT 可空）。
 */

// 合法示例（GB 32100-2015 校验码计算通过）：91110000MA01B8KX49（校验码 9）
const VALID_USCC = '91110000MA01B8KX49';

describe('validateUscc — GB 32100-2015', () => {
  it('合法 18 位通过', () => {
    expect(validateUscc(VALID_USCC)).toBe(true);
  });
  it('小写/带空格归一化后通过', () => {
    expect(validateUscc(' ' + VALID_USCC.toLowerCase() + ' ')).toBe(true);
  });
  it('校验码错误拒绝', () => {
    expect(validateUscc('91110000MA01B8KX40')).toBe(false); // 末位 0 ≠ 校验码 9
  });
  it('校验码错误拒绝（旧示例）', () => {
    expect(validateUscc('91110000MA01B8KX4Y')).toBe(false); // 末位改 Y
  });
  it('字符集非法（含 I/O/S/V/Z）拒绝', () => {
    expect(validateUscc('91110000SA01B8KX4X')).toBe(false);
  });
  it('长度边界：17 位 / 19 位拒绝', () => {
    expect(validateUscc('91110000MA01B8KX4')).toBe(false);
    expect(validateUscc(VALID_USCC + '0')).toBe(false);
  });
  it('空/非数字字符拒绝', () => {
    expect(validateUscc('')).toBe(false);
    expect(validateUscc('91110000MA01B8KX4!')).toBe(false);
  });
});

describe('validateTaxInvoiceFields — 税务号码格式（I7）', () => {
  it('专票 12+8 通过', () => {
    expect(validateTaxInvoiceFields('SPECIAL_VAT', '110020001234', '12345678')).toEqual({ ok: true });
  });
  it('普票 12+8 通过', () => {
    expect(validateTaxInvoiceFields('ORDINARY_VAT', '110020001234', '12345678')).toEqual({ ok: true });
  });
  it('数电票 20 位且 code 为空通过', () => {
    expect(validateTaxInvoiceFields('ELECTRONIC_VAT', null, '12345678901234567890')).toEqual({ ok: true });
  });
  it('数电票带 code 拒绝', () => {
    const r = validateTaxInvoiceFields('ELECTRONIC_VAT', '110020001234', '12345678901234567890');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TAX_INVOICE_CODE_INVALID');
  });
  it('专票 code 11 位拒绝', () => {
    const r = validateTaxInvoiceFields('SPECIAL_VAT', '11002000123', '12345678');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TAX_INVOICE_CODE_INVALID');
  });
  it('专票号码 7 位拒绝', () => {
    const r = validateTaxInvoiceFields('SPECIAL_VAT', '110020001234', '1234567');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TAX_INVOICE_NO_INVALID');
  });
  it('EXPORT 可空通过', () => {
    expect(validateTaxInvoiceFields('EXPORT', null, null)).toEqual({ ok: true });
  });
  it('类型缺失 → INVOICE_TYPE_REQUIRED（I4 fail-closed）', () => {
    const r = validateTaxInvoiceFields(null, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVOICE_TYPE_REQUIRED');
  });
});
