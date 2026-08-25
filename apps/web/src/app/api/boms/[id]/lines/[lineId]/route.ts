import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const lineUpdateSchema = z
  .object({
    version: z.coerce.number().int().positive(), // 配方 CAS 乐观锁版本
    componentUomId: z.string().min(1).optional(),
    qtyPerFinishedUnit: z.coerce.number().positive().optional(),
    lossRate: z.coerce.number().min(0).max(0.99).optional(),
    sort: z.coerce.number().int().min(0).optional(),
    remark: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

const lineDeleteSchema = z.object({
  version: z.coerce.number().int().positive(),
});

/**
 * PATCH /api/boms/:id/lines/:lineId —— 修改配方行（仅 DRAFT；CAS version）
 * - 可改：数量 qtyPerFinishedUnit / 损耗率 lossRate / 排序 sort / 备注 remark / 单位
 * - 若改单位：沿用红线（单位 = 原料库存单位）
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.line.update");
  const { id, lineId } = await params;
  const meta = requestMeta(request);

  const parsed = lineUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (bom.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      const line = await tx.itemBomLine.findFirst({ where: { id: lineId, bomId: id, deletedAt: null } });
      if (!line) throw new Error("LINE_NOT_FOUND");

      // 若改单位：原料库存单位红线
      if (parsed.data.componentUomId !== undefined && parsed.data.componentUomId !== line.componentUomId) {
        const comp = await tx.item.findFirst({ where: { id: line.componentItemId, deletedAt: null } });
        if (!comp || !comp.stockUomId || comp.stockUomId !== parsed.data.componentUomId) throw new Error("LINE_INVALID");
      }

      const cas = await tx.itemBom.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: { version: { increment: 1 }, updatedById: actorId },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");

      return tx.itemBomLine.update({
        where: { id: lineId },
        data: {
          ...(parsed.data.componentUomId !== undefined ? { componentUomId: parsed.data.componentUomId } : {}),
          ...(parsed.data.qtyPerFinishedUnit !== undefined ? { qtyPerFinishedUnit: new Prisma.Decimal(parsed.data.qtyPerFinishedUnit) } : {}),
          ...(parsed.data.lossRate !== undefined ? { lossRate: new Prisma.Decimal(parsed.data.lossRate) } : {}),
          ...(parsed.data.sort !== undefined ? { sort: parsed.data.sort } : {}),
          ...(parsed.data.remark !== undefined ? { remark: parsed.data.remark } : {}),
          updatedById: actorId,
        },
      });
    });

    await writeAuditLog({
      actorId,
      action: "bom.line.update",
      entityType: "itemBomLine",
      entityId: lineId,
      afterData: { bomId: id, qtyPerFinishedUnit: parsed.data.qtyPerFinishedUnit, lossRate: parsed.data.lossRate ?? undefined },
      ...meta,
    });
    return ok(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "LINE_NOT_FOUND") return failNotFound(ERROR_CODES.BOM_LINE_NOT_FOUND, "配方行不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT 状态可修改配方行");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "LINE_INVALID") return failConflict(ERROR_CODES.BOM_LINE_INVALID, "原料行非法（原料单位必须 = 原料库存单位）");
    console.error("[bom.line.update]", e);
    return failServer("修改配方行失败");
  }
}

/**
 * DELETE /api/boms/:id/lines/:lineId —— 删除配方行（仅 DRAFT；CAS version）
 * - DRAFT 未生效，物理删除（与 PATCH 整表重建先例一致）；同原料可再次添加
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.line.delete");
  const { id, lineId } = await params;
  const meta = requestMeta(request);

  const parsed = lineDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (bom.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      const line = await tx.itemBomLine.findFirst({ where: { id: lineId, bomId: id, deletedAt: null } });
      if (!line) throw new Error("LINE_NOT_FOUND");

      const cas = await tx.itemBom.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: { version: { increment: 1 }, updatedById: user!.id },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");

      await tx.itemBomLine.delete({ where: { id: lineId } });
      return line;
    });

    await writeAuditLog({
      actorId: user!.id,
      action: "bom.line.delete",
      entityType: "itemBomLine",
      entityId: lineId,
      afterData: { bomId: id, componentItemId: result.componentItemId },
      ...meta,
    });
    return ok({ id: lineId, deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "LINE_NOT_FOUND") return failNotFound(ERROR_CODES.BOM_LINE_NOT_FOUND, "配方行不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT 状态可删除配方行");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    console.error("[bom.line.delete]", e);
    return failServer("删除配方行失败");
  }
}
