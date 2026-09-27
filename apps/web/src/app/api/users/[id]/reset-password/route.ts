import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hashPassword } from "@/lib/auth";
import { DEFAULT_INITIAL_PASSWORD } from "@nilier-crm/shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/users/:id/reset-password — 管理员重置密码（ADR-0059）
 *
 * 语义（用户指令 2026-09-21）：
 * - 管理员**只能**重置为固定初始密码 123456（不接受任何自定义密码）；
 * - 同时置 mustChangePassword=true → 该用户下次登录被强制改密（改密前其余 API fail closed 403）；
 * - 幂等：重复重置结果一致（回到初始密码 + 强制改密态）；
 * - 审计：user.password.reset（记录被重置账号与结果，不记录任何密码明文）。
 *
 * 权限：复用既有 user:edit（ADMIN / SUPER_ADMIN 默认持有）——不新增权限码，
 * 避免新增受限权限在既有生产角色上未回填导致管理员 403（ADR-0059 §3）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "user.resetPassword");

  const { id } = await params;
  const meta = requestMeta(request);

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, isActive: true, mustChangePassword: true },
  });
  if (!target) return failNotFound(ERROR_CODES.NOT_FOUND, "用户不存在");
  if (!target.isActive) {
    return failConflict(ERROR_CODES.CONFLICT, "用户已停用，请先启用后再重置密码");
  }

  const resetAt = new Date();
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
      // 重置后必须回到强制改密态：管理员不得知悉/决定用户的最终密码
      mustChangePassword: true,
      passwordChangedAt: resetAt,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "user.password.reset",
    entityType: "user",
    entityId: target.id,
    beforeData: { email: target.email, mustChangePassword: target.mustChangePassword },
    afterData: { email: target.email, mustChangePassword: true, initialPassword: true },
    ...meta,
  });

  return ok({
    id: target.id,
    mustChangePassword: true,
    resetAt: resetAt.toISOString(),
  });
}
