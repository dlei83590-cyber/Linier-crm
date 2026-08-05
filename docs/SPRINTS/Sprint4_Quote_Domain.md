# Sprint 4 预备：Quote Domain（报价领域设计，仅设计不写代码）

> 状态：Design（Sprint 4 Sales 提前准备，CTO 批准 #1977）
> 原则：只输出领域设计，不写实现代码
> 关联：ADR-0009（Customer）、ADR-0010（Supplier）、EVENTS.md（QuotationSubmitted）

## 1. 领域定位

Quotation（报价单）是销售主链的核心单据：`BusinessPartner → Opportunity → Quotation → Sales Order → Contract`。
报价单挂 **Customer（Partner 角色）**，行项目引用 **Item（Sprint 3C-3 落地）**，审批走 **Workflow/Approval（Sprint 3A 已交付）**，
附件走 **File Center（Sprint 3B 已交付）**，提交事件 `QuotationSubmitted`（EVENTS.md 已定义）。

## 2. 模型设计（Prisma 草案）

```prisma
enum QuotationStatus {
  DRAFT        // 草稿
  SUBMITTED    // 已提交（触发 QuotationSubmitted 事件）
  APPROVED     // 已批准
  REJECTED     // 已驳回
  CONVERTED    // 已转销售订单
  CANCELLED    // 已取消
  EXPIRED      // 已过期（超过 validUntil）
}

enum QuotationLineStatus {
  ACTIVE
  REMOVED
}

/// 报价单头
model Quotation {
  id           String   @id @default(cuid())
  code         String   @unique // 单据编号（DocumentSequence 生成，如 QT-2026-0001）
  customerId   String   // 客户（Customer，partner 关联 BP）
  customer     Customer @relation(fields: [customerId], references: [id], onDelete: Restrict)
  opportunityId String? // 关联项目机会（Sprint 3C-4）
  status       QuotationStatus @default(DRAFT)
  quoteDate    DateTime @default(now())
  validUntil   DateTime? // 有效期至
  currency     String   @default("CNY")
  taxRate      Decimal  @default(13) @db.Decimal(5, 2) // 默认税率环境变量注入
  subtotal     Decimal  @default(0) @db.Decimal(18, 2) // 未税合计
  discount     Decimal  @default(0) @db.Decimal(18, 2) // 折扣
  taxAmount    Decimal  @default(0) @db.Decimal(18, 2) // 税额
  total        Decimal  @default(0) @db.Decimal(18, 2) // 含税合计
  remark       String?
  approvedById String?  // 审批人
  approvedAt   DateTime?
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  lines        QuotationLine[]
  revisions    QuotationRevision[]
  approvals    QuotationApproval[]

  @@index([code])
  @@index([customerId])
  @@index([status])
  @@index([deletedAt])
}

/// 报价行
model QuotationLine {
  id           String   @id @default(cuid())
  quotationId  String
  quotation    Quotation @relation(fields: [quotationId], references: [id], onDelete: Cascade)
  itemId       String?  // 物料（Sprint 3C-3 Item 落地后强关联）
  itemCode     String?  // 冗余物料编码
  itemName     String   // 物料名称（快照）
  spec         String?  // 规格
  uom          String   // 单位
  qty          Decimal  @db.Decimal(18, 4)
  unitPrice    Decimal  @db.Decimal(18, 2)
  discountRate Decimal  @default(0) @db.Decimal(5, 2) // 行折扣 %
  lineTotal    Decimal  @db.Decimal(18, 2) // 行小计（未税）
  taxRate      Decimal  @default(13) @db.Decimal(5, 2)
  taxAmount    Decimal  @default(0) @db.Decimal(18, 2)
  lineStatus   QuotationLineStatus @default(ACTIVE)
  remark       String?
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@index([quotationId])
  @@index([itemId])
  @@index([deletedAt])
}

/// 报价修订（历史版本）
model QuotationRevision {
  id           String   @id @default(cuid())
  quotationId  String
  quotation    Quotation @relation(fields: [quotationId], references: [id], onDelete: Cascade)
  revisionNo   Int      // 版本号（1,2,3...）
  changeSummary String  // 变更说明
  snapshot     Json?    // 变更前快照（行集合）
  subtotal     Decimal  @db.Decimal(18, 2)
  total        Decimal  @db.Decimal(18, 2)
  revisedById  String?
  revisedAt    DateTime @default(now())
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([quotationId, revisionNo])
  @@index([quotationId])
  @@index([deletedAt])
}

/// 报价审批记录（关联 Workflow/Approval 平台）
model QuotationApproval {
  id           String   @id @default(cuid())
  quotationId  String
  quotation    Quotation @relation(fields: [quotationId], references: [id], onDelete: Cascade)
  workflowInstanceId String? // Workflow Instance（Sprint 3A）
  approverId   String?
  approverName String?
  stepName     String?  // 审批步骤名
  action       String   // APPROVE/REJECT/COUNTERSIGN
  comment      String?
  actedAt      DateTime @default(now())
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@index([quotationId])
  @@index([workflowInstanceId])
  @@index([deletedAt])
}
```

**模型数**：+4（Quotation / QuotationLine / QuotationRevision / QuotationApproval），无新枚举（QuotationStatus/QuotationLineStatus 待建）。

## 3. 关键设计决策

1. **客户挂 Customer（Partner 角色）**：`Quotation.customerId → Customer`，Customer 再通过 partnerId 关联 BusinessPartner —— 复用 3C-1/3C-2 的 Partner 唯一主体架构，不新建客户字段。
2. **审批复用 Workflow/Approval（Sprint 3A）**：`QuotationApproval.workflowInstanceId` 关联 Workflow Instance；种子工作流 `QUOTATION_APPROVAL` 已在 Sprint 3A seed 中定义，直接复用。
3. **事件驱动**：状态 → SUBMITTED 时发布 `QuotationSubmitted`（EVENTS.md 已定义 payload），Notification/BI/Webhook 监听，不模块间直接调用。
4. **附件走 File Center**：`FileAttachment.businessType=quotation`，不新建附件表。
5. **行快照**：itemCode/itemName/spec 冗余快照，物料改名不影响历史报价。
6. **修订留痕**：每次修改生成 QuotationRevision（含变更前快照），满足报价历史追溯。
7. **税率不写死**：默认税率取 `DEFAULT_TAX_RATE` 环境变量（默认 13），行级可覆盖。

## 4. 状态机

```
DRAFT ──提交──> SUBMITTED ──审批通过──> APPROVED ──转单──> CONVERTED
  │                │                        │
  └──取消──> CANCELLED    └──驳回──> REJECTED（可编辑后重新提交）
  │
  └──超期──> EXPIRED（validUntil 过后由定时任务标记）
```
