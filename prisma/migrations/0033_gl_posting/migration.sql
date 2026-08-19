-- Sprint 7 Finance 首块（CTO 解锁 2026-08-20）：0033_gl_posting — GL 过账消费 5C 事件
--
-- 范围（ADR-0033）：会计科目（GlAccount）+ 记账凭证头行（GlJournalEntry/GlJournalEntryLine）
-- 红线：POSTED 一次性终态不可变；sourceType+sourceId @unique 幂等防重复过账；不建余额/试算表（后续 backlog）。

-- 1) 科目类别枚举
CREATE TYPE "GlAccountCategory" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "GlAccountDirection" AS ENUM ('DEBIT', 'CREDIT');

-- 2) 会计科目
CREATE TABLE "GlAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "GlAccountCategory" NOT NULL,
    "direction" "GlAccountDirection" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GlAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlAccount_code_key" ON "GlAccount"("code");
CREATE INDEX "GlAccount_category_idx" ON "GlAccount"("category");
CREATE INDEX "GlAccount_deletedAt_idx" ON "GlAccount"("deletedAt");

-- 3) 记账凭证头
CREATE TABLE "GlJournalEntry" (
    "id" TEXT NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "postingDate" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "summary" TEXT,
    "createdById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GlJournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlJournalEntry_voucherNo_key" ON "GlJournalEntry"("voucherNo");
CREATE UNIQUE INDEX "GlJournalEntry_sourceType_sourceId_key" ON "GlJournalEntry"("sourceType", "sourceId");
CREATE INDEX "GlJournalEntry_postingDate_idx" ON "GlJournalEntry"("postingDate");
CREATE INDEX "GlJournalEntry_sourceType_idx" ON "GlJournalEntry"("sourceType");
CREATE INDEX "GlJournalEntry_deletedAt_idx" ON "GlJournalEntry"("deletedAt");

-- 4) 记账凭证行
CREATE TABLE "GlJournalEntryLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "summary" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GlJournalEntryLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GlJournalEntryLine_entryId_idx" ON "GlJournalEntryLine"("entryId");
CREATE INDEX "GlJournalEntryLine_accountId_idx" ON "GlJournalEntryLine"("accountId");

ALTER TABLE "GlJournalEntryLine" ADD CONSTRAINT "GlJournalEntryLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "GlJournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GlJournalEntryLine" ADD CONSTRAINT "GlJournalEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GlAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) 标准中国会计科目最小集（seed 同源；fail closed——过账映射依赖这些 code）
INSERT INTO "GlAccount" ("id", "code", "name", "category", "direction", "remark", "createdAt", "updatedAt") VALUES
  ('glacct-1001', '1001', '库存现金', 'ASSET', 'DEBIT', '现金', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('glacct-1002', '1002', '银行存款', 'ASSET', 'DEBIT', 'GL_ACCOUNT_BANK', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('glacct-1403', '1403', '原材料', 'ASSET', 'DEBIT', 'GL_ACCOUNT_PURCHASE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('glacct-2202', '2202', '应付账款', 'LIABILITY', 'CREDIT', 'GL_ACCOUNT_AP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('glacct-222101', '222101', '应交税费-应交增值税-进项税额', 'LIABILITY', 'CREDIT', 'GL_ACCOUNT_TAX_INPUT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('glacct-6111', '6111', '采购调整', 'EXPENSE', 'DEBIT', 'GL_ACCOUNT_ADJUST', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);