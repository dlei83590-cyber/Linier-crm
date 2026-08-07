import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { parsePagination } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/invoices（分页 + code/customerId/status/dateFrom/dateTo/dueDateFrom/dueDateTo/currency/salesOrderId/deliveryId 过滤 + createdAt desc）
 * 注意：不开放 POST /api/invoices——Direct Invoice 禁止（CTO 锁定），唯一创建入口 POST /api/deliveries/{id}/invoice。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const customerId = searchParams.get("customerId")?.trim();
  const status = searchParams.get("status")?.trim();
  const dateFrom = searchParams.get("dateFrom")?.trim();
  const dateTo = searchParams.get("dateTo")?.trim();
  const dueDateFrom = searchParams.get("dueDateFrom")?.trim();
  const dueDateTo = searchParams.get("dueDateTo")?.trim();
  const currency = searchParams.get("currency")?.trim();
  const salesOrderId = searchParams.get("salesOrderId")?.trim();
  const deliveryId = searchParams.get("deliveryId")?.trim();
  const approvalStatus = searchParams.get("approvalStatus")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(customerId ? { customerId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(dateFrom || dateTo
      ? { invoiceDate: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) } }
      : {}),
    ...(dueDateFrom || dueDateTo
      ? { dueDate: { ...(dueDateFrom ? { gte: new Date(dueDateFrom) } : {}), ...(dueDateTo ? { lte: new Date(dueDateTo) } : {}) } }
      : {}),
    ...(currency ? { currency } : {}),
    ...(salesOrderId ? { salesOrderId } : {}),
    ...(deliveryId ? { deliveryId } : {}),
    ...(approvalStatus ? { approvalStatus: approvalStatus as never } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        delivery: { select: { id: true, code: true, status: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
