import { z } from 'zod';

/**
 * Sprint 3A - 统一 Zod Schemas（平台 API）
 * 所有平台 API 参数验证集中于此，禁止散落内联 schema。
 */

// ============================================================================
// Workflow Definition（第一批）
// ============================================================================

export const workflowStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const approvalModeSchema = z.enum(['SEQUENTIAL', 'PARALLEL', 'ANY_ONE', 'COUNTERSIGN']);
export const approverTypeSchema = z.enum(['USER', 'ROLE', 'DEPARTMENT', 'APPROVER_GROUP']);
export const conditionOperatorSchema = z.enum([
  'EQ',
  'NEQ',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'IN',
  'NOT_IN',
  'CONTAINS',
]);

export const workflowConditionSchema = z.object({
  expression: z.string().max(200).optional(),
  field: z.string().min(1).max(100),
  operator: conditionOperatorSchema,
  value: z.string().min(1).max(200),
});

export const workflowStepSchema = z.object({
  stepNo: z.number().int().positive(),
  stepName: z.string().min(1).max(100),
  approverType: approverTypeSchema,
  approverValue: z.string().min(1).max(100).optional(),
  approvalMode: approvalModeSchema.default('SEQUENTIAL'),
  timeoutHours: z.number().int().positive().optional(),
  allowReject: z.boolean().default(true),
  allowTransfer: z.boolean().default(false),
  allowDelegate: z.boolean().default(false),
  allowWithdraw: z.boolean().default(false),
  conditions: z.array(workflowConditionSchema).default([]),
});

export const workflowDefinitionCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, 'Code 仅允许大写字母、数字、下划线'),
  name: z.string().min(1).max(100),
  module: z.string().min(1).max(50),
  description: z.string().max(500).optional(),
  steps: z.array(workflowStepSchema).min(1, '至少需要一个步骤'),
});

export const workflowDefinitionUpdateSchema = workflowDefinitionCreateSchema
  .partial()
  .extend({ version: z.number().int().positive() });

// ============================================================================
// Workflow Instance（第二批）
// ============================================================================

export const workflowInstanceStatusSchema = z.enum([
  'RUNNING',
  'COMPLETED',
  'REJECTED',
  'TERMINATED',
  'WITHDRAWN',
]);
export const workflowActionTypeSchema = z.enum([
  'SUBMIT',
  'APPROVE',
  'REJECT',
  'RETURN',
  'TRANSFER',
  'DELEGATE',
  'WITHDRAW',
  'TERMINATE',
  'COMMENT',
]);

export const workflowInstanceCreateSchema = z.object({
  definitionId: z.string().min(1),
  businessType: z.string().min(1).max(50),
  businessId: z.string().min(1).max(100),
  payload: z.record(z.unknown()).optional(), // 业务字段（用于条件评估，如 amount）
});

export const workflowActionSchema = z.object({
  actionType: workflowActionTypeSchema,
  targetUserId: z.string().min(1).optional(), // TRANSFER/DELEGATE 目标
  stepNo: z.number().int().positive().optional(),
  comment: z.string().max(1000).optional(),
  payload: z.record(z.unknown()).optional(),
});

// ============================================================================
// 第三批：平台配置
// ============================================================================

export const approverGroupCreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[A-Z0-9_]+$/, 'Code 仅允许大写字母、数字、下划线'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  memberUserIds: z.array(z.string().min(1)).default([]),
});

export const approverGroupUpdateSchema = approverGroupCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const dictionaryTypeCreateSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1).max(100),
  category: z.string().max(50).optional(),
  language: z.string().max(20).default('zh-CN'),
  sort: z.number().int().default(0),
  icon: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  enabled: z.boolean().default(true),
});

export const dictionaryTypeUpdateSchema = dictionaryTypeCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const dictionaryItemCreateSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(100),
  sort: z.number().int().default(0),
  color: z.string().max(20).optional(),
  icon: z.string().max(100).optional(),
  enabled: z.boolean().default(true),
});

export const dictionaryItemUpdateSchema = dictionaryItemCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const settingScopeSchema = z.enum(['SYSTEM', 'TENANT', 'USER']);
export const settingDataTypeSchema = z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'SECRET']);

export const settingCreateSchema = z.object({
  scope: settingScopeSchema,
  tenantId: z.string().min(1).optional(), // scope=TENANT 必填
  userId: z.string().min(1).optional(), // scope=USER 必填
  key: z.string().min(1).max(100),
  value: z.string().max(4000).optional(),
  dataType: settingDataTypeSchema.default('STRING'),
  encrypted: z.boolean().default(false),
  description: z.string().max(500).optional(),
});

export const settingUpdateSchema = settingCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

export const notificationChannelTypeSchema = z.enum([
  'SYSTEM',
  'EMAIL',
  'TELEGRAM',
  'WEBHOOK',
  'WECHAT',
  'DINGTALK',
]);

export const notificationTemplateCreateSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1).max(100),
  channel: notificationChannelTypeSchema.default('SYSTEM'),
  subject: z.string().max(200).optional(),
  content: z.string().min(1).max(4000),
});

export const notificationTemplateUpdateSchema = notificationTemplateCreateSchema.partial().extend({
  version: z.number().int().positive(),
});

// ============================================================================
// 第四批：Quotation（Sprint 4A Phase 3）
// ============================================================================

export const quotationLineCreateSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().max(500).optional(),
  quantity: z.coerce.number().positive(),
  uomId: z.string().min(1).optional(),
  lineNo: z.number().int().positive().optional(),
});

export const quotationCreateSchema = z
  .object({
    customerId: z.string().min(1),
    opportunityId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1).nullable().optional(),
    currency: z.string().max(10).default('CNY'),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    taxProfileId: z.string().min(1).nullable().optional(),
    paymentTerm: z.string().max(100).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    lines: z.array(quotationLineCreateSchema).min(1, '至少需要一行'),
  })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, {
    message: '有效期至不能早于有效期从',
    path: ['validUntil'],
  });

