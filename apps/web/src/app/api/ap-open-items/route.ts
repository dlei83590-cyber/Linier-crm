import { NextRequest } from "next/server";
import type { SupplierInvoiceSettlementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/ap-open-items — 应付未结项只读查询（Pending Pages：ap-open-items）
 *
 * SSOT：ApOpenItem（5C-1C1 POST 同事务产生的 materialized projection / read model）。
 * 红线：openAmount 为服务端投影（= Liability + CN/DN - Allocations），只读展示；
 * 本端点不提供任何写能力（付款/核销/冲销属 5C-2 HOLD，解除需 CTO 指令）。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "ap-open-item:view");
  if (denied) return denied;
  requestLog(request, user?.id, "ap-open-item.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const supplierId = searchParams.get("supplierId")?.trim();
  const settlementStatus = searchParams.get("settlementStatus")?.trim();
  const currency = searchParams.get("currency")?.trim();
  const dueDateFrom = searchParams.get("dueDateFrom")?.trim();
  const dueDateTo = searchParams.get("dueDateTo")?.trim();

  const where = {
    ...(supplierId ? { supplierId } : {}),
    ...(settlementStatus ? { settlementStatus: settlementStatus as SupplierInvoiceSettlementStatus } : {}),
    ...(currency ? { currency } : {}),
    ...(dueDateFrom ? { dueDate: { gte: new Date(dueDateFrom) } } : {}),
    ...(dueDateTo ? { dueDate: { lte: new Date(dueDateTo) } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.apOpenItem.count({ where }),
    prisma.apOpenItem.findMany({
      where,
      orderBy: [{ settlementStatus: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      // ApOpenItem 无 supplier 关系字段（仅 supplierId）→ 供应商摘要经 apLiabilityFact.supplier 关联取（5C-1C1 保证 supplierId 一致）
      include: {
        apLiabilityFact: {
          select: {
            grossAmount: true,
            netAmount: true,
            inputVatAmount: true,
            dueDate: true,
            supplier: { select: { id: true, code: true, name: true } },
            supplierInvoice: { select: { id: true, invoiceNo: true, supplierInvoiceNo: true, documentStatus: true } },
          },
        },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}