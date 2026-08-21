import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const priceListItemCreateSchema = z.object({
  itemId: z.string().min(1),
  unitPriceExclTax: z.coerce.number().positive(),
  taxRate: z.coerce.number().min(0).max(100),
  minOrderQty: z.coerce.number().positive().optional(),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
});

/** 金额服务端 canonical 计算（不信任客户端）：taxAmount = excl × taxRate/100；incl = excl + taxAmount */
/** GET /api/price-lists/:id/items（价格表单价明细，含物料摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:view");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.items.list");

  const { id } = await params;
  const priceList = await prisma.priceList.findFirst({ where: { id, deletedAt: null } });
  if (!priceList) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");

  const items = await prisma.priceListItem.findMany({
    where: { priceListId: id, deletedAt: null, isActive: true },
    orderBy: [{ minOrderQty: "asc" }, { createdAt: "desc" }],
    include: { item: { select: { id: true, code: true, name: true, model: true } } },
  });
  return ok(items);
}

/** POST /api/price-lists/:id/items（新增单价行：item 有效 + 服务端算税/含税价） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "price-list:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "price-list.items.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = priceListItemCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const priceList = await prisma.priceList.findFirst({ where: { id, deletedAt: null } });
  if (!priceList) return failNotFound(ERROR_CODES.NOT_FOUND, "价目表不存在");

  const item = await prisma.item.findFirst({ where: { id: parsed.data.itemId, deletedAt: null } });
  if (!item) return failConflict(ERROR_CODES.NOT_FOUND, "物料不存在或已停用");

  const exclD = new Prisma.Decimal(parsed.data.unitPriceExclTax);
  const taxRateD = new Prisma.Decimal(parsed.data.taxRate);
  const taxAmount = exclD.mul(taxRateD).div(100);
  const incl = exclD.plus(taxAmount);
  const created = await prisma.priceListItem.create({
    data: {
      priceListId: id,
      itemId: parsed.data.itemId,
      unitPriceExclTax: exclD,
      taxRate: taxRateD,
      taxAmount,
      unitPriceInclTax: incl,
      minOrderQty: parsed.data.minOrderQty !== undefined ? new Prisma.Decimal(parsed.data.minOrderQty) : null,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      priceSource: "MANUAL",
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
    include: { item: { select: { id: true, code: true, name: true, model: true } } },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "price-list.item.create",
    entityType: "priceListItem",
    entityId: created.id,
    afterData: { priceListId: id, itemId: created.itemId, unitPriceExclTax: created.unitPriceExclTax.toString() },
    ...meta,
  });

  return ok(created, undefined, 201);
}
