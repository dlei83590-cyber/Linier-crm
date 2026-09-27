import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { DEFAULT_INITIAL_PASSWORD, passwordPolicyErrors } from "@nilier-crm/shared";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password — 自助改密（ADR-0059）
 *
 * 语义：
 * - 任意已认证用户可调用（**不经 requirePermission** → 不受强制改密 Gate 阻塞，是初始密码账号唯一的出口）；
 * - 必须重新验证当前密码（会话被盗不能静默改密）；
 * - 新密码必须满足强密码策略（大小写字母 + 数字组合，长度 ≥ 8）：不满足 → 400 PASSWORD_POLICY_VIOLATION；
 * - 新密码不得与当前密码相同 → 400 PASSWORD_SAME_AS_CURRENT；
 * - 成功后：passwordHash 更新 + mustChangePassword 清零 + passwordChangedAt = now，写审计 user.password.change。
 *
 * 边界：会话为无状态 JWT，改密不吊销其它设备上的既有会话（已知限制，见 ADR-0059 §5）。
 */

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
  newPassword: z.string().min(1, "请输入新密码").max(128),
});

export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  if (!user) {
    return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  }
  requestLog(request, user.id, "auth.changePassword");

  const meta = requestMeta(request);
  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { currentPassword, newPassword } = parsed.data;

  // 强密码策略（SSOT = @nilier-crm/shared；服务端重新校验，不信任客户端）
  const policyErrors = passwordPolicyErrors(newPassword);
  if (policyErrors.length > 0) {
    return fail(ERROR_CODES.PASSWORD_POLICY_VIOLATION, policyErrors[0], 400, { errors: policyErrors });
  }

  const target = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, isActive: true, passwordHash: true, mustChangePassword: true },
  });
  if (!target || !target.isActive) {
    return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  }

  if (!(await verifyPassword(currentPassword, target.passwordHash))) {
    return fail(ERROR_CODES.PASSWORD_CURRENT_INVALID, "当前密码不正确", 400);
  }

  if (newPassword === currentPassword) {
    return fail(ERROR_CODES.PASSWORD_SAME_AS_CURRENT, "新密码不得与当前密码相同", 400);
  }

  // 初始密码不可作为新密码（123456 本身也不满足策略，此处显式 fail closed）
  if (newPassword === DEFAULT_INITIAL_PASSWORD) {
    return fail(ERROR_CODES.PASSWORD_POLICY_VIOLATION, "新密码不得使用初始密码", 400, {
      errors: ["新密码不得使用初始密码"],
    });
  }

  const changedAt = new Date();
  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordChangedAt: changedAt,
    },
  });

  await writeAuditLog({
    actorId: user.id,
    action: "user.password.change",
    entityType: "user",
    entityId: target.id,
    beforeData: { mustChangePassword: target.mustChangePassword },
    afterData: { mustChangePassword: false },
    ...meta,
  });

  return ok({
    id: target.id,
    mustChangePassword: false,
    passwordChangedAt: changedAt.toISOString(),
  });
}
