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

export async function writeAuditLog(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
  ipAddress?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        meta: params.meta === undefined ? undefined : (params.meta as object),
        ipAddress: params.ipAddress,
      },
    });
  } catch {
    // 审计日志失败不应阻断业务
  }
}
