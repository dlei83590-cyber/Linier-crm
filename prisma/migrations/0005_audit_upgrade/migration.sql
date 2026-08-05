-- Sprint 3B - Audit Center 升级：AuditLog 增加 ObjectType/ObjectId 语义字段 + Before/AfterData + RequestId/TraceId + Device/Browser/Duration/Result
-- 策略：AuditLog 表已存在（0001），本迁移仅 ALTER 加列 + 建索引，不重建表（CTO 规则：已上线迁移禁止修改）

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'PARTIAL');

-- AlterTable
ALTER TABLE "AuditLog"
    ADD COLUMN "beforeData" JSONB,
    ADD COLUMN "afterData" JSONB,
    ADD COLUMN "requestId" TEXT,
    ADD COLUMN "traceId" TEXT,
    ADD COLUMN "device" TEXT,
    ADD COLUMN "browser" TEXT,
    ADD COLUMN "duration" INTEGER,
    ADD COLUMN "result" "AuditResult" NOT NULL DEFAULT 'SUCCESS';

-- CreateIndex
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX "AuditLog_traceId_idx" ON "AuditLog"("traceId");
CREATE INDEX "AuditLog_result_idx" ON "AuditLog"("result");
