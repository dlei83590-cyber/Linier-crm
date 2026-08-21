-- ============================================================
-- 0045 销售贷/借项（CN/DN）反冲减 + 发票红冲支持
-- 背景：CN/DN APPLIED 后可反向撤销（InvoiceAdjustment.reversedAt 预留字段启用）：
--   ① CreditDebitNoteStatus 新增 REVERSED（反冲后状态）
-- 仅改枚举，不重建表。
-- ============================================================

ALTER TYPE "CreditDebitNoteStatus" ADD VALUE 'REVERSED';
