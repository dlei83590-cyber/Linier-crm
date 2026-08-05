-- Sprint 3B - Dashboard API：Widget / Layout / KPI / Chart（只提供数据 API，页面以后开发）
-- 策略：仅新增表，不修改既有表（CTO 规则）

-- CreateEnum
CREATE TYPE "DashboardWidgetType" AS ENUM ('KPI', 'CHART', 'TABLE');

-- CreateEnum
CREATE TYPE "DashboardChartType" AS ENUM ('LINE', 'BAR', 'PIE', 'AREA', 'SCATTER');

-- CreateEnum
CREATE TYPE "DashboardAggregate" AS ENUM ('SUM', 'AVG', 'COUNT', 'MIN', 'MAX');

-- CreateTable
CREATE TABLE "DashboardWidget" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widgetType" "DashboardWidgetType" NOT NULL DEFAULT 'KPI',
    "dataSource" TEXT,
    "query" JSONB,
    "refreshInterval" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DashboardWidget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "grid" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardKpi" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "aggregate" "DashboardAggregate" NOT NULL DEFAULT 'SUM',
    "dataSource" TEXT,
    "query" JSONB,
    "target" DECIMAL(18,2),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DashboardKpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardChart" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chartType" "DashboardChartType" NOT NULL DEFAULT 'LINE',
    "dataSource" TEXT,
    "query" JSONB,
    "xAxis" TEXT,
    "yAxis" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3) WITH TIME ZONE,
    "createdAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) WITH TIME ZONE NOT NULL,

    CONSTRAINT "DashboardChart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardWidget_code_key" ON "DashboardWidget"("code");
CREATE INDEX "DashboardWidget_deletedAt_idx" ON "DashboardWidget"("deletedAt");

CREATE UNIQUE INDEX "DashboardLayout_code_key" ON "DashboardLayout"("code");
CREATE INDEX "DashboardLayout_deletedAt_idx" ON "DashboardLayout"("deletedAt");

CREATE UNIQUE INDEX "DashboardKpi_code_key" ON "DashboardKpi"("code");
CREATE INDEX "DashboardKpi_deletedAt_idx" ON "DashboardKpi"("deletedAt");

CREATE UNIQUE INDEX "DashboardChart_code_key" ON "DashboardChart"("code");
CREATE INDEX "DashboardChart_deletedAt_idx" ON "DashboardChart"("deletedAt");
