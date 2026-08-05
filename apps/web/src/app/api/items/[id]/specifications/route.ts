import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const specCreateSchema = z.object({
  specKey: z.string().min(1).max(100),
  specValue: z.string().min(1).max(500),
  unit: z.string().max(50).optional(),
  sort: z.number().int().default(0),
});

/** GET /api/items/:id/specifications（规格列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-specification.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.itemSpecification.count({ where: { itemId: id, deletedAt: null } }),
    prisma.itemSpecification.findMany({
      where: { itemId: id, deletedAt: null },
      orderBy: [{ sort: "asc" }, { specKey: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/specifications（新增规格） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-specification.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = specCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const created = await prisma.itemSpecification.create({
    data: { ...parsed.data, itemId: id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-specification.create",
    entityType: "item-specification",
    entityId: created.id,
    meta: { itemId: id, specKey: created.specKey },
    ...meta,
  });

  return ok(created, undefined, 201);
}
