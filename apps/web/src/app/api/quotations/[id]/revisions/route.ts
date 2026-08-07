import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationRevisionCreateSchema } from "@/lib/api/schemas";
import { createQuotationRevision } from "@/lib/quotation/helpers";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/** GET /api/quotations/:id/revisions（修订历史，revisionNo desc） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-revision:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-revision.list");

  const { id } = await params;
  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  const revisions = await prisma.quotationRevision.findMany({
    where: { quotationId: id, deletedAt: null },
    orderBy: { revisionNo: "desc" },
  });
  return ok(revisions);
}

/**
 * POST /api/quotations/:id/revisions（系统生成修订，仅 DRAFT/REJECTED）
 * CTO：Revision 只能系统生成，不开放自由编辑——body 仅接受 changeReason，快照由系统从当前状态生成。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-revision:create");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-revision.create");

  const { id } = await params;
  const parsed = quotationRevisionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
  });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可生成修订");
  }

  const revision = await prisma.$transaction(async (tx) => {
    const created = await createQuotationRevision(
      tx,
      id,
      parsed.data.changeReason,
      { quotation: { id: quotation.id, code: quotation.code, status: quotation.status, totalAmount: quotation.totalAmount }, lines: quotation.lines },
      user?.id,
    );
    return created;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "quotation-revision.create",
    entityType: "quotationRevision",
    entityId: revision.id,
    afterData: { quotationId: id, revisionNo: revision.revisionNo, changeReason: parsed.data.changeReason },
    ...meta,
  });

  return ok(revision, undefined, 201);
}
