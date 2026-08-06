-- Sprint 3C-5 Project Foundation Enhancement（仅新增/加列，不重建 14 个既有 Project 模型）
-- CTO #3C5 决策：Project 最小增量 priority+progressPercent；ProjectProduct.priceSnapshotId（SetNull）；
-- ProjectTag 复用全局 Tag 主数据（与 CustomerTag/PartnerTag/ItemTag 同构）。

-- AlterTable: Project 补字段（最小增量，不加 stageChanged*）
ALTER TABLE "Project" ADD COLUMN "priority" TEXT,
ADD COLUMN "progressPercent" DECIMAL(5,2);

-- AlterTable: ProjectProduct 增加价格快照引用（可空，不复制价格字段）
ALTER TABLE "ProjectProduct" ADD COLUMN "priceSnapshotId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectProduct_priceSnapshotId_idx" ON "ProjectProduct"("priceSnapshotId");

-- CreateTable: ProjectTag（复用全局 Tag 主数据）
CREATE TABLE "ProjectTag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ProjectTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTag_projectId_tagId_key" ON "ProjectTag"("projectId", "tagId");

-- CreateIndex
CREATE INDEX "ProjectTag_projectId_idx" ON "ProjectTag"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTag_tagId_idx" ON "ProjectTag"("tagId");

-- CreateIndex
CREATE INDEX "ProjectTag_deletedAt_idx" ON "ProjectTag"("deletedAt");

-- AddForeignKey: ProjectProduct → QuotationPriceSnapshot（SetNull：快照软删/归档不阻断项目读取）
ALTER TABLE "ProjectProduct" ADD CONSTRAINT "ProjectProduct_priceSnapshotId_fkey" FOREIGN KEY ("priceSnapshotId") REFERENCES "QuotationPriceSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProjectTag → Project（Cascade）
ALTER TABLE "ProjectTag" ADD CONSTRAINT "ProjectTag_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ProjectTag → Tag（Cascade）
ALTER TABLE "ProjectTag" ADD CONSTRAINT "ProjectTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
