import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — 清除 httpOnly 会话 cookie（ADR-0045；httpOnly cookie 必须服务端清除） */
export async function POST(request: NextRequest) {
  const res = NextResponse.json({ success: true, data: { loggedOut: true } });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
