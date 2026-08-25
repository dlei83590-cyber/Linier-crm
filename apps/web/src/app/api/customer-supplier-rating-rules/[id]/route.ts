import { NextRequest } from "next/server";
import type { CustomerCreditRating } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";
import { SUPPLIER_RATINGS } from "@/lib/supplier-rating";

export const dynamic = "force-dynamic";

const customerSupplierRatingRuleUpdateSchema = z
  .object({
    minimumSupplierRating: z.enum(SUPPLIER_RATINGS).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/customer-supplier-rating-rules/:id（规则详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-supplier-rating-rule:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier-rating-rule.get");

  const { id } = await params;
  const rule = await prisma.customerSupplierRatingRule.findFirst({ where: { id, deletedAt: null } });
  if (!rule) return failNotFound(ERROR_CODES.NOT_FOUND, "评级规则不存在");
  return ok(rule);
}

/** PATCH /api/customer-supplier-rating-rules/:id（乐观锁 version；仅调整 minimumSupplierRating / isActive） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-supplier-rating-rule:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier-rating-rule.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = customerSupplierRatingRuleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.customerSupplierRatingRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "评级规则不存在");

  const cas = await casUpdate(prisma, "customerSupplierRatingRule", id, version, {
    ...updates,
    minimumSupplierRating: updates.minimumSupplierRating as CustomerCreditRating | undefined,
    updatedById: user?.id ?? null,
  });
  if (cas.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "评级规则不存在");
  if (cas.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");

  const updated = await prisma.customerSupplierRatingRule.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "评级规则不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-supplier-rating-rule.update",
    entityType: "customerSupplierRatingRule",
    entityId: id,
    beforeData: { customerLevel: existing.customerLevel, minimumSupplierRating: existing.minimumSupplierRating, isActive: existing.isActive },
    afterData: { customerLevel: updated.customerLevel, minimumSupplierRating: updated.minimumSupplierRating, isActive: updated.isActive },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customer-supplier-rating-rules/:id（软删除；规则停用即推荐不再过滤——无规则默认展示全部） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-supplier-rating-rule:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier-rating-rule.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.customerSupplierRatingRule.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "评级规则不存在");

  await prisma.customerSupplierRatingRule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-supplier-rating-rule.delete",
    entityType: "customerSupplierRatingRule",
    entityId: id,
    beforeData: { customerLevel: existing.customerLevel, minimumSupplierRating: existing.minimumSupplierRating },
    ...meta,
  });

  return ok({ id, deleted: true });
}
