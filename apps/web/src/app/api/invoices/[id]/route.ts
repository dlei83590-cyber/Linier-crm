import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/:id（详情：Invoice + Customer + Workflow + Delivery/SalesOrder Summary + Lines + Latest Revision/Snapshot）
 * 一次带出 Dashboard 所需全部数据，避免前端 5~6 个额外请求（CTO 指令）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.get");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      // 来源交付摘要 + 经 Delivery 溯源 SalesOrder 摘要（Invoice.salesOrderId 为冗余投影，无直接 relation）
      delivery: {
        select: { id: true, code: true, status: true, deliveryDate: true },
        include: {
          salesOrder: { select: { id: true, code: true, status: true, currency: true } },
        },
      },
      workflowInstance: { select: { id: true, status: true, currentStepNo: true, startedAt: true, completedAt: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");

  return ok(invoice);
}
