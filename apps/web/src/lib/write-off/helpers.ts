import { Prisma } from "@prisma/client";

/** Sprint 4E-2 - WriteOff 领域通用函数（**不放路由逻辑**；对齐 Invoice/Receipt helpers 模式）
 * CTO Design Review 97/100 拍板③：
 * - WriteOff **不做 Revision/Snapshot 三件套**（Schema 0019 只有 WriteOff + WriteOffAllocation，不硬造模型——
 *   审批历史由 Workflow、审计由 AuditLog，避免模型膨胀）；
 * - code DocumentSequence **创建即取号**（拍板④：WO-2026-xxxx）；
 * - **审批通过 ≠ 自动修改余额**：只有显式 Apply 动作回写 AR.writeOffAmount（CTO 解冻令）；
 * - 金额始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线：Decimal 无 Float/Number 转换）。
 */

export const WRITE_OFF_DOC_TYPE = "WRITE_OFF";

/** DocumentSequence 原子取号（docType=WRITE_OFF，前缀 WO，位数 6；创建即取号——拍板④） */
export async function nextWriteOffCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: "WRITE_OFF", isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? "WO";
  const padLength = seq?.padLength ?? 6;
  if (seq) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    return `${prefix}${String(updated.nextNo - 1).padStart(padLength, "0")}`;
  }
  return `${prefix}${String(1).padStart(padLength, "0")}`;
}

/** 写销总额：Σ WriteOffAllocation.amount（多 AR 汇总；Decimal 全程，禁止 number） */
export function computeWriteOffTotal(
  allocations: Array<{ amount: Prisma.Decimal | string | number }>,
): Prisma.Decimal {
  return allocations.reduce(
    (acc, a) => acc.plus(new Prisma.Decimal(a.amount)),
    new Prisma.Decimal(0),
  );
}

/** 校验写销金额：必须 > 0（Decimal 精确比较；返回 ok/reason，供路由映射 409/400） */
export function validateWriteOffAmount(
  amount: Prisma.Decimal,
): { ok: true } | { ok: false; reason: string } {
  if (amount.lte(0)) return { ok: false, reason: "WRITE_OFF_AMOUNT_INVALID" };
  return { ok: true };
}
