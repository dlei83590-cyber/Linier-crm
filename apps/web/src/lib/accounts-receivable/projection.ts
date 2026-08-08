import type { AccountsReceivableStatus } from "@prisma/client";

/**
 * AR 惰性投影工具（CTO Review 97/100 必改①：agingBucket 不存库；拍板②：OVERDUE 不落库）
 * - effectiveStatus：storedStatus ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → OVERDUE（与 Quotation EXPIRED 同思路，不新增 Scheduler）
 * - effectiveAgingBucket：读取时动态计算 0-30 / 31-60 / 61-90 / 90+，只依赖 today/dueDate/balance，属 Projection，不每天更新数据库
 */

export interface ArProjection {
  effectiveStatus: AccountsReceivableStatus;
  isOverdue: boolean;
  effectiveAgingBucket: string | null;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * 计算 AR 惰性投影（读路径统一入口；禁止写库——CTO 必改①/拍板②）
 * @param status 数据库真实状态（OPEN/PARTIALLY_PAID/PAID/CLOSED；OVERDUE 永不落库）
 * @param dueDate 到期日（逾期判定基准；继承 Invoice.dueDate）
 * @param balanceAmount 余额（账龄计算只对未清余额有意义）
 * @param now 基准时间（默认当前时间；测试可注入）
 */
export function computeArProjection(
  status: AccountsReceivableStatus,
  dueDate: Date | null,
  balanceAmount: { toString(): string } | number | string,
  now: Date = new Date(),
): ArProjection {
  const balance = Number(balanceAmount);
  const isOverdue = (status === "OPEN" || status === "PARTIALLY_PAID") && dueDate !== null && dueDate.getTime() < now.getTime();
  const effectiveStatus: AccountsReceivableStatus = isOverdue ? "OVERDUE" : status;

  // 账龄：仅对未清余额（balance > 0）且有到期日的记录计算；已清/无到期日 → null
  let effectiveAgingBucket: string | null = null;
  if (balance > 0 && dueDate !== null) {
    const overdueDays = daysBetween(dueDate, now);
    if (overdueDays <= 0) effectiveAgingBucket = "0-30";
    else if (overdueDays <= 30) effectiveAgingBucket = "0-30";
    else if (overdueDays <= 60) effectiveAgingBucket = "31-60";
    else if (overdueDays <= 90) effectiveAgingBucket = "61-90";
    else effectiveAgingBucket = "90+";
  }

  return { effectiveStatus, isOverdue, effectiveAgingBucket };
}

/** 余额唯一口径（CTO 锁定，禁止多入口计算）：balanceAmount = original + adjusted - paid - writeOff */
export function computeBalance(
  originalAmount: { toString(): string } | number | string,
  adjustedAmount: { toString(): string } | number | string,
  paidAmount: { toString(): string } | number | string,
  writeOffAmount: { toString(): string } | number | string,
): string {
  const balance =
    Number(originalAmount) + Number(adjustedAmount) - Number(paidAmount) - Number(writeOffAmount);
  // 对齐 Prisma Decimal 序列化：返回字符串，避免 Float/Number 精度损失（CTO 红线：Decimal 无 Float/Number 转换）
  return balance.toFixed(4);
}
