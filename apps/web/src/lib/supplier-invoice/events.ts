import { writeAuditLog } from '@/lib/api-helpers';

/**
 * Sprint 5C-1B - SupplierInvoice Domain Events 发布（EVENTS.md v1.32 已注册 SupplierInvoiceMatched）
 * 事件总线尚未落地（Known Risk），当前以 AuditLog 留痕；总线落地后替换为 publish。
 * 本阶段（5C-1B Immutable 3-Way Match）实现：`SupplierInvoiceMatched`——**只有 Match 事务成功
 * （immutable MatchRun + MatchLines + current projection + documentStatus=MATCHED 同事务提交）后才发布**。
 * 红线：载荷含三单匹配事实（invoiceId/invoiceNo/supplierId/**matchRunId + revision（immutable 引用）**/
 * result/disposition/行数/操作人/时点）；**不含投影余额**（AP/OpenItem 属 5C-1C）；DRAFT/SUBMITTED
 * 不发领域事件（仅 AuditLog——EVENTS v1.31 口径）。
 * `SupplierInvoiceMatched/Posted` + `GrirAccrued/GrirReversed` + `SupplierInvoiceCancelled` 仍 HOLD 到对应阶段；
 * 5C-1B 只实现 Matched（Approval 走 Workflow，不单独发事件——Workflow 审批事实源）。
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
  [key: string]: unknown;
}

export async function publishSupplierInvoiceEvent(params: {
  eventType: 'SupplierInvoiceMatched';
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
