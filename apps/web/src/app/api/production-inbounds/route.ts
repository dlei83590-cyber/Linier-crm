import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failServer, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { nextInboundNo, computeLineAmount, type ProductionLineInput } from "@/lib/production-inbound/helpers";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  fromItemId: z.string().min(1),
  fromQty: z.coerce.number().positive(),
  toItemId: z.string().min(1),
  toQty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  remark: z.string().max(500).nullable().optional(),
});

const productionInboundCreateSchema = z.object({
  inboundDate: z.string().datetime(),
  warehouseId: z.string().min(1),
  batchNo: z.string().max(100).nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

/** GET /api/production-inbounds（分页 + status/warehouseId/inboundDateFrom/To 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-inbound:view");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const warehouseId = searchParams.get("warehouseId")?.trim();
  const dateFrom = searchParams.get("inboundDateFrom")?.trim();
  const dateTo = searchParams.get("inboundDateTo")?.trim();

  const where = {
    deletedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(dateFrom ? { inboundDate: { gte: new Date(dateFrom) } } : {}),
    ...(dateTo ? { inboundDate: { lte: new Date(dateTo) } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.productionInbound.count({ where }),
    prisma.productionInbound.findMany({
      where,
      orderBy: { inboundDate: "desc" },
      skip,
      take,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/production-inbounds（创建 DRAFT：inboundNo 取号 + 行校验 + 服务端金额计算） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-inbound:create");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.create");

  const meta = requestMeta(request);
  const parsed = productionInboundCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({ where: { id: parsed.data.warehouseId, deletedAt: null } });
      if (!warehouse) throw new Error("WAREHOUSE_INVALID");

      // 行校验：item 存在 + fromItemId != toItemId
      const itemIds = new Set<string>();
      for (const l of parsed.data.lines) {
        if (l.fromItemId === l.toItemId) throw new Error("ITEM_INVALID");
        itemIds.add(l.fromItemId);
        itemIds.add(l.toItemId);
      }
      const found = await tx.item.findMany({
        where: { id: { in: [...itemIds] }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== itemIds.size) throw new Error("ITEM_INVALID");

      const inboundNo = await nextInboundNo(tx);
      const lines = parsed.data.lines.map((l: ProductionLineInput) => {
        const unitCost = new Prisma.Decimal(l.unitCost);
        const toQty = new Prisma.Decimal(l.toQty);
        const amount = computeLineAmount(unitCost, toQty);
        return {
          fromItemId: l.fromItemId,
          fromQty: new Prisma.Decimal(l.fromQty),
          toItemId: l.toItemId,
          toQty,
          unitCost,
          amount,
          remark: l.remark ?? null,
          createdById: actorId,
        };
      });
      const totalQty = lines.reduce((s, l) => s.plus(l.toQty), new Prisma.Decimal(0));
      const totalAmount = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));

      const inbound = await tx.productionInbound.create({
        data: {
          inboundNo,
          inboundDate: new Date(parsed.data.inboundDate),
          warehouseId: parsed.data.warehouseId,
          batchNo: parsed.data.batchNo ?? null,
          totalQty,
          totalAmount,
          status: "DRAFT",
          remark: parsed.data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: { create: lines },
        },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          lines: {
            include: {
              fromItem: { select: { id: true, code: true, name: true, model: true } },
              toItem: { select: { id: true, code: true, name: true, model: true } },
            },
          },
        },
      });
      return inbound;
    }).catch((e: Error) => {
      if (e.message === "WAREHOUSE_INVALID") throw new Error("WAREHOUSE_INVALID");
      if (e.message === "ITEM_INVALID") throw new Error("ITEM_INVALID");
      if (e.message === "PRODUCTION_INBOUND_SEQUENCE_MISSING") throw new Error("SEQUENCE_MISSING");
      throw e;
    });

    await writeAuditLog({
      actorId,
      action: "production-inbound.create",
      entityType: "productionInbound",
      entityId: created.id,
      afterData: { inboundNo: created.inboundNo, totalQty: created.totalQty.toString(), totalAmount: created.totalAmount.toString() },
      ...meta,
    });
    return ok(created, undefined, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "WAREHOUSE_INVALID") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_WAREHOUSE_INVALID, "仓库不存在或已停用");
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_ITEM_INVALID, "物料不存在/已停用或 fromItem 与 toItem 相同");
    if (msg === "SEQUENCE_MISSING") return failServer("PIN DocumentSequence 缺失，请先配置生产入库单号规则");
    console.error("[production-inbound.create]", e);
    return failServer("创建生产入库单失败");
  }
}
