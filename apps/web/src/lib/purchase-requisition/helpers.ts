import { Prisma } from '@prisma/client';
import { nextDocumentCode } from '@/lib/document-sequence/next-code';

/** Sprint 5A - PurchaseRequisition 领域通用函数（**不放路由逻辑**；对齐 CreditDebitNote/WriteOff helpers 模式）
 * CTO Design Review 97/100 + ADR-0023：
 * - **PR = 需求事实源（内部申请）**：Header/Line **不得出现金额、单价、税额等采购承诺事实**（拍板⑤）——
 *   金额事实唯一在 PO（Phase 3 只做 PR API，PO 保持冻结）；
 * - code DocumentSequence **创建即取号**（PR-2026-xxxx；docType=PURCHASE_REQUISITION 为 5A 新增，seed 已补种，不重复新增）；
 * - Line quantity 必须 > 0（Decimal 精确比较）；Item/UOM 引用在路由服务端验证；
 * - **Submit 后进入条件 Workflow，审批只改变 PR 审批/状态投影，不创建 PO**（PR → PO Convert 留到 PO 阶段显式动作）；
 * - 数量始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线：Decimal 无 Float/Number 转换）。
 */

/** DocumentSequence 原子取号（docType=PURCHASE_REQUISITION，前缀 PR；创建即取号；单据序列重构：PR-LNE{YYYY}{MM}{####}） */
export async function nextPurchaseRequisitionCode(tx: Prisma.TransactionClient, documentDate: Date): Promise<string> {
  return nextDocumentCode(tx, 'PURCHASE_REQUISITION', documentDate, {
    isCodeFree: async (tx, code) => !(await tx.purchaseRequisition.findUnique({ where: { code } })),
  });
}

/** 校验需求数量：必须 > 0（Decimal 精确比较；返回 ok/reason，供路由映射 400/409） */
export function validatePurchaseRequisitionQuantity(
  quantity: Prisma.Decimal,
): { ok: true } | { ok: false; reason: string } {
  if (quantity.lte(0)) return { ok: false, reason: 'PR_QUANTITY_INVALID' };
  return { ok: true };
}

/** 创建 PR Revision（PATCH 修改必须产生 Revision；Line 不作为独立业务入口 → 行变更随头一起留痕） */
export async function createPurchaseRequisitionRevision(
  tx: Prisma.TransactionClient,
  purchaseRequisitionId: string,
  changeReason: string,
  snapshotData: unknown,
  actorId?: string | null,
) {
  const last = await tx.purchaseRequisitionRevision.findFirst({
    where: { purchaseRequisitionId, deletedAt: null },
    orderBy: { revisionNo: 'desc' },
  });
  const revisionNo = (last?.revisionNo ?? 0) + 1;
  return tx.purchaseRequisitionRevision.create({
    data: {
      purchaseRequisitionId,
      revisionNo,
      changeReason,
      snapshotData:
        snapshotData === undefined ? Prisma.JsonNull : (snapshotData as Prisma.InputJsonValue),
      createdById: actorId ?? null,
      updatedById: actorId ?? null,
    },
  });
}
