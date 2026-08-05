import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";
import { hasPermission, type PermissionCode, type RoleCode } from "@nilier-crm/shared";

export interface SessionUser {
  id: string;
  email: string;
  roles: string[];
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export async function authenticate(request: NextRequest): Promise<SessionUser | null> {
  const token = bearerToken(request);
  if (!token) return null;

  let payload: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    payload = await verifySessionToken(token);
  } catch {
    return null;
  }

  if (!payload.sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { roles: { include: { role: true } } },
  });

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    roles: user.roles.map((m) => m.role.code),
  };
}

export function requirePermission(user: SessionUser | null, permission: PermissionCode): NextResponse | null {
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "AUTHENTICATION_ERROR", message: "Unauthorized" } },
      { status: 401 },
    );
  }
  if (!hasPermission(user.roles as RoleCode[], permission)) {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Insufficient permission" } },
      { status: 403 },
    );
  }
  return null;
}

export function clientIp(request: NextRequest): string | undefined {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

/** 请求元数据（Sprint 3B Audit 升级：RequestId/TraceId/IP/Device/Browser） */
export interface RequestMeta {
  requestId: string | null;
  traceId: string | null;
  ipAddress: string | undefined;
  device: string | null;
  browser: string | null;
}

export function requestMeta(request: NextRequest): RequestMeta {
  const ua = request.headers.get("user-agent") ?? "";
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  const browser =
    /edg\//i.test(ua) ? "Edge" :
    /chrome/i.test(ua) ? "Chrome" :
    /firefox/i.test(ua) ? "Firefox" :
    /safari/i.test(ua) ? "Safari" : null;
  return {
    requestId: request.headers.get("x-request-id"),
    traceId: request.headers.get("x-trace-id"),
    ipAddress: clientIp(request),
    device,
    browser,
  };
}

export interface AuditLogParams {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  requestId?: string | null;
  traceId?: string | null;
  meta?: unknown;
  ipAddress?: string;
  device?: string | null;
  browser?: string | null;
  duration?: number | null;
  result?: "SUCCESS" | "FAILURE" | "PARTIAL";
}

export async function writeAuditLog(params: AuditLogParams) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        beforeData: params.beforeData === undefined ? undefined : (params.beforeData as object),
        afterData: params.afterData === undefined ? undefined : (params.afterData as object),
        requestId: params.requestId ?? null,
        traceId: params.traceId ?? null,
        meta: params.meta === undefined ? undefined : (params.meta as object),
        ipAddress: params.ipAddress,
        device: params.device ?? null,
        browser: params.browser ?? null,
        duration: params.duration ?? null,
        result: params.result ?? "SUCCESS",
      },
    });
  } catch {
    // 审计日志失败不应阻断业务
  }
}
