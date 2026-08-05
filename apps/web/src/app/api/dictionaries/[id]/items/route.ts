import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { dictionaryItemCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/dictionaries/:id/items（字典项列表，分页） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-item:view");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-item.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const label = searchParams.get("label")?.trim();
  const enabled = searchParams.get("enabled")?.trim();

  const type = await prisma.dictionaryType.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!type) {
    return failNotFound(ERROR_CODES.DICTIONARY_TYPE_NOT_FOUND, "字典类型不存在");
  }

  const where = {
    typeId: id,
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(label ? { label: { contains: label } } : {}),
    ...(enabled === "true" || enabled === "false" ? { enabled: enabled === "true" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.dictionaryItem.count({ where }),
    prisma.dictionaryItem.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/dictionaries/:id/items（创建字典项，typeId+code 唯一） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-item:create");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-item.create");

  const { id } = await params;
  const parsed = dictionaryItemCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const type = await prisma.dictionaryType.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!type) {
    return failNotFound(ERROR_CODES.DICTIONARY_TYPE_NOT_FOUND, "字典类型不存在");
  }

  const existing = await prisma.dictionaryItem.findFirst({
    where: { typeId: id, code: parsed.data.code },
  });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.DICTIONARY_ITEM_CODE_EXISTS, "字典项编码已存在");
  }

  const created = await prisma.dictionaryItem.create({
    data: { ...parsed.data, typeId: id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-item.create",
    entityType: "dictionary-item",
    entityId: created.id,
    ipAddress: clientIp(request),
    meta: { typeId: id, code: created.code },
  });

  return ok(created, undefined, 201);
}
