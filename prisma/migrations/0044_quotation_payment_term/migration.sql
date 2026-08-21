-- ============================================================
-- 0044 报价单付款方式（paymentTerm）
-- 背景：报价单新增「付款方式」字段——下拉选项来自商业条款（CommercialTerm.code，如 NET30/FOB/CIF），
--       作为 Quotation.paymentTerm 快照（后续 convert 到 SalesOrder 时继承）。
-- 仅加列，不重建表。
-- ============================================================

ALTER TABLE "Quotation" ADD COLUMN "paymentTerm" TEXT;
