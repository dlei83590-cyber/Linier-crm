import { Prisma } from '@prisma/client';
import type { prisma } from '@/lib/prisma';
import { verifyReceiptBasedSourceChain } from '@/lib/supplier-invoice/helpers';

/**
 * B1 修复（CTO Static Gate 2026-08-12）：POST 终态 CAS 冲突错误。
 * 必须在事务内 **throw**（而不是 return {ok:false}）——Prisma $transaction callback 正常 return
 * 会 commit，只有 throw 才 rollback；从第一笔 GRIR CONSUME 写入之后，任何失败都只能 throw，
 * 否则会产生 partial accounting facts（CONSUME/AP 落库而 Invoice 未 POSTED）。
 */
export class SupplierInvoicePostVersionConflictError extends Error {
  constructor() {
    super('SUPPLIER_INVOICE_POST_VERSION_CONFLICT');
    this.name = 'SupplierInvoicePostVersionConflictError';
  }
}

/**
 * B1 修复：Phase B 写入后不可达的终态异常（防御性 throw，保证回滚）。
 */
export class SupplierInvoicePostInternalError extends Error {
  constructor() {
    super('SUPPLIER_INVOICE_POST_INTERNAL');
    this.name = 'SupplierInvoicePostInternalError';
  }
}

/**
 * Sprint 5C-1C - Supplier Invoice POST / GRIR CONSUME / AP Liability-OpenItem Vertical Slice
 * （CTO #9678 5C-1C0 FINAL APPROVED 99/100，Blocking 0，1C1+1C2+1C3 HOLD 解除）
 * 设计依据：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md §4.14 + ADR-0027 +
 *           CTO #9678 六条实现不变量（全部锁死）：
 *
 * ① **批准快照必须精确一致**：approvedMatchRunId + approvedMatchRevision 必须真实存在、属于当前
 *    invoice，并与审批时 immutable snapshot 一致（三列 FK 已绑定 SupplierInvoiceMatchRun(id,
 *    supplierInvoiceId, revision)）；POST **不得仅看 currentMatchStatus**——显式重验 approved 引用。
 * ② **WHR Line 锁顺序与 Return 共用**：invoice 涉及的 WHR ids 去重、排序，`ORDER BY id FOR UPDATE`
 *    后才计算 remaining GRIR（复用 verifyReceiptBasedSourceChain 的 deterministic lock order——
 *    helpers.ts 已实现 collect ids → sort → FOR UPDATE）；Invoice CONSUME 与 PurchaseReturn REVERSAL
 *    串行竞争同一余额。
 * ③ **GRIR CONSUME 必须全额满足，禁止 partial POST**：每张 InvoiceLine 要求对应 remaining GRIR
 *    quantity ≥ 本次已批准 invoice quantity；不足 → GRIR_INSUFFICIENT（409 fail closed），整个 POST
 *    回滚，Invoice 保持 APPROVED。不能"能 consume 多少就 consume 多少"仍把整票 POSTED。
 * ④ **CONSUME 金额必须使用 GRIR/PO snapshot basis**：quantity = approved invoice line qty，
 *    unitPrice/taxRate 取对应 ACCRUAL snapshot，baseAmount = quantity × accrual unitPrice。
 *    Invoice 与 PO 的价格差异属于已审批的采购价格差异，**不得通过改写 GRIR basis 掩盖**。
 * ⑤ **AP Liability 使用发票事实金额**：grossAmount/netAmount/inputVatAmount/nonRecoverableTaxAmount
 *    从 SupplierInvoice 服务端金额事实 + 行 vatRecoverable 聚合；一票一个 immutable ApLiabilityFact；
 *    ApOpenItem.openAmount 初始值 = Liability grossAmount，settlementStatus=UNPAID，**只是 projection**。
 * ⑥ **POST 原子性**：SupplierInvoice POSTED + 所有 GRIR CONSUME + ApLiabilityFact + ApOpenItem
 *    必须同事务全有或全无；任一 source、余额、maker-checker、unique/idempotency 异常都保持 APPROVED。
 *
 * maker-checker（服务层强制，CTO #9757 修正）：Poster ≠ Creator（硬性）；Approval actor 从
 * WorkflowInstance(businessType='supplier-invoice') 的 APPROVE action/Approver(APPROVED) 解析；
 * posterId 不得等于本轮任一 APPROVE actor；**查不到可证明的审批事实时 fail closed**——不能只因为
 * documentStatus=APPROVED 就继续 POST（不新造 approvedById 字段，frozen 0027 不动）。
 *
 * 边界提前固化（CTO #9678）：历史退货已降低 remaining GRIR 导致当前发票无法完整 consume →
 * POST 必须拒绝（GRIR_INSUFFICIENT），**不得制造负 GRIR，不得在 5C-1C 偷做 CN/DN**；用户应修正
 * 发票/来源；已形成 AP 后的后续退货差额继续留给 5C-2。
 *
 * 幂等/终态：POST 成功一次后 documentStatus=POSTED，重复 POST → ALREADY_POSTED（409 幂等拒绝），
 * 不会重复生成 CONSUME / Liability / OpenItem（DB partial UNIQUE + sourceKey UNIQUE +
 * ApLiabilityFact.supplierInvoiceId UNIQUE 最终防线）。
 */

