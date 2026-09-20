import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * 权限目录只读端点（系统权限树 + 角色权限分配的数据源）
 *
 * 权威目录 = DB Permission 表（prisma/seed.ts 注册；与 shared PERMISSION_MODULES × PERMISSION_ACTIONS
 * + SYSTEM_PERMISSIONS 对齐，ADR-0028 防漂移）。
 * 本端点只读，不产生任何鉴权事实；角色分配写入口仍为 POST /api/roles 与 PATCH /api/roles/:id
 * （permissionCodes 全量替换，未知 code → 400）。
 *
 * 权限：role:view（角色管理读取权限；与 GET /api/roles 同权）。
 */
export interface PermissionCatalogItem {
  id: string;
  code: string;
  module: string;
  /** code 中 ":" 之后的部分（如 item:view → view）；供前端权限树动作层消费 */
  action: string;
  name: string;
}

/** GET /api/permissions — 全量权限目录（域/模块/动作分组由前端按权限树契约完成，API 只给规范事实） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "role:view");
  if (denied) return denied;
  requestLog(request, user?.id, "permission.list");

  const permissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { code: "asc" }],
    select: { id: true, code: true, module: true, name: true },
  });

  const items: PermissionCatalogItem[] = permissions.map((permission) => {
    const idx = permission.code.indexOf(":");
    return {
      id: permission.id,
      code: permission.code,
      module: permission.module,
      action: idx > 0 ? permission.code.slice(idx + 1) : "",
      name: permission.name,
    };
  });

  return ok({ items, total: items.length });
}
