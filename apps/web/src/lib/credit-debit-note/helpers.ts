import { Prisma } from "@prisma/client";
import { nextDocumentCode } from "@/lib/document-sequence/next-code";

/** Sprint 4E-3 - CreditDebitNote 领域通用函数（**不放路由逻辑**；对齐 WriteOff/Receipt helpers 模式）
 * CTO Design Review 98/100 + ADR-0022：
 * - **Create 只生成 CreditDebitNote(DRAFT) + Lines**——不创建 InvoiceAdjustment、不改 AR、
 *   不改 Invoice.balanceAmount（事实由 Apply 事务生成；客户端禁直接创建事实）；
 * - code DocumentSequence **创建即取号**（CN-/DN-2026-xxxx；docType=CREDIT_NOTE/DEBIT_NOTE 已存在，不重复新增）；
 * - 金额快照直接复制原 InvoiceLine（unitPrice/discountRate/lineAmount/taxAmount/totalAmount），**不调用 Pricing Engine**；
 * - 金额始终 `Prisma.Decimal`，**禁止 number 中间转换**（CTO 红线：Decimal 无 Float/Number 转换）。
 */

/** docType 映射：CREDIT → CREDIT_NOTE；DEBIT → DEBIT_NOTE（DocumentSequence 正式单据类型，已有） */
export function creditDebitNoteDocType(noteType: "CREDIT" | "DEBIT"): "CREDIT_NOTE" | "DEBIT_NOTE" {
  return noteType === "CREDIT" ? "CREDIT_NOTE" : "DEBIT_NOTE";
}

/** DocumentSequence 原子取号（docType=CREDIT_NOTE/DEBIT_NOTE，前缀 CN/DN；创建即取号；单据序列重构：CN/DN-LNE{YYYY}{MM}{####}） */
export async function nextCreditDebitNoteCode(
  tx: Prisma.TransactionClient,
  noteType: "CREDIT" | "DEBIT",
  documentDate: Date,
): Promise<string> {
  return nextDocumentCode(tx, creditDebitNoteDocType(noteType), documentDate);
}

/** 调整总额：Σ lines.totalAmount（服务端计算，禁止直传头金额；Decimal 全程） */
export function computeCreditDebitNoteTotal(
  lines: Array<{ totalAmount: Prisma.Decimal | string | number }>,
): Prisma.Decimal {
  return lines.reduce(
    (acc, l) => acc.plus(new Prisma.Decimal(l.totalAmount)),
    new Prisma.Decimal(0),
  );
}

/** 校验调整数量：必须 > 0（Decimal 精确比较；返回 ok/reason，供路由映射 409） */
export function validateCreditDebitNoteQuantity(
  quantity: Prisma.Decimal,
): { ok: true } | { ok: false; reason: string } {
  if (quantity.lte(0)) return { ok: false, reason: "CN_DN_QUANTITY_INVALID" };
  return { ok: true };
}
