import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { parsePagination } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales-orders（分页 + code/quotationId/customerId/status/dateFrom/dateTo 过滤 + createdAt desc）
 * 注意：本阶段不开放 POST /api/sales-orders——Direct Sales Order 未获 CTO 批准（锁定项①），
 * 唯一创建入口为 POST /api/quotations/{id}/convert（Sprint 4B 已实现）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const quotationId = searchParams.get("quotationId")?.trim();
  const customerId = searchParams.get("customerId")?.trim();
  const status = searchParams.get("status")?.trim();
  const dateFrom = searchParams.get("dateFrom")?.trim();
  const dateTo = searchParams.get("dateTo")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(quotationId ? { quotationId } : {}),
    ...(customerId ? { customerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(dateFrom || dateTo
      ? { orderDate: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) } }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        quotation: { select: { id: true, code: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
