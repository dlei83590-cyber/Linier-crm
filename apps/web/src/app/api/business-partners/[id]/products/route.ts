import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/business-partners/:id/products — Customer 360「产品」Tab（Phase 3 MVP，Migration 0051）
 *
 * 领域事实：CustomerProduct（客户 → 多产品；businessPartnerId + itemId 唯一）。
 * 说明：SupplierItem 是「物料-供应商」采购来源（item 维度），PartnerPrice 是「伙伴-物料」专属价（定价语义），
 *   均无法承载「客户 × 产品」的档案关联语义 → 最小关系表（不建 generic relation framework）。
 * 权限：复用 business-partner:view/edit——尽量复用既有 RBAC 模块，不新增权限模块（ADR-0028）。
 * HOLD：generic relation framework / 产品画像分析。
 */

const createSchema = z.object({
  itemId: z.string().min(1).max(64),
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/business-partners/:id/products（分页列表；business-partner:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-product.list");

  const { id } = await params;
  const bp = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!bp) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { businessPartnerId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.customerProduct.count({ where }),
    prisma.customerProduct.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        item: {
          select: { id: true, code: true, name: true, model: true, spec: true, brand: true, status: true },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/business-partners/:id/products（新增客户产品关联；business-partner:edit） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-product.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const bp = await tx.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!bp) throw new Error("PARTNER_INVALID");

      const item = await tx.item.findFirst({ where: { id: parsed.data.itemId, deletedAt: null }, select: { id: true } });
      if (!item) throw new Error("ITEM_INVALID");

      const dup = await tx.customerProduct.findFirst({
        where: { businessPartnerId: id, itemId: parsed.data.itemId, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw new Error("DUPLICATE");

      return tx.customerProduct.create({
        data: {
          businessPartnerId: id,
          itemId: parsed.data.itemId,
          note: parsed.data.note?.trim() || null,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-product.create",
      entityType: "customerProduct",
      entityId: created.id,
      afterData: { businessPartnerId: id, itemId: created.itemId, note: created.note },
      ...meta,
    });

    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "PARTNER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
    }
    if (err instanceof Error && err.message === "ITEM_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "产品（物料）不存在");
    }
    if (err instanceof Error && err.message === "DUPLICATE") {
      return failConflict(ERROR_CODES.CONFLICT, "该产品已关联到此客户");
    }
    return handleServerError(request, user?.id, "customer-product.create", err);
  }
}
