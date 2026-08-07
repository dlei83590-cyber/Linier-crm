import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/invoices/:id/lines（行列表，lineNo asc；只读——行完全系统生成，不开放 PATCH） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice-line:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice-line.list");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");

  const lines = await prisma.invoiceLine.findMany({
    where: { invoiceId: id, deletedAt: null },
    orderBy: { lineNo: "asc" },
    include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
  });
  return ok(lines);
}
