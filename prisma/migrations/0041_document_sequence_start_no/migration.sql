-- Migration 0041 — DocumentSequence 起始序号/当前序号可调整（用户需求：单据序列可编辑删除、起始序号、当前序号可改）

-- AlterTable DocumentSequence（起始序号；nextNo 语义：当前序号，管理员可调整）
ALTER TABLE "DocumentSequence"
  ADD COLUMN "startNo" INTEGER NOT NULL DEFAULT 1;
