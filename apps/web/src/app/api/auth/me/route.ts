import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — 当前会话用户（SessionProvider.refresh 使用）
 * ADR-0045：httpOnly 会话 cookie 由浏览器自动携带；authenticate() 双来源（Bearer 遗留 → cookie）
 * 修复：此前仅认 Bearer，cookie-only 的浏览器请求恒 401 → 登录后闪退回登录页。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Unauthorized" } },
      { status: 401 },
    );
  }

  return NextResponse.json({
    success: true,
    data: user,
  });
}
