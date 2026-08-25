import { apiFetch } from "@/lib/api-client";

/**
 * 负责人选择器数据源（followup-level，Migration 0055）
 *
 * 跟进「决策推进」的负责人（responsibleUserId）用真实 User selector 选择（禁止输入 userId）。
 * 数据源 = /api/users?isActive=true（User SSOT；user:view 权限——SUPER_ADMIN/ADMIN 可用）。
 *
 * 权限边界（Known Limitation）：MANAGER/MEMBER 无 user:view → 本加载返回 null（调用方隐藏选择器，
 * 交由服务端投影兜底：客户负责人 CustomerOwnership → 商机负责人 ProjectOpportunity.ownerId）。
 *
 * 不变量：option.id = User.id = POST responsibleUserId = 服务端 user 校验 id。
 */
export interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

/** 负责人选项数据源 URL（User SSOT；isActive=true 仅可选启用用户） */
export const USER_SELECTOR_URL = "/api/users?pageSize=100&isActive=true";

/**
 * 加载启用用户选项；AbortSignal 透传。无 user:view 权限（403）或加载失败 → null（调用方决定降级策略），
 * 禁止把失败伪装成空列表（空列表会被当作「没有可选用户」而误判）。
 */
export async function loadUserOptions(signal?: AbortSignal): Promise<UserOption[] | null> {
  try {
    const body = await apiFetch<UserOption[]>(USER_SELECTOR_URL, { signal });
    return Array.isArray(body.data) ? body.data : [];
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
}
