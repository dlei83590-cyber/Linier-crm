import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { z } from 'zod';
import { applySupplierCnDn } from '@/lib/supplier-cn-dn/apply-helper';
import { publishSupplierCnDnEvent, writeSupplierCnDnAppliedEvent } from '@/lib/supplier-cn-dn/events';

export const dynamic = 'force-dynamic';

const applySchema = z.object({
  version: z.number().int().positive(),
});

interface ApplySuccess {
  ok: true;
  openAmountAfter: string;
  noteInfo: { code: string; noteType: string; supplierId: string; sourceSupplierInvoiceId: string; adjustmentTotal: string } | null;
}
interface ApplyFailure {
  ok: false;
  code: string;
  message: string;
  httpStatus: number;
}
type ApplyOutcome = ApplySuccess | ApplyFailure;

/**
 * POST /api/supplier-credit-debit-notes/:id/apply — APPROVED → APPLIED（5C-2，ADR-0027 D6）
 * 同事务：状态终态 + ApOpenItem.openAmount 投影重算（防超调锁内重算）+ maker-checker（apply 人 ≠ 创建人）。
 * 事务提交后发布 SupplierCreditDebitNoteApplied（AuditLog 留痕，EVENTS v1.34）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // apply 映射现有动作（apply→:edit，对齐 5C-1 POST→:edit 先例；maker-checker 在服务层强制）
  const denied = requirePermission(user, 'supplier-credit-debit-note:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-credit-debit-note.apply');

  const { id } = await params;
  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const outcome: ApplyOutcome = await prisma.$transaction(async (tx) => {
      const r = await applySupplierCnDn(tx, { cnDnId: id, version: parsed.data.version, actorId });
      if (!r.ok) {
        return { ok: false as const, code: r.code, message: r.message, httpStatus: r.httpStatus };
      }
      const n = await tx.supplierCreditDebitNote.findFirst({
        where: { id },
        select: { code: true, noteType: true, supplierId: true, sourceSupplierInvoiceId: true, adjustmentTotal: true },
      });
      const noteInfo = n
        ? {
            code: n.code,
            noteType: n.noteType as string,
            supplierId: n.supplierId,
            sourceSupplierInvoiceId: n.sourceSupplierInvoiceId,
            adjustmentTotal: n.adjustmentTotal.toString(),
          }
        : null;
      // 事件总线落地：同事务原子写 Outbox（可靠持久化；AuditLog 留痕保留在发布侧）
      if (n) {
        await writeSupplierCnDnAppliedEvent(tx, {
          cnDnId: id,
          payload: {
            cnDnId: id,
            code: n.code,
            noteType: n.noteType as string,
            supplierId: n.supplierId,
            sourceSupplierInvoiceId: n.sourceSupplierInvoiceId,
            adjustmentTotal: n.adjustmentTotal.toString(),
            openAmountAfter: r.openAmountAfter,
            appliedById: actorId,
            appliedAt: new Date().toISOString(),
          },
        });
      }
      await writeAuditLog({
        actorId: user?.id,
        action: 'supplier-credit-debit-note.apply',
        entityType: 'supplierCreditDebitNote',
        entityId: id,
        afterData: { status: 'APPLIED', openAmountAfter: r.openAmountAfter },
        ...meta,
      });
      return { ok: true as const, openAmountAfter: r.openAmountAfter, noteInfo };
    });

    if (!outcome.ok) {
      const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
        NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, msg: '供应商贷/借项通知单不存在', status: 404 },
        ALREADY_APPLIED: { code: ERROR_CODES.CONFLICT, msg: '通知单已应用（APPLIED），重复 APPLY 幂等拒绝', status: 409 },
        INVALID_STATE: { code: ERROR_CODES.CONFLICT, msg: '仅 APPROVED 状态可应用（APPROVED ≠ APPLIED）', status: 409 },
        VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
        MAKER_CHECKER: { code: ERROR_CODES.CONFLICT, msg: '应用人不能是创建人（maker-checker）', status: 409 },
        OPEN_ITEM_NOT_FOUND: { code: ERROR_CODES.CONFLICT, msg: '目标 AP Open Item 不存在（发票未过账？）', status: 409 },
        OVER_ADJUSTMENT: { code: ERROR_CODES.CONFLICT, msg: '累计调整后应付未结项为负（CREDIT 超冲减），拒绝应用', status: 409 },
      };
      const mapped = codeMap[outcome.code] ?? { code: ERROR_CODES.INTERNAL_ERROR, msg: '应用失败（事务已回滚）', status: 500 };
      return fail(mapped.code, mapped.msg, mapped.status);
    }

    if (outcome.noteInfo) {
      await publishSupplierCnDnEvent({
        eventType: 'SupplierCreditDebitNoteApplied',
        actorId: user?.id,
        entityId: id,
        payload: {
          cnDnId: id,
          code: outcome.noteInfo.code,
          noteType: outcome.noteInfo.noteType,
          supplierId: outcome.noteInfo.supplierId,
          sourceSupplierInvoiceId: outcome.noteInfo.sourceSupplierInvoiceId,
          adjustmentTotal: outcome.noteInfo.adjustmentTotal,
          openAmountAfter: outcome.openAmountAfter,
          appliedById: actorId,
          appliedAt: new Date().toISOString(),
        },
        meta: { requestId: meta.requestId ?? undefined },
      });
    }

    return ok({ id, status: 'APPLIED', openAmountAfter: outcome.openAmountAfter });
  } catch (err) {
    console.error('[supplier-credit-debit-note.apply]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '应用失败（事务已回滚，通知单保持原状态）', 500);
  }
}