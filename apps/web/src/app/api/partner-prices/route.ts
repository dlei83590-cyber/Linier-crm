import { NextRequest } from "next/server";
import type { PartnerRoleType, PriceSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const partnerPriceCreateSchema = z.object({
  partnerId: z.string().min(1),
  partnerRoleType: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "LOGISTICS", "OUTSOURCING"]).optional(),
  partnerRoleName: z.string().max(100).nullable().optional(),
  itemId: z.string().min(1),
  unitPrice: z.coerce.number().nonnegative(),
  currency: z.string().max(10).optional(),
  taxProfileId: z.string().min(1).nullable().optional(),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
  priceSource: z.enum(["MANUAL", "IMPORT", "FORMULA", "PROMOTION", "SUPPLIER", "MARKET"]).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  approvalRequired: z.boolean().optional(),
});

/** GET /api/partner-prices（分页 + partnerId/itemId/partnerRoleType 过滤，Sprint 3C-4 Price Foundation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-price:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-price.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const partnerId = searchParams.get("partnerId")?.trim();
  const itemId = searchParams.get("itemId")?.trim();
  const partnerRoleType = searchParams.get("partnerRoleType")?.trim();

  const where = {
    deletedAt: null,
    ...(partnerId ? { partnerId } : {}),
    ...(itemId ? { itemId } : {}),
    ...(partnerRoleType ? { partnerRoleType: partnerRoleType as PartnerRoleType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.partnerPrice.count({ where }),
    prisma.partnerPrice.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        partner: { select: { id: true, code: true, name: true, type: true } },
        item: { select: { id: true, code: true, name: true, model: true } },
        taxProfile: { select: { id: true, code: true, name: true, rate: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/partner-prices（创建专属价：partnerId+itemId 必填，Partner 级价格） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-price:create");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-price.create");

  const meta = requestMeta(request);
  const parsed = partnerPriceCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const partner = await prisma.businessPartner.findFirst({ where: { id: parsed.data.partnerId, deletedAt: null } });
  if (!partner) return failConflict(ERROR_CODES.NOT_FOUND, "关联往来单位不存在");

  const item = await prisma.item.findFirst({ where: { id: parsed.data.itemId, deletedAt: null } });
  if (!item) return failConflict(ERROR_CODES.NOT_FOUND, "关联物料不存在");

  if (parsed.data.taxProfileId) {
    const taxProfile = await prisma.taxProfile.findFirst({ where: { id: parsed.data.taxProfileId, deletedAt: null } });
    if (!taxProfile) return failConflict(ERROR_CODES.NOT_FOUND, "关联税率档案不存在");
  }

  const created = await prisma.partnerPrice.create({
    data: {
      partnerId: parsed.data.partnerId,
      partnerRoleType: (parsed.data.partnerRoleType as PartnerRoleType) ?? partner.type,
      partnerRoleName: parsed.data.partnerRoleName ?? null,
      itemId: parsed.data.itemId,
      unitPrice: parsed.data.unitPrice,
      currency: parsed.data.currency ?? "CNY",
      taxProfileId: parsed.data.taxProfileId ?? null,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
      effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
      priceSource: (parsed.data.priceSource as PriceSource) ?? "MANUAL",
      priority: parsed.data.priority ?? 100,
      approvalRequired: parsed.data.approvalRequired ?? false,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-price.create",
    entityType: "partnerPrice",
    entityId: created.id,
    afterData: { partnerId: created.partnerId, itemId: created.itemId, unitPrice: created.unitPrice },
    ...meta,
  });

  return ok(created, undefined, 201);
}
