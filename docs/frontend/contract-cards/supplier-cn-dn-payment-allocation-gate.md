# Supplier CN/DN + Payment Allocation — Design / Scope Gate（5C-2，CTO 授权解锁）

- 版本：v0.1
- 日期：2026-08-19
- 维护者：CIO（JINZA）｜审核：CTO（解锁授权已确认，2026-08-19）
- 关联：ADR-0027（D6/D7/D8/D12）、ADR-0028（API referenced permission ⊆ ALL_ACTION_PERMISSIONS）、5C-1（SupplierInvoice/ApLiabilityFact/ApOpenItem FINAL）、4E-3（CreditDebitNote 先例）、4E-2（Receipt/Allocation/WriteOff 先例）
- 状态：**DESIGN / SCOPE GATE — 已授权**（实现分 2 批：Migration 0029 CN/DN → Migration 0030 Payment，每批独立 PR + GitHub CI）

---

## 1. 背景与授权

CTO 授权解锁 5C-2（Supplier Payment / AP Allocation / Supplier CN-DN）HOLD。此前 ROADMAP 将 5C-2 列为 HOLD（解除需 CTO 单独指令）；本 Gate 即解锁后正式设计。BI（reports）保持信息架构（Report Catalog Mapping Gate 前置，待 20 份源报表清单）。

## 2. 事实基线

- **5C-1 已 FINAL（不可变会计事实）**：SupplierInvoice（POSTED 同事务产生）→ ApLiabilityFact（immutable：gross/net/inputVAT/nonRecoverableTax，**无 openAmount 可改字段**）→ ApOpenItem（materialized projection：`openAmount = Liability + CN/DN(signed) - Allocations`，服务端计算；version CAS 由 reconciliation 服务更新）
- **参考先例**：4E-3 CreditDebitNote（signed adjustment CN<0/DN>0 + 累计防超调锁内重算 + maker-checker + code 创建即取号）；4E-2 Receipt/ReceiptAllocation/WriteOff（M:N 核销 + allocatedAmount/unallocatedAmount 受控投影 + Apply 唯一回写 + reversal 纠错）；5C-1 POST→`supplier-invoice:edit` 权限（**不新造 post/apply 权限码**——复用统一 RBAC，maker-checker 在业务层强制）
- **DocumentType 现状**：已有 CREDIT_NOTE/DEBIT_NOTE（销售侧）、PAYMENT_VOUCHER（付款凭证）。AP 侧 CN/DN 新增枚举；Payment 复用 PAYMENT_VOUCHER

## 3. Migration 0029 — Supplier CN/DN（供应商贷/借项，AP 侧）

### 3.1 模型（参考 4E-3，AP 侧独立事实）

