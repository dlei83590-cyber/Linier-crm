import { z } from "zod";

export const emailSchema = z.string().email("Invalid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * ADR-0059 — 密码策略 SSOT（API 与前端共用，禁止两处漂移）
 *
 * 规则（用户指令 2026-09-21）：新密码必须为**大小写字母 + 数字组合**，长度 ≥ 8 位。
 * - 初始密码：新建用户 / 管理员重置后固定为 123456（**不满足强密码策略** → 必须首次登录改密）。
 * - 判定入口：`passwordPolicyErrors`（纯函数，返回未满足项的中文说明，空数组 = 通过）；
 *   `strongPasswordSchema`（zod，供服务端 schema 复用同一规则）。
 */
export const DEFAULT_INITIAL_PASSWORD = "123456";

/** 强密码最小长度（≥ 8 位） */
export const PASSWORD_MIN_LENGTH = 8;
/** 强密码最大长度（与 bcrypt 成本/DB 列一致） */
export const PASSWORD_MAX_LENGTH = 128;

/** 策略人类可读描述（前端提示 / API 错误文案共用） */
export const PASSWORD_POLICY_DESCRIPTION = `密码需包含大写字母、小写字母和数字，长度 ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`;

/** 强密码 zod schema（服务端校验唯一来源；错误消息即未满足项说明） */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码长度至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码长度最多 ${PASSWORD_MAX_LENGTH} 位`)
  .regex(/[A-Z]/, "密码必须包含大写字母")
  .regex(/[a-z]/, "密码必须包含小写字母")
  .regex(/[0-9]/, "密码必须包含数字");

/**
 * 强密码策略校验（纯函数，客户端/服务端共用）。
 * 返回未满足项的说明列表；空数组 = 满足策略。
 */
export function passwordPolicyErrors(password: string): string[] {
  const parsed = strongPasswordSchema.safeParse(password);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.message);
}

/** 是否满足强密码策略 */
export function isStrongPassword(password: string): boolean {
  return passwordPolicyErrors(password).length === 0;
}

/** 是否为固定初始密码（初始密码不满足强密码策略，仅作状态判定用） */
export function isDefaultInitialPassword(password: string): boolean {
  return password === DEFAULT_INITIAL_PASSWORD;
}
