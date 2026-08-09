# Sprint 5A：Purchase Requisition & Purchase Order Foundation Design（采购申请与采购订单领域设计）

> 版本：v1.0（Design 阶段，提交 CTO Design Review）
> 日期：2026-08-08
> 维护者：CIO（JINZA）｜审核：CTO
> 关联：ADR-0023 / EVENTS.md v1.14 / ROADMAP v1.17
> **状态：Approved with Changes（CTO Design Review 97/100，2026-08-09——7 个 Pending 全部拍板 + 3 项必改调整已落实）**；本阶段仍只做 Design / ADR / EVENTS，**Schema/Migration 0021 待 CTO 放行后启动，仍不写 PR/PO API**

## 0. Sprint 5 范围切分

| 子阶段 | 范围 | 状态 |
| --- | --- | --- |
| **5A（本阶段）** | Purchase Requisition（采购申请）+ Purchase Order（采购订单）Foundation：模型设计 + 事实源边界 + 审批 + 价格/金额事实来源 + GR 边界 | 🟡 Design（本文件） |
| 5B | Goods Receipt（收货）：PO → GR 溯源、防超收、GRN 事实源 | ⬜ |
| 5C | Supplier Invoice / 三单匹配（PO-GR-Invoice）/ AP | ⬜ |
| 5D+ | 采购付款 / Settlement / 采购分析 | ⬜ |

## 1. 现状侦查（已确认）

- **Supplier 主数据已存在**（Sprint 3C-1，`model Supplier`：code/partnerId/status/rating/defaultLeadTime/minOrderQty/currency/isPreferred + qualifications/certificates/settlements + approvalStatus）——**Sprint 5A 不新建 Supplier，直接复用**
- **partner-prices API 已存在**（Sprint 3C-4 Price Foundation，`priceSource` 枚举含 `SUPPLIER`）——供应商价格基础已就位，PO 价格事实来源可复用
- **DocumentType 枚举已有** `PURCHASE_ORDER`、`GOODS_RECEIPT_NOTE`；**缺 `PURCHASE_REQUISITION`**（Schema 阶段需新增 docType=PR）
- **ApprovalPolicy.module 为 String**（默认 "QUOTATION"，注释"后续 SO/PO/Invoice 复用"）——PR/PO 条件审批可复用，不建 Approval 表
- **DocumentSequence 机制成熟**（创建即取号，对齐 Quotation/SO/Delivery/Invoice/CN/DN）
- 销售侧对称模板齐备：Quotation→SO→Delivery→Invoice→AR→Receipt→WriteOff→CN/DN（Sprint 4 全闭环，v0.6.0-alpha 已发布）

## 2. 销售 ↔ 采购对称映射（设计锚点）

| 销售域（Sprint 4 已验证） | 采购域（Sprint 5） | 备注 |
| --- | --- | --- |
| Customer（客户主数据） | Supplier（供应商主数据，已存在） | 复用 |
| Quotation（报价事实源） | PurchaseRequisition（采购申请事实源） | PR = 内部需求申请 |
| Sales Order（订单事实源） | PurchaseOrder（采购订单事实源） | PO = 对供应商承诺 |
| Delivery（交付事实源，SO→DO） | Goods Receipt（收货事实源，PO→GRN，5B） | 防超交 ↔ 防超收 |
| Invoice（开票事实源，DO→CI） | Supplier Invoice（供应商发票，5C） | 三单匹配 |
| Receipt/Allocation（收款） | Payment/Settlement（付款，5D+） | 对称 |

## 3. 模型范围（Sprint 5A，草案不实现）

### 3.1 PurchaseRequisition（PR，采购申请事实源）

- 性质：**内部需求申请单据**（部门/申请人发起，表达"需要买什么、多少、何时要"），**非供应商交互单据**
- 事实源角色：需求事实源；**PO 从 PR 转单后，PR 金额/数量事实不被 PO 修改**（对齐 CN/DN 不修改原 Invoice 金额事实的红线思想）
- 编号：DocumentSequence docType=`PURCHASE_REQUISITION`（**枚举需新增**），如 PR-2026-0001，创建即取号
- 关键字段草案：`id / code / requesterId / departmentId / status / currency / totalAmount(预估，可空) / workflowInstanceId / approvalStatus / approvedAt / approvedById / lines / revisions / snapshots / 审计字段`
- 状态机草案：`DRAFT → SUBMITTED → APPROVED → CONVERTED（已转 PO）`；`DRAFT/SUBMITTED → CANCELLED`
- 审批：条件审批复用 ApprovalPolicy(module=`PURCHASE_REQUISITION`) + Workflow（不建 Approval 表）
- 行：`PurchaseRequisitionLine`：`id / requisitionId / lineNo / itemId / description / quantity / uomId / needDate / remark / suggestedUnitPrice(预估，可空) / 审计字段`；`@@unique([requisitionId, lineNo])`

