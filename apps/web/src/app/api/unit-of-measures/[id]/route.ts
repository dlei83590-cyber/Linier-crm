import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { handleServerError } from "@/lib/api/server-error";
import { collectReferences, failReferenceConflict, REFERENCE_SAMPLE_LIMIT } from "@/lib/api/reference-guard";
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

  try {
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
  } catch (err) {
    // P2002：改 code 撞软删占位唯一约束 → 友好 409；其他 → 结构化日志（P0 Incident R2 模式）
    if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.CONFLICT, "计量单位编码已存在（历史删除记录仍占用该编码，请更换编码）");
    }
    return handleServerError(request, user?.id, "unit-of-measure.update", err);
  }
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
          items: { where: { deletedAt: null } },
          stockItems: { where: { deletedAt: null } },
          purchaseItems: { where: { deletedAt: null } },
          salesItems: { where: { deletedAt: null } },
          fromConversions: { where: { deletedAt: null } },
          toConversions: { where: { deletedAt: null } },
          quotationLines: { where: { deletedAt: null } },
          salesOrderLines: { where: { deletedAt: null } },
          deliveryLines: { where: { deletedAt: null } },
          invoiceLines: { where: { deletedAt: null } },
          creditDebitNoteLines: { where: { deletedAt: null } },
          purchaseRequisitionLines: { where: { deletedAt: null } },
          purchaseOrderLines: { where: { deletedAt: null } },
          purchaseReceiptLines: { where: { deletedAt: null } },
          warehouseReceiptLines: { where: { deletedAt: null } },
          purchaseReturnLines: { where: { deletedAt: null } },
          inventoryMovements: true, // InventoryMovement 是不可变事实（无 deletedAt），始终计入引用
          transferLines: { where: { deletedAt: null } },
          adjustmentLines: { where: { deletedAt: null } },
          conversionLines: { where: { deletedAt: null } },
          conversionBaseUoms: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "计量单位不存在");

  // 引用检查：被物料/单据行/换算关系引用 → 不可删除（可编辑）
  const c = existing._count;
  // 引用出处（问题二）：按引用族给出条数 + 真实单据编号（物料/单据行/换算/流水逐族可定位）
  const references = await collectReferences([
    {
      entity: "物料（基本/库存/采购/销售单位）",
      count: () => Promise.resolve(c.items + c.stockItems + c.purchaseItems + c.salesItems),
      samples: async () =>
        (
          await prisma.item.findMany({
            where: {
              // Item 默认单位字段为 unitId（relation "ItemUnit"）；禁止写成不存在的 uomId
              OR: [{ unitId: id }, { stockUomId: id }, { purchaseUomId: id }, { salesUomId: id }],
              deletedAt: null,
            },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { code: "asc" },
            select: { code: true },
          })
        ).map((i) => i.code),
      releaseHint: "先修改对应物料的计量单位",
    },
    {
      entity: "报价单行",
      count: () => Promise.resolve(c.quotationLines),
      samples: async () =>
        (
          await prisma.quotationLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { quotation: { select: { code: true } } },
          })
        ).map((l) => l.quotation.code),
      releaseHint: "先处理（替换/删除）对应报价单行",
    },
    {
      entity: "销售订单行",
      count: () => Promise.resolve(c.salesOrderLines),
      samples: async () =>
        (
          await prisma.salesOrderLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { salesOrder: { select: { code: true } } },
          })
        ).map((l) => l.salesOrder.code),
      releaseHint: "先回退/删除对应销售订单",
    },
    {
      entity: "送货单行",
      count: () => Promise.resolve(c.deliveryLines),
      samples: async () =>
        (
          await prisma.deliveryLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { delivery: { select: { code: true } } },
          })
        ).map((l) => l.delivery.code),
      releaseHint: "先回退/删除对应送货单",
    },
    {
      entity: "销售发票行",
      count: () => Promise.resolve(c.invoiceLines),
      samples: async () =>
        (
          await prisma.invoiceLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { invoice: { select: { code: true, taxInvoiceNo: true } } },
          })
        ).map((l) => l.invoice.code ?? l.invoice.taxInvoiceNo ?? ""),
      releaseHint: "先红冲/删除对应发票",
    },
    {
      entity: "贷项/借项通知单行",
      count: () => Promise.resolve(c.creditDebitNoteLines),
      samples: async () =>
        (
          await prisma.creditDebitNoteLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { creditDebitNote: { select: { code: true } } },
          })
        ).map((l) => l.creditDebitNote.code),
      releaseHint: "先回退/删除对应贷项/借项通知单",
    },
    {
      entity: "采购申请行",
      count: () => Promise.resolve(c.purchaseRequisitionLines),
      samples: async () =>
        (
          await prisma.purchaseRequisitionLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { purchaseRequisition: { select: { code: true } } },
          })
        ).map((l) => l.purchaseRequisition.code),
      releaseHint: "先删除对应采购申请",
    },
    {
      entity: "采购订单行",
      count: () => Promise.resolve(c.purchaseOrderLines),
      samples: async () =>
        (
          await prisma.purchaseOrderLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { purchaseOrder: { select: { code: true } } },
          })
        ).map((l) => l.purchaseOrder.code),
      releaseHint: "先回退/删除对应采购订单",
    },
    {
      entity: "收货单行",
      count: () => Promise.resolve(c.purchaseReceiptLines),
      samples: async () =>
        (
          await prisma.purchaseReceiptLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { purchaseReceipt: { select: { code: true } } },
          })
        ).map((l) => l.purchaseReceipt.code),
      releaseHint: "先回退/删除对应收货单",
    },
    {
      entity: "入库单行",
      count: () => Promise.resolve(c.warehouseReceiptLines),
      samples: async () =>
        (
          await prisma.warehouseReceiptLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { warehouseReceipt: { select: { code: true } } },
          })
        ).map((l) => l.warehouseReceipt.code),
      releaseHint: "先回退/删除对应入库单",
    },
    {
      entity: "退货单行",
      count: () => Promise.resolve(c.purchaseReturnLines),
      samples: async () =>
        (
          await prisma.purchaseReturnLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { purchaseReturn: { select: { code: true } } },
          })
        ).map((l) => l.purchaseReturn.code),
      releaseHint: "先删除对应退货单",
    },
    {
      entity: "单位换算关系",
      count: () => Promise.resolve(c.fromConversions + c.toConversions),
      samples: async () =>
        (
          await prisma.uomConversion.findMany({
            where: { OR: [{ fromUomId: id }, { toUomId: id }], deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { fromUom: { select: { code: true } }, toUom: { select: { code: true } } },
          })
        ).map((u) => `${u.fromUom.code} → ${u.toUom.code}`),
      releaseHint: "先删除对应单位换算关系",
    },
    {
      entity: "库存流水",
      count: () => Promise.resolve(c.inventoryMovements),
      samples: async () =>
        (
          await prisma.inventoryMovement.findMany({
            where: { uomId: id },
            take: REFERENCE_SAMPLE_LIMIT,
            orderBy: { committedAt: "desc" },
            select: { movementNo: true },
          })
        ).map((m) => m.movementNo),
      releaseHint: "库存流水为不可变事实（保持库存溯源）",
    },
    {
      entity: "库存调拨单行",
      count: () => Promise.resolve(c.transferLines),
      samples: async () =>
        (
          await prisma.inventoryTransferLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { transferHeader: { select: { transferNo: true } } },
          })
        ).map((l) => l.transferHeader.transferNo),
      releaseHint: "先删除对应调拨单",
    },
    {
      entity: "库存调整单行",
      count: () => Promise.resolve(c.adjustmentLines),
      samples: async () =>
        (
          await prisma.inventoryAdjustmentLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { adjustmentHeader: { select: { adjustmentNo: true } } },
          })
        ).map((l) => l.adjustmentHeader.adjustmentNo),
      releaseHint: "先删除对应库存调整单",
    },
    {
      entity: "库存转换单行",
      count: () => Promise.resolve(c.conversionLines),
      samples: async () =>
        (
          await prisma.inventoryConversionLine.findMany({
            where: { uomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { conversionHeader: { select: { conversionNo: true } } },
          })
        ).map((l) => l.conversionHeader.conversionNo),
      releaseHint: "先删除对应库存转换单",
    },
    {
      entity: "库存转换基准单位",
      count: () => Promise.resolve(c.conversionBaseUoms),
      samples: async () =>
        (
          await prisma.inventoryConversion.findMany({
            where: { baseUomId: id, deletedAt: null },
            take: REFERENCE_SAMPLE_LIMIT,
            select: { conversionNo: true },
          })
        ).map((v) => v.conversionNo),
      releaseHint: "该计量单位被库存转换单作为基准单位引用",
    },
  ]);
  if (references.length > 0) {
    return failReferenceConflict(
      ERROR_CODES.CONFLICT,
      `计量单位「${existing.code} ${existing.name}」`,
      references,
    );
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
