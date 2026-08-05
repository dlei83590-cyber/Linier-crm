import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const specCreateSchema = z.object({
  definitionId: z.string().min(1).optional(), // CTO #2138：关联规格定义（可选）
  specKey: z.string().min(1).max(100),
  specValue: z.string().min(1).max(500),
  unit: z.string().max(50).optional(),
  sort: z.number().int().default(0),
});

/** GET /api/items/:id/specifications（规格列表，含定义信息） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-specification.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const definitionId = searchParams.get("definitionId")?.trim();

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const where = {
    itemId: id,
    deletedAt: null,
    ...(definitionId ? { definitionId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.itemSpecification.count({ where }),
    prisma.itemSpecification.findMany({
      where,
      orderBy: [{ sort: "asc" }, { specKey: "asc" }],
      skip,
      take,
      include: { definition: { select: { id: true, code: true, name: true, unit: true, dataType: true, isRequired: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/specifications（新增规格；definitionId 存在性校验） */
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

  if (parsed.data.definitionId) {
    const def = await prisma.specificationDefinition.findFirst({ where: { id: parsed.data.definitionId, deletedAt: null } });
    if (!def) return failConflict(ERROR_CODES.NOT_FOUND, "规格定义不存在");
  }

  const created = await prisma.itemSpecification.create({
    data: { ...parsed.data, itemId: id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-specification.create",
    entityType: "item-specification",
    entityId: created.id,
    meta: { itemId: id, specKey: created.specKey, definitionId: created.definitionId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
