import { NextRequest } from "next/server";
import type { SupplierStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const supplierCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  partnerId: z.string().min(1),
  status: z.enum(["POTENTIAL", "QUALIFIED", "PREFERRED", "SUSPENDED", "BLACKLISTED"]).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  defaultLeadTime: z.number().int().positive().optional(),
  minOrderQty: z.coerce.number().nonnegative().optional(),
  currency: z.string().max(10).optional(),
  isPreferred: z.boolean().optional(),
});

/** GET /api/suppliers（分页 + code/name/status/partnerId/isPreferred 过滤，Sprint 3C-2 Supplier Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier:view");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const status = searchParams.get("status")?.trim();
  const partnerId = searchParams.get("partnerId")?.trim();
  const isPreferred = searchParams.get("isPreferred")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(status ? { status: status as SupplierStatus } : {}),
    ...(partnerId ? { partnerId } : {}),
    ...(isPreferred === "true" ? { isPreferred: true } : isPreferred === "false" ? { isPreferred: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        partner: { select: { id: true, code: true, name: true, uscc: true, type: true, bankName: true, bankAccount: true } },
        _count: {
          select: {
            qualifications: { where: { deletedAt: null } },
            certificates: { where: { deletedAt: null } },
            settlements: { where: { deletedAt: null } },
          },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/suppliers（创建供应商：partnerId 必填，校验 BP type=SUPPLIER/BOTH，自动写入 BusinessPartnerRole） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier:create");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier.create");

  const meta = requestMeta(request);
  const parsed = supplierCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const partner = await prisma.businessPartner.findFirst({ where: { id: parsed.data.partnerId, deletedAt: null } });
  if (!partner) return failConflict(ERROR_CODES.NOT_FOUND, "关联往来单位不存在");
  if (partner.type === "CUSTOMER") {
    return failConflict(ERROR_CODES.CONFLICT, "该往来单位类型为 CUSTOMER，不能创建供应商；请先调整为 SUPPLIER 或 BOTH");
  }

  const existing = await prisma.supplier.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "供应商编码已存在");
  }

  const created = await prisma.$transaction(async (tx) => {
    // BusinessPartner 唯一主体：自动写入 SUPPLIER 角色（幂等）
    await tx.businessPartnerRole.upsert({
      where: { partnerId_roleType: { partnerId: parsed.data.partnerId, roleType: "SUPPLIER" } },
      update: {},
      create: { partnerId: parsed.data.partnerId, roleType: "SUPPLIER", createdById: user!.id, updatedById: user!.id },
    });
    return tx.supplier.create({
      data: {
        ...parsed.data,
        minOrderQty: parsed.data.minOrderQty ?? null,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier.create",
    entityType: "supplier",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, partnerId: created.partnerId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
