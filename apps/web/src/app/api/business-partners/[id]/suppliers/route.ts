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
 * GET/POST /api/business-partners/:id/suppliers — Customer 360「供应商」Tab（Phase 3 MVP，Migration 0051）
 *
 * 领域事实：CustomerSupplier（客户 → 多供应商；BP-BP 自关联，customerId + supplierId 唯一）。
 * 说明：SupplierItem 是「物料-供应商」采购来源（item 维度），无法承载「客户 × 供应商」的档案关联语义
 *   → 最小关系表（不建 generic relation framework）。
 * 约束：supplierId 指向的往来单位 type ∈ {SUPPLIER, BOTH}；禁止自关联（客户 ≠ 供应商自身）。
 * 权限：复用 business-partner:view/edit——尽量复用既有 RBAC 模块，不新增权限模块（ADR-0028）。
 * HOLD：generic relation framework / 供应商关系分析。
 */

const createSchema = z.object({
  supplierId: z.string().min(1).max(64),
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/business-partners/:id/suppliers（分页列表；business-partner:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier.list");

  const { id } = await params;
  const bp = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!bp) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { customerId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.customerSupplier.count({ where }),
    prisma.customerSupplier.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        supplier: { select: { id: true, code: true, name: true, type: true, uscc: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/business-partners/:id/suppliers（新增客户供应商关联；business-partner:edit） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-supplier.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const customer = await tx.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!customer) throw new Error("CUSTOMER_INVALID");

      // 自关联禁止：客户不能把自己当作自己的供应商
      if (parsed.data.supplierId === id) throw new Error("SELF_LINK");

      const supplier = await tx.businessPartner.findFirst({
        where: { id: parsed.data.supplierId, deletedAt: null },
        select: { id: true, type: true },
      });
      if (!supplier) throw new Error("SUPPLIER_INVALID");
      if (supplier.type !== "SUPPLIER" && supplier.type !== "BOTH") throw new Error("SUPPLIER_TYPE_INVALID");

      const dup = await tx.customerSupplier.findFirst({
        where: { customerId: id, supplierId: parsed.data.supplierId, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw new Error("DUPLICATE");

      return tx.customerSupplier.create({
        data: {
          customerId: id,
          supplierId: parsed.data.supplierId,
          note: parsed.data.note?.trim() || null,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-supplier.create",
      entityType: "customerSupplier",
      entityId: created.id,
      afterData: { customerId: id, supplierId: created.supplierId, note: created.note },
      ...meta,
    });

    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "CUSTOMER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
    }
    if (err instanceof Error && err.message === "SELF_LINK") {
      return failValidation({ supplierId: ["不能将客户自身关联为供应商"] });
    }
    if (err instanceof Error && err.message === "SUPPLIER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "供应商（往来单位）不存在");
    }
    if (err instanceof Error && err.message === "SUPPLIER_TYPE_INVALID") {
      return failValidation({ supplierId: ["所选往来单位类型不是供应商（SUPPLIER/BOTH）"] });
    }
    if (err instanceof Error && err.message === "DUPLICATE") {
      return failConflict(ERROR_CODES.CONFLICT, "该供应商已关联到此客户");
    }
    return handleServerError(request, user?.id, "customer-supplier.create", err);
  }
}
