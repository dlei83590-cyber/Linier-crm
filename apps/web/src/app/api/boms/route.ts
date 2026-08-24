import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { BomStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failServer, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { buildBomNo } from "@/lib/item-bom/helpers";

export const dynamic = "force-dynamic";

const bomLineSchema = z.object({
  componentItemId: z.string().min(1),
  componentUomId: z.string().min(1),
  qtyPerFinishedUnit: z.coerce.number().positive(),
  lossRate: z.coerce.number().min(0).max(0.99).default(0),
  sort: z.coerce.number().int().min(0).default(0),
  remark: z.string().max(500).nullable().optional(),
});

const bomCreateSchema = z.object({
  finishedItemId: z.string().min(1),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(bomLineSchema).min(1),
});

/** GET /api/boms（分页 + finishedItemId/status 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:view");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const finishedItemId = searchParams.get("finishedItemId")?.trim();
  const status = searchParams.get("status")?.trim();

  const where = {
    deletedAt: null,
    ...(finishedItemId ? { finishedItemId } : {}),
    ...(status ? { status: status as BomStatus } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.itemBom.count({ where }),
    prisma.itemBom.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
      include: {
        finishedItem: { select: { id: true, code: true, name: true, model: true, sourcingType: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/boms（创建 DRAFT 配方：bomVersion = max+1，bomNo 自动生成；行校验 + 单位红线） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:create");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.create");

  const meta = requestMeta(request);
  const parsed = bomCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 成品校验
      const finished = await tx.item.findFirst({ where: { id: parsed.data.finishedItemId, deletedAt: null } });
      if (!finished) throw new Error("ITEM_INVALID");

      // 原料校验（存在 + 不与成品相同 + 单位 = 原料库存单位）
      const componentIds = parsed.data.lines.map((l) => l.componentItemId);
      const components = await tx.item.findMany({ where: { id: { in: componentIds }, deletedAt: null } });
      if (components.length !== new Set(componentIds).size) throw new Error("ITEM_INVALID");
      const compMap = new Map(components.map((c) => [c.id, c]));
      const seen = new Set<string>();
      for (const l of parsed.data.lines) {
        if (l.componentItemId === parsed.data.finishedItemId) throw new Error("LINE_INVALID");
        if (seen.has(l.componentItemId)) throw new Error("COMPONENT_DUPLICATE");
        seen.add(l.componentItemId);
        const comp = compMap.get(l.componentItemId);
        if (!comp.stockUomId || comp.stockUomId !== l.componentUomId) {
          throw new Error("LINE_INVALID"); // 单位红线：componentUomId 必须 = 原料库存单位
        }
      }

      // bomVersion = max + 1；bomNo 自动生成
      const latest = await tx.itemBom.findFirst({
        where: { finishedItemId: parsed.data.finishedItemId, deletedAt: null },
        orderBy: { bomVersion: "desc" },
        select: { bomVersion: true },
      });
      const bomVersion = (latest?.bomVersion ?? 0) + 1;
      const bomNo = buildBomNo(finished.code, bomVersion);

      const bom = await tx.itemBom.create({
        data: {
          bomNo,
          finishedItemId: parsed.data.finishedItemId,
          bomVersion,
          status: "DRAFT",
          isDefault: false,
          remark: parsed.data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: parsed.data.lines.map((l, i) => ({
              componentItemId: l.componentItemId,
              componentUomId: l.componentUomId,
              qtyPerFinishedUnit: new Prisma.Decimal(l.qtyPerFinishedUnit),
              lossRate: new Prisma.Decimal(l.lossRate),
              sort: l.sort || i,
              remark: l.remark ?? null,
              createdById: actorId,
              updatedById: actorId,
            })),
          },
        },
        include: { lines: { orderBy: { sort: "asc" } }, finishedItem: { select: { id: true, code: true, name: true } } },
      });
      return bom;
    });

    await writeAuditLog({
      actorId,
      action: "bom.create",
      entityType: "itemBom",
      entityId: created.id,
      afterData: { bomNo: created.bomNo, finishedItemId: created.finishedItemId, status: created.status },
      ...meta,
    });
    return ok(created, undefined, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.BOM_ITEM_INVALID, "成品/原料不存在或已停用");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.BOM_LINE_INVALID, "原料行非法（原料单位必须 = 原料库存单位，且原料不得等于成品）");
    if (msg === "COMPONENT_DUPLICATE") return failConflict(ERROR_CODES.BOM_COMPONENT_DUPLICATE, "同一配方内原料重复");
    console.error("[bom.create]", e);
    return failServer("创建配方失败");
  }
}
