import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { computeLineAmount } from "@/lib/production-inbound/helpers";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  id: z.string().optional(), // 已有行（编辑时按 id 覆盖）
  fromItemId: z.string().min(1),
  fromQty: z.coerce.number().positive(),
  toItemId: z.string().min(1),
  toQty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  remark: z.string().max(500).nullable().optional(),
});

const productionInboundUpdateSchema = z
  .object({
    inboundDate: z.string().datetime().optional(),
    warehouseId: z.string().min(1).optional(),
    batchNo: z.string().max(100).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    lines: z.array(lineSchema).min(1).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  lines: {
    include: {
      fromItem: { select: { id: true, code: true, name: true, model: true } },
      toItem: { select: { id: true, code: true, name: true, model: true } },
    },
  },
} as const;

/** GET /api/production-inbounds/:id（详情含行） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-inbound:view");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.get");

  const { id } = await params;
  const inbound = await prisma.productionInbound.findFirst({
    where: { id, deletedAt: null },
    include: detailInclude,
  });
  if (!inbound) return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
  return ok(inbound);
}

/** PATCH /api/production-inbounds/:id（仅 DRAFT；CAS version；行整体替换 + 金额服务端重算） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-inbound:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = productionInboundUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const actorId = user!.id;

  const { version, ...updates } = parsed.data;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.productionInbound.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new Error("NOT_FOUND");
      if (existing.status !== "DRAFT") throw new Error("INVALID_STATE");

      const data: Record<string, unknown> = {
        ...(updates.inboundDate ? { inboundDate: new Date(updates.inboundDate) } : {}),
        ...(updates.warehouseId !== undefined ? { warehouseId: updates.warehouseId } : {}),
        ...(updates.batchNo !== undefined ? { batchNo: updates.batchNo } : {}),
        ...(updates.remark !== undefined ? { remark: updates.remark } : {}),
        updatedById: actorId,
      };

      // 行整体替换（仅 DRAFT）：先软删旧行，再建新行（金额服务端 canonical）
      if (updates.lines) {
        const itemIds = new Set<string>();
        for (const l of updates.lines) {
          if (l.fromItemId === l.toItemId) throw new Error("ITEM_INVALID");
          itemIds.add(l.fromItemId);
          itemIds.add(l.toItemId);
        }
        const found = await tx.item.findMany({
          where: { id: { in: [...itemIds] }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== itemIds.size) throw new Error("ITEM_INVALID");

        const newLines = updates.lines.map((l) => {
          const unitCost = new Prisma.Decimal(l.unitCost);
          const toQty = new Prisma.Decimal(l.toQty);
          return {
            fromItemId: l.fromItemId,
            fromQty: new Prisma.Decimal(l.fromQty),
            toItemId: l.toItemId,
            toQty,
            unitCost,
            amount: computeLineAmount(unitCost, toQty),
            remark: l.remark ?? null,
            createdById: actorId,
          };
        });
        const totalQty = newLines.reduce((s, l) => s.plus(l.toQty), new Prisma.Decimal(0));
        const totalAmount = newLines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
        data.totalQty = totalQty;
        data.totalAmount = totalAmount;
        data.lines = newLines;
      }

      // CAS header 更新（updateMany 不支持嵌套行写入 → 行单独处理）
      const cas = await tx.productionInbound.updateMany({
        where: { id, version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (cas.count !== 1) {
        const still = await tx.productionInbound.findFirst({ where: { id, deletedAt: null } });
        throw still ? new Error("VERSION_CONFLICT") : new Error("NOT_FOUND");
      }
      // 行整体替换（仅 DRAFT）：先物理删旧行再建新行（同事务；行无软删设计，直接 deleteMany）
      if (updates.lines) {
        await tx.productionInboundLine.deleteMany({ where: { inboundId: id } });
        await tx.productionInboundLine.createMany({
          data: data.lines as never,
        });
      }
      return tx.productionInbound.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: detailInclude,
      });
    });

    await writeAuditLog({
      actorId,
      action: "production-inbound.update",
      entityType: "productionInbound",
      entityId: id,
      afterData: { inboundNo: updated.inboundNo, status: updated.status },
      ...meta,
    });
    return ok(updated);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_INVALID_STATE, "仅 DRAFT 状态可编辑");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "ITEM_INVALID") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_ITEM_INVALID, "物料不存在/已停用或 fromItem 与 toItem 相同");
    console.error("[production-inbound.update]", e);
    return failServer("更新生产入库单失败");
  }
}

/** DELETE /api/production-inbounds/:id（仅 DRAFT 软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "production-inbound:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.productionInbound.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
  if (existing.status !== "DRAFT") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_INVALID_STATE, "仅 DRAFT 状态可删除");

  await prisma.productionInbound.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "production-inbound.delete",
    entityType: "productionInbound",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
