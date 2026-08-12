import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { supplierInvoicePostSchema } from '@/lib/api/schemas';
import {
  postSupplierInvoice,
  SupplierInvoicePostVersionConflictError,
  SupplierInvoicePostInternalError,
} from '@/lib/supplier-invoice/post-helpers';
import { publishSupplierInvoiceEvent } from '@/lib/supplier-invoice/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/supplier-invoices/:id/post —— APPROVED → POSTED（CTO #9678 Supplier Invoice POST /
 * GRIR CONSUME / AP Liability-OpenItem Vertical Slice，六条不变量锁死）
 * - **POST 是一个事务闭环**（postSupplierInvoice，同事务全有或全无）：
 *   lock SupplierInvoice → APPROVED Gate → approved MatchRun 精确重验（不变量①：approvedMatchRunId +
 *   approvedMatchRevision 必须真实存在、属于本 invoice、与审批 immutable snapshot 一致——不得仅看
 *   currentMatchStatus）→ 来源事实重验（verifyReceiptBasedSourceChain 复用：WHR POSTED + 链一致 +
 *   Item ACTIVE + 累计守恒；**内部 deterministic WHR Line lock order**——不变量②，与 Return REVERSAL
 *   串行竞争同一 remaining GRIR）→ remaining GRIR 重算 → **全额满足校验（不变量③：不足 409 fail
 *   closed，禁止 partial POST）** → CONSUME（GRIR/PO snapshot basis——不变量④）→ ApLiabilityFact +
 *   ApOpenItem（发票事实金额——不变量⑤）→ CAS POSTED + postedAt/postedById（不变量⑥ 原子性）
 * - **maker-checker（服务层）**：Poster ≠ Creator（硬性）；Approval actor 可解析则双重校验
 *   （Poster ≠ Approval actor——从 Workflow APPROVE action/Approver(APPROVED) 解析）
 * - **幂等**：已 POSTED → 409 ALREADY_POSTED（不会重复生成 Liability/Consume）；DB partial UNIQUE
 *   + sourceKey UNIQUE + ApLiabilityFact.supplierInvoiceId UNIQUE 最终防线
 * - **边界提前固化**：历史退货已降低 remaining GRIR 导致无法完整 consume → POST 拒绝（GRIR_INSUFFICIENT
 *   409），不制造负 GRIR，不在 5C-1C 偷做 CN/DN（5C-2 处理）
 * - **红线**：不写库存成本/GL/Costing/Reservation/InventoryMovement/StockProjection（5C-2 及后续 HOLD）
 * - 事件：POST 事务提交后发布 `SupplierInvoicePosted` + `GrirConsumed`（consume 终态；EVENTS v1.33）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // POST 映射现有动作（post→:edit，对齐 submit→:edit / match→:edit 先例，不新造权限体系；
  // maker-checker 在服务层强制 Poster ≠ Creator / Approval actor）
  const denied = requirePermission(user, 'supplier-invoice:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'supplier-invoice.post');

  const { id } = await params;
  const parsed = supplierInvoicePostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      return postSupplierInvoice(tx, { invoiceId: id, version, actorId });
    });
  } catch (err) {
    // B1（CTO Static Gate 2026-08-12）：postSupplierInvoice 从第一笔 accounting write 之后
    // 所有失败均 throw（Prisma $transaction 只有 throw 才 rollback）；此处按错误类映射回 API 响应。
    if (err instanceof SupplierInvoicePostVersionConflictError) {
      return fail(
        ERROR_CODES.VERSION_CONFLICT,
        '版本冲突：发票已被并发修改（事务已回滚，发票保持 APPROVED）',
        409,
      );
    }
    if (err instanceof SupplierInvoicePostInternalError) {
      return fail(ERROR_CODES.INTERNAL_ERROR, '发票过账失败（事务已回滚，发票保持 APPROVED）', 500);
    }
    // CTO #9757 + Required Hardening（CTO 2026-08-12）：P2002 不再无条件映射 ALREADY_POSTED。
    // 正常并发重复 POST 已被 Header FOR UPDATE → 锁后状态 Gate（POSTED → ALREADY_POSTED）拦住，
    // 不会进到 Phase B；因此 Phase B 内出现 P2002 更可能是 existing accounting fact / document
    // state 不一致（GRIR sourceKey 已存在但 Header 非 POSTED、ApLiabilityFact.supplierInvoiceId
    // 已存在、ApOpenItem.apLiabilityFactId 已存在等唯一约束冲突）。
    // **只有确认 Invoice = POSTED 时才允许返回 ALREADY_POSTED**；否则暴露 invariant conflict。
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // 事务已回滚；重新读取已提交状态判断发票是否确已 POSTED（合法重放）
      const invoiceNow = await prisma.supplierInvoice.findFirst({
        where: { id, deletedAt: null },
        select: { documentStatus: true },
      });
      if (invoiceNow?.documentStatus === 'POSTED') {
        return fail(
          ERROR_CODES.SUPPLIER_INVOICE_ALREADY_POSTED,
          '发票已过账（POSTED），重复 POST 幂等拒绝——不会重复生成 Liability/Consume',
          409,
        );
      }
      return fail(
        ERROR_CODES.INTERNAL_ERROR,
        '会计事实一致性冲突：CONSUME/Liability 唯一键已存在但发票未达 POSTED 终态（数据异常，事务已回滚，请调查）',
        500,
      );
    }
    console.error('[supplier-invoice.post]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '发票过账失败（事务已回滚，发票保持 APPROVED）', 500);
  }

  if (!result.ok) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: {
        code: ERROR_CODES.SUPPLIER_INVOICE_NOT_FOUND,
        msg: '供应商发票不存在',
        status: 404,
      },
      ALREADY_POSTED: {
        code: ERROR_CODES.SUPPLIER_INVOICE_ALREADY_POSTED,
        msg: '发票已过账（POSTED），重复 POST 幂等拒绝——不会重复生成 Liability/Consume',
        status: 409,
      },
      INVALID_STATE: {
        code: ERROR_CODES.SUPPLIER_INVOICE_NOT_APPROVED,
        msg: '仅 APPROVED 状态可过账（当前未审批完成）；APPROVED ≠ POSTED',
        status: 409,
      },
      VERSION_CONFLICT: {
        code: ERROR_CODES.VERSION_CONFLICT,
        msg: '版本冲突，请刷新后重试',
        status: 409,
      },
      MAKER_CHECKER: {
        code: ERROR_CODES.SUPPLIER_INVOICE_MAKER_CHECKER,
        msg: 'maker-checker：过账人不得 = 创建人/审批人',
        status: 409,
      },
      APPROVAL_SNAPSHOT_INVALID: {
        code: ERROR_CODES.SUPPLIER_INVOICE_APPROVAL_SNAPSHOT_INVALID,
        msg: '审批快照引用（approvedMatchRunId/Revision）缺失或与审批 immutable snapshot 不一致，禁止过账',
        status: 409,
      },
      NO_LINES: {
        code: ERROR_CODES.SUPPLIER_INVOICE_NO_LINES,
        msg: '发票至少需要一条有效行',
        status: 400,
      },
      WHR_NOT_POSTED: {
        code: ERROR_CODES.SUPPLIER_INVOICE_WHR_NOT_POSTED,
        msg: '入库行所属 WHR 必须已 POSTED（来源事实重验）',
        status: 400,
      },
      SOURCE_CHAIN_MISMATCH: {
        code: ERROR_CODES.SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH,
        msg: 'WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链不一致',
        status: 400,
      },
      ITEM_INVALID: {
        code: ERROR_CODES.SUPPLIER_INVOICE_ITEM_INVALID,
        msg: '物料不存在/已停用（来源事实重验）',
        status: 400,
      },
      QUANTITY_INVALID: {
        code: ERROR_CODES.SUPPLIER_INVOICE_QUANTITY_INVALID,
        msg: '开票数量必须 > 0 且 ≤ 已入库数量',
        status: 400,
      },
      CUMULATIVE_QTY_EXCEEDED: {
        code: ERROR_CODES.SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED,
        msg: '累计开票数量超过已入库数量（含其他发票占用）',
        status: 400,
      },
      GRIR_INSUFFICIENT: {
        code: ERROR_CODES.SUPPLIER_INVOICE_GRIR_INSUFFICIENT,
        msg: '剩余 GRIR 不足以全额消耗本次已批准开票数量（禁止 partial POST）；请修正发票/来源，已形成 AP 后的差额留待 5C-2 CN/DN',
        status: 409,
      },
    };
    const entry = codeMap[result.error];
    if (entry) {
      return fail(entry.code, entry.msg, entry.status);
    }
    return fail(ERROR_CODES.INTERNAL_ERROR, '发票过账失败', 500);
  }

  const { invoice, consumes, liability, openItem, inputVatAmount, nonRecoverableTaxAmount } =
    result;

  await writeAuditLog({
    actorId,
    action: 'supplier-invoice:post',
    entityType: 'supplier-invoice',
    entityId: invoice.id,
    beforeData: { documentStatus: 'APPROVED', version },
    afterData: {
      invoiceNo: invoice.invoiceNo,
      documentStatus: invoice.documentStatus,
      postedAt: invoice.postedAt?.toISOString(),
      postedById: invoice.postedById,
      grossAmount: invoice.grossAmount.toString(),
      netAmount: invoice.netAmount.toString(),
      inputVatAmount: inputVatAmount.toString(),
      nonRecoverableTaxAmount: nonRecoverableTaxAmount.toString(),
      liabilityId: liability.id,
      openItemId: openItem.id,
      consumeCount: consumes.length,
      consumes,
      approvedMatchRunId: invoice.approvedMatchRunId,
      approvedMatchRevision: invoice.approvedMatchRevision,
    },
    meta,
  });

  // POST 事务提交后 best-effort 发布 SupplierInvoicePosted + GrirConsumed（EVENTS v1.33；
  // 不含投影余额——ApOpenItem.openAmount 为 projection，不随事件下发）
  publishSupplierInvoiceEvent({
    eventType: 'SupplierInvoicePosted',
    actorId,
    entityId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      supplierId: invoice.supplierId,
      grossAmount: invoice.grossAmount.toString(),
      netAmount: invoice.netAmount.toString(),
      inputVatAmount: inputVatAmount.toString(),
      nonRecoverableTaxAmount: nonRecoverableTaxAmount.toString(),
      liabilityId: liability.id,
      openItemId: openItem.id,
      consumeCount: consumes.length,
      postedById: actorId,
      postedAt: invoice.postedAt?.toISOString() ?? new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);
  publishSupplierInvoiceEvent({
    eventType: 'GrirConsumed',
    actorId,
    entityId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      supplierId: invoice.supplierId,
      consumes,
      consumedById: actorId,
      consumedAt: invoice.postedAt?.toISOString() ?? new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);

  return ok({
    invoice,
    grir: {
      consumes,
      liability: {
        id: liability.id,
        grossAmount: liability.grossAmount,
        netAmount: liability.netAmount,
        inputVatAmount: liability.inputVatAmount,
        nonRecoverableTaxAmount: liability.nonRecoverableTaxAmount,
      },
      openItem: {
        id: openItem.id,
        openAmount: openItem.openAmount,
        settlementStatus: openItem.settlementStatus,
      },
    },
  });
}
