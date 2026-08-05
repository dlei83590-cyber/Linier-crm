import { NextRequest } from "next/server";
import type { PartnerAddressType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addressCreateSchema = z.object({
  addressType: z.enum(["REGISTERED", "BILLING", "SHIPPING", "WAREHOUSE", "FACTORY", "INVOICING", "CONTACT"]).default("REGISTERED"),
  recipient: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  province: z.string().max(50).optional(),
  city: z.string().max(50).optional(),
  district: z.string().max(50).optional(),
  detail: z.string().max(200).optional(),
  isDefault: z.boolean().default(false),
  sort: z.number().int().default(0),
});

/** GET /api/suppliers/:id/addresses（地址列表，PartnerAddress 共享表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-address:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-address.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const [total, items] = await Promise.all([
    prisma.partnerAddress.count({ where: { partnerId: supplier.partnerId, deletedAt: null } }),
    prisma.partnerAddress.findMany({
      where: { partnerId: supplier.partnerId, deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { sort: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers/:id/addresses（新增地址，写入 PartnerAddress；isDefault 时清除其他默认地址） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-address:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-address.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = addressCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.partnerAddress.updateMany({
        where: { partnerId: supplier.partnerId, deletedAt: null },
        data: { isDefault: false, updatedById: user?.id ?? null },
      });
    }
    return tx.partnerAddress.create({
      data: { ...parsed.data, addressType: parsed.data.addressType as PartnerAddressType, partnerId: supplier.partnerId, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-address.create",
    entityType: "partner-address",
    entityId: created.id,
    meta: { supplierId: id, partnerId: supplier.partnerId, addressType: created.addressType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