```prisma
enum SupplierCnDnType {
  CREDIT // 贷项：冲减 AP（signed 负向）
  DEBIT  // 借项：增加 AP（signed 正向）
}
enum SupplierCnDnStatus {
  DRAFT
  SUBMITTED
  APPROVED
  APPLIED  // 终态：同事务更新 ApOpenItem.openAmount 投影（maker-checker）
  CANCELLED
}

model SupplierCreditDebitNote {
  id            String   @id @default(cuid())
  code          String   @unique // CN-/DN-2026-xxxx（DocumentSequence docType=SUPPLIER_CREDIT_NOTE/SUPPLIER_DEBIT_NOTE 创建即取号 fail closed）
  noteType      SupplierCnDnType
  sourceSupplierInvoiceId String // 单票制（CTO 拍板：必填且唯一；跨票 Consolidated 延后）
  sourceSupplierInvoice SupplierInvoice @relation(fields: [sourceSupplierInvoiceId], references: [id], onDelete: Restrict)
  supplierId    String // 继承 sourceInvoice.supplierId
  supplier      Supplier @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  currency      String   @default("CNY") // 继承 sourceInvoice.currency
  reason        String   // 调整原因（折扣/退货/价差/更正/其他）
  adjustmentTotal Decimal @db.Decimal(18, 4) // = Σ lines（服务端计算，禁止直传头金额）；CREDIT 负向 / DEBIT 正向
  status        SupplierCnDnStatus @default(DRAFT)
  approvalStatus ApprovalStatus @default(DRAFT)
  approvedAt    DateTime? @db.Timestamptz(3)
  approvedById  String?
  appliedAt     DateTime? @db.Timestamptz(3) // APPLIED 才回写 AP Open Item 投影
  appliedById   String?
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  lines SupplierCreditDebitNoteLine[]
  @@index([supplierId])
  @@index([status])
  @@index([deletedAt])
}

model SupplierCreditDebitNoteLine {
  id           String   @id @default(cuid())
  creditDebitNoteId String
  creditDebitNote SupplierCreditDebitNote @relation(fields: [creditDebitNoteId], references: [id], onDelete: Cascade)
  sourceSupplierInvoiceLineId String // 来源发票行（必填可追溯）
  sourceSupplierInvoiceLine SupplierInvoiceLine @relation(fields: [sourceSupplierInvoiceLineId], references: [id], onDelete: Restrict)
  lineNo       Int      @default(10)
  itemId       String?
  item         Item?    @relation(fields: [itemId], references: [id], onDelete: SetNull)
  description  String
  quantity     Decimal  @db.Decimal(18, 4) // 调整数量 > 0；部分行数量调整（累计防超调）
  unitPrice    Decimal  @db.Decimal(18, 4) // 单价快照（复制，不重算）
  taxRate      Decimal  @db.Decimal(5, 2)
  amount       Decimal  @db.Decimal(18, 4) // 调整行金额（服务端计算）
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  @@index([creditDebitNoteId])
  @@index([sourceSupplierInvoiceLineId])
}
```

### 3.2 业务不变量

- **APPLIED 同事务**（failure atomicity）：status APPROVED→APPLIED + appliedAt/appliedById + **ApOpenItem.openAmount 重算**（= Liability + Σsigned(CN/DN) - ΣAllocations，服务端 Decimal）
- **累计防超调**：CREDIT（负向）累计不得使 openAmount < 0（锁内重算；超限 → 409，与 4E-3 H15/H16 对齐）
- **maker-checker**：appliedById ≠ createdById/approvedById；已 APPLIED → 409（幂等）
- **并发锁序（Blocking Gate，与 5C-1 完全一致）**：collect ids → deduplicate → sort → `SELECT ... ORDER BY id FOR UPDATE`
- **不可变事实**：CN/DN 自身 immutable（APPLIED 后禁改/禁删）；纠错 → 追加反向 CN/DN（不手改 openAmount）
- **DocumentType 枚举新增**：`SUPPLIER_CREDIT_NOTE` / `SUPPLIER_DEBIT_NOTE`（DocumentSequence 取号）

## 4. Migration 0030 — Supplier Payment + Allocation（付款核销，Settlement Fact）

### 4.1 模型（参考 4E-2 Receipt/Allocation + D7）

