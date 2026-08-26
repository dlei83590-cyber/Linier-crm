import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceIssueSchema } from "@/lib/api/schemas";
import { nextInvoiceCode, createInvoiceSnapshot, latestInvoiceRevisionNo } from "@/lib/invoice/helpers";
import { computeBalance } from "@/lib/accounts-receivable/projection";
import { publishInvoiceEvent } from "@/lib/invoice/events";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { validateTaxInvoiceFields, normalizeTaxInvoiceNumber } from "@/lib/tax-invoice";
import {
  createAccountsReceivableRevision,
  createAccountsReceivableSnapshot,
  latestAccountsReceivableRevisionNo,
} from "@/lib/accounts-receivable/helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/issue（DRAFT → ISSUED；编号延后生成——CTO Review 必改①）
 * 事务链路（用户锁定）：
 *  1. FOR UPDATE 锁 Invoice（并发 issue 第二个请求在此被挡：status 已非 DRAFT → 409，不消耗第二个编号）
 *  2. 校验 status = DRAFT（仅 DRAFT 可开票；ISSUED+ 已开票或已取消 → 409）
 *  3. 校验至少 1 个有效 InvoiceLine
 *  4. 校验 invoiceTotal > 0
 *  5. 校验 code = null（DRAFT 不占号；若已有 code 说明已 ISSUED）
 *  6. DocumentSequence(INVOICE) 原子 increment → 生成正式 invoice code（如 INV-2026-000123）
 *  7. status = ISSUED + code 回写（issuedAt/issuedById 记录在 ISSUED Snapshot snapshotData，与 4C deliveredAt 同款）
 *  8. 创建 InvoiceSnapshot(ISSUED)（Decimal toString + 税务/汇率快照）
 *  9. AuditLog + InvoiceIssued（事务外，事件失败不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.issue");

  const { id } = await params;
  const parsed = invoiceIssueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason, invoiceType, taxInvoiceCode, taxInvoiceNo, redInvoiceRefId } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. FOR UPDATE 锁 Invoice（并发 issue 串行化；第二个请求等待后读到 status=ISSUED → 409，不消耗编号） ──
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const invoice = await tx.invoice.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!invoice) return { error: "NOT_FOUND" as const };

    // ── 2. 校验 status = DRAFT ──────────────────────────────────────────────
    if (invoice.status !== "DRAFT") {
      return { error: "INVALID_STATE" as const, status: invoice.status };
    }
    // ── 2b. 审批门禁（CTO Phase 4 锁定）：命中 INVOICE 审批策略后必须先完成审批才能 Issue ──
    //     workflowInstanceId != null 时，仅 approvalStatus=APPROVED 允许开票；
    //     PENDING/REJECTED 全部禁止（REJECTED 需先修改后重审，PENDING 需等待审批完成）
    if (invoice.workflowInstanceId && invoice.approvalStatus !== "APPROVED") {
      return { error: "APPROVAL_GATE" as const, approvalStatus: invoice.approvalStatus };
    }
    // ── 3. 至少 1 个有效 InvoiceLine ────────────────────────────────────────
    if (invoice.lines.length === 0) return { error: "NO_LINES" as const };
    // ── 4. invoiceTotal > 0 ─────────────────────────────────────────────────
    if (invoice.invoiceTotal.lte(0)) return { error: "TOTAL_ZERO" as const };
    // ── 5. code = null（DRAFT 不占号；若已有 code 说明已 ISSUED） ───────────
    if (invoice.code !== null) return { error: "ALREADY_ISSUED" as const };

    // ── 5b. VAT 校验（ADR-0043）：类型必填（I4）+ 号码格式（I7）+ 开票资料（I10）+ 红字（R2/R4/R6） ──
    const vat = validateTaxInvoiceFields(invoiceType, taxInvoiceCode, taxInvoiceNo);
    if (!vat.ok) return { error: vat.code as "INVOICE_TYPE_REQUIRED" | "TAX_INVOICE_CODE_INVALID" | "TAX_INVOICE_NO_INVALID", message: vat.message };
    const normTaxCode = taxInvoiceCode ? normalizeTaxInvoiceNumber(taxInvoiceCode) : null;
    const normTaxNo = taxInvoiceNo ? normalizeTaxInvoiceNumber(taxInvoiceNo) : null;
    // I10：开票客户必须为 BusinessPartner 且已维护开票资料（title+uscc 必填，fail closed）
    const customer = await tx.businessPartner.findFirst({ where: { id: invoice.customerId, deletedAt: null } });
    if (!customer) return { error: "PARTNER_LINK_REQUIRED" as const };
    const invInfo = await tx.businessPartnerInvoiceInfo.findFirst({ where: { partnerId: customer.id, deletedAt: null } });
    if (!invInfo || !invInfo.title || !invInfo.uscc) return { error: "PARTNER_INVOICE_INFO_MISSING" as const };
    // 红字（R3 服务端取反 / R4 防超冲 / R2+R6 引用终态蓝票禁链式）
    // 引用来源：请求体优先；红字 DRAFT（POST /red-invoice 创建时已预填 redInvoiceRefId）自动沿用 DB 预填值，
    // 避免用户跳转详情后不重填引用而把红字草稿当蓝票开具（金额取正危险）
    const effectiveRedRef = redInvoiceRefId ?? invoice.redInvoiceRefId ?? null;
    let redLetter = false;
    let redRefId: string | null = null;
    let original: {
      id: string;
      code: string | null;
      redLetter: boolean;
      status: string;
      subtotal: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      invoiceTotal: Prisma.Decimal;
    } | null = null;
    let issueSubtotal = invoice.subtotal;
    let issueTax = invoice.taxAmount;
    let issueTotal = invoice.invoiceTotal;
    if (effectiveRedRef) {
      const origLocked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${effectiveRedRef} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (origLocked.length === 0) return { error: "RED_INVOICE_REF_STATUS_INVALID" as const };
      original = await tx.invoice.findFirst({ where: { id: effectiveRedRef, deletedAt: null } });
      if (!original || original.redLetter || original.status !== "ISSUED") {
        return { error: "RED_INVOICE_REF_STATUS_INVALID" as const }; // R2：终态蓝票；R6：禁红字冲红字
      }
      // R4：Σ|红字金额| ≤ |原票金额|（锁内累计，并发安全；排除本票自身——红字 DRAFT 已预填引用）
      const reds = await tx.invoice.findMany({
        where: { redInvoiceRefId: effectiveRedRef, deletedAt: null, redLetter: true, id: { not: id } },
        select: { invoiceTotal: true },
      });
      const sumRed = reds.reduce((acc, r) => acc.add(r.invoiceTotal.abs()), new Prisma.Decimal(0));
      if (sumRed.add(original.invoiceTotal.abs()).gt(original.invoiceTotal.abs())) {
        return { error: "RED_INVOICE_OVERFLOW" as const, originalTotal: original.invoiceTotal.toString() };
      }
      redLetter = true;
      redRefId = effectiveRedRef;
      // R3：红字金额 = 服务端对原票金额取反（禁止客户端正数伪装）
      issueSubtotal = original.subtotal.negated();
      issueTax = original.taxAmount.negated();
      issueTotal = original.invoiceTotal.negated();
    }

    // ── 6. DocumentSequence(INVOICE) 原子取号（编号延后生成，DRAFT 不消耗） ──
    const code = await nextInvoiceCode(tx, new Date());

    // ── 7. status = ISSUED + code + VAT 要素回写（I3：ISSUE 后冻结；红字金额服务端取反） ──
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        code,
        status: "ISSUED",
        invoiceType,
        taxInvoiceCode: normTaxCode,
        taxInvoiceNo: normTaxNo,
        redLetter,
        redInvoiceRefId: redRefId,
        ...(redLetter
          ? { subtotal: issueSubtotal, taxAmount: issueTax, invoiceTotal: issueTotal }
          : {}),
        updatedById: user!.id,
        version: { increment: 1 },
      },
    });

    // ── 8. InvoiceSnapshot(ISSUED)（issuedAt/issuedById 记录在 snapshotData；税务/汇率快照） ──
    const issuedAt = new Date();
    const revisionNo = await latestInvoiceRevisionNo(tx, id);
    const firstPs = invoice.lines[0]?.priceSnapshotId
      ? await tx.quotationPriceSnapshot.findFirst({ where: { id: invoice.lines[0].priceSnapshotId } })
      : null;
    await createInvoiceSnapshot(
      tx,
      id,
      "ISSUED",
      revisionNo,
      {
        code,
        issuedAt: issuedAt.toISOString(),
        issuedById: user?.id,
        status: "ISSUED",
        changeReason: changeReason ?? "对外开票",
        invoiceDate: updated.invoiceDate.toISOString(),
        dueDate: updated.dueDate?.toISOString() ?? null,
        currency: updated.currency,
        taxProfileId: updated.taxProfileId,
        paymentTerm: updated.paymentTerm,
        invoiceType,
        taxInvoiceCode: normTaxCode,
        taxInvoiceNo: normTaxNo,
        redLetter,
        redInvoiceRefId: redRefId,
        subtotal: updated.subtotal.toString(),
        taxAmount: updated.taxAmount.toString(),
        invoiceTotal: updated.invoiceTotal.toString(),
        paidAmount: updated.paidAmount.toString(),
        balanceAmount: updated.balanceAmount.toString(),
        lines: invoice.lines.map((l) => ({
          lineId: l.id,
          sourceDeliveryLineId: l.sourceDeliveryLineId,
          lineNo: l.lineNo,
          quantity: l.quantity.toString(),
          unitPrice: l.unitPrice.toString(),
          discountRate: l.discountRate.toString(),
          lineAmount: l.lineAmount.toString(),
          taxAmount: l.taxAmount.toString(),
          totalAmount: l.totalAmount.toString(),
          priceSnapshotId: l.priceSnapshotId,
        })),
      },
      user?.id,
      {
        taxProfileId: updated.taxProfileId,
        taxRate: firstPs?.taxRate ?? null,
        sstNo: null, // SST 注册号（TaxProfile 无此字段，待配置来源）
        currencyRate: null, // 汇率快照（待币种汇率配置；4E 前可扩展）
        exchangeRate: firstPs?.exchangeRate ?? null,
        invoiceType,
        taxInvoiceCode: normTaxCode,
        taxInvoiceNo: normTaxNo,
      },
    );

    // ── 8a. AccountsReceivable（1:1 绑定 Invoice；originalAmount = invoiceTotal 复制；余额 = computeBalance 单口径）
    //     蓝票：创建独立 AR（originalAmount = 正数 invoiceTotal）。
    //     红字发票（redLetter=true，用户指令 2026-08-21）：**不再创建独立负应收**——改回退**原票** AR：
    //       原票 AR.adjustedAmount -= |红字金额|（负向冲减）+ balanceAmount 重算（computeBalance 单入口）
    //       + 原票 Invoice.balanceAmount 同步 + AR Revision/Snapshot（snapshotSource=ADJUSTMENT）
    //       删除红字发票（ISSUED）时恢复原票 AR（撤销红冲）。
    if (redLetter && redRefId) {
      // 锁原票 AR（红字冲减与红字删除恢复并发安全）
      const origArLocked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AccountsReceivable" WHERE "invoiceId" = ${redRefId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (origArLocked.length === 0) return { error: "ORIGINAL_AR_NOT_FOUND" as const };
      const origAr = await tx.accountsReceivable.findFirst({
        where: { invoiceId: redRefId, deletedAt: null },
      });
      if (!origAr) return { error: "ORIGINAL_AR_NOT_FOUND" as const };
      const redAbs = updated.invoiceTotal.abs(); // 红字金额绝对值（= 原票金额）
      const newAdjusted = origAr.adjustedAmount.minus(redAbs);
      const newBalance = new Prisma.Decimal(
        computeBalance(origAr.originalAmount, newAdjusted, origAr.paidAmount, origAr.writeOffAmount),
      );
      await tx.accountsReceivable.update({
        where: { id: origAr.id },
        data: { adjustedAmount: newAdjusted, balanceAmount: newBalance, updatedById: user!.id },
      });
      // 原票 Invoice.balanceAmount 同步（投影）
      await tx.invoice.update({
        where: { id: redRefId },
        data: { balanceAmount: newBalance, updatedById: user!.id },
      });
      // AR Revision + Snapshot（红字冲减留痕）
      await createAccountsReceivableRevision(
        tx,
        origAr.id,
        "红字发票冲减应收（红冲自 " + (original?.code ?? "") + "）",
        {
          invoiceId: redRefId,
          redInvoiceId: id,
          redInvoiceCode: code,
          redAmount: redAbs.toString(),
          adjustedAmount: newAdjusted.toString(),
          balanceAmount: newBalance.toString(),
          reversedAt: issuedAt.toISOString(),
        },
        user?.id,
      );
      const origArRevisionNo = await latestAccountsReceivableRevisionNo(tx, origAr.id);
      await createAccountsReceivableSnapshot(
        tx,
        origAr.id,
        "ADJUSTED",
        "ADJUSTMENT",
        origArRevisionNo,
        {
          invoiceId: redRefId,
          redInvoiceId: id,
          redInvoiceCode: code,
          redAmount: redAbs.toString(),
          adjustedAmount: newAdjusted.toString(),
          balanceAmount: newBalance.toString(),
          issuedAt: issuedAt.toISOString(),
          issuedById: user?.id ?? null,
        },
        user?.id,
      );
    } else {
      const ar = await tx.accountsReceivable.create({
        data: {
          invoiceId: id,
          customerId: updated.customerId,
          currency: updated.currency,
          originalAmount: updated.invoiceTotal,
          adjustedAmount: new Prisma.Decimal(0),
          paidAmount: new Prisma.Decimal(0),
          writeOffAmount: new Prisma.Decimal(0),
          balanceAmount: updated.invoiceTotal,
          status: "OPEN",
          effectiveStatus: "OPEN",
          dueDate: updated.dueDate,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
      // AR Revision + AR Snapshot(CREATED, ISSUE)（余额留痕 + 关键节点固化，对齐 4E 领域模式）
      await createAccountsReceivableRevision(
        tx,
        ar.id,
        "发票开票生成应收",
        { invoiceId: id, invoiceCode: code, originalAmount: updated.invoiceTotal.toString(), balanceAmount: updated.invoiceTotal.toString() },
        user?.id,
      );
      const arRevisionNo = await latestAccountsReceivableRevisionNo(tx, ar.id);
      await createAccountsReceivableSnapshot(
        tx,
        ar.id,
        "CREATED",
        "ISSUE",
        arRevisionNo,
        {
          invoiceId: id,
          invoiceCode: code,
          customerId: updated.customerId,
          currency: updated.currency,
          originalAmount: updated.invoiceTotal.toString(),
          balanceAmount: updated.invoiceTotal.toString(),
          dueDate: updated.dueDate?.toISOString() ?? null,
          issuedAt: issuedAt.toISOString(),
          issuedById: user?.id ?? null,
        },
        user?.id,
      );
    }

    // ── 8b. InvoiceIssued Outbox（业务事务内原子写；GL consumer → 收入确认凭证，ADR-0042）
    // 红字发票（负数金额）跳过 GL 过账——GL 借贷行拒绝负数（GL_NEGATIVE_AMOUNT），红字 GL 记账 = ADR-0043 backlog
    if (!redLetter) {
      await writeDomainEvent(tx, {
        eventType: "InvoiceIssued",
        aggregateType: "Invoice",
        aggregateId: id,
        payload: {
          invoiceId: id,
          invoiceCode: code,
          customerId: updated.customerId,
          currency: updated.currency,
          subtotal: updated.subtotal.toString(),
          taxAmount: updated.taxAmount.toString(),
          invoiceTotal: updated.invoiceTotal.toString(),
          invoiceType,
          taxInvoiceCode: normTaxCode,
          taxInvoiceNo: normTaxNo,
          redLetter,
          redInvoiceRefId: redRefId,
          issuedAt: issuedAt.toISOString(),
          issuedById: user?.id ?? null,
        },
        idempotencyKey: "InvoiceIssued|" + id,
      });
    }

    return { invoice: updated, code, issuedAt };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `仅 DRAFT 状态可开票（当前 ${result.status}；已开票/已取消禁止重复 issue）`,
        );
      case "NO_LINES":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票至少需要 1 个有效行才能开票");
      case "TOTAL_ZERO":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票金额必须大于 0 才能开票");
      case "ALREADY_ISSUED":
        return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票已生成编号，禁止重复开票（不消耗第二个编号）");
      case "APPROVAL_GATE":
        return failConflict(
          ERROR_CODES.INVOICE_INVALID_STATE,
          `发票审批未完成（当前 approvalStatus=${result.approvalStatus}），仅 APPROVED 允许开票；请先完成审批或修改后重新提交`,
        );
      case "INVOICE_TYPE_REQUIRED":
        return failConflict(ERROR_CODES.INVOICE_TYPE_REQUIRED, "开票时必须指定发票类型（专票/普票/数电票/出口/其他）");
      case "TAX_INVOICE_CODE_INVALID":
        return fail(ERROR_CODES.TAX_INVOICE_CODE_INVALID, "税务发票代码格式非法", 400, { taxInvoiceCode });
      case "TAX_INVOICE_NO_INVALID":
        return fail(ERROR_CODES.TAX_INVOICE_NO_INVALID, "税务发票号码格式非法", 400, { taxInvoiceNo });
      case "PARTNER_LINK_REQUIRED":
        return failConflict(ERROR_CODES.PARTNER_LINK_REQUIRED, "开票客户必须关联 BusinessPartner（统一往来单位），请先在主档建立关联");
      case "PARTNER_INVOICE_INFO_MISSING":
        return failConflict(ERROR_CODES.PARTNER_INVOICE_INFO_MISSING, "开票资料缺失：客户关联的往来单位需维护发票抬头与统一社会信用代码（BusinessPartnerInvoiceInfo）");
      case "RED_INVOICE_REF_STATUS_INVALID":
        return failConflict(ERROR_CODES.RED_INVOICE_REF_STATUS_INVALID, "红字引用无效：被冲销发票必须为已开票（ISSUED）的蓝字发票，且禁止红字冲红字");
      case "RED_INVOICE_OVERFLOW":
        return failConflict(ERROR_CODES.RED_INVOICE_OVERFLOW, `红字累计超冲：Σ|红字金额| 不得超过原票金额（原票 ${result.originalTotal}）`);
      case "ORIGINAL_AR_NOT_FOUND":
        return failConflict(ERROR_CODES.CN_DN_SOURCE_NOT_COMPATIBLE, "原票应收不存在，无法回退应收（红冲失败）");
    }
  }

  // ── 9. 事件 + 审计（事务外，与现有模式一致；事件失败不阻断） ─────────────
  try {
    await publishInvoiceEvent({
      eventType: "InvoiceIssued",
      actorId: user?.id,
      entityId: id,
      payload: {
        invoiceId: id,
        invoiceCode: result.code,
        deliveryId: result.invoice.deliveryId,
        salesOrderId: result.invoice.salesOrderId,
        customerId: result.invoice.customerId,
        currency: result.invoice.currency,
        subtotal: result.invoice.subtotal,
        taxAmount: result.invoice.taxAmount,
        invoiceTotal: result.invoice.invoiceTotal,
        issuedAt: result.issuedAt.toISOString(),
        issuedById: user?.id,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "invoice.issue",
      entityType: "invoice",
      entityId: id,
      afterData: {
        code: result.code,
        status: "ISSUED",
        issuedAt: result.issuedAt.toISOString(),
        invoiceTotal: result.invoice.invoiceTotal.toString(),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ invoice: result.invoice, code: result.code, issuedAt: result.issuedAt });
}
