import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe（Phase R1 — Health Contract Repair）
 *
 * 只证明 Node/Next.js 进程存活（200）；不访问数据库、不声称业务依赖正常。
 * 业务依赖就绪性请使用 /api/health/ready（DB probe → 503）。
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "linier-crm",
    timestamp: new Date().toISOString(),
  });
}
