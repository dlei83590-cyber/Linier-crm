-- Sprint 7 Finance（CTO 解锁 2026-08-20）：0034_gl_manual_entry — GL 手工凭证录入 + 审核流
--
-- 范围（ADR-0035）：GlJournalEntry.voucherNo 改可空（手工凭证 DRAFT 不占号，POSTED 时取号——4D 教训）+ approvedAt/approvedById（maker-checker 审核投影）。
-- 红线：只放宽列 + 加列；自动过账路径不变（POSTED 一次性）。

ALTER TABLE "GlJournalEntry" ALTER COLUMN "voucherNo" DROP NOT NULL;
ALTER TABLE "GlJournalEntry" ADD COLUMN "approvedAt" TIMESTAMPTZ(3);
ALTER TABLE "GlJournalEntry" ADD COLUMN "approvedById" TEXT;
