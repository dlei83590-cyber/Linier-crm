import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  ALL_ACTION_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_PERMISSIONS,
  normalizePermissions,
} from "@nilier-crm/shared";

export const dynamic = "force-dynamic";

/**
 * Readiness probe（Phase R1 — Health Contract Repair）
 *
 * 必须全部通过才返回 200；任一失败 → HTTP 503（结构化错误，不泄露 stack）：
 * 1. database reachable + Prisma query 可执行（SELECT 1）
 * 2. schema/migration baseline：DB `_prisma_migrations` 最新已应用 migration
 *    >= 仓库 prisma/migrations 最新目录（0028_grir_historical_fact_backfill）
 * 3. build metadata 存在（NEXT_PUBLIC_APP_VERSION/GIT_SHA/BUILD_ID/DEPLOYMENT_ENV）
 * 4. RBAC 已初始化（至少一个角色持有权限关联）
 * 5. RBAC 覆盖度（2026-09-27 生产事件，**仅报告、不参与 ready 判定**）：
 *    DB 权限目录与 SUPER_ADMIN 覆盖率必须等于本版本声明的权限码集合。
 *    仅“存在权限关联”不足以判定可用——目录缺码 / SUPER_ADMIN 覆盖率不足时，
 *    表现是**部分接口 403**（如物料表单的分类、供应商下拉 403，而其它模块正常），
 *    这种“部分锁死”既不会被第 4 项发现，也不会在任何页面上产生告警。
 *    ⚠️ 刻意不纳入 ready 判定：本端点可能被平台当作**运行中容器**的健康检查，
 *    若因既有数据陈旧而返回 503，会把“部分接口不可用”升级为整站被摘除（扩大故障面）。
 *    运维判定以 `rbac.catalogComplete === true && rbac.superAdminComplete === true` 为准
 *    （见 docs/runbooks/Deploy_Update_Runbook.md §2）。
 *
 * 废除旧 /api/health 的“静态永远 200 + database:pending”假健康设计：
 * Railway production readiness/deployment Gate 应使用本端点。
 */

async function latestMigrationInRepo(): Promise<string | null> {
  // Next.js standalone 运行时会把 cwd 切到 server 目录（如 /app/apps/web），
  // 而 prisma/migrations 位于仓库根（如 /app/prisma/migrations）。
  // 从 cwd 向上逐级查找，兼容 standalone 容器与本地开发两种布局。
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, "prisma", "migrations");
    try {
      const entries = await readdir(candidate);
      const names = entries
        .filter((e) => !e.startsWith("migration_lock") && !e.startsWith("."))
        .sort();
      if (names.length > 0) return names[names.length - 1] ?? null;
    } catch {
      // 当前层级没有 prisma/migrations，继续向上一级
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function GET() {
  const checks = {
    database: false,
    migrationBaseline: false,
    buildMetadata: false,
    // ADR-0057（2026-09-20 生产事件）：DB 权限集是鉴权权威，未回填 = 全员无权限（fail-closed）
    rbacInitialized: false,
  };
  let rolesWithPermissions = 0;
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
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC LIMIT 1
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

  // 4) RBAC 初始化（ADR-0057）：至少一个角色持有权限关联，才说明内置角色回填已执行。
  //    若为 0，则本版本（P2 起）对外表现为"所有用户无任何权限"——必须显式 unready，
  //    避免以"静默锁死"（全员 403 / 导航只剩仪表盘）的形式暴露为业务故障。
  if (checks.database) {
    try {
      rolesWithPermissions = await prisma.role.count({ where: { permissions: { some: {} } } });
    } catch {
      rolesWithPermissions = 0;
    }
    checks.rbacInitialized = rolesWithPermissions > 0;
  }

  // 5) RBAC 覆盖度（2026-09-27 生产事件）：只报告、不参与 ready 判定（原因见文件头 §5）。
  //    - 目录覆盖：本版本声明的每个权限码都必须存在于 DB Permission 目录；
  //    - 角色覆盖：SUPER_ADMIN 必须持有全集（ADR-0057 Q2：该角色权限由系统治理，API 禁止修改）。
  //    只读比对常量与 DB 行，不做任何运行时角色判定（ADR-0057：禁止回退静态角色映射）。
  const declaredPermissions = normalizePermissions([
    ...Object.values(PERMISSIONS),
    ...ALL_ACTION_PERMISSIONS,
    ...SYSTEM_PERMISSIONS,
  ]);
  let catalogMissing: string[] = [];
  let superAdminMissing: string[] = [];
  let rbacCoverageChecked = false;
  if (checks.database) {
    try {
      const catalogRows = await prisma.permission.findMany({
        where: { code: { in: declaredPermissions } },
        select: { code: true },
      });
      const presentCodes = new Set(catalogRows.map((row) => row.code));
      catalogMissing = declaredPermissions.filter((code) => !presentCodes.has(code));
      const superAdminRole = await prisma.role.findUnique({
        where: { code: "SUPER_ADMIN" },
        select: { permissions: { select: { code: true } } },
      });
      const heldCodes = new Set((superAdminRole?.permissions ?? []).map((p) => p.code));
      superAdminMissing = superAdminRole
        ? declaredPermissions.filter((code) => !heldCodes.has(code))
        : declaredPermissions;
      rbacCoverageChecked = true;
    } catch {
      // 查询失败（DB 抖动等）不冒充"覆盖完整"：保持 checked=false，字段为 null
      rbacCoverageChecked = false;
    }
  }
  const rbacCoverage = rbacCoverageChecked
    ? {
        declaredPermissions: declaredPermissions.length,
        catalogComplete: catalogMissing.length === 0,
        catalogMissingCount: catalogMissing.length,
        ...(catalogMissing.length > 0 ? { catalogMissingSample: catalogMissing.slice(0, 5) } : {}),
        superAdminComplete: superAdminMissing.length === 0,
        superAdminMissingCount: superAdminMissing.length,
        ...(superAdminMissing.length > 0
          ? { superAdminMissingSample: superAdminMissing.slice(0, 5) }
          : {}),
        ...(catalogMissing.length > 0 || superAdminMissing.length > 0
          ? {
              hint:
                catalogMissing.length > 0
                  ? "run pnpm db:seed（幂等：补齐 DB 权限目录，再由内置角色回填授权）"
                  : "run pnpm db:seed（幂等：SUPER_ADMIN 每次都会对齐为全集）",
            }
          : {}),
      }
    : {
        declaredPermissions: declaredPermissions.length,
        checked: false,
      };

  const ready =
    checks.database && checks.migrationBaseline && checks.buildMetadata && checks.rbacInitialized;

  const base = {
    service: "linier-crm",
    database: checks.database ? "ok" : "unreachable",
    ...(databaseErrorType ? { databaseErrorType } : {}),
    migrationBaseline: checks.migrationBaseline,
    expectedMigration,
    appliedMigration,
    buildMetadata: checks.buildMetadata,
    rbacInitialized: checks.rbacInitialized,
    rolesWithPermissions,
    rbac: rbacCoverage,
    ...(checks.database && !checks.rbacInitialized
      ? { reason: "RBAC_NOT_INITIALIZED", hint: "run pnpm db:seed（内置角色权限回填）" }
      : {}),
    timestamp: new Date().toISOString(),
  };

  if (!ready) {
    return NextResponse.json({ status: "unready", ...base }, { status: 503 });
  }

  return NextResponse.json({ status: "ok", ...base });
}
