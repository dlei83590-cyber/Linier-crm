import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/invoices/:id/revisions（修订历史，revisionNo desc；只读——修订系统生成） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice-revision.list");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");

  const revisions = await prisma.invoiceRevision.findMany({
    where: { invoiceId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  return ok(revisions);
}
