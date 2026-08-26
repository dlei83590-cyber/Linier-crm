import { NextRequest } from "next/server";
import type { CustomerLevel, CustomerCreditRating } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { CUSTOMER_LEVELS, SUPPLIER_RATINGS } from "@/lib/supplier-rating";

export const dynamic = "force-dynamic";

const customerSupplierRatingRuleCreateSchema = z.object({
  customerLevel: z.enum(CUSTOMER_LEVELS),
  minimumSupplierRating: z.enum(SUPPLIER_RATINGS),
  isActive: z.boolean().optional(),
});

/** GET /api/customer-supplier-rating-rules（分页；isActive 过滤；系统设置简单表格数据源） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-supplier-rating-rule:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier-rating-rule.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerSupplierRatingRule.count({ where }),
    prisma.customerSupplierRatingRule.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { customerLevel: "asc" }],
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/customer-supplier-rating-rules（创建规则；customerLevel 唯一；重复 → 409） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-supplier-rating-rule:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier-rating-rule.create");

  const meta = requestMeta(request);
  const parsed = customerSupplierRatingRuleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.customerSupplierRatingRule.findUnique({ where: { customerLevel: parsed.data.customerLevel } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, `客户等级 ${parsed.data.customerLevel} 已配置评级规则`);
  }

  const created = await prisma.customerSupplierRatingRule.create({
    data: {
      customerLevel: parsed.data.customerLevel as CustomerLevel,
      minimumSupplierRating: parsed.data.minimumSupplierRating as CustomerCreditRating,
      isActive: parsed.data.isActive ?? true,
      approvalStatus: "APPROVED",
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-supplier-rating-rule.create",
    entityType: "customerSupplierRatingRule",
    entityId: created.id,
    afterData: { customerLevel: created.customerLevel, minimumSupplierRating: created.minimumSupplierRating, isActive: created.isActive },
    ...meta,
  });

  return ok(created, undefined, 201);
}
