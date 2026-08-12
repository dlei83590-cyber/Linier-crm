import { writeAuditLog } from '@/lib/api-helpers';

/**
 * Sprint 5C-1B/1C - SupplierInvoice Domain Events 发布（EVENTS.md v1.32/1.33 注册）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段实现：
 * - `SupplierInvoiceMatched`（5C-1B）——**只有 Match 事务成功（immutable MatchRun + MatchLines +
 *   current projection + documentStatus=MATCHED 同事务提交）后才发布**；载荷含三单匹配事实
 *   （invoiceId/invoiceNo/supplierId/matchRunId + revision（immutable 引用）/result/disposition/行数/
 *   操作人/时点）；**不含投影余额**（AP/OpenItem 属 5C-1C）；DRAFT/SUBMITTED 不发领域事件（仅 AuditLog）。
 * - `SupplierInvoicePosted`（5C-1C，EVENTS v1.33 ⏳→✅）——**只有 POST 事务成功（POSTED + 所有
 *   GRIR CONSUME + ApLiabilityFact + ApOpenItem 同事务提交）后才发布**；载荷含发票事实金额
 *   （gross/net/inputVat/nonRecoverableTax）+ liabilityId/openItemId + consumeCount；
 *   **不含 projection 余额**（ApOpenItem.openAmount 为投影，不随事件下发）。
 * - `GrirConsumed`（5C-1C，EVENTS v1.33 ⏳→✅）——GRIR consume 终态（每行一条 consume 事实
 *   的载荷数组）；与 SupplierInvoicePosted 同事务提交后发布。
 * 红线：`GrirAccrued/GrirReversed`（C0 producer）+ `SupplierInvoiceCancelled` + 5C-2 事件仍 HOLD。
 */

export interface SupplierInvoiceEventPayload {
  invoiceId: string;
  invoiceNo: string;
  supplierId: string;
  /** immutable MatchRun 引用（Approval 也引用此 run+revision——#9238 分层） */
  matchRunId?: string;
  revision?: number;
  result?: string; // MATCHED | VARIANCE
  disposition?: string; // ACCEPT | HOLD（CREATE_CN_DN 5C-2 不接）
  lineCount?: number;
  matchedById?: string;
  matchedAt?: string; // ISO
  /** 5C-1C POST：发票事实金额（服务端聚合；不含投影余额） */
  grossAmount?: string;
  netAmount?: string;
  inputVatAmount?: string;
  nonRecoverableTaxAmount?: string;
  liabilityId?: string;
  openItemId?: string;
  consumeCount?: number;
  postedById?: string;
  postedAt?: string; // ISO
  /** GrirConsumed：consume 终态行 */
  consumes?: Array<{
    lineId: string;
    warehouseReceiptLineId: string;
    quantity: string;
    unitPrice: string;
    baseAmount: string;
    sourceKey: string;
  }>;
  consumedById?: string;
  consumedAt?: string; // ISO
  [key: string]: unknown;
}

export async function publishSupplierInvoiceEvent(params: {
  eventType: 'SupplierInvoiceMatched' | 'SupplierInvoicePosted' | 'GrirConsumed';
  actorId?: string | null;
  entityId: string;
  payload: SupplierInvoiceEventPayload;
  meta?: object;
}) {
  await writeAuditLog({
    actorId: params.actorId ?? null,
    action: params.eventType,
    entityType: 'supplier-invoice',
    entityId: params.entityId,
    afterData: params.payload,
    meta: params.meta,
  });
}
