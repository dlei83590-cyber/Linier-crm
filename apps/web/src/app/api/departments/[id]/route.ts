import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Department 无 version → PATCH 无 CAS；无 DELETE（无软删字段，物理删除破坏组织树审计） */
const departmentUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供一个更新字段" });

/** GET /api/departments/:id（详情含父级链 + 用户数 + 子部门数） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "department:view");
  if (denied) return denied;
  requestLog(request, user?.id, "department.get");

  const { id } = await params;
  const department = await prisma.department.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      _count: { select: { users: true, children: true } },
    },
  });
  if (!department) return failNotFound(ERROR_CODES.NOT_FOUND, "部门不存在");
  return ok(department);
}

/** PATCH /api/departments/:id（name/code/parentId；循环引用校验：不得设为自身或子孙为父） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "department:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "department.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = departmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "部门不存在");

  if (parsed.data.code) {
    const codeExisting = await prisma.department.findUnique({ where: { code: parsed.data.code } });
    if (codeExisting && codeExisting.id !== id) {
      return failConflict(ERROR_CODES.CONFLICT, "部门编码已存在");
    }
  }

  if (parsed.data.parentId !== undefined && parsed.data.parentId !== null && parsed.data.parentId !== id) {
    const parent = await prisma.department.findUnique({ where: { id: parsed.data.parentId } });
    if (!parent) return failConflict(ERROR_CODES.NOT_FOUND, "父级部门不存在");
    // 循环引用校验：沿候选父级链向上，不得回到自身（把自身/子孙设为父 → 409）
    let cursor: string | null = parsed.data.parentId;
    let cycleDetected = false;
    const guard = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        cycleDetected = true;
        break;
      }
      if (guard.has(cursor)) break;
      guard.add(cursor);
      const row = await prisma.department.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = row?.parentId ?? null;
    }
    if (cycleDetected) {
      return failConflict(ERROR_CODES.CONFLICT, "不能将部门设为自身或下级部门的子部门");
    }
  }

  const updated = await prisma.department.update({
    where: { id },
    data: {
      ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "department.update",
    entityType: "department",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name, parentId: existing.parentId },
    afterData: { code: updated.code, name: updated.name, parentId: updated.parentId },
    ...meta,
  });

  return ok(updated);
}