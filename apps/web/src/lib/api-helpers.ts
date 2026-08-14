import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";
import { hasPermission, type PermissionCode, type RoleCode } from "@nilier-crm/shared";
import { failConflict } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";

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

/** B2-0（CTO #12228/#12278）：Project header FOR UPDATE 锁定的权威行（锁后不重读） */
export interface LockedProject {
  id: string;
  stage: string;
  version: number;
  paymentStatus: string;
  receivableBalance: unknown;
}

/**
 * B2-0（CTO #12278）：Project 写 Gate 结果。
 * ok=true 携带 locked project（调用方可直接复用锁内 stage/version/paymentStatus/receivableBalance）；
 * ok=false 携带拒绝响应（调用方直接 return response）。
 */
export type ProjectWriteGateResult =
  | { ok: true; project: LockedProject }
  | { ok: false; response: NextResponse };

/**
 * B2-0（CTO #12201/#12228/#12278）：项目子资源写操作前置校验——CLOSED 项目 fail-closed，
 * 且必须与 mutation 处于同一事务（transactional aggregate write gate，消除 TOCTOU 竞态）。
 * 统一锁序：Project header FOR UPDATE → Gate → mutation。
 * 内部：lockProjectHeader → stage === CLOSED → 409 CONFLICT。
 * 返回 ProjectWriteGateResult（ok=true 携带 locked project）。
 * 调用方必须已处于 prisma.$transaction(async (tx) => { ... }) 内。
 */
export async function assertProjectWritable(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<ProjectWriteGateResult> {
  const project = await lockProjectHeader(tx, projectId);
  if (!project) {
    return { ok: false, response: failConflict(ERROR_CODES.NOT_FOUND, "项目不存在") };
  }
  if (project.stage === "CLOSED") {
    return { ok: false, response: failConflict(ERROR_CODES.CONFLICT, "项目已结项，不允许修改项目子资源") };
  }
  return { ok: true, project };
}

/**
 * B2-0（CTO #12228/#12278）：事务内锁定 Project header（FOR UPDATE）并返回权威行。
 * 供 close / transition / 子资源 mutation 统一复用同一锁序：
 * Project header FOR UPDATE → Gate → mutation（锁序 Project → Child，防死锁）。
 * 返回 null = 项目不存在或已软删（调用方按需 404）。
 */
export async function lockProjectHeader(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<LockedProject | null> {
  const rows = await tx.$queryRaw<LockedProject[]>(
    Prisma.sql`SELECT "id", "stage", "version", "paymentStatus", "receivableBalance" FROM "Project" WHERE "id" = ${projectId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  return rows[0] ?? null;
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