### 3.2 PurchaseOrder（PO，采购订单事实源）

- 性质：**对供应商的正式承诺单据**（下单：向谁买、买什么、多少、什么价、何时交）
- 事实源角色：采购承诺事实源；**金额事实 = 行快照复制（单价/税率/行金额），不重算、不调价格引擎**（对齐销售侧价格红线）
- 编号：DocumentSequence docType=`PURCHASE_ORDER`（**枚举已有**），如 PO-2026-0001，创建即取号
- 关键字段草案：`id / code / **sourceType(REQUISITION | DIRECT——CTO 拍板②，Direct 显式可审计)** / supplierId / requisitionId(溯源；REQUISITION 必填 / DIRECT 为空) / status / currency / paymentTerm / totalAmount / workflowInstanceId / approvalStatus / approvedAt / approvedById / lines / revisions / snapshots / 审计字段`
- **状态机（CTO 锁死，进入 Schema 前定稿）**：`DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`；`DRAFT → CANCELLED`
  - **APPROVED ≠ CONFIRMED（CTO 拍板调整③）**：APPROVED = 内部审批通过（投影）；**CONFIRMED = 正式下单给供应商**（确认动作）；**只有 Confirmed PO 才能成为 5B Goods Receipt 来源**
  - PARTIALLY_RECEIVED / RECEIVED 投影由 5B GR 聚合回写（对齐 SO deliveredQty）
- 审批：条件审批复用 ApprovalPolicy(module=`PURCHASE_ORDER`) + Workflow（不建 Approval 表）；**Direct Purchase 不能绕过 PO Approval**（同样走 SUBMITTED → APPROVED → CONFIRMED）
- 行：`PurchaseOrderLine`：`id / purchaseOrderId / lineNo / **sourcePurchaseRequisitionLineId(PR 转 PO 保留；Direct 为空——CTO 拍板②)** / itemId / description / quantity / uomId / **priceSource(SUPPLIER_PRICE_SNAPSHOT | MANUAL——CTO 拍板③双通道)** / unitPrice(快照) / **priceReason / priceSetById / priceSetAt（MANUAL 必填，审计留痕）** / discountRate / taxRate(快照) / lineAmount / taxAmount / totalAmount / **receivedQty=0 / remainingReceiveQty=quantity（预留投影；5A 禁客户端修改，5B 唯一回写方）** / 审计字段`；`@@unique([purchaseOrderId, lineNo])`

### 3.3 Revision / Snapshot

- **PO 对齐 Sales Order 模式**：`PurchaseOrderRevision` + `PurchaseOrderSnapshot`（快照类型：CREATED/SUBMITTED/APPROVED/**CONFIRMED**/RECEIVED/CANCELLED——含 CONFIRMED 定稿快照）
- **PR 首版从简**：仅 Revision（内容变更留痕），Snapshot 延后（PR 无财务事实，快照价值低——Pending 决策⑥）

## 4. 事实源边界（CTO 锁死红线，写入 ADR）

1. **PR = 需求事实源**：PR 只表达需求；**PR 不携带对供应商的价格承诺**（suggestedUnitPrice 仅预估参考，非事实）
2. **PO = 承诺事实源**：PO 行金额 = 快照复制（Supplier 价格来源或手工快照——Pending 决策③）；**PO 不修改 PR 的数量/金额事实**（转单是复制投影，不是改写）
3. **PO 是 GR 的唯一来源**（5B）：不存在 Direct GR（对齐无 Direct Delivery 锁定项）；GR 防超收 = PO Line 数量 ceiling（5B 实现，本阶段定义边界）
4. **PO 金额事实 = Σ 行快照**：服务端计算，禁客户端直传头金额（对齐 4E-3 adjustmentTotal 口径）
5. **审批 ≠ 生效**：PR/PO 审批只回写投影（approvalStatus/approvedAt）；**PO 的"正式下单"语义 = APPROVED**（对齐 APPROVED ≠ APPLIED 思想，但 PO 无独立 Apply 动作——Pending 决策①）
6. **Supplier 主数据不可被 PO 改写**：PO 只引用 supplierId 快照（supplierCode/name/currency），不写回 Supplier
7. **PO 价格双通道（CTO 拍板③）**：`SUPPLIER_PRICE_SNAPSHOT`（优先，partner-prices priceSource=SUPPLIER 快照复制）｜`MANUAL`（授权手工，**必须记录 priceReason / actor / audit**）；**头金额仍由服务端 Decimal 聚合，客户端不可直接传总额**
8. **Direct Purchase 显式可审计（CTO 拍板②）**：PO Header `sourceType = REQUISITION | DIRECT`；PR 转 PO 时 line 保留 `sourcePurchaseRequisitionLineId`；Direct 时来源字段为空；**Direct Purchase 不能绕过 PO Approval**
9. **PO 生命周期锁死（CTO 拍板调整③）**：`DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`；`DRAFT → CANCELLED`；**APPROVED ≠ CONFIRMED**；只有 Confirmed PO 才能成为 5B Goods Receipt 来源；PO Line 预留 `receivedQty=0 / remainingReceiveQty=quantity`，但 **5A 不允许客户端改，5B 才是唯一回写方**

