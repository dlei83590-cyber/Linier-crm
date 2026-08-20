"use client";

/**
 * 增值税发票前端标签/格式化（ADR-0043 前端接线）
 */

export const INVOICE_TYPE_LABELS: Record<string, string> = {
  SPECIAL_VAT: "增值税专用发票",
  ORDINARY_VAT: "增值税普通发票",
  ELECTRONIC_VAT: "数电票",
  EXPORT: "出口发票",
  OTHER: "其他",
};

export const INVOICE_TYPE_OPTIONS = Object.entries(INVOICE_TYPE_LABELS).map(([value, label]) => ({ value, label }));

/** 凭证字（ADR-0044） */
export const VOUCHER_TYPE_LABELS: Record<string, string> = {
  GENERAL: "记",
  RECEIPT: "收",
  PAYMENT: "付",
  TRANSFER: "转",
};

export const VOUCHER_TYPE_OPTIONS = Object.entries(VOUCHER_TYPE_LABELS).map(([value, label]) => ({ value, label }));

/** 税务发票号码展示（12 位代码-8 位号码 / 数电 20 位） */
export function formatTaxInvoiceNumber(code?: string | null, no?: string | null): string {
  if (!no) return "—";
  if (code) return `${code}-${no}`;
  return no;
}

/** 开票表单前端校验（与后端 I7 对齐）：返回错误文案或 null */
export function validateIssueVatFields(
  invoiceType: string,
  taxInvoiceCode: string,
  taxInvoiceNo: string,
): string | null {
  if (invoiceType === "EXPORT" || invoiceType === "OTHER") return null;
  if (invoiceType === "ELECTRONIC_VAT") {
    if (taxInvoiceCode) return "数电票无 12 位发票代码，代码必须为空";
    if (!/^[0-9]{20}$/.test(taxInvoiceNo)) return "数电票号码须为 20 位数字";
    return null;
  }
  if (!/^[0-9]{12}$/.test(taxInvoiceCode)) return "发票代码须为 12 位数字";
  if (!/^[0-9]{8}$/.test(taxInvoiceNo)) return "发票号码须为 8 位数字";
  return null;
}