```prisma
enum SupplierPaymentStatus {
  UNALLOCATED
  PARTIALLY_ALLOCATED
  ALLOCATED
}

model SupplierPayment {
  id           String   @id @default(cuid())
  code         String   @unique // PAY-2026-xxxx（DocumentSequence docType=PAYMENT_VOUCHER 创建即取号 fail closed）
  supplierId   String
  supplier     Supplier @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  currency     String   @default("CNY") // 同供应商同币种（对齐 4E-2 硬规则）
  amount       Decimal  @db.Decimal(18, 4) // 实付金额（付款事实）
  allocatedAmount   Decimal @default(0) @db.Decimal(18, 4) // 受控投影 = Σ allocations（非反向核销）
  unallocatedAmount Decimal @default(0) @db.Decimal(18, 4)
  paymentDate  DateTime @db.Timestamptz(3)
  paymentMethod PaymentMethod // 复用 4E-2 枚举
  referenceNo  String? // 银行流水号/备注
  status       SupplierPaymentStatus @default(UNALLOCATED) // 受控投影（事务更新，禁止 PATCH）
  voidedAt     DateTime? @db.Timestamptz(3)
  voidedById   String?
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  allocations SupplierPaymentAllocation[]
  @@index([supplierId])
  @@index([status])
  @@index([deletedAt])
}

model SupplierPaymentAllocation {
  id           String   @id @default(cuid())
  paymentId    String
  payment      SupplierPayment @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  apOpenItemId String
  apOpenItem   ApOpenItem @relation(fields: [apOpenItemId], references: [id], onDelete: Restrict)
  allocatedAmount Decimal @db.Decimal(18, 4) // 本次核销金额
  allocatedAt   DateTime @default(now()) @db.Timestamptz(3)
  allocatedBy   String?
  reversedAt    DateTime? @db.Timestamptz(3) // 纠错 → 追加 reversal（不手改 openAmount）
  reversedBy    String?
  reverseReason String?
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  @@index([paymentId])
  @@index([apOpenItemId])
  @@index([reversedAt])
}
```

### 4.2 业务不变量

- **Apply 唯一回写入口**（Created ≠ Applied）：创建 SupplierPaymentAllocation + 更新 payment.allocatedAmount/unallocatedAmount/status + **ApOpenItem.openAmount 投影 - allocation**（同事务）
- **防超核销**：Σ allocation(payment) ≤ amount；Σ allocation(apOpenItem) ≤ openAmount（锁内重算；超限 → 409）
- **同供应商同币种**：核销目标 ApOpenItem.supplierId = payment.supplierId 且 currency 一致（硬规则）
- **maker-checker**：allocatedBy ≠ createdById；payment 已全额核销 → 禁止继续核销
- **纠错 → reversal/correction allocation**（不手改 openAmount，Blocking ③ 纪律延续）
- **并发锁序**：与 5C-1 一致（collect→dedupe→sort→FOR UPDATE）
- **不反向改变 documentStatus**：核销只更新 settlementStatus/投影，不触碰 SupplierInvoice.documentStatus（D10 Hardening 1）

## 5. API 契约

### 5.1 Supplier CN/DN（/api/supplier-credit-debit-notes）
- GET 列表：过滤 noteType / supplierId / status / sourceSupplierInvoiceId + 分页；include supplier + sourceInvoice 摘要 + lines 计数
- POST（`supplier-credit-debit-note:create`）：noteType + sourceSupplierInvoiceId（须 POSTED）+ reason + lines[]（sourceSupplierInvoiceLineId/itemId/quantity/unitPrice 快照）；code 创建即取号（DocumentSequence docType 按 noteType）
- GET /:id：详情含 lines（快照）+ approval/applied 审计摘要
- PATCH /:id（`supplier-credit-debit-note:edit`，DRAFT/SUBMITTED only + version CAS）：reason / lines
- POST /:id/submit（`supplier-credit-debit-note:edit`）：DRAFT→SUBMITTED（第三次来源链校验：行 ∈ sourceInvoice 行）
- POST /:id/apply（`supplier-credit-debit-note:edit`，maker-checker 业务层强制）：APPROVED→APPLIED + ApOpenItem.openAmount 重算（§3.2 不变量）
- 权限：view/create/edit/approve/close 全动作；会计敏感仅 SUPER_ADMIN/ADMIN 静态授权（与 supplier-invoice 一致，MANAGER 无）

### 5.2 Supplier Payment（/api/supplier-payments）
- GET 列表：过滤 supplierId / status / currency / paymentDate 范围 + 分页；include supplier + _count allocations
- POST（`supplier-payment:create`）：supplierId + currency + amount + paymentDate + paymentMethod + referenceNo；code 创建即取号（PAYMENT_VOUCHER）
- GET /:id：详情含 allocations（未 reversal 的）
- POST /:id/apply（`supplier-payment:edit`，maker-checker）：body { apOpenItemId, allocatedAmount }——单条核销；重复调用追加 allocation（每次锁内重算防超调）
- POST /:id/void（`supplier-payment:close`）：UNALLOCATED only → 作废
- POST /api/supplier-payment-allocations/:id/reverse（`supplier-payment-allocation:edit`）：追加 reversal（纠错）

