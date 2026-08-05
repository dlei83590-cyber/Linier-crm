import type { NextRequest } from "next/server";

/**
 * Sprint 3A - 请求日志
 * 所有平台 API 在入口记录一行结构化日志（方法/路径/用户/动作）。
 */
export function requestLog(request: NextRequest, userId: string | undefined, action: string) {
  console.log(
    `[api] ${new Date().toISOString()} ${request.method} ${request.nextUrl.pathname} user=${userId ?? "anonymous"} action=${action}`,
  );
}
