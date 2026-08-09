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

export const quotationCreateSchema = z.object({
  customerId: z.string().min(1),
  opportunityId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  currency: z.string().max(10).default('CNY'),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  taxProfileId: z.string().min(1).nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(quotationLineCreateSchema).min(1, '至少需要一行'),
});

export const quotationUpdateSchema = z
  .object({
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    taxProfileId: z.string().min(1).nullable().optional(),
    remark: z.string().max(1000).nullable().optional(),
    changeReason: z.string().max(500).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: '至少提供一个更新字段' });

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

/** issue：DRAFT → ISSUED（DocumentSequence 原子取号；编号延后生成；并发 issue 第二个请求 409 不消耗编号） */
export const invoiceIssueSchema = z.object({
  changeReason: z.string().max(500).optional(),
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
  paymentMethod: z.enum(['BANK_TRANSFER', 'CHEQUE', 'CASH', 'CARD', 'OTHER']),
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

/** WriteOff 提交审批：DRAFT → SUBMITTED（命中 WRITE_OFF 策略则 maybeTriggerWriteOffApproval 建/复用 Workflow；无策略可直接进入可 Apply 状态） */
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

/** CreditDebitNote 提交审批：DRAFT → SUBMITTED（命中 CREDIT_DEBIT_NOTE 策略则 maybeTriggerCreditDebitNoteApproval 建/复用 Workflow；无策略可直接进入可 Apply 状态） */
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

/** PO 行（价格双通道：SUPPLIER_PRICE_SNAPSHOT 服务端从 PartnerPrice 解析 / MANUAL 客户端授权录入+priceReason） */
export const purchaseOrderLineCreateSchema = z
  .object({
    itemId: z.string().min(1),
    description: z.string().max(500).optional(),
    quantity: z.coerce.number().positive(), // 采购数量 > 0（服务端 Decimal 精确校验）
    uomId: z.string().min(1).optional(),
    lineNo: z.number().int().positive().optional(),
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
  currency: z.string().min(1).max(10).optional(),
  paymentTerm: z.string().max(100).nullable().optional(),
  expectedDeliveryDate: z.string().datetime().nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  lines: z.array(purchaseOrderLineCreateSchema).min(1, '至少需要一行'),
});

/** PO 头更新 + 可选行全量替换（仅 DRAFT；金额服务端重算；ReceivedQty/remainingReceiveQty 禁止客户端传入） */
export const purchaseOrderUpdateSchema = z
  .object({
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