## 5. 事务红线草案（CTO Design Review 确认后写入 ADR）

### 5.1 PR Create（草案）

```
Lock 无（新建）
→ 取号（DocumentSequence PURCHASE_REQUISITION 原子 increment）
→ 创建 PurchaseRequisition（DRAFT）+ Lines
→ Revision(CREATED) + 事件 PurchaseRequisitionCreated（事务外，降级不阻断）
```

### 5.2 PR Submit + 审批（草案）

```
Lock PR（FOR UPDATE）
→ 状态门禁（DRAFT 才能 SUBMITTED；已审批不可重提）
→ maybeTriggerPurchaseRequisitionApproval（命中策略 → PENDING + workflowInstanceId；未命中 → 直接 APPROVED）
→ 事件 PurchaseRequisitionSubmitted / ApprovalStarted（事务外）
Workflow actions 终态回写：COMPLETED→APPROVED / REJECTED→DRAFT 重提（只回写投影，不建 Approval 表）
```

### 5.3 PO Convert（PR→PO，CTO 拍板②：sourceType=REQUISITION）

```
Lock PR（FOR UPDATE）→ 校验 PR 状态（APPROVED 才能转单）
→ 取号（DocumentSequence PURCHASE_ORDER 原子 increment）
→ 创建 PurchaseOrder（DRAFT，sourceType=REQUISITION）+ Lines（快照复制自 PR Line；
   line 保留 sourcePurchaseRequisitionLineId；价格走 SUPPLIER_PRICE_SNAPSHOT 优先 / MANUAL 授权双通道）
→ 回写 PR status=CONVERTED（投影，不改 PR 数量/金额事实）
→ Revision + 事件 PurchaseOrderCreated + PurchaseRequisitionConverted（事务外）
```

### 5.4 PO Direct Purchase（CTO 拍板②：sourceType=DIRECT，显式可审计）

```
Lock 无（新建）
→ 取号（DocumentSequence PURCHASE_ORDER 原子 increment）
→ 创建 PurchaseOrder（DRAFT，sourceType=DIRECT；requisitionId 为空，line sourcePurchaseRequisitionLineId 为空）
→ 校验授权（Direct 必须有权限 + 价格 MANUAL 必须记录 priceReason/actor/audit）
→ Revision + 事件 PurchaseOrderCreated（事务外）
→ **Direct 不能绕过 PO Approval**：同样走 SUBMITTED → APPROVED → CONFIRMED
```

### 5.4 PO Submit + 审批（草案）

```
Lock PO（FOR UPDATE）
→ 状态门禁（DRAFT 才能 SUBMITTED）
→ maybeTriggerPurchaseOrderApproval（命中策略 → PENDING；未命中 → APPROVED）
→ 事件 PurchaseOrderSubmitted / ApprovalStarted（事务外）
Workflow actions 终态回写：COMPLETED→APPROVED / REJECTED→DRAFT 重提
```

### 5.5 PO 修改（Pending 决策⑦：SUBMITTED 后是否允许 PATCH 触发重审）

```
对齐 Invoice PATCH 模式：keyFinancialChanged（supplierId/currency/paymentTerm/行数量/单价变化）→ 重审；
非财务字段（remark）不触发。乐观锁 version。
```

## 6. 价格/金额事实来源（CTO 拍板③：**双通道**，最重要的拍板项）

| 通道 | 规则 | 审计要求 |
| --- | --- | --- |
| **`SUPPLIER_PRICE_SNAPSHOT`（优先）** | PO 行价来自 **Supplier 价格快照**（partner-prices priceSource=SUPPLIER），转单/创建时快照复制，**不重算** | 可追溯（源价格 ID + 快照） |
| **`MANUAL`（授权手工）** | 允许授权用户手工录入单价（快照复制） | **必须记录 `priceReason / priceSetById(actor) / priceSetAt`（audit 留痕）** |

