import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { approverGroupCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/approver-groups（分页 + code/name 搜索） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "approver-group:view");
  if (denied) return denied;
  requestLog(request, user?.id, "approver-group.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.approverGroup.count({ where }),
    prisma.approverGroup.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      include: {
        members: { where: { deletedAt: null }, select: { id: true, userId: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/approver-groups（创建 + 成员，事务） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "approver-group:create");
  if (denied) return denied;
  requestLog(request, user?.id, "approver-group.create");

  const parsed = approverGroupCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { memberUserIds, ...group } = parsed.data;

  const existing = await prisma.approverGroup.findUnique({ where: { code: group.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.APPROVER_GROUP_CODE_EXISTS, "审批组编码已存在");
  }

  const created = await prisma.$transaction(async (tx) => {
    const g = await tx.approverGroup.create({
      data: {
        ...group,
        createdById: user!.id,
        updatedById: user!.id,
        members: {
          create: memberUserIds.map((userId) => ({
            userId,
            createdById: user!.id,
            updatedById: user!.id,
          })),
        },
      },
      include: { members: { where: { deletedAt: null } } },
    });
    return g;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "approver-group.create",
    entityType: "approver-group",
    entityId: created.id,
    ipAddress: clientIp(request),
    meta: { code: created.code, memberCount: memberUserIds.length },
  });

  return ok(created, undefined, 201);
}
