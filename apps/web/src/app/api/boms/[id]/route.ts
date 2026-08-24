import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  componentItemId: z.string().min(1),
  componentUomId: z.string().min(1),
  qtyPerFinishedUnit: z.coerce.number().positive(),
  lossRate: z.coerce.number().min(0).max(0.99).default(0),
  sort: z.coerce.number().int().min(0).default(0),
  remark: z.string().max(500).nullable().optional(),
});

const bomUpdateSchema = z.object({
  version: z.coerce.number().int().positive(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

/** GET /api/boms/:id（详情 + 行） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:view");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.get");
  const { id } = await params;

  const bom = await prisma.itemBom.findFirst({
    where: { id, deletedAt: null },
    include: {
      finishedItem: { select: { id: true, code: true, name: true, model: true, itemType: true, sourcingType: true, isManufacturable: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { sort: "asc" },
        include: {
          componentItem: { select: { id: true, code: true, name: true, model: true, stockUomId: true } },
          componentUom: { select: { id: true, code: true, symbol: true } },
        },
      },
    },
  });
  if (!bom) return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
  return ok(bom);
}

/** PATCH /api/boms/:id（仅 DRAFT；CAS；行整体替换） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.update");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = bomUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (bom.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // 行校验（同创建：单位红线 + 不与成品相同 + 去重）
      const componentIds = parsed.data.lines.map((l) => l.componentItemId);
      const components = await tx.item.findMany({ where: { id: { in: componentIds }, deletedAt: null } });
      if (components.length !== new Set(componentIds).size) throw new Error("ITEM_INVALID");
      const compMap = new Map(components.map((c) => [c.id, c]));
      const seen = new Set<string>();
      for (const l of parsed.data.lines) {
        if (l.componentItemId === bom.finishedItemId) throw new Error("LINE_INVALID");
        if (seen.has(l.componentItemId)) throw new Error("COMPONENT_DUPLICATE");
        seen.add(l.componentItemId);
        const comp = compMap.get(l.componentItemId);
        if (!comp || !comp.stockUomId || comp.stockUomId !== l.componentUomId) throw new Error("LINE_INVALID");
      }

      const cas = await tx.itemBom.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: { remark: parsed.data.remark ?? null, updatedById: actorId, version: { increment: 1 } },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");

      // 行整体替换（物理删旧建新——DRAFT 未生效，安全）
      await tx.itemBomLine.deleteMany({ where: { bomId: id } });
      await tx.itemBomLine.createMany({
        data: parsed.data.lines.map((l, i) => ({
          bomId: id,
          componentItemId: l.componentItemId,
          componentUomId: l.componentUomId,
          qtyPerFinishedUnit: new Prisma.Decimal(l.qtyPerFinishedUnit),
          lossRate: new Prisma.Decimal(l.lossRate),
          sort: l.sort || i,
          remark: l.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        })),
      });

      return tx.itemBom.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { sort: "asc" } } },
      });
    });

    await writeAuditLog({ actorId, action: "bom.update", entityType: "itemBom", entityId: id, afterData: { bomNo: updated.bomNo, status: updated.status, version: updated.version }, ...meta });
    return ok(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT 状态可编辑");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.BOM_ITEM_INVALID, "原料不存在或已停用");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.BOM_LINE_INVALID, "原料行非法（原料单位必须 = 原料库存单位）");
    if (msg === "COMPONENT_DUPLICATE") return failConflict(ERROR_CODES.BOM_COMPONENT_DUPLICATE, "同一配方内原料重复");
    console.error("[bom.update]", e);
    return failServer("更新配方失败");
  }
}

/** DELETE /api/boms/:id（仅 DRAFT；软删头+行） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.delete");
  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status !== "DRAFT") throw new Error("INVALID_STATE");
      const now = new Date();
      await tx.itemBom.update({ where: { id }, data: { deletedAt: now, updatedById: user!.id, version: { increment: 1 } } });
      await tx.itemBomLine.updateMany({ where: { bomId: id }, data: { deletedAt: now } });
      return bom;
    });
    await writeAuditLog({ actorId: user!.id, action: "bom.delete", entityType: "itemBom", entityId: id, afterData: { bomNo: result.bomNo }, ...meta });
    return ok({ id, deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT 状态可删除");
    console.error("[bom.delete]", e);
    return failServer("删除配方失败");
  }
}
