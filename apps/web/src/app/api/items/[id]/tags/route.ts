import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const tagCreateSchema = z.object({
  tagId: z.string().min(1),
});

/** GET /api/items/:id/tags（物料标签列表，ItemTag 独立 Relation） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-tag:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-tag.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.itemTag.count({ where: { itemId: id, deletedAt: null } }),
    prisma.itemTag.findMany({
      where: { itemId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { tag: { select: { id: true, code: true, name: true, color: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/tags（打标签；重复 409） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-tag:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-tag.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = tagCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const tag = await prisma.tag.findFirst({ where: { id: parsed.data.tagId, deletedAt: null } });
  if (!tag) return failConflict(ERROR_CODES.NOT_FOUND, "标签不存在");

  const existing = await prisma.itemTag.findFirst({
    where: { itemId: id, tagId: parsed.data.tagId, deletedAt: null },
  });
  if (existing) return failConflict(ERROR_CODES.CONFLICT, "标签已存在");

  const created = await prisma.itemTag.create({
    data: { itemId: id, tagId: parsed.data.tagId, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-tag.create",
    entityType: "item-tag",
    entityId: created.id,
    meta: { itemId: id, tagId: parsed.data.tagId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
