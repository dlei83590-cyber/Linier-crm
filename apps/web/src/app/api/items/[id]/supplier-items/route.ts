import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const supplierItemCreateSchema = z.object({
  supplierId: z.string().min(1),
  supplierCode: z.string().max(100).optional(),
  moq: z.coerce.number().nonnegative().optional(),
  leadTime: z.number().int().positive().optional(),
  currency: z.string().max(10).default("CNY"),
  purchasePrice: z.coerce.number().nonnegative().optional(),
  isPreferred: z.boolean().default(false),
  incoterm: z.string().max(20).optional(),
  paymentTerm: z.string().max(50).optional(),
});

/** GET /api/items/:id/supplier-items（供应商物料列表，一个 Item 多供应商） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-supplier:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-supplier.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.supplierItem.count({ where: { itemId: id, deletedAt: null } }),
    prisma.supplierItem.findMany({
      where: { itemId: id, deletedAt: null },
      orderBy: [{ isPreferred: "desc" }, { createdAt: "desc" }],
      skip,
      take,
      include: { supplier: { select: { id: true, code: true, name: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/supplier-items（新增供应商；重复 409；supplier 校验 type=SUPPLIER/BOTH） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-supplier:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-supplier.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = supplierItemCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const supplier = await prisma.businessPartner.findFirst({ where: { id: parsed.data.supplierId, deletedAt: null } });
  if (!supplier) return failConflict(ERROR_CODES.NOT_FOUND, "供应商不存在");
  if (supplier.type === "CUSTOMER") {
    return failConflict(ERROR_CODES.CONFLICT, "该往来单位类型为 CUSTOMER，不能作为供应商");
  }

  const existing = await prisma.supplierItem.findFirst({
    where: { itemId: id, supplierId: parsed.data.supplierId, deletedAt: null },
  });
  if (existing) return failConflict(ERROR_CODES.CONFLICT, "该供应商已关联此物料");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPreferred) {
      await tx.supplierItem.updateMany({
        where: { itemId: id, deletedAt: null },
        data: { isPreferred: false, updatedById: user?.id ?? null },
      });
    }
    return tx.supplierItem.create({
      data: { ...parsed.data, itemId: id, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-supplier.create",
    entityType: "item-supplier",
    entityId: created.id,
    meta: { itemId: id, supplierId: created.supplierId, purchasePrice: created.purchasePrice, isPreferred: created.isPreferred },
    ...meta,
  });

  return ok(created, undefined, 201);
}
