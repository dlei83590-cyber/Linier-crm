-- Sprint 7 Finance（CTO 解锁 2026-08-20）：0035_gl_period_close — GL 期末结转
--
-- 范围（ADR-0036）：GlPeriodClose 表（periodKey @unique 防重复月结；journalEntryId 引用结转凭证）。
-- 红线：只加表；结转分录（收入/费用 → 本年利润）在应用层同事务生成；不手改已过账凭证。

CREATE TABLE "GlPeriodClose" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlPeriodClose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlPeriodClose_periodKey_key" ON "GlPeriodClose"("periodKey");
CREATE UNIQUE INDEX "GlPeriodClose_journalEntryId_key" ON "GlPeriodClose"("journalEntryId");
CREATE INDEX "GlPeriodClose_periodKey_idx" ON "GlPeriodClose"("periodKey");

ALTER TABLE "GlPeriodClose" ADD CONSTRAINT "GlPeriodClose_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "GlJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
