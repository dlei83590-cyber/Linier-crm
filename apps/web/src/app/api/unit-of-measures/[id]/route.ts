import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const unitOfMeasureUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    symbol: z.string().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/unit-of-measures/:id（详情，含引用计数） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "unit-of-measure:view");
  if (denied) return denied;
  requestLog(request, user?.id, "unit-of-measure.get");

  const { id } = await params;
  const uom = await prisma.unitOfMeasure.findFirst({ where: { id, deletedAt: null } });
  if (!uom) return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");
  return ok(uom);
}

/** PATCH /api/unit-of-measures/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "unit-of-measure:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "unit-of-measure.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = unitOfMeasureUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.unitOfMeasure.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");

  if (updates.code) {
    const codeExisting = await prisma.unitOfMeasure.findUnique({ where: { code: updates.code } });
    if (codeExisting && codeExisting.id !== id && !codeExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "计量单位编码已存在");
    }
  }

  const cas = await casUpdate(prisma, "unitOfMeasure", id, version, {
    ...updates,
    updatedById: user!.id,
  });
  if (cas.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");
  if (cas.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.unitOfMeasure.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "unit-of-measure.update",
    entityType: "unitOfMeasure",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/unit-of-measures/:id（软删除；被物料/单据/换算引用 → 不可删除（可编辑）） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "unit-of-measure:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "unit-of-measure.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.unitOfMeasure.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          items: true,
          stockItems: true,
          purchaseItems: true,
          salesItems: true,
          fromConversions: true,
          toConversions: true,
          quotationLines: true,
          salesOrderLines: true,
          deliveryLines: true,
          invoiceLines: true,
          creditDebitNoteLines: true,
          purchaseRequisitionLines: true,
          purchaseOrderLines: true,
          purchaseReceiptLines: true,
          warehouseReceiptLines: true,
          purchaseReturnLines: true,
          inventoryMovements: true,
          transferLines: true,
          adjustmentLines: true,
          conversionLines: true,
          conversionBaseUoms: true,
        },
      },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");

  // 引用检查：被物料/单据行/换算关系引用 → 不可删除（可编辑）
  const c = existing._count;
  const referenced =
    c.items +
    c.stockItems +
    c.purchaseItems +
    c.salesItems +
    c.fromConversions +
    c.toConversions +
    c.quotationLines +
    c.salesOrderLines +
    c.deliveryLines +
    c.invoiceLines +
    c.creditDebitNoteLines +
    c.purchaseRequisitionLines +
    c.purchaseOrderLines +
    c.purchaseReceiptLines +
    c.warehouseReceiptLines +
    c.purchaseReturnLines +
    c.inventoryMovements +
    c.transferLines +
    c.adjustmentLines +
    c.conversionLines +
    c.conversionBaseUoms;
  if (referenced > 0) {
    return failConflict(ERROR_CODES.CONFLICT, "计量单位已被物料/单据/换算引用，不能删除（可编辑）");
  }

  await prisma.unitOfMeasure.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "unit-of-measure.delete",
    entityType: "unitOfMeasure",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
