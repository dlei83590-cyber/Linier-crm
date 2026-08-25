import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const lineCreateSchema = z.object({
  version: z.coerce.number().int().positive(), // 配方 CAS 乐观锁版本
  componentItemId: z.string().min(1),
  componentUomId: z.string().min(1),
  qtyPerFinishedUnit: z.coerce.number().positive(),
  lossRate: z.coerce.number().min(0).max(0.99).default(0),
  sort: z.coerce.number().int().min(0).default(0),
  remark: z.string().max(500).nullable().optional(),
});

/**
 * POST /api/boms/:id/lines —— 增加配方行（仅 DRAFT；CAS version）
 * - 复用创建配方的行校验：原料存在、!= 成品、单位 = 原料库存单位（红线）、同一配方内不重复
 * - 权限：bom:edit（配方行属于配方编辑范围）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.line.create");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = lineCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 配方头：存在 + DRAFT + CAS 版本
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (bom.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // 原料校验：存在 + 不与成品相同 + 单位红线（componentUomId 必须 = 原料库存单位）
      const comp = await tx.item.findFirst({ where: { id: parsed.data.componentItemId, deletedAt: null } });
      if (!comp) throw new Error("ITEM_INVALID");
      if (comp.id === bom.finishedItemId) throw new Error("LINE_INVALID");
      if (!comp.stockUomId || comp.stockUomId !== parsed.data.componentUomId) throw new Error("LINE_INVALID");

      // 同一配方内原料去重（@@unique([bomId, componentItemId]) 兜底并发 P2002）
      const dup = await tx.itemBomLine.findFirst({ where: { bomId: id, componentItemId: parsed.data.componentItemId, deletedAt: null } });
      if (dup) throw new Error("COMPONENT_DUPLICATE");

      // 原子 CAS（版本 +1）
      const cas = await tx.itemBom.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: { version: { increment: 1 }, updatedById: actorId },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");

      return tx.itemBomLine.create({
        data: {
          bomId: id,
          componentItemId: parsed.data.componentItemId,
          componentUomId: parsed.data.componentUomId,
          qtyPerFinishedUnit: new Prisma.Decimal(parsed.data.qtyPerFinishedUnit),
          lossRate: new Prisma.Decimal(parsed.data.lossRate),
          sort: parsed.data.sort,
          remark: parsed.data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
        include: {
          componentItem: { select: { id: true, code: true, name: true, model: true } },
          componentUom: { select: { id: true, code: true, symbol: true } },
        },
      });
    });

    await writeAuditLog({
      actorId,
      action: "bom.line.create",
      entityType: "itemBomLine",
      entityId: created.id,
      afterData: { bomId: id, componentItemId: created.componentItemId, qtyPerFinishedUnit: created.qtyPerFinishedUnit.toFixed(6) },
      ...meta,
    });
    return ok(created, undefined, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT 状态可增加原料行");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.BOM_ITEM_INVALID, "原料不存在或已停用");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.BOM_LINE_INVALID, "原料行非法（原料单位必须 = 原料库存单位，且原料不得等于成品）");
    if (msg === "COMPONENT_DUPLICATE") return failConflict(ERROR_CODES.BOM_COMPONENT_DUPLICATE, "同一配方内原料重复");
    console.error("[bom.line.create]", e);
    return failServer("增加配方行失败");
  }
}
