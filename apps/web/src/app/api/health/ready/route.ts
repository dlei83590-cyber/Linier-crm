import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Readiness probe（Phase R1 — Health Contract Repair）
 *
 * 必须全部通过才返回 200；任一失败 → HTTP 503（结构化错误，不泄露 stack）：
 * 1. database reachable + Prisma query 可执行（SELECT 1）
 * 2. schema/migration baseline：DB `_prisma_migrations` 最新已应用 migration
 *    >= 仓库 prisma/migrations 最新目录（0028_grir_historical_fact_backfill）
 * 3. build metadata 存在（NEXT_PUBLIC_APP_VERSION/GIT_SHA/BUILD_ID/DEPLOYMENT_ENV）
 *
 * 废除旧 /api/health 的“静态永远 200 + database:pending”假健康设计：
 * Railway production readiness/deployment Gate 应使用本端点。
 */

async function latestMigrationInRepo(): Promise<string | null> {
  try {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    const entries = await readdir(dir);
    const names = entries
      .filter((e) => !e.startsWith("migration_lock") && !e.startsWith("."))
      .sort();
    return names[names.length - 1] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const checks = {
    database: false,
    migrationBaseline: false,
    buildMetadata: false,
  };
  let databaseErrorType: string | null = null;
  let appliedMigration: string | null = null;
  const expectedMigration = await latestMigrationInRepo();

  // 1) DB reachable + Prisma query 可执行
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (e) {
    databaseErrorType = e instanceof Error ? e.name : "UNKNOWN";
  }

  // 2) migration baseline：DB 最新已应用 migration >= 仓库最新 migration
  if (checks.database) {
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1
      `;
      appliedMigration = rows[0]?.migration_name ?? null;
      checks.migrationBaseline =
        expectedMigration !== null &&
        appliedMigration !== null &&
        appliedMigration >= expectedMigration;
    } catch {
      checks.migrationBaseline = false;
    }
  }

  // 3) build metadata 存在
  checks.buildMetadata = Boolean(
    process.env.NEXT_PUBLIC_APP_VERSION &&
      process.env.NEXT_PUBLIC_GIT_SHA &&
      process.env.NEXT_PUBLIC_BUILD_ID &&
      process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
  );

  const ready = checks.database && checks.migrationBaseline && checks.buildMetadata;

  const base = {
    service: "linier-crm",
    database: checks.database ? "ok" : "unreachable",
    ...(databaseErrorType ? { databaseErrorType } : {}),
    migrationBaseline: checks.migrationBaseline,
    expectedMigration,
    appliedMigration,
    buildMetadata: checks.buildMetadata,
    timestamp: new Date().toISOString(),
  };

  if (!ready) {
    return NextResponse.json({ status: "unready", ...base }, { status: 503 });
  }

  return NextResponse.json({ status: "ok", ...base });
}
