import { NextRequest } from "next/server";
import type { ItemCostType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const costCreateSchema = z.object({
  costType: z.enum(["STANDARD", "LAST_PURCHASE", "AVERAGE", "CURRENT"]),
  amount: z.coerce.number().nonnegative(),
  currency: z.string().max(10).default("CNY"),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo: z.string().datetime().optional(),
  source: z.string().max(100).optional(),
});

/** GET /api/items/:id/costs（成本列表，按 costType 过滤） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-cost:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-cost.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const costType = searchParams.get("costType")?.trim();

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const where = {
    itemId: id,
    deletedAt: null,
    ...(costType ? { costType: costType as ItemCostType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.itemCost.count({ where }),
    prisma.itemCost.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/costs（写入成本，接口不做算法） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-cost:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-cost.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = costCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const created = await prisma.itemCost.create({
    data: {
      ...parsed.data,
      costType: parsed.data.costType as ItemCostType,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      itemId: id,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-cost.create",
    entityType: "item-cost",
    entityId: created.id,
    meta: { itemId: id, costType: created.costType, amount: created.amount, currency: created.currency },
    ...meta,
  });

  return ok(created, undefined, 201);
}
