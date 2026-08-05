import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const settlementCreateSchema = z.object({
  paymentTerms: z.string().max(200).optional(),
  creditDays: z.number().int().nonnegative().optional(),
  paymentMethod: z.string().max(50).optional(),
  currency: z.string().max(10).optional(),
});

/** GET /api/suppliers/:id/settlements（结算条款列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-settlement:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-settlement.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.supplierSettlement.count({ where: { supplierId: id, deletedAt: null } }),
    prisma.supplierSettlement.findMany({
      where: { supplierId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/settlements（新增结算条款） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-settlement:create");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-settlement.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = settlementCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const created = await prisma.supplierSettlement.create({
    data: { ...parsed.data, supplierId: id, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-settlement.create",
    entityType: "supplier-settlement",
    entityId: created.id,
    meta: { supplierId: id, paymentTerms: created.paymentTerms, creditDays: created.creditDays },
    ...meta,
  });

  return ok(created, undefined, 201);
}
