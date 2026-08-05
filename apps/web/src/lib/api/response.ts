import { NextResponse } from "next/server";
import { ERROR_CODES, type ErrorCode } from "./errors";

/**
 * Sprint 3A - 统一 API 响应格式
 * 成功：{ success: true, data, meta: { page, pageSize, total } }
 * 失败：{ success: false, error: { code, message, details? } }
 */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

export function ok<T>(data: T, meta?: PaginationMeta, status = 200) {
  return NextResponse.json(meta ? { success: true, data, meta } : { success: true, data }, { status });
}

export function fail(
  code: ErrorCode,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );
}

export function failValidation(details: unknown) {
  return fail(ERROR_CODES.VALIDATION_ERROR, "Invalid request body", 400, details);
}

export function failNotFound(code: ErrorCode = ERROR_CODES.NOT_FOUND, message = "Resource not found") {
  return fail(code, message, 404);
}

export function failConflict(code: ErrorCode, message: string) {
  return fail(code, message, 409);
}

export function failServer(message = "Internal server error") {
  return fail(ERROR_CODES.INTERNAL_ERROR, message, 500);
}

/** 解析分页参数（page/pageSize），带上限保护 */
export function parsePagination(searchParams: URLSearchParams) {
  const rawPage = Number(searchParams.get("page") ?? "1");
  const rawPageSize = Number(searchParams.get("pageSize") ?? "20");
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(Math.floor(rawPageSize), 100)
      : 20;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