- **金额事实链（对齐销售侧）**：Supplier 价格（PartnerPrice）→ PO Line 单价快照 → PO.totalAmount（Σ 行，**服务端 Decimal 聚合，客户端不可直接传总额**）；**PO 不调 Pricing Engine、不重算**
- **税率（CTO 拍板④）**：PO 行 taxRate 快照复制，税档变化不影响已 APPROVED PO（对齐 Invoice 快照税务）

## 7. 审批（复用 Workflow，不建 Approval 表）

- ApprovalPolicy(module=`PURCHASE_REQUISITION` / `PURCHASE_ORDER`) → WorkflowDefinition → WorkflowInstance → 投影回写
- businessType=`purchase-requisition` / `purchase-order`（workflow actions 路由分支，对齐 quotation/sales-order/invoice/write-off/credit-debit-note）
- **PR 与 PO 是否都需审批 / 双审批链**（Pending 决策①：PR 审批后转 PO，PO 再审批？还是 PR 免审、PO 必审？）

## 8. Goods Receipt 边界（5B，本阶段只定义；CTO 拍板调整③锁死）

- **只有 Confirmed PO 才能成为 5B Goods Receipt 来源**（APPROVED ≠ CONFIRMED；未确认 PO 不可收货）
- PO Line **预留**投影字段：`receivedQty=0 / remainingReceiveQty=quantity`（Schema 阶段建列；**5A 不允许客户端修改，5B 才是唯一回写方**——GR 聚合回写，对齐 SO deliveredQty/remainingQty）
- **防超收红线**：GR 数量 ≤ PO Line remainingReceiveQty（5B 锁内校验，对齐防超交/防超开票）
- **PO 金额事实不被 GR 修改**：GR 只回写数量投影（receivedQty），不碰 PO 单价/行金额（对齐 Invoice 投影思想）

## 9. 事件注册（EVENTS.md v1.14，先注册后开发，见 2.3.8；**11 个事件**——PurchaseOrderConfirmed 为 CTO 拍板调整③新增）

| eventType | 触发时机 | 载荷要点 | 状态 |
| --- | --- | --- | --- |
| `PurchaseRequisitionCreated` | 创建 PR（DRAFT；PR-2026-xxxx 创建即取号） | `{ requisitionId, requisitionCode, requesterId, departmentId, currency, totalAmount, createdBy }` | ⏳ 注册待实现 |
| `PurchaseRequisitionSubmitted` | 提交审批（命中策略触发 Workflow） | `{ requisitionId, workflowInstanceId, submittedBy, submittedAt }` | ⏳ 注册待实现 |
| `PurchaseRequisitionApproved` | 审批通过（Workflow 回调，投影回写） | `{ requisitionId, workflowInstanceId, approvedBy, approvedAt }` | ⏳ 注册待实现 |
| `PurchaseRequisitionRejected` | 审批驳回（→ DRAFT 重提） | `{ requisitionId, workflowInstanceId, rejectedBy, rejectedAt, reason }` | ⏳ 注册待实现 |
| `PurchaseRequisitionConverted` | PR → PO 转单（PR status=CONVERTED） | `{ requisitionId, purchaseOrderId, purchaseOrderCode, convertedBy, convertedAt }` | ⏳ 注册待实现 |
| `PurchaseOrderCreated` | 创建 PO（DRAFT；PO-2026-xxxx 创建即取号） | `{ purchaseOrderId, purchaseOrderCode, supplierId, requisitionId, currency, totalAmount, createdBy }` | ⏳ 注册待实现 |
| `PurchaseOrderSubmitted` | 提交审批 | `{ purchaseOrderId, workflowInstanceId, submittedBy, submittedAt }` | ⏳ 注册待实现 |
| `PurchaseOrderApproved` | 审批通过（**内部批准投影；APPROVED ≠ CONFIRMED**——CTO 拍板调整③） | `{ purchaseOrderId, workflowInstanceId, approvedBy, approvedAt }` | ⏳ 注册待实现 |
| `PurchaseOrderConfirmed` | **确认正式下单（APPROVED → CONFIRMED；只有 Confirmed PO 才是 5B GR 来源）** | `{ purchaseOrderId, purchaseOrderCode, supplierId, confirmedBy, confirmedAt }` | ⏳ 注册待实现 |
| `PurchaseOrderRejected` | 审批驳回（→ DRAFT 重提） | `{ purchaseOrderId, workflowInstanceId, rejectedBy, rejectedAt, reason }` | ⏳ 注册待实现 |
| `PurchaseOrderCancelled` | 取消（DRAFT/SUBMITTED 可取消；APPROVED 后取消需边界确认） | `{ purchaseOrderId, cancelledBy, cancelledAt, reason }` | ⏳ 注册待实现 |