/** 从 Workflow 审批事实源解析审批人集合（Approver.status=APPROVED + WorkflowAction.actionType=APPROVE） */
async function resolveSupplierInvoiceApprovalActors(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<string[]> {
  const instance = await tx.workflowInstance.findFirst({
    where: { businessType: 'supplier-invoice', businessId: invoiceId, deletedAt: null },
    select: { id: true },
  });
  if (!instance) return [];
  const [approvers, actions] = await Promise.all([
    tx.approver.findMany({
      where: { instanceId: instance.id, status: 'APPROVED', deletedAt: null },
      select: { userId: true },
    }),
    tx.workflowAction.findMany({
      where: { instanceId: instance.id, actionType: 'APPROVE', deletedAt: null },
      select: { actorId: true },
    }),
  ]);
  return [...new Set([...approvers.map((a) => a.userId), ...actions.map((a) => a.actorId)])];
}

/**
 * AP helper：一票一个 immutable ApLiabilityFact + ApOpenItem 初始投影（CTO #9678 不变量⑤）。
 * 金额全部来自发票服务端金额事实聚合（不信任客户端）：
 * - grossAmount/netAmount：SupplierInvoice 服务端聚合（DB CHECK gross=net+tax 兜底）
 * - inputVatAmount：Σ 行 vatRecoverable=true 的 taxAmount（Input VAT component）
 * - nonRecoverableTaxAmount：Σ 行 vatRecoverable=false 的 nonRecoverableTaxAmount（= taxAmount）
 * - ApOpenItem.openAmount 初始值 = Liability grossAmount；settlementStatus=UNPAID；只读 projection
 * 幂等：ApLiabilityFact.supplierInvoiceId UNIQUE + ApOpenItem.apLiabilityFactId UNIQUE（DB 最终防线）。
 */
export async function createApLiabilityAndOpenItem(
  tx: Prisma.TransactionClient,
  params: {
    invoice: {
      id: string;
      supplierId: string;
      currency: string;
      grossAmount: Prisma.Decimal;
      netAmount: Prisma.Decimal;
      paymentDueDate: Date | null;
    };
    lines: Array<{
      vatRecoverable: boolean;
      taxAmount: Prisma.Decimal;
      nonRecoverableTaxAmount: Prisma.Decimal;
    }>;
    actorId: string;
  },
): Promise<{
  liability: NonNullable<Awaited<ReturnType<typeof prisma.apLiabilityFact.findFirst>>>;
  openItem: NonNullable<Awaited<ReturnType<typeof prisma.apOpenItem.findFirst>>>;
  inputVatAmount: Prisma.Decimal;
  nonRecoverableTaxAmount: Prisma.Decimal;
}> {
  const inputVatAmount = params.lines
    .reduce((s, l) => (l.vatRecoverable ? s.plus(l.taxAmount) : s), new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const nonRecoverableTaxAmount = params.lines
    .reduce((s, l) => s.plus(l.nonRecoverableTaxAmount), new Prisma.Decimal(0))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const liability = await tx.apLiabilityFact.create({
    data: {
      supplierInvoiceId: params.invoice.id,
      supplierId: params.invoice.supplierId,
      currency: params.invoice.currency,
      grossAmount: params.invoice.grossAmount,
      netAmount: params.invoice.netAmount,
      inputVatAmount,
      nonRecoverableTaxAmount,
      dueDate: params.invoice.paymentDueDate,
      createdById: params.actorId,
    },
  });

  const openItem = await tx.apOpenItem.create({
    data: {
      apLiabilityFactId: liability.id,
      supplierId: params.invoice.supplierId,
      currency: params.invoice.currency,
      openAmount: params.invoice.grossAmount,
      settlementStatus: 'UNPAID',
      dueDate: params.invoice.paymentDueDate,
    },
  });

  return { liability, openItem, inputVatAmount, nonRecoverableTaxAmount };
}

/** CONSUME 结果行（事件/Audit 载荷用） */
export interface GrirConsumeResult {
  lineId: string;
  warehouseReceiptLineId: string;
  quantity: string; // Decimal string（decimal.js 序列化安全）
  unitPrice: string;
  baseAmount: string; // quantity × accrual unitPrice（未税）
  sourceKey: string;
}

export type PostResult =
  | {
      ok: true;
      invoice: NonNullable<Awaited<ReturnType<typeof prisma.supplierInvoice.findFirst>>>;
      consumes: GrirConsumeResult[];
      liability: NonNullable<Awaited<ReturnType<typeof prisma.apLiabilityFact.findFirst>>>;
      openItem: NonNullable<Awaited<ReturnType<typeof prisma.apOpenItem.findFirst>>>;
      inputVatAmount: Prisma.Decimal;
      nonRecoverableTaxAmount: Prisma.Decimal;
    }
  | {
      ok: false;
      error:
        | 'NOT_FOUND'
        | 'ALREADY_POSTED' // 幂等：已 POSTED 重复 POST，409
        | 'INVALID_STATE' // 非 APPROVED（DRAFT/SUBMITTED/MATCHED/CANCELLED），409
        | 'VERSION_CONFLICT'
        | 'MAKER_CHECKER' // Poster = Creator / Approval actor，409
        | 'APPROVAL_SNAPSHOT_INVALID' // approvedMatchRunId/Revision 缺失或与审批快照不一致，409
        | 'NO_LINES'
        | 'WHR_NOT_POSTED'
        | 'SOURCE_CHAIN_MISMATCH'
        | 'ITEM_INVALID'
        | 'QUANTITY_INVALID'
        | 'CUMULATIVE_QTY_EXCEEDED'
        | 'GRIR_INSUFFICIENT'; // remaining GRIR 不足（fail closed，禁止 partial POST），409
      status?: string;
      /** GRIR_INSUFFICIENT 明细：{lineId, whrLineId, required, remaining} */
      details?: Array<{
        lineId: string;
        warehouseReceiptLineId: string;
        required: string;
        remaining: string;
      }>;
    };

/**
 * **Supplier Invoice POST（唯一入口）**：APPROVED → POSTED 事务闭环（CTO #9678 锁死顺序）
 * ① FOR UPDATE 锁 SupplierInvoice header
 * ② 重读状态 → APPROVED Gate（POSTED → ALREADY_POSTED 幂等 409；其他 → INVALID_STATE）→ CAS version
 * ③ 批准快照精确重验（不变量①）：approvedMatchRunId + approvedMatchRevision 非空且三列 FK 命中
 * ④ maker-checker（服务层）：Poster ≠ Creator；approval actor 可解析则双重校验
 * ⑤ 行存在校验 + 来源事实重验（verifyReceiptBasedSourceChain 复用：WHR POSTED + 链一致 +
 *    Item ACTIVE + 累计守恒；**内部已做 WHR Line deterministic lock order**——不变量②）
 * ⑥ remaining GRIR 重算（ΣACCRUAL - ΣREVERSAL - ΣCONSUME，对同一 WHR Line）
 * ⑦ 全额满足校验（不变量③）：每行 remaining ≥ 本行 approved invoice qty，不足 → GRIR_INSUFFICIENT
 * ⑧ 创建 CONSUME（每行一条，GRIR/PO snapshot basis——不变量④）
 * ⑨ 创建 ApLiabilityFact + ApOpenItem（发票事实金额——不变量⑤）
 * ⑩ CAS documentStatus → POSTED + postedAt/postedById（version+1；不变量⑥ 同事务全有或全无）
 * 全部同一 caller transaction（调用方 prisma.$transaction）；任何失败 → 事务回滚，Invoice 保持 APPROVED。
 */
export async function postSupplierInvoice(
  tx: Prisma.TransactionClient,
  params: { invoiceId: string; version: number; actorId: string },
): Promise<PostResult> {
  // ① Lock SupplierInvoice header（FOR UPDATE——唯一串行点，防并发 POST/Cancel）
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "SupplierInvoice" WHERE "id" = ${params.invoiceId} AND "deletedAt" IS NULL FOR UPDATE`,
  );
  if (locked.length === 0) return { ok: false, error: 'NOT_FOUND' };

  // ② 重读状态 + CAS version
  const invoice = await tx.supplierInvoice.findFirst({
    where: { id: params.invoiceId, deletedAt: null },
    select: {
      id: true,
      invoiceNo: true,
      documentStatus: true,
      version: true,
      supplierId: true,
      currency: true,
      grossAmount: true,
      netAmount: true,
      taxAmount: true,
      paymentDueDate: true,
      createdById: true,
      approvedMatchRunId: true,
      approvedMatchRevision: true,
      currentMatchRunId: true,
    },
  });
  if (!invoice) return { ok: false, error: 'NOT_FOUND' };

  // APPROVED Gate：POSTED → 幂等 409；其他非 APPROVED → INVALID_STATE（APPROVED ≠ POSTED）
  if (invoice.documentStatus === 'POSTED')
    return { ok: false, error: 'ALREADY_POSTED', status: 'POSTED' };
  if (invoice.documentStatus !== 'APPROVED') {
    return { ok: false, error: 'INVALID_STATE', status: invoice.documentStatus };
  }
  if (invoice.version !== params.version) return { ok: false, error: 'VERSION_CONFLICT' };

  // ③ 批准快照精确重验（不变量①）：approved 引用必须真实存在、属于本 invoice、revision 一致
  //    （三列 FK SupplierInvoiceMatchRun(id, supplierInvoiceId, revision) 已绑定 immutable snapshot）
  if (!invoice.approvedMatchRunId || invoice.approvedMatchRevision == null) {
    return { ok: false, error: 'APPROVAL_SNAPSHOT_INVALID' };
  }
  const approvedRun = await tx.supplierInvoiceMatchRun.findFirst({
    where: {
      id: invoice.approvedMatchRunId,
      supplierInvoiceId: invoice.id,
      revision: invoice.approvedMatchRevision,
    },
    select: { id: true, revision: true, result: true, disposition: true },
  });
  if (!approvedRun) return { ok: false, error: 'APPROVAL_SNAPSHOT_INVALID' };

  // ③b 加载 approved immutable MatchRun 的 MatchLines（CTO #9757：requiredQty 必须取
  //    MatchLine.invoiceQty——immutable snapshot，**不得信 current projection**）；
  //    approved Run 必须覆盖每张发票行（缺行 = approved Run 被污染/不一致 → 拒绝）
  const approvedMatchLines = await tx.supplierInvoiceMatchLine.findMany({
    where: { matchRunId: approvedRun.id },
    select: { supplierInvoiceLineId: true, invoiceQty: true },
  });
  const requiredQtyByLineId = new Map(
    approvedMatchLines.map((m) => [m.supplierInvoiceLineId, m.invoiceQty]),
  );

  // ④ maker-checker（服务层，CTO #9757 修正）：
  //    - Poster ≠ Creator（硬性）；
  //    - Approval actor 从现有 Workflow 事实读取（不新造 approvedById 字段，frozen 0027 不动）——
  //      posterId 不得等于本轮任一 APPROVE actor；
  //    - **查不到可证明的审批事实时 fail closed**——不能只因为 documentStatus=APPROVED 就继续 POST
  if (params.actorId === invoice.createdById) return { ok: false, error: 'MAKER_CHECKER' };
  const approvalActors = await resolveSupplierInvoiceApprovalActors(tx, invoice.id);
  if (approvalActors.length === 0) {
    // fail closed：无法从 Workflow SSOT 证明审批事实（无实例/无 APPROVE 动作/无 APPROVED approver）
    return { ok: false, error: 'APPROVAL_SNAPSHOT_INVALID' };
  }
  if (approvalActors.includes(params.actorId)) {
    return { ok: false, error: 'MAKER_CHECKER' };
  }

  // ⑤ 行存在校验
  const lines = await tx.supplierInvoiceLine.findMany({
    where: { supplierInvoiceId: invoice.id, deletedAt: null },
    orderBy: { lineNo: 'asc' },
    select: {
      id: true,
      purchaseOrderLineId: true,
      warehouseReceiptLineId: true,
      quantity: true,
      vatRecoverable: true,
      taxAmount: true,
      nonRecoverableTaxAmount: true,
    },
  });
  if (lines.length === 0) return { ok: false, error: 'NO_LINES' };

  // ⑤b 来源事实重验（不变量② 锁序契约）：verifyReceiptBasedSourceChain 内部 deterministic lock——
  //    collect WHR ids → 去重排序 → ORDER BY id FOR UPDATE → 之后才计算 remaining GRIR；
  //    Invoice CONSUME 与 PurchaseReturn REVERSAL 共享同一锁序，串行竞争同一余额
  const chain = await verifyReceiptBasedSourceChain(tx, {
    supplierId: invoice.supplierId,
    excludeInvoiceId: invoice.id, // POST 时自身行已在 DB（APPROVED 非 CANCELLED），排除自身累计占用
    lines: lines.map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId,
      warehouseReceiptLineId: l.warehouseReceiptLineId,
      quantity: l.quantity,
    })),
  });
  if (!chain.ok) return { ok: false, error: chain.error };

  // ⑥⑦⑧ Phase A（零写入）：锁内全量校验——remaining GRIR 重算 + 全额满足校验（不变量③，fail closed）
  // + ACCRUAL snapshot 获取（不变量④）+ sourceKey 幂等检查。
  // **B1 修复（CTO Static Gate 2026-08-12）**：Prisma $transaction 正常 return 会 commit，只有 throw
  // 才 rollback——因此所有 `{ok:false}` 业务 Gate 必须在第一笔 immutable accounting write 之前结束；
  // Phase A 只读校验（零写入，任何失败 return {ok:false} 都安全），Phase B 才执行写入。
  const consumes: GrirConsumeResult[] = [];
  const insufficient: Array<{
    lineId: string;
    warehouseReceiptLineId: string;
    required: string;
    remaining: string;
  }> = [];
  const consumePlans: Array<{
    lineId: string;
    whrLineId: string;
    requiredQty: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    baseAmount: Prisma.Decimal;
    sourceKey: string;
  }> = [];
  for (const line of lines) {
    const whrLineId = line.warehouseReceiptLineId;

    // CTO #9757：requiredQty 必须取 approved immutable MatchRun 对应 MatchLine.invoiceQty
    // （**不得信 current projection**——SupplierInvoiceLine.quantity 是可变投影，approved snapshot
    //  才是 POST 的授权利量）；approved Run 必须覆盖每张发票行，缺行 = Run 被污染/不一致 → 拒绝
    const requiredQty = requiredQtyByLineId.get(line.id);
    if (requiredQty === undefined) {
      return { ok: false, error: 'APPROVAL_SNAPSHOT_INVALID' };
    }

    // remaining unconsumed GRIR（对同一 WHR Line）：ΣACCRUAL - ΣREVERSAL - ΣCONSUME
    // （与 C0-C REVERSAL 完全相同的口径——REVERSAL/CONSUME 经来源行回溯同一 WHR Line）
    const [accrualAgg, reversalAgg, consumeAgg] = await Promise.all([
      tx.grirRecord.aggregate({
        where: { grirType: 'ACCRUAL', warehouseReceiptLineId: whrLineId },
        _sum: { quantity: true },
      }),
      tx.grirRecord.aggregate({
        where: {
          grirType: 'REVERSAL',
          purchaseReturnLine: { sourceWarehouseReceiptLineId: whrLineId },
        },
        _sum: { quantity: true },
      }),
      tx.grirRecord.aggregate({
        where: {
          grirType: 'CONSUME',
          supplierInvoiceLine: { warehouseReceiptLineId: whrLineId },
        },
        _sum: { quantity: true },
      }),
    ]);
    const accrued = accrualAgg._sum.quantity ?? new Prisma.Decimal(0);
    const reversed = reversalAgg._sum.quantity ?? new Prisma.Decimal(0);
    const consumed = consumeAgg._sum.quantity ?? new Prisma.Decimal(0);
    const remaining = accrued.minus(reversed).minus(consumed);

    // 不变量③：必须全额满足——remaining ≥ requiredQty（approved MatchLine.invoiceQty）；不足 fail closed
    if (remaining.lt(requiredQty)) {
      insufficient.push({
        lineId: line.id,
        warehouseReceiptLineId: whrLineId,
        required: requiredQty.toString(),
        remaining: remaining.toString(),
      });
      continue;
    }

    // 不变量④：CONSUME 金额用 GRIR/PO snapshot basis——unitPrice/taxRate 取对应 ACCRUAL snapshot
    // （不取发票价格；Invoice 与 PO 价格差异属已审批采购价格差异，不得改写 GRIR basis 掩盖）
    const accrualRecord = await tx.grirRecord.findFirst({
      where: { grirType: 'ACCRUAL', warehouseReceiptLineId: whrLineId },
      select: { unitPrice: true, taxRate: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!accrualRecord) {
      // 无 ACCRUAL = 无可 consume（fail closed——CTO #9757：不要因为 0028 理论上补过就假设数据库完整）
      insufficient.push({
        lineId: line.id,
        warehouseReceiptLineId: whrLineId,
        required: requiredQty.toString(),
        remaining: '0',
      });
      continue;
    }
    const unitPrice = accrualRecord.unitPrice;
    const taxRate = accrualRecord.taxRate;
    const baseAmount = requiredQty.mul(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const sourceKey = `CONSUME:SUPPLIER_INVOICE_LINE:${line.id}`;

    // 幂等防线：sourceKey 已存在（POST 只应发生一次；POSTED 门禁在前，DB 兜底）——
    // Phase A 零写入，此处 return {ok:false} 安全（无任何 accounting fact 已落库）
    const existing = await tx.grirRecord.findFirst({ where: { sourceKey } });
    if (existing) return { ok: false, error: 'ALREADY_POSTED' };

    consumePlans.push({
      lineId: line.id,
      whrLineId,
      requiredQty,
      unitPrice,
      taxRate,
      baseAmount,
      sourceKey,
    });
  }

  // 不变量③ fail closed：任一 insufficient → return（Phase A 零写入，安全；禁止 partial POST）
  if (insufficient.length > 0) {
    return { ok: false, error: 'GRIR_INSUFFICIENT', details: insufficient };
  }

  // Phase B（仅写入）：第一笔 accounting write 之后，任何失败必须 throw（保证事务回滚）——
  // 禁止再通过 return {ok:false} 表达失败（Prisma 正常 return 会 commit partial facts）
  for (const plan of consumePlans) {
    await tx.grirRecord.create({
      data: {
        grirType: 'CONSUME',
        supplierInvoiceId: invoice.id,
        supplierInvoiceLineId: plan.lineId,
        quantity: plan.requiredQty,
        unitPrice: plan.unitPrice,
        taxRate: plan.taxRate,
        baseAmount: plan.baseAmount,
        sourceKey: plan.sourceKey,
        remark: `SINV ${invoice.invoiceNo} POSTED 消耗暂估（ACCRUAL snapshot basis，qty=${plan.requiredQty.toString()} × unitPrice=${plan.unitPrice.toString()}）`,
        createdById: params.actorId,
      },
    });
    consumes.push({
      lineId: plan.lineId,
      warehouseReceiptLineId: plan.whrLineId,
      quantity: plan.requiredQty.toString(),
      unitPrice: plan.unitPrice.toString(),
      baseAmount: plan.baseAmount.toString(),
      sourceKey: plan.sourceKey,
    });
  }

  // ⑨ AP Liability + OpenItem（AP helper——不变量⑤：发票事实金额；同事务原子创建；抛错 → 回滚）
  const ap = await createApLiabilityAndOpenItem(tx, {
    invoice: {
      id: invoice.id,
      supplierId: invoice.supplierId,
      currency: invoice.currency,
      grossAmount: invoice.grossAmount,
      netAmount: invoice.netAmount,
      paymentDueDate: invoice.paymentDueDate,
    },
    lines,
    actorId: params.actorId,
  });
  const { liability, openItem, inputVatAmount, nonRecoverableTaxAmount } = ap;

  // ⑩ CAS POSTED（不变量⑥：同事务全有或全无；POSTED 终态证据）
  // B1：CAS 失败必须 throw（不能 return {ok:false}——否则 CONSUME+AP 已写入却被 commit）
  const postedAt = new Date();
  const cas = await tx.supplierInvoice.updateMany({
    where: {
      id: invoice.id,
      version: params.version,
      documentStatus: 'APPROVED',
      deletedAt: null,
    },
    data: {
      documentStatus: 'POSTED',
      postedAt,
      postedById: params.actorId,
      updatedById: params.actorId,
      version: { increment: 1 },
    },
  });
  if (cas.count !== 1) {
    throw new SupplierInvoicePostVersionConflictError();
  }

  const invoiceFinal = await tx.supplierInvoice.findFirst({
    where: { id: invoice.id, deletedAt: null },
    include: {
      lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
    },
  });
  if (!invoiceFinal) {
    // B1：写入后不可达的终态异常 → throw（回滚），禁止 return {ok:false} 提交 partial facts
    throw new SupplierInvoicePostInternalError();
  }

  return {
    ok: true,
    invoice: invoiceFinal,
    consumes,
    liability,
    openItem,
    inputVatAmount,
    nonRecoverableTaxAmount,
  };
}
