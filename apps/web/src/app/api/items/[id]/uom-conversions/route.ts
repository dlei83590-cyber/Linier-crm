import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const conversionCreateSchema = z.object({
  fromUomId: z.string().min(1),
  toUomId: z.string().min(1),
  factor: z.coerce.number().positive(),
});

/** GET /api/items/:id/uom-conversions（UOM 换算列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-uom:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-uom.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.uomConversion.count({ where: { itemId: id, deletedAt: null } }),
    prisma.uomConversion.findMany({
      where: { itemId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { fromUom: { select: { id: true, code: true, name: true } }, toUom: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/uom-conversions（新增换算；from/to 重复 409） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-uom:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-uom.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = conversionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");
  if (parsed.data.fromUomId === parsed.data.toUomId) {
    return failConflict(ERROR_CODES.CONFLICT, "源单位与目标单位不能相同");
  }

  const existing = await prisma.uomConversion.findFirst({
    where: { itemId: id, fromUomId: parsed.data.fromUomId, toUomId: parsed.data.toUomId, deletedAt: null },
  });
  if (existing) return failConflict(ERROR_CODES.CONFLICT, "该换算关系已存在");

  const created = await prisma.uomConversion.create({
    data: { ...parsed.data, itemId: id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-uom.create",
    entityType: "item-uom",
    entityId: created.id,
    meta: { itemId: id, fromUomId: created.fromUomId, toUomId: created.toUomId, factor: created.factor },
    ...meta,
  });

  return ok(created, undefined, 201);
}
