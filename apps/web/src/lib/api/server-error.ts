import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { fail } from "./response";
import { ERROR_CODES } from "./errors";

/**
 * 统一 server-side runtime error 处理（P0 Incident R2 — Runtime Error Observability）
 *
 * 现状问题：大量 API 直接执行 Prisma query，未捕获数据库 runtime error →
 * 直接冒泡成 Next.js 原生 500（无结构化日志、前端只能看到"请求失败（500）"）。
 *
 * 本 helper：
 * - 生成 requestId（服务端日志与客户端错误响应共用，可跨端追踪）
 * - 服务端记录结构化日志：requestId / route / userId / Prisma error type+code / timestamp
 * - 返回 500 + INTERNAL_ERROR + "系统内部错误" + requestId
 *   （**不向客户端泄露 PostgreSQL/Prisma stack**）
 */
export function handleServerError(
  request: NextRequest,
  userId: string | undefined,
  action: string,
  error: unknown,
) {
  const requestId = randomUUID();
  const errorType = error instanceof Error ? error.name : typeof error;
  const prismaCode =
    error !== null && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);

  // 服务端结构化日志（禁止把 message/stack 写入客户端响应）
  console.error(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      requestId,
      route: request.nextUrl.pathname,
      userId: userId ?? "anonymous",
      action,
      errorType,
      ...(prismaCode ? { prismaCode } : {}),
      message,
    }),
  );

  return fail(ERROR_CODES.INTERNAL_ERROR, "系统内部错误", 500, { requestId });
}
