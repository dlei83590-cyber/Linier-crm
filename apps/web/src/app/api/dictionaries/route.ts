import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { dictionaryTypeCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/dictionaries（字典类型列表：分页 + code/name/category 搜索） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-type:view");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-type.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const category = searchParams.get("category")?.trim();
  const enabled = searchParams.get("enabled")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(category ? { category } : {}),
    ...(enabled === "true" || enabled === "false" ? { enabled: enabled === "true" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.dictionaryType.count({ where }),
    prisma.dictionaryType.findMany({
      where,
      orderBy: [{ sort: "asc" }, { updatedAt: "desc" }],
      skip,
      take,
      include: { _count: { select: { items: { where: { deletedAt: null } } } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/dictionaries（创建字典类型） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-type:create");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-type.create");

  const parsed = dictionaryTypeCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.dictionaryType.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.DICTIONARY_TYPE_CODE_EXISTS, "字典类型编码已存在");
  }

  const created = await prisma.dictionaryType.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-type.create",
    entityType: "dictionary-type",
    entityId: created.id,
    ipAddress: clientIp(request),
    meta: { code: created.code, category: created.category },
  });

  return ok(created, undefined, 201);
}