## 6. 权限与事件

- **权限模块注册（ADR-0028）**：`supplier-credit-debit-note` / `supplier-payment` / `supplier-payment-allocation` → shared PERMISSION_MODULES + seed SEED_ACTION_MODULES；rbac MANAGER 不授予（会计敏感，对齐 supplier-invoice）
- **事件（EVENTS.md v1.34 注册）**：`SupplierCreditDebitNoteApplied` / `SupplierPaymentApplied`（携带 supplierId/invoiceNo/openAmountAfter 等稳定载荷，供 Notification/BI/GL 未来消费）
- **AuditLog**：cn-dn.create/submit/apply、payment.create/apply/void、allocation.reverse（writeAuditLog 全程）

## 7. 前端页面计划（F2 Workspace 共享层）

| 模块 | 页面 | 形态 | ui capabilities |
|---|---|---|---|
| supplier-cn-dn | /supplier-ap/credit-debit-notes + /new + /[id] | 列表（noteType/供应商/状态过滤）+ 新建（选择 POSTED 发票 + 行录入）+ 详情（submit/apply 按钮按状态机显隐） | UI_LIST_DETAIL_CRUD_ACTIONS（无 workflow 独立 submit 流——提交复用 edit，应用复用 edit） |
| payment-allocation | /supplier-ap/payments + /new + /[id] | 列表（供应商/状态过滤）+ 新建（供应商+金额+日期）+ 详情（未结 Open Items 展示 + 核销录入 + apply/void 按钮） | UI_LIST_DETAIL_CREATE_ACTIONS |

registry：supplier-cn-dn / payment-allocation → availability ready（permission 用 action 码）；前端不伪造 5C-2 之外权限。

## 8. 文档同步清单（随实现 PR）

1. Migration 0029（CN/DN）+ 0030（Payment）；Prisma schema 同步
2. openapi.yaml：+2 组 paths + schemas
3. EVENTS.md v1.34：+2 事件
4. ADR-0030：5C-2 boundary（本 Gate 决策记录）
5. docs/test-cases/：SupplierCnDn_API.md + SupplierPayment_API.md
6. docs/qa/：Sprint5C2_QA.md
7. ROADMAP v1.24：5C-2 状态 + HOLD 清单更新（解除后仅剩 GL/Costing/Reservation/BI/OA/Mobile）
8. CHANGELOG [Unreleased]：Batch 1/2 条目
9. Frontend Module Map / Page Route Map：登记新页面

## 9. 边界（MUST NOT）

- **不建 GL 总账**（ADR-0027 D8：只产出稳定会计事件/接口，过账留给 Finance 阶段）
- 不触碰 InventoryMovement/StockProjection（6A SSOT 红线）；不做 Costing/FIFO/Reservation
- 不修改已 POSTED SupplierInvoice / 不可变 ApLiabilityFact；纠错一律追加新事实
- BI（reports）保持信息架构（Report Mapping Gate 前置，待 20 份源报表清单）
- 验证 = GitHub CI（Quality/Build/Secret Scanning）；本地零验证

## 10. 验收标准

- Migration 0029/0030 + schema 一致，CI 全绿
- CN/DN APPLIED 与 Payment Apply 全部同事务、幂等、锁序一致
- 累计防超调（负 AP / 超核销）→ 409（测试用例覆盖）
- maker-checker 业务层强制（appliedById/allocatedBy ≠ creator）
- 前端状态机按钮显隐消费后端状态契约（APPLIED ≠ APPROVED、ALLOCATED ≠ CREATED）
- 权限：新 requirePermission 码 ∈ ALL_ACTION_PERMISSIONS（ADR-0028 静态一致）