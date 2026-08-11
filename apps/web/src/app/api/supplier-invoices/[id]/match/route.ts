import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { supplierInvoiceMatchSchema } from '@/lib/api/schemas';
import { runMatch } from '@/lib/supplier-invoice/match-helpers';
import { maybeTriggerSupplierInvoiceApproval } from '@/lib/supplier-invoice/workflow-sync';
import { publishSupplierInvoiceEvent } from '@/lib/supplier-invoice/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/supplier-invoices/:id/match —— Immutable 3-Way Match（CTO #9238/#9247 分层指令）
 * - **只推进 documentStatus：SUBMITTED/MATCHED → MATCHED**（追加 immutable revision）；
 *   **Match API 自己不得写 approvedMatchRunId/approvedMatchRevision**（Approval 单独接 Workflow）
 * - **Match Engine（runMatch）事务内固定顺序**（#9247）：
 *   FOR UPDATE 锁 SupplierInvoice header（唯一串行点）→ 重读状态/current run → 状态门禁
 *   （SUBMITTED/MATCHED 可进；APPROVED/POSTED/CANCELLED 禁直接 re-match → 409 MATCH_NOT_MATCHABLE）→
 *   CAS version → 锁内算 next revision（max+1）→ 来源链重验（verifyReceiptBasedSourceChain 复用：
 *   WHR POSTED + 链一致 + Item ACTIVE + 累计守恒）→ 服务端 snapshot 计算（客户端不得上传计算结果）→
 *   创建 MatchRun + MatchLines（immutable，DB trigger 兜底）→ 更新 current projection
 *   （header.currentMatchRunId + lines currentMatchRunId/currentMatchStatus/matchedQty/variance*）→
 *   CAS documentStatus → MATCHED（version+1）——同一 caller transaction
 * - 红线：不创建 GrirRecord/ApLiabilityFact/ApOpenItem；不写 postedAt/postedById；不接 CN/DN
 * - 事件：Match 事务提交后发布 `SupplierInvoiceMatched`（EVENTS v1.32，引用 matchRunId + revision）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // match 映射现有动作（match→:edit，不新造权限体系——对齐 5C-1A submit→:edit）
  const denied = requirePermission(user, 'supplier-invoice:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.match');

  const { id } = await params;
  const parsed = supplierInvoiceMatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      return runMatch(tx, { invoiceId: id, version, actorId });
    });
  } catch (err) {
    console.error('[supplier-invoice.match]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '三单匹配失败', 500);
  }

  if (!result.ok) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.SUPPLIER_INVOICE_NOT_FOUND, msg: '供应商发票不存在', status: 404 },
      NOT_MATCHABLE: { code: ERROR_CODES.SUPPLIER_INVOICE_MATCH_NOT_MATCHABLE, msg: '仅 SUBMITTED/MATCHED 可 Match；APPROVED/POSTED/CANCELLED 禁直接 re-match', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      NO_LINES: { code: ERROR_CODES.SUPPLIER_INVOICE_MATCH_NO_LINES, msg: '发票至少需要一条有效行', status: 400 },
      WHR_NOT_POSTED: { code: ERROR_CODES.SUPPLIER_INVOICE_WHR_NOT_POSTED, msg: '入库行所属 WHR 必须已 POSTED（只有已入库事实可匹配）', status: 400 },
      SOURCE_CHAIN_MISMATCH: { code: ERROR_CODES.SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH, msg: 'WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_ITEM_INVALID, msg: '物料不存在/已停用或 PO/WHR 未绑定物料（NULL 穿透禁止）', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.SUPPLIER_INVOICE_QUANTITY_INVALID, msg: '开票数量必须 > 0 且 ≤ 已入库数量', status: 400 },
      CUMULATIVE_QTY_EXCEEDED: { code: ERROR_CODES.SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED, msg: '累计开票数量超过已入库数量（含其他发票占用）', status: 400 },
    };
    const entry = codeMap[result.error];
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '三单匹配失败', 500);
  }

  const { run, invoice } = result;

  await writeAuditLog({
    actorId,
    action: 'supplier-invoice:match',
    entityType: 'supplier-invoice',
    entityId: invoice.id,
    afterData: {
      invoiceNo: invoice.invoiceNo,
      documentStatus: invoice.documentStatus,
      matchRunId: run.id,
      revision: run.revision,
      result: run.result,
      disposition: run.disposition,
      lineCount: run.lines.length,
    },
    meta,
  });

  // Match 事务提交后发布 SupplierInvoiceMatched（引用 immutable matchRunId + revision；不含投影余额）
  await publishSupplierInvoiceEvent({
    eventType: 'SupplierInvoiceMatched',
    actorId,
    entityId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      supplierId: invoice.supplierId,
      matchRunId: run.id,
      revision: run.revision,
      result: run.result,
      disposition: run.disposition,
      lineCount: run.lines.length,
      matchedById: actorId,
      matchedAt: run.runAt.toISOString(),
    },
    meta,
  }).catch(() => undefined);

  // Approval 单独接现有 Workflow（#9238 分层）：Match 成功后触发审批，
  // 把 matchRunId + revision 绑定进 workflow business context（#9247 细节③——SUBMIT action comment JSON）；
  // **本 API 不写 approvedMatchRunId/approvedMatchRevision**（审批完成时由 syncSupplierInvoiceApproval 固化）；
  // 未命中策略 → 发票保持 MATCHED（不阻塞 Match 结果）
  await maybeTriggerSupplierInvoiceApproval({
    invoiceId: invoice.id,
    matchRunId: run.id,
    revision: run.revision,
    actorId,
    meta,
  }).catch(() => undefined);

  return ok({
    invoice,
    matchRun: {
      id: run.id,
      runNo: run.runNo,
      revision: run.revision,
      result: run.result,
      disposition: run.disposition,
      runAt: run.runAt,
      runById: run.runById,
      lines: run.lines,
    },
  });
}
