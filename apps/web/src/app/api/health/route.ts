import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Health probe（Phase R1 — Health Contract Repair + R3 — Release Version SSOT）
 *
 * 废除旧设计“静态永远 200 + database:pending”（Railway 假健康盲点）。
 * 现在必须做真实 DB probe（Prisma SELECT 1）：
 * - DB 可达 → 200 + database:ok
 * - DB 不可达 → HTTP 503 + database:unreachable（结构化，不泄露 stack）
 *
 * version 使用 Release SSOT：NEXT_PUBLIC_RELEASE_VERSION（构建时由 next.config.ts
 * 从 RELEASE_VERSION manifest 注入，不再用 NEXT_PUBLIC_APP_VERSION / package.json 版本）。
 *
 * 更完整的 readiness（含 migration baseline / build metadata）请用
 * /api/health/ready；进程存活仅用 /api/health/live。
 */
export async function GET() {
  let databaseOk = false;
  let databaseErrorType: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseOk = true;
  } catch (e) {
    databaseErrorType = e instanceof Error ? e.name : "UNKNOWN";
  }

  const body = {
    status: databaseOk ? "ok" : "unhealthy",
    service: "linier-crm",
    version: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "unknown",
    database: databaseOk ? "ok" : "unreachable",
    ...(databaseErrorType ? { databaseErrorType } : {}),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: databaseOk ? 200 : 503 });
}