export const quotationUpdateSchema = z
  .object({
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    taxProfileId: z.string().min(1).nullable().optional(),
    paymentTerm: z.string().max(100).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, {
    message: '有效期至不能早于有效期从',
    path: ['validUntil'],
  });

export const quotationLineUpdateSchema = z
  .object({
    description: z.string().max(500).optional(),
    quantity: z.coerce.number().positive().optional(),
    uomId: z.string().min(1).nullable().optional(),
    lineNo: z.number().int().positive().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

export const quotationRevisionCreateSchema = z.object({
  changeReason: z.string().min(1).max(500),
});

// ============================================================================
// 第五批：Sales Order（Sprint 4B）
// ============================================================================

/** 头更新：允许改交期/付款条件/贸易术语/备注；禁止直接改价（CTO 锁定项②：价格继承 Quotation，重定价走 PricingEngine） */
export const salesOrderUpdateSchema = z
  .object({
    requestedDeliveryDate: z.string().datetime().nullable().optional(),
    paymentTerm: z.string().max(50).nullable().optional(),
    incoterm: z.string().max(50).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

/** 行更新：允许改描述/数量/UOM/行号；禁止 unitPrice（价格字段不得前端直接写入） */
export const salesOrderLineUpdateSchema = z
  .object({
    description: z.string().max(500).optional(),
    quantity: z.coerce.number().positive().optional(),
    uomId: z.string().min(1).nullable().optional(),
    lineNo: z.number().int().positive().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

export const salesOrderRevisionCreateSchema = z.object({
  changeReason: z.string().min(1).max(500),
});

// ============================================================================
// 第六批：Delivery（Sprint 4C）
// ============================================================================

/** 创建 Delivery：头 + 指定行（从 SO Line 选择，不默认复制全部剩余行；空行则只建头） */
export const deliveryCreateSchema = z.object({
  deliveryDate: z.string().datetime().optional(), // 计划交付日期（默认 now）
  expectedArrivalDate: z.string().datetime().nullable().optional(),
  carrier: z.string().max(100).nullable().optional(),
  trackingNo: z.string().max(100).nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z
    .array(
      z.object({
        sourceSalesOrderLineId: z.string().min(1),
        quantity: z.coerce.number().positive(),
      }),
    )
    .min(1)
    .optional(),
  changeReason: z.string().max(500).optional(),
});

/** 头更新：仅 DRAFT 可编辑；salesOrderId/customerId/status 不可改 */
export const deliveryUpdateSchema = z
  .object({
    deliveryDate: z.string().datetime().optional(),
    expectedArrivalDate: z.string().datetime().nullable().optional(),
    carrier: z.string().max(100).nullable().optional(),
    trackingNo: z.string().max(100).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

/** 行更新：仅 DRAFT 可编辑；quantity 变更必须过 availableQty 动态校验（防超交） */
export const deliveryLineUpdateSchema = z
  .object({
    quantity: z.coerce.number().positive().optional(),
    description: z.string().max(500).optional(),
    uomId: z.string().min(1).nullable().optional(),
    lineNo: z.number().int().positive().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

/** ready：无业务字段，仅可选变更原因 */
export const deliveryReadySchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/** dispatch：可更新承运方/运单号/预计到达（READY → DISPATCHED 时可选补充物流信息） */
export const deliveryDispatchSchema = z.object({
  carrier: z.string().max(100).nullable().optional(),
  trackingNo: z.string().max(100).nullable().optional(),
  expectedArrivalDate: z.string().datetime().nullable().optional(),
  changeReason: z.string().max(500).optional(),
});

/** confirm-delivery：POD 门禁（podStatus ∈ {RECEIVED, WAIVED}，否则 409）；RECEIVED 时回填签收投影 */
export const deliveryConfirmSchema = z.object({
  podStatus: z.enum(['RECEIVED', 'WAIVED']).optional(),
  podReceivedAt: z.string().datetime().optional(),
  changeReason: z.string().max(500).optional(),
});

/** cancel：无业务字段，仅可选变更原因 */
export const deliveryCancelSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/** Invoice 创建：唯一入口 POST /api/deliveries/{id}/invoice（{id}=primaryDeliveryId；deliveryIds[] 附加来源=Consolidated） */
export const invoiceCreateSchema = z.object({
  deliveryIds: z.array(z.string().min(1)).optional(), // Consolidated Invoice 附加 Delivery 来源（财务属性必须一致）
  lines: z
    .array(
      z.object({
        deliveryLineId: z.string().min(1),
        quantity: z.coerce.number().positive(),
      }),
    )
    .min(1),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  changeReason: z.string().max(500).optional(),
});

/** issue：DRAFT → ISSUED（DocumentSequence 原子取号；编号延后生成；并发 issue 第二个请求 409 不消耗编号）
 * VAT 要素（ADR-0043）：invoiceType 必填（I4）；taxInvoiceCode/No 按类型校验（I7）；redInvoiceRefId 触发红字（R2/R4） */
export const invoiceIssueSchema = z.object({
  changeReason: z.string().max(500).optional(),
  invoiceType: z.enum(["SPECIAL_VAT", "ORDINARY_VAT", "ELECTRONIC_VAT", "EXPORT", "OTHER"]).optional(),
  taxInvoiceCode: z.string().max(20).nullable().optional(),
  taxInvoiceNo: z.string().max(20).nullable().optional(),
  redInvoiceRefId: z.string().min(1).max(64).nullable().optional(),
});

/** cancel：仅 DRAFT → CANCELLED（释放 DeliveryLine 已占用的开票数量投影） */
export const invoiceCancelSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/** 头更新：仅 DRAFT 可编辑；只允许非财务字段（remark/dueDate/paymentTerm——schema 无 reference 列）；金额/数量/code/status 禁止 PATCH */
export const invoiceUpdateSchema = z
  .object({
    remark: z.string().max(1000).nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    paymentTerm: z.string().max(50).nullable().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

// ============================================================================
// Receipt / Payment Allocation（Sprint 4E-2）
// ============================================================================

/** Receipt 创建：只记录实际收到的钱（拍板①：创建与核销分离，不自动核销；unallocatedAmount = amount）
 * 拍板④：DocumentSequence 创建即取号（RCT-2026-xxxx）
 * 硬规则：customerId/currency 由调用方提供；核销时校验与目标 AR 一致（409 RECEIPT_CUSTOMER_MISMATCH / RECEIPT_CURRENCY_MISMATCH）
 */
export const receiptCreateSchema = z.object({
  customerId: z.string().min(1),
  currency: z.string().min(3).max(3).default('CNY'),
  amount: z.coerce.number().positive(),
  receiptDate: z.string().datetime().optional(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER', 'BANK_ACCEPTANCE_BILL', 'COMMERCIAL_ACCEPTANCE_BILL', 'TT_ELECTRONIC_TRANSFER']),
  referenceNo: z.string().max(100).nullable().optional(),
  changeReason: z.string().max(500).optional(),
});

/** Allocation 核销：一次请求原子化（拍板①：创建与核销分离，allocate 为显式动作）
 * allocations[]：一个 Receipt → 多 AR（M:N）；同一 (receipt, AR) 只核销一次（unique 约束）
 * 事务红线（CTO 指定）：Lock Receipt → Lock AR(id ASC FOR UPDATE) → 校验 Customer/Currency →
 * 校验 Receipt unallocated → 校验 ≤ AR.balanceAmount → Create ReceiptAllocation → 回写 AR/Invoice/Receipt 投影 → Snapshot/Audit → Events
 */
export const receiptAllocateSchema = z.object({
  allocations: z
    .array(
      z.object({
        accountsReceivableId: z.string().min(1),
        amount: z.coerce.number().positive(),
      }),
    )
    .min(1),
  changeReason: z.string().max(500).optional(),
});

/** Allocation Reversal：撤销原核销关系（CTO Design Review 新锁定边界；CN 不承担收款冲销）
 * 留痕：reversedAt/reversedBy/reverseReason 写入原 ReceiptAllocation（**不删除**）；恢复 AR/Invoice/Receipt 三方投影
 */
export const receiptAllocationReverseSchema = z.object({
  reverseReason: z.string().min(1).max(500),
});

/** Receipt Void：仅 UNALLOCATED 可 VOID（拍板②）；已有核销不得直接 VOID（须先 Reversal）
 * 边界：Void 只作废收款事实，**不实现 Credit Note 语义**（CN 属 4E-3 发票调整域）
 */
export const receiptVoidSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

// ============================================================================
// WriteOff（Sprint 4E-2；独立事实——拍板③：WriteOff + WriteOffAllocation，不做三件套）
// ============================================================================

/** WriteOff 创建：DRAFT + WriteOffAllocation 明细（拍板④：DocumentSequence 创建即取号 WO-2026-xxxx）
 * 校验：同 Customer / 同 Currency（409 WRITE_OFF_SOURCE_NOT_COMPATIBLE）；每笔 amount > 0；
 * amount = Σ allocations（服务端 computeWriteOffTotal，禁止直传头金额）；**暂不修改 AR**。
 */
export const writeOffCreateSchema = z.object({
  allocations: z
    .array(
      z.object({
        accountsReceivableId: z.string().min(1),
        amount: z.coerce.number().positive(),
      }),
    )
    .min(1),
  reason: z.string().min(1).max(500),
  writeOffDate: z.string().datetime().optional(),
  approvalPolicyId: z.string().nullable().optional(),
  changeReason: z.string().max(500).optional(),
});

/** WriteOff 提交（移除审核 auto-approve）：DRAFT → SUBMITTED + approvalStatus=APPROVED（提交即生效，可直接 Apply） */
export const writeOffSubmitSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/** WriteOff Apply：**唯一回写 AR.writeOffAmount 的动作**（CTO：审批通过 ≠ 自动修改余额）
 * 重复 Apply → 409 WRITE_OFF_ALREADY_APPLIED（幂等/稳定 409）
 */
export const writeOffApplySchema = z.object({
  changeReason: z.string().max(500).optional(),
});

// ============ Sprint 4E-3：Credit Note / Debit Note ============

/** CreditDebitNote 创建：单票制（sourceInvoiceId 必填唯一）；只接受已 ISSUED 的 Invoice；
 * Customer/Currency 从原 Invoice 继承（禁止客户端传）；行只传 sourceInvoiceLineId + quantity（>0）；
 * 金额/税率/价格只复制原 InvoiceLine 快照，不调用 Pricing Engine；编号创建即取现有 CN/DN DocumentSequence。
 * **不创建 InvoiceAdjustment、不改 AR、不改 Invoice.balanceAmount**（事实由 Apply 事务生成）
 */
export const creditDebitNoteCreateSchema = z.object({
  noteType: z.enum(['CREDIT', 'DEBIT']), // CREDIT 负向调整 / DEBIT 正向调整（符号口径在 Apply 落 InvoiceAdjustment）
  sourceInvoiceId: z.string().min(1),
  reason: z.string().min(1).max(500),
  lines: z
    .array(
      z.object({
        sourceInvoiceLineId: z.string().min(1),
        quantity: z.coerce.number().positive(), // 调整数量 > 0（部分行数量调整——CTO 拍板④）
      }),
    )
    .min(1),
  changeReason: z.string().max(500).optional(),
});

/** CreditDebitNote 提交（移除审核 auto-approve）：DRAFT → SUBMITTED + approvalStatus=APPROVED（提交即生效，可直接 Apply） */
export const creditDebitNoteSubmitSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/** CreditDebitNote Apply：**唯一回写 AR.adjustedAmount 的动作**（CTO：APPROVED ≠ APPLIED，审批通过 ≠ 自动改余额）
 * 重复 Apply → 409 CN_DN_ALREADY_APPLIED（幂等/稳定 409）
 */
export const creditDebitNoteApplySchema = z.object({
  changeReason: z.string().max(500).optional(),
});

// ============================================================================
// Sprint 5A：Purchase Requisition（Phase 3 PR API；PO API 冻结）
// 红线：PR Header/Line 不得出现金额/单价/税额（需求事实源）；Line quantity 必须 > 0
// ============================================================================

export const purchaseRequisitionLineCreateSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().max(500).optional(),
  quantity: z.coerce.number().positive(), // 需求数量 > 0（服务端 Decimal 精确校验）
  uomId: z.string().min(1).optional(),
  lineNo: z.number().int().positive().optional(),
  needDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
});

export const purchaseRequisitionCreateSchema = z.object({
  requesterId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  needDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(purchaseRequisitionLineCreateSchema).min(1, '至少需要一行'),
});

/** PR 头更新 + 可选行全量替换（Line 不作为独立业务入口 → 行修改经 PATCH /{id} 整体替换；仅 DRAFT） */
export const purchaseRequisitionUpdateSchema = z
  .object({
    needDate: z.string().datetime().nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    lines: z.array(purchaseRequisitionLineCreateSchema).optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

// ============================================================================
// Sprint 5A：Purchase Order（Phase 4A PO API；PO = 采购承诺事实源）
// 红线：金额事实 = 服务端 Decimal 聚合（禁客户端直传头金额）；行金额快照复制（SUPPLIER_PRICE_SNAPSHOT 优先 / MANUAL 授权双通道）；
//       PO 不调 Pricing Engine、不重算；税率先例快照复制；receivedQty/remainingReceiveQty 仅 5B 回写（5A 禁改）
// ============================================================================

/** PO 行（价格双通道：SUPPLIER_PRICE_SNAPSHOT 服务端从 PartnerPrice 解析 / MANUAL 客户端授权录入+priceReason）
 * sourcePurchaseRequisitionLineId：**REQUISITION PO PATCH 时每行必须提供且非空（服务端验证属于 Header.requisitionId + itemId 一致）**；
 * Direct PO 强制为空（Phase 4A Review Blocking ③：不再用 lineNo 猜溯源）。 */
export const purchaseOrderLineCreateSchema = z
  .object({
    itemId: z.string().min(1),
    description: z.string().max(500).optional(),
    quantity: z.coerce.number().positive(), // 采购数量 > 0（服务端 Decimal 精确校验）
    uomId: z.string().min(1).optional(),
    lineNo: z.number().int().positive().optional(),
    sourcePurchaseRequisitionLineId: z.string().min(1).optional(),
    priceSource: z.enum(['SUPPLIER_PRICE_SNAPSHOT', 'MANUAL']).default('SUPPLIER_PRICE_SNAPSHOT'),
    // MANUAL 通道：unitPrice + priceReason 必填（CTO 拍板③：MANUAL 必须记录 priceReason/actor/audit）
    unitPrice: z.coerce.number().positive().optional(),
    priceReason: z.string().max(500).optional(),
    // 税率快照（SUPPLIER_PRICE_SNAPSHOT 时服务端从税档解析；MANUAL 时可传，默认 0）
    taxRate: z.coerce.number().nonnegative().optional(),
  })
  .refine(
    (v) => {
      if (v.priceSource === 'MANUAL') {
        return (
          v.unitPrice !== undefined &&
          v.unitPrice > 0 &&
          v.priceReason !== undefined &&
          v.priceReason.length > 0
        );
      }
      return true;
    },
    { message: 'MANUAL 价格通道必须提供 unitPrice 和 priceReason' },
  );

/** PO 创建（Direct Purchase：sourceType=DIRECT，requisitionId 为空；行 sourcePurchaseRequisitionLineId 为空） */
export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().min(1),
  // 采购员/采购部门（CTO Phase 4B 指令：PO Header 落地；Direct 无 PR 时采购员不可推导）
  purchaserId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  currency: z.string().min(1).max(10).optional(),
  paymentTerm: z.string().max(100).nullable().optional(),
  expectedDeliveryDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(purchaseOrderLineCreateSchema).min(1, '至少需要一行'),
});

/** PO 头更新 + 可选行全量替换（仅 DRAFT；金额服务端重算；ReceivedQty/remainingReceiveQty 禁止客户端传入） */
export const purchaseOrderUpdateSchema = z
  .object({
    purchaserId: z.string().min(1).nullable().optional(),
    departmentId: z.string().min(1).nullable().optional(),
    paymentTerm: z.string().max(100).nullable().optional(),
    expectedDeliveryDate: z.string().datetime().nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    lines: z.array(purchaseOrderLineCreateSchema).optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

/** PR → PO Convert（sourceType=REQUISITION；行快照复制自 PR Line + 保留 sourcePurchaseRequisitionLineId；价格双通道）
 * lines 可选：不传则全部行走 SUPPLIER_PRICE_SNAPSHOT（服务端解析）；传则按 PR 行顺序覆盖价格。 */
export const purchaseOrderConvertSchema = z.object({
  supplierId: z.string().min(1),
  purchaserId: z.string().min(1).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  currency: z.string().min(1).max(10).optional(),
  paymentTerm: z.string().max(100).nullable().optional(),
  expectedDeliveryDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z
    .array(
      z
        .object({
          priceSource: z
            .enum(['SUPPLIER_PRICE_SNAPSHOT', 'MANUAL'])
            .default('SUPPLIER_PRICE_SNAPSHOT'),
          unitPrice: z.coerce.number().positive().optional(),
          priceReason: z.string().max(500).optional(),
          taxRate: z.coerce.number().nonnegative().optional(),
        })
        .refine(
          (v) => {
            if (v.priceSource === 'MANUAL') {
              return (
                v.unitPrice !== undefined &&
                v.unitPrice > 0 &&
                v.priceReason !== undefined &&
                v.priceReason.length > 0
              );
            }
            return true;
          },
          { message: 'MANUAL 价格通道必须提供 unitPrice 和 priceReason' },
        ),
    )
    .optional(),
});

/** Sprint 5B：PurchaseReceipt（采购收货事实）schema（CTO Phase 2 Review 98/100 APPROVED 后开发）
 * 设计依据：ADR-0024 + Sprint5B Field Matrix §1 + CTO #6923 Receive 8 条硬规则：
 * - quantity = **物理到货毛数量**（>0）；0 <= rejectedOnReceiptQty <= quantity（规则④）；
 *   **acceptedReceiptQty = quantity - rejectedOnReceiptQty**（服务端计算，客户端只提交毛数量与现场拒收）；
 * - receivedQty / remainingReceiveQty **禁止客户端提交**（服务端唯一回写，规则⑦）；
 * - fulfillmentType **不在此层**——以 PO Line 已确认的 fulfillmentType 为准（规则③，禁静默改）；
 * - warehouseId 可空（仅 WAREHOUSE 收货场景使用；DIRECT_PROJECT 不要求，规则③）。
 */

/** PurchaseReceipt 行（客户端提交：purchaseOrderLineId + 物理到货毛数量 + 现场拒收/可见损坏 + 直送执行补充） */
export const purchaseReceiptLineCreateSchema = z
  .object({
    purchaseOrderLineId: z.string().min(1), // 溯源 PO Line（行级溯源；服务端校验属于同一 PO——规则②）
    quantity: z.coerce.number().positive(), // 物理到货毛数量 > 0（规则④）
    visibleDamageQty: z.coerce.number().nonnegative().default(0), // 收货现场可见损坏
    rejectedOnReceiptQty: z.coerce.number().nonnegative().default(0), // 现场即拒收（不计入 receivedQty）
    // 直送执行补充（P4 Final：PO Line 已声明 DIRECT_PROJECT；此处记录实际执行结果；receivedBy/receivedAt 用 Header）
    deliveryAddress: z.string().max(500).optional(),
    receiver: z.string().max(200).optional(),
    proof: z.string().max(500).optional(),
    remark: z.string().max(500).optional(),
  })
  .refine((v) => v.rejectedOnReceiptQty <= v.quantity, {
    message: 'rejectedOnReceiptQty 不能超过物理到货毛数量 quantity',
    path: ['rejectedOnReceiptQty'],
  });

/** PurchaseReceipt 创建（DRAFT；普通收货不走审批——P1b Final；warehouseId 可空：仅 WAREHOUSE 场景） */
export const purchaseReceiptCreateSchema = z.object({
  purchaseOrderId: z.string().min(1),
  warehouseId: z.string().min(1).optional(), // 公司仓库到货地点（仅 WAREHOUSE 收货场景；DIRECT_PROJECT 不要求）
  remark: z.string().max(500).optional(),
  lines: z.array(purchaseReceiptLineCreateSchema).min(1, '至少需要一行'),
});

/** PurchaseReceipt 更新（仅 DRAFT；version 乐观锁；行整体替换；receivedQty/remainingReceiveQty 禁客户端提交） */
export const purchaseReceiptUpdateSchema = z.object({
  version: z.number().int().positive(),
  warehouseId: z.string().min(1).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(purchaseReceiptLineCreateSchema).min(1).optional(),
});

/** Sprint 5B - Inspection（质检唯一事实源，CTO #7045 97/100 APPROVED 后开发）
 * - 创建：绑定已 RECEIVED 的 PurchaseReceiptLine + 检验模式（SKIP/SPOT/FULL）；
 * - 数量在 complete 时定稿（SPOT/FULL 必提交 qualifiedQty/rejectedQty，服务端校验 = inspectableQty）；
 * - SKIP 免检：complete 时服务端强制 QUALIFIED + qualifiedQty=inspectableQty + rejectedQty=0（不绕开 Inspection 记录）；
 * - result 服务端推导（客户端不得传）；inspectableQty = quantity - rejectedOnReceiptQty（不含现场拒收）。
 */

/** Inspection 创建 */
export const inspectionCreateSchema = z.object({
  purchaseReceiptLineId: z.string().min(1),
  inspectionMode: z.enum(['SKIP', 'SPOT', 'FULL']),
  remark: z.string().max(500).optional(),
});

/** Inspection 更新（仅 PENDING；version 乐观锁；只允许改 inspectionMode/remark——数量在 complete 时定稿） */
export const inspectionUpdateSchema = z.object({
  version: z.number().int().positive(),
  inspectionMode: z.enum(['SKIP', 'SPOT', 'FULL']).optional(),
  remark: z.string().max(500).nullable().optional(),
});

/** Inspection 完成（真 Gate；SPOT/FULL 必须提交 qualifiedQty+rejectedQty，服务端校验 = inspectableQty；SKIP 免检服务端强制，数量忽略） */
export const inspectionCompleteSchema = z.object({
  version: z.number().int().positive(),
  qualifiedQty: z.coerce.number().nonnegative().optional(),
  rejectedQty: z.coerce.number().nonnegative().optional(),
});

/** Sprint 5B - WarehouseReceipt（采购入库事实，CTO Inspection API Final 98/100 APPROVED #7135 后开发；D10：Created ≠ Posted，只有 POSTED 才触发 6A InventoryMovement(IN)）
 * - 入库行只能消费**已完成且 qualifiedQty > 0** 的 Inspection（组合 FK [inspectionId, purchaseReceiptLineId] 保证 Inspection 属于同一收货行）；
 * - quantity <= 可入库余额（qualifiedQty - 已占用），累计入库不得超过 Inspection 可入库余额；
 * - DIRECT_PROJECT（直送）禁入库（P4）；Warehouse-Location 必须同属；
 * - POST 幂等（ALREADY_POSTED → 409）；DRAFT 创建/编辑不发领域事件（只有 POST 发 WarehouseReceiptPosted）；
 * - 红线：5B 禁写 Stock/InventoryMovement（6A 唯一事实源）。
 */

/** 入库行（客户端提交：溯源收货行 + 已完成 Inspection + 数量 + P6 批次/序列号/效期采集） */
export const warehouseReceiptLineCreateSchema = z.object({
  purchaseReceiptLineId: z.string().min(1), // 溯源收货行（组合 FK 约束 Inspection 属于同一收货行）
  inspectionId: z.string().min(1), // 质量结论（必须已完成且 qualifiedQty > 0）
  quantity: z.coerce.number().positive(), // 入库数量（> 0；≤ 可入库余额，服务端校验）
  // P6 Final：批次/序列号/效期 canonical capture point = 入库层采集
  batchNo: z.string().max(100).optional(),
  serialNos: z.array(z.string().max(100)).optional(),
  mfgDate: z.string().max(50).optional(), // 生产日期（ISO 日期字符串，服务端转 Date）
  expDate: z.string().max(50).optional(), // 有效期至（ISO 日期字符串，服务端转 Date）
  remark: z.string().max(500).optional(),
});

/** 入库单创建（DRAFT；仓库必填；location 若提供必须属于同一 warehouse） */
export const warehouseReceiptCreateSchema = z.object({
  purchaseReceiptId: z.string().min(1),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).optional(),
  remark: z.string().max(500).optional(),
  lines: z.array(warehouseReceiptLineCreateSchema).min(1, '至少需要一行'),
});

/** 入库单更新（仅 DRAFT；version 乐观锁；行整体替换；warehouseId 模型必填不可清空、locationId 可空——组合 FK 同属校验） */
export const warehouseReceiptUpdateSchema = z.object({
  version: z.number().int().positive(),
  warehouseId: z.string().min(1).optional(), // 模型必填非空 String：不可置 null
  locationId: z.string().min(1).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(warehouseReceiptLineCreateSchema).min(1).optional(),
});

/** 入库过账（真 Gate：DRAFT → POSTED；version 乐观锁 + 幂等 ALREADY_POSTED） */
export const warehouseReceiptPostSchema = z.object({
  version: z.number().int().positive(),
});

/** Sprint 5B - PurchaseReturn（采购退货独立事实，CTO WarehouseReceipt Final Re-review 98/100 APPROVED #7219 后开发；P5 Final：非负 GR + 必须有真实来源 + disposition）
 * - 三来源（exactly-one FK + API 强制匹配）：RECEIPT_LINE / WAREHOUSE_RECEIPT_LINE / INSPECTION；
 *   RECEIPT_LINE / INSPECTION = 未入库退货（不碰库存）；WAREHOUSE_RECEIPT_LINE = 已入库退货（必须来自 POSTED 入库事实，**不得写 InventoryMovement(OUT)**）；
 * - quantity > 0 且 ≤ 来源可退余额（Return Gate 锁内重算累计 RETURNED，防并发超退）；
 * - disposition：REPLACE_REQUIRED（重开 PO 履约剩余）/ CREDIT_ONLY（不自动重开待交）；returnReason 必填；
 * - RETURN 事务锁 + CAS + Audit + PurchaseReturned 事务后事件；DRAFT 创建/编辑不发领域事件；
 * - 红线：5B 禁写 Stock/InventoryMovement（6A 唯一事实源）。
 */

/** 退货行（客户端提交：来源引用三选一 + 数量 + 处置 + 原因） */
export const purchaseReturnLineCreateSchema = z
  .object({
    sourceRefType: z.enum(['RECEIPT_LINE', 'WAREHOUSE_RECEIPT_LINE', 'INSPECTION']),
    sourcePurchaseReceiptLineId: z.string().min(1).optional(),
    sourceWarehouseReceiptLineId: z.string().min(1).optional(),
    sourceInspectionId: z.string().min(1).optional(),
    quantity: z.coerce.number().positive(), // 退货数量（> 0；≤ 来源可退余额，服务端校验）
    disposition: z.enum(['REPLACE_REQUIRED', 'CREDIT_ONLY']), // 必填（P5 Final / Blocking ②）
    returnReason: z.string().min(1).max(500), // 退货原因必填
    batchNo: z.string().max(100).optional(), // 已入库退货批次追溯（可空）
    serialNos: z.array(z.string().max(100)).optional(),
    remark: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      (v.sourceRefType === 'RECEIPT_LINE' && !!v.sourcePurchaseReceiptLineId) ||
      (v.sourceRefType === 'WAREHOUSE_RECEIPT_LINE' && !!v.sourceWarehouseReceiptLineId) ||
      (v.sourceRefType === 'INSPECTION' && !!v.sourceInspectionId),
    {
      message: 'sourceRefType 必须与对应来源 FK 匹配（exactly-one 非空）',
      path: ['sourceRefType'],
    },
  );

/** 退货单创建（DRAFT；来源必须属于该 PO） */
export const purchaseReturnCreateSchema = z.object({
  purchaseOrderId: z.string().min(1),
  returnType: z.enum(['REJECTED_ON_RECEIPT', 'RETURN_AFTER_STOCK_IN', 'QUALITY_ISSUE']),
  remark: z.string().max(500).optional(),
  lines: z.array(purchaseReturnLineCreateSchema).min(1, '至少需要一行'),
});

/** 退货单更新（仅 DRAFT；version 乐观锁；行整体替换；来源/数量重新校验） */
export const purchaseReturnUpdateSchema = z.object({
  version: z.number().int().positive(),
  returnType: z.enum(['REJECTED_ON_RECEIPT', 'RETURN_AFTER_STOCK_IN', 'QUALITY_ISSUE']).optional(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(purchaseReturnLineCreateSchema).min(1).optional(),
});

/** 退货完成（真 Gate：DRAFT → RETURNED；version 乐观锁 + 幂等 ALREADY_RETURNED） */
export const purchaseReturnReturnSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 6B - Inventory Transfer（调拨 Vertical Slice，CTO 6B-2 授权）
// 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §3（Transfer 双边原子事实）+
//           Field Matrix v0.5 §1 + ADR-0026 D2（Transfer = 双边原子事实 SOURCE_OUT + DESTINATION_IN）
// - 状态机：DRAFT → SUBMITTED → APPROVED → EXECUTED / CANCELLED（P2 Final）；EXECUTED 才触发双边 Movement
// - 审批走既有 Workflow Policy（跨仓默认需审、同仓策略配置，不硬编码）；submit 时 maybeTriggerApproval
// - Execute：Shared LedgerCommand 双 atom（SOURCE_OUT + DESTINATION_IN 同一 movementGroupId）同事务全有或全无
// - 行字段：itemId/uomId/quantity/batchNo（精确继承）/serialNos（每 serial 一对）/mfgDate/expDate（继承）
// ============================================================================

/** 调拨行（客户端提交；quantity > 0；serial-managed 每 serial 一对 Movement，数量守恒） */
export const inventoryTransferLineCreateSchema = z.object({
  itemId: z.string().min(1),
  uomId: z.string().min(1).optional(), // 业务 UOM（可选；继承来源）
  quantity: z.coerce.number().positive(), // 调拨数量（> 0；serial-managed 时须 = serialNos.length 且整数）
  batchNo: z.string().max(100).optional(), // P5 Final：batch 精确继承（SOURCE_OUT batch=B → DESTINATION_IN batch=B）
  serialNos: z.array(z.string().max(100)).default([]), // serial-managed：每 serial 一对 Movement（serial 精确继承不重生成；默认空数组）
  mfgDate: z.string().max(50).optional(), // 生产日期（ISO 日期字符串，服务端转 Date）
  expDate: z.string().max(50).optional(), // 有效期至（ISO 日期字符串，服务端转 Date）
  remark: z.string().max(500).optional(),
});

/** 调拨单创建（DRAFT；创建即取号 TRF；source/destination 仓库必填，location 若提供必须属于对应仓库） */
export const inventoryTransferCreateSchema = z.object({
  sourceWarehouseId: z.string().min(1),
  sourceLocationId: z.string().min(1).optional(),
  destinationWarehouseId: z.string().min(1),
  destinationLocationId: z.string().min(1).optional(),
  remark: z.string().max(500).optional(),
  lines: z.array(inventoryTransferLineCreateSchema).min(1, '至少需要一行'),
});

/** 调拨单更新（仅 DRAFT；version 乐观锁；行整体替换；warehouse/location 组合 FK 同属校验） */
export const inventoryTransferUpdateSchema = z.object({
  version: z.number().int().positive(),
  sourceWarehouseId: z.string().min(1).optional(),
  sourceLocationId: z.string().min(1).nullable().optional(),
  destinationWarehouseId: z.string().min(1).optional(),
  destinationLocationId: z.string().min(1).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(inventoryTransferLineCreateSchema).min(1).optional(),
});

/** 调拨提交（真 Gate：DRAFT → SUBMITTED；version 乐观锁；触发审批 maybeTriggerApproval） */
export const inventoryTransferSubmitSchema = z.object({
  version: z.number().int().positive(),
});

/** 调拨取消（DRAFT/APPROVED → CANCELLED；version 乐观锁；SUBMITTED 需先 Withdraw 审批） */
export const inventoryTransferCancelSchema = z.object({
  version: z.number().int().positive(),
});

/** 调拨执行（真 Gate：APPROVED → EXECUTED；version 乐观锁 + 幂等 ALREADY_EXECUTED；Shared LedgerCommand 双 atom 同事务） */
export const inventoryTransferExecuteSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 6B-3 - Stock Count（盘点实盘事实，CTO 6B-3 授权：Count + Adjustment 事实链一起做）
// 设计依据：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md §4 + Field Matrix v0.5 §2 + ADR-0026
// - 状态机：DRAFT → COUNTING → COMPLETED → ADJUSTED / CANCELLED
// - **红线：StockCount 永不直接改 StockProjection**——只有 Adjustment Apply 才允许调用 Shared LedgerCommand
// - 盘点行：per-line atomic snapshot（录入 countedQty 时同事务读五维 StockProjection → bookQtyAtCount/countedAt/ledgerWatermark）
//   varianceQty = countedQty - bookQtyAtCount（服务端计算）；五维唯一（DB UNIQUE NULLS NOT DISTINCT）
// - complete：非零差异 → 自动生成 COUNT_VARIANCE Adjustment（sourceStockCountLineId @unique 防双重入账）→ ADJUSTED；
//   零差异 → COMPLETED；生成的 Adjustment 仍需审批（maker-checker，System Default 非零差异需审批）
// ============================================================================

/** 盘点行（客户端提交；countedQty >= 0；五维唯一） */
export const stockCountLineSchema = z.object({
  id: z.string().min(1).optional(), // 提供则更新该行（重新 snapshot），否则新增
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).nullable().optional(),
  itemId: z.string().min(1),
  batchNo: z.string().max(100).nullable().optional(),
  serialNo: z.string().max(100).nullable().optional(), // 单值（serial-managed 逐 serial 盘点）
  countedQty: z.coerce.number().nonnegative(), // 实盘数（>= 0）
  remark: z.string().max(500).optional(),
});

/** 盘点单创建（DRAFT；创建即取号 CNT） */
export const stockCountCreateSchema = z.object({
  remark: z.string().max(500).optional(),
});

/** 盘点单更新（仅 DRAFT；version 乐观锁；header remark） */
export const stockCountUpdateSchema = z.object({
  version: z.number().int().positive(),
  remark: z.string().max(500).nullable().optional(),
});

/** 盘点行录入（COUNTING：per-line atomic snapshot——同事务读五维 StockProjection → varianceQty 服务端计算） */
export const stockCountLinesSchema = z.object({
  lines: z.array(stockCountLineSchema).min(1, '至少需要一行'),
});

/** 盘点完成（真 Gate：COUNTING → COMPLETED/ADJUSTED；非零差异自动生成 COUNT_VARIANCE Adjustment） */
export const stockCountCompleteSchema = z.object({
  version: z.number().int().positive(),
});

/** 盘点取消（DRAFT/COUNTING → CANCELLED；version 乐观锁） */
export const stockCountCancelSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 6B-3 - Inventory Adjustment（受控库存账事实，CTO 6B-3 授权）
// 设计依据：Architecture Process Gate §5 + Field Matrix v0.5 §3 + ADR-0026 + P8/P9 Final
// - 状态机：DRAFT → SUBMITTED → APPROVED → APPLIED / CANCELLED；APPROVED ≠ APPLIED
// - **红线：Adjustment 只能经 Shared LedgerCommand 追加 ADJUSTMENT Movement**（同步命令）；绝不直写 Projection
// - maker-checker（P9）：createdById（创建人）与 approvedById/appliedById（批准/Apply 人）不得相同（DB CHECK 兜底）
// - reasonCode：系统保留码（COUNT_VARIANCE/DAMAGE/LOSS/GIFT/SYSTEM_CORRECTION/MANUAL）+ 可扩展字典
// - 行：direction 在行级（IN/OUT，quantity 恒正）；serial-managed 逐 serial 原子化；sourceStockCountLineId @unique 防双重入账
// - Minor Hardening ②：非空 sourceStockCountLineId 必须属于 sourceStockCountId 指向的盘点单（service Gate 事务内校验）
// - Apply：FOR UPDATE 锁单 → 仅 APPROVED → maker-checker → 同事务 executeLedgerAtoms（每行一笔 ADJUSTMENT Movement）→
//   单据 APPLIED + appliedById/appliedAt + 证据（approvedById 若无则补 apply 人）→ 事件 InventoryAdjustmentApplied
// ============================================================================

/** 调整行（客户端提交；direction IN/OUT；quantity > 0 恒正；serial-managed 逐 serial） */
export const inventoryAdjustmentLineCreateSchema = z.object({
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).nullable().optional(),
  itemId: z.string().min(1),
  batchNo: z.string().max(100).nullable().optional(),
  serialNo: z.string().max(100).nullable().optional(), // 单值（serial-managed 逐 serial 原子化）
  direction: z.enum(['IN', 'OUT']),
  quantity: z.coerce.number().positive(),
  uomId: z.string().min(1).optional(),
  sourceStockCountLineId: z.string().min(1).nullable().optional(), // 盘点行追溯（可空；UNIQUE 防双重入账）
  remark: z.string().max(500).optional(),
});

/** 调整单创建（DRAFT；创建即取号 ADJ；Manual 或引用 Count 差异） */
export const inventoryAdjustmentCreateSchema = z.object({
  reasonCode: z.string().min(1).max(50), // P8 Final：系统保留码 + 可扩展字典（不写死 enum）
  sourceStockCountId: z.string().min(1).nullable().optional(), // 来源盘点单（可空——Manual 无盘点来源）
  remark: z.string().max(500).optional(),
  lines: z.array(inventoryAdjustmentLineCreateSchema).min(1, '至少需要一行'),
});

/** 调整单更新（仅 DRAFT；version 乐观锁；行整体替换） */
export const inventoryAdjustmentUpdateSchema = z.object({
  version: z.number().int().positive(),
  reasonCode: z.string().min(1).max(50).optional(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(inventoryAdjustmentLineCreateSchema).min(1).optional(),
});

/** 调整提交（真 Gate：DRAFT → SUBMITTED；version 乐观锁；触发审批 maybeTriggerApproval） */
export const inventoryAdjustmentSubmitSchema = z.object({
  version: z.number().int().positive(),
});

/** 调整 Apply（真 Gate：APPROVED → APPLIED；version 乐观锁 + 幂等 ALREADY_APPLIED；Shared LedgerCommand 逐行 ADJUSTMENT Movement 同事务） */
export const inventoryAdjustmentApplySchema = z.object({
  version: z.number().int().positive(),
});

/** 调整取消（DRAFT/SUBMITTED/APPROVED → CANCELLED；version 乐观锁；APPLIED 禁——纠错走 Reversal） */
export const inventoryAdjustmentCancelSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 6B-4 - Inventory Conversion（同 item Repack / UOM Conversion，CTO #8658 授权）
// 设计依据：Architecture Process Gate §6 + Field Matrix v0.5 §4 + ADR-0026 + P10/P11 Final
// - 状态机：DRAFT → SUBMITTED → EXECUTED / CANCELLED（Conversion 无审批状态——同 item 计量事实，不发明审批流）
// - 同一 itemId（首版禁止 BOM/组装/拆解/多物料）；一张 Conversion 最多 1 CONSUME + 1 PRODUCE（UNIQUE(headerId, lineRole)）
// - **baseQuantity 不由客户端提交**：服务端 canonical 计算 baseQuantity = quantity × uomToBaseRate（Decimal 精度统一），
//   不信任客户端；EXECUTE 前验证 CONSUME.baseQuantity == PRODUCE.baseQuantity（守恒，P11）
// - batch 精确继承（CONSUME batch → PRODUCE batch 同值）；serial 不允许（首版不支持 serial 重生成）
// - EXECUTE：CONSUME + PRODUCE 同一稳定 movementGroupId，经 Shared executeLedgerAtoms 同事务原子提交
// ============================================================================

/** 转换行（CONSUME/PRODUCE 各一条；quantity + uomToBaseRate 由客户端提交，**baseQuantity 服务端计算**） */
export const inventoryConversionLineCreateSchema = z.object({
  lineRole: z.enum(['CONSUME', 'PRODUCE']),
  quantity: z.coerce.number().positive(), // 业务 UOM 数量（> 0）
  uomId: z.string().min(1), // 业务 UOM
  uomToBaseRate: z.coerce.number().positive(), // 行级换算率 snapshot（业务 UOM → base UOM，> 0；DB CHECK 兜底）
  warehouseId: z.string().min(1),
  locationId: z.string().min(1).nullable().optional(),
  batchNo: z.string().max(100).nullable().optional(), // P5 Final：batch 精确继承（CONSUME batch → PRODUCE batch 同值）
  remark: z.string().max(500).optional(),
});

/** 转换单创建（DRAFT；创建即取号 CVT；baseUomId 必须 == Item 的 stock UOM——service Gate） */
export const inventoryConversionCreateSchema = z.object({
  itemId: z.string().min(1), // 同一 itemId（首版 Repack/UOM Conversion，禁止多物料）
  baseUomId: z.string().min(1), // Inventory Base UOM（service Gate 验证 == Item.stockUomId）
  remark: z.string().max(500).optional(),
  lines: z.array(inventoryConversionLineCreateSchema).length(2, '必须恰好 1 CONSUME + 1 PRODUCE'),
});

/** 转换单更新（仅 DRAFT；version 乐观锁；行整体替换） */
export const inventoryConversionUpdateSchema = z.object({
  version: z.number().int().positive(),
  remark: z.string().max(500).nullable().optional(),
  lines: z.array(inventoryConversionLineCreateSchema).length(2).optional(),
});

/** 转换提交（真 Gate：DRAFT → SUBMITTED；version 乐观锁；Conversion 无审批状态，提交即确认） */
export const inventoryConversionSubmitSchema = z.object({
  version: z.number().int().positive(),
});

/** 转换执行（真 Gate：SUBMITTED → EXECUTED；version 乐观锁 + 幂等 ALREADY_EXECUTED；Shared LedgerCommand 双 atom 同事务） */
export const inventoryConversionExecuteSchema = z.object({
  version: z.number().int().positive(),
});

/** 转换取消（DRAFT/SUBMITTED → CANCELLED；version 乐观锁；EXECUTED 禁——纠错走 Reversal） */
export const inventoryConversionCancelSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 5C-1A — Supplier Invoice Foundation（RECEIPT_BASED 首版；CTO #9048 FINAL APPROVED）
// ============================================================================

/** 供应商发票行（创建/更新共用；双溯源必填——PO Line + POSTED WHR Line；**不收金额**——服务端计算） */
export const supplierInvoiceLineSchema = z.object({
  purchaseOrderLineId: z.string().min(1), // 溯源 PO Line（不变量① 承诺来源）
  warehouseReceiptLineId: z.string().min(1), // 溯源入库行（不变量① 数量匹配基准；必须来自 POSTED WHR——红线 1）
  quantity: z.coerce.number().positive(), // 开票数量（> 0；≤ 已入库数量——红线 1）
  unitPrice: z.coerce.number().positive(), // 单价（与 PO 快照单价比对；> 0）
  taxRate: z.coerce.number().min(0).max(100), // 税率快照（0-100 百分比；DB CHECK 兜底）
  vatRecoverable: z.boolean().default(true), // P9 Final：recoverable=true → Input VAT；false → nonRecoverableTaxAmount
  remark: z.string().max(500).optional(),
});

/** 供应商发票创建（DRAFT；创建即取号 SINV——P1 Final；**不收头金额**——服务端聚合） */
export const supplierInvoiceCreateSchema = z.object({
  supplierId: z.string().min(1),
  supplierInvoiceNo: z.string().min(1).max(100), // 供应商发票号（供应商侧唯一标识；不变量② 组合唯一）
  invoiceDate: z.string().min(1), // ISO date（YYYY-MM-DD）
  receivedDate: z.string().min(1), // ISO date（YYYY-MM-DD）
  currency: z.string().max(10).default('CNY'), // 币种（对齐现有模式：String ISO 码）
  exchangeRate: z.coerce.number().positive().default(1), // 创建时快照 FX（P2 Final）
  paymentDueDate: z.string().optional(), // 账期（可空）
  remark: z.string().max(500).optional(),
  // VAT 要素（ADR-0043）：DRAFT 可空；POSTED 必填（I4）+ 号码格式（I7）
  invoiceType: z.enum(["SPECIAL_VAT", "ORDINARY_VAT", "ELECTRONIC_VAT", "EXPORT", "OTHER"]).optional(),
  taxInvoiceCode: z.string().max(20).nullable().optional(),
  taxInvoiceNo: z.string().max(20).nullable().optional(),
  lines: z.array(supplierInvoiceLineSchema).min(1, '至少一条有效行'),
});

/** 供应商发票更新（仅 DRAFT；version 乐观锁；行整体替换；supplierId/supplierInvoiceNo/currency/exchangeRate 不可改） */
export const supplierInvoiceUpdateSchema = z.object({
  version: z.number().int().positive(),
  invoiceDate: z.string().optional(),
  receivedDate: z.string().optional(),
  paymentDueDate: z.string().nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
  // VAT 要素（ADR-0043）：DRAFT 可编辑；POSTED 后冻结
  invoiceType: z.enum(["SPECIAL_VAT", "ORDINARY_VAT", "ELECTRONIC_VAT", "EXPORT", "OTHER"]).optional(),
  taxInvoiceCode: z.string().max(20).nullable().optional(),
  taxInvoiceNo: z.string().max(20).nullable().optional(),
  lines: z.array(supplierInvoiceLineSchema).min(1).optional(),
});

/** 供应商发票提交（真 Gate：DRAFT → SUBMITTED；version 乐观锁；**SUBMITTED ≠ POSTED**——submit 不生成 AP/GRIR） */
export const supplierInvoiceSubmitSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 5C-1B — Immutable 3-Way Match（Match 与 Approval 分层——CTO #9238/#9247）
// ============================================================================

/**
 * 供应商发票 Match（SUBMITTED/MATCHED → MATCHED，追加 immutable revision；version 乐观锁）
 * **客户端不得上传任何匹配计算结果**（poQty/receiptQty/invoiceQty/poUnitPrice/invoiceUnitPrice/
 * qtyVariance/priceVariance/taxVariance/result/disposition 全部服务端 snapshot——CTO #9238）；
 * Match API 自己不得写 approvedMatchRunId/approvedMatchRevision（Approval 单独接 Workflow——#9238/#9247）。
 */
export const supplierInvoiceMatchSchema = z.object({
  version: z.number().int().positive(),
});

// ============================================================================
// Sprint 5C-1C — Supplier Invoice POST / GRIR CONSUME / AP Liability-OpenItem（CTO #9678）
// ============================================================================

/**
 * 供应商发票 POST（APPROVED → POSTED；version 乐观锁）。
 * **POST 是服务端事务闭环**：client 只传 version（其余全部服务端派生——批准快照重验、WHR Line
 * deterministic lock、remaining GRIR 重算、CONSUME、ApLiabilityFact、ApOpenItem、CAS POSTED）。
 */
export const supplierInvoicePostSchema = z.object({
  version: z.number().int().positive(),
});
