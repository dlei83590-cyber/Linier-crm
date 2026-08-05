import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addressCreateSchema = z.object({
  addressType: z.enum(["REGISTERED", "SHIPPING", "INVOICING", "CONTACT"]).default("REGISTERED"),
  recipient: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  province: z.string().max(50).optional(),
  city: z.string().max(50).optional(),
  district: z.string().max(50).optional(),
  detail: z.string().max(300).optional(),
  isDefault: z.boolean().default(false),
  sort: z.number().int().default(0),
});

/** GET /api/customers/:id/addresses（地址列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-address:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-address.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const addressType = searchParams.get("addressType")?.trim();

  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const where = {
    customerId: id,
    deletedAt: null,
    ...(addressType ? { addressType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerAddress.count({ where }),
    prisma.customerAddress.findMany({
      where,
      orderBy: [{ isDefault: "desc" }, { sort: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/customers/:id/addresses（创建地址；isDefault 时清除其他默认地址） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-address:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-address.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = addressCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!customer) return failNotFound(ERROR_CODES.NOT_FOUND, "客户不存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId: id, deletedAt: null },
        data: { isDefault: false, updatedById: user?.id ?? null },
      });
    }
    return tx.customerAddress.create({
      data: { ...parsed.data, customerId: id, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-address.create",
    entityType: "customer-address",
    entityId: created.id,
    meta: { customerId: id, addressType: created.addressType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