> 注：GR/Supplier Invoice 事件（GoodsReceived / SupplierInvoiceCreated 等）属 5B/5C，本阶段不注册；`PurchaseOrderPartiallyReceived/Received` 投影事件 5B 注册（对齐 Delivery 先例）。

## 10. Migration / API 草案（实现阶段，本阶段不创建）

- **Migration 0021**（实现阶段草案）：新增 `PurchaseRequisition`/`PurchaseRequisitionLine`/`PurchaseRequisitionRevision`/`PurchaseOrder`/`PurchaseOrderLine`/`PurchaseOrderRevision`/`PurchaseOrderSnapshot` + 枚举（PurchaseRequisitionStatus / **PurchaseOrderStatus（含 CONFIRMED）** / PurchaseOrderSnapshotType / **PurchaseOrderSourceType(REQUISITION\|DIRECT)** / **PurchaseOrderPriceSource(SUPPLIER_PRICE_SNAPSHOT\|MANUAL)**）；纯增量不改既有；DocumentType 新增 `PURCHASE_REQUISITION`；PurchaseOrderLine 含 `sourcePurchaseRequisitionLineId / priceReason / priceSetById / priceSetAt / receivedQty / remainingReceiveQty` 列
- **API 草案**：POST/GET /api/purchase-requisitions、POST /{id}/submit、POST /api/purchase-orders（convert 或直采）、POST /{id}/submit、PATCH /{id}（Pending 决策⑦）；RBAC 模块 purchase-requisition* / purchase-order*
- **Seed 草案**：ApprovalPolicy(module=PURCHASE_REQUISITION / PURCHASE_ORDER) 默认策略（对齐 4E-2/4E-3 先例：不自动建默认策略）

## 11. CTO Final Decisions（Design Review 97/100 拍板结果，2026-08-09）

| # | Pending | **CTO 拍板结论** |
| --- | --- | --- |
| ① | PR/PO 审批链 | **各自独立条件审批**（ApprovalPolicy 各自 module=PURCHASE_REQUISITION / PURCHASE_ORDER，命中才审） |
| ② | PO 创建入口 | **允许 PR Convert + Direct Purchase**（sourceType=REQUISITION\|DIRECT；Direct 显式可审计、不能绕过 PO Approval） |
| ③ | PO 价格来源 | **Supplier Price Snapshot 优先，但必须允许授权 Manual Price**（双通道；MANUAL 记录 priceReason/actor/audit） |
| ④ | 税率策略 | **快照复制**（税档变化不影响已 APPROVED PO） |
| ⑤ | PR 是否带金额 | **不带金额**（纯需求，金额事实在 PO） |
| ⑥ | PR Revision/Snapshot | **仅 Revision**（PR 无财务事实，快照延后） |
| ⑦ | PO 修改重审 | **财务/承诺字段变更触发重新审批**（对齐 Invoice keyFinancialChanged） |

> **3 项必改调整（进入 Schema 前已落实于本文档）**：① PO 价格双通道（SUPPLIER_PRICE_SNAPSHOT/MANUAL + priceReason/actor/audit + 头金额服务端聚合）② Direct Purchase 显式可审计（sourceType + sourcePurchaseRequisitionLineId + 不能绕过 PO Approval）③ PO 生命周期锁死（DRAFT→SUBMITTED→APPROVED→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED；DRAFT→CANCELLED；**APPROVED ≠ CONFIRMED**，只有 Confirmed PO 才是 5B GR 来源；PO Line 预留 receivedQty/remainingReceiveQty，5A 禁客户端改）

## 12. 边界红线（本阶段无越界实现）

- ❌ 不创建 Schema / Migration / API（Design 阶段只写草案）
- ❌ 不新建 Supplier 主数据（已存在，复用）
- ❌ 不实现 Goods Receipt / GRN（5B）；不实现 Supplier Invoice / 三单匹配 / AP（5C）；不实现采购付款（5D+）
- ❌ 不建 Approval 表（Workflow 唯一审批事实源）
- ❌ PR/PO 不承载库存动作（库存属 Sprint 6）
- ❌ PO 不直接调用 Pricing Engine（价格快照复制）
