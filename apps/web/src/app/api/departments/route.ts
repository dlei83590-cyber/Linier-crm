import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 部门管理（Pending Pages Completion Gate — Batch 2；Department 无 version/deletedAt/isActive → 无 CAS、无软删、无启停） */
const departmentCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  parentId: z.string().min(1).nullable().optional(),
});

/** GET /api/departments（分页 + code/name/parentId 过滤；含父级摘要与用户/子部门计数） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "department:view");
  if (denied) return denied;
  requestLog(request, user?.id, "department.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const parentId = searchParams.get("parentId")?.trim();

  const where = {
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(parentId ? { parentId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.department.count({ where }),
    prisma.department.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { users: true, children: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/departments（创建部门：code 唯一；parentId 校验父级存在） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "department:create");
  if (denied) return denied;
  requestLog(request, user?.id, "department.create");

  const meta = requestMeta(request);
  const parsed = departmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.department.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return failConflict(ERROR_CODES.CONFLICT, "部门编码已存在");
  }

  if (parsed.data.parentId) {
    const parent = await prisma.department.findUnique({ where: { id: parsed.data.parentId } });
    if (!parent) return failConflict(ERROR_CODES.NOT_FOUND, "父级部门不存在");
  }

  const created = await prisma.department.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "department.create",
    entityType: "department",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}