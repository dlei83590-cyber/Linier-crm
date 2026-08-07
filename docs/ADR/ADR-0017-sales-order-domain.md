# ADR-0017：Sales Order Domain（销售订单领域模型边界与转换/定价/审批/事件决策）

- 状态：**Draft（待 CTO Review，2026-08-07；Sprint 4B 设计阶段，禁止写业务代码）**
- 日期：2026-08-07
- 关联：ADR-0015（Quotation must consume Pricing Engine）、ADR-0016（Quotation Domain）、Sprint4B_SO_Design.md、EVENTS.md（v1.4 待注册）、Sprint4A_Quote_Design.md、ROADMAP.md
- 背景：Sprint 4A Quotation Foundation 已合并（PR #12，8ee88a0）。Sprint 4B 进入 Sales Order 设计。CTO 决策：**先设计后实现**；Quotation → SalesOrder 转换唯一入口 `POST /api/quotations/{id}/convert`（4A 的 501 在 4B 正式实现）；Sales Order 不重新定价；本 ADR 锁定模型边界，保证 Sales 模块（4A Quote / 4B SO / 4C Delivery / 4D Invoice）与 Sprint 3 平台能力（Workflow、Pricing、File Center、BusinessPartner）完全一致。

## 决策

### 1. 不建 SalesOrderApproval 表（Workflow 为唯一审批事实源）

- 与 ADR-0016 决策①同构：审批状态、审批人、意见、时间一律以 Workflow（WorkflowInstance / WorkflowAction / WorkflowHistory）为唯一事实源。
- SalesOrder 仅保存投影字段：`workflowInstanceId / approvalStatus / approvedAt / approvedById`。
- 审批动作复用 `POST /api/workflows/instances/:id/actions`。
- **CTO Pending 问题③**：SO Confirm 是否需要再次审批（还是 Accepted Quotation 已足够）——未拍板前 confirm 默认不创建 WorkflowInstance。

### 2. 不建 SalesOrderPrice 表（Sales Order 不重新定价）

- **核心原则：Sales Order 不重新定价。** Quotation 已是客户接受后的商业价格依据。
- SO Line 继承 QuotationLine 全部价格字段 + `priceSnapshotId`（FK → QuotationPriceSnapshot，ADR-0015）。
- 除非用户主动修改订单商业条件（CTO Pending 问题②），才允许重新走 `PricingEngine.resolvePrice()`，
  且必须形成**新 SalesOrderRevision + 新 SalesOrderSnapshot + 必要审批**，并写 AuditLog。
- SO 行 schema 不含 unitPrice 自由填写入口（禁止前端 `unitPrice = 123`，与 Quotation 同构）。

### 3. 不建 SalesOrderAttachment 表（复用 File Center）

- 附件走 `FileAttachment`，`businessType = "sales-order"`（与 quotation/project/contract 统一引用）。

### 4. Quotation → SalesOrder 转换唯一入口（Sprint 4B 核心）

- **唯一入口：** `POST /api/quotations/{id}/convert`；**不开放** `POST /api/sales-orders`（Direct SO 为 CTO Pending 问题①）。
- 前置校验：`Quotation.status = ACCEPTED`、未过期（effectiveStatusOf）、未转换（convertedAt/salesOrderId 为空）。
- 单事务执行（任一步失败整体回滚）：
  1. DocumentSequence 取号（docType=SALES_ORDER，前缀 SO）
  2. 创建 SalesOrder（status=DRAFT，继承 header 商业字段）
  3. 复制有效 QuotationLine → SalesOrderLine（继承 itemId/quantity/uomId/unitPrice/taxAmount/lineAmount/totalAmount/priceSnapshotId + 溯源 quotationLineId；**不重新定价**）
  4. 创建 SalesOrderSnapshot(CREATED)
  5. 回写 Quotation：salesOrderId / convertedAt / convertedById
  6. Quotation.status = CONVERTED
  7. AuditLog + Domain Event（QuotationConverted + SalesOrderCreated）

### 5. SalesOrder 状态机与投影边界

- 主状态：`DRAFT → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED → COMPLETED`；`DRAFT/CONFIRMED → CANCELLED`。
- **主状态明确排除** Invoice/Payment 状态：Delivery、Invoice、Payment 各自生命周期，SO 仅保存必要投影（deliveredAt 预留）。
- **CTO Pending 问题④**：PARTIALLY_DELIVERED 由 SO 自维护还是 Delivery 聚合投影——未拍板前设计草案为 Delivery 聚合投影回写。

### 6. EVENTS 先注册后开发（EVENTS.md v1.4 待注册）

- 注册 7 个 SalesOrder 事件：SalesOrderCreated / SalesOrderUpdated / SalesOrderConfirmed / SalesOrderCancelled / SalesOrderDeliveryStarted / SalesOrderDelivered / SalesOrderCompleted。
- 统一载荷至少包含：`salesOrderId / salesOrderCode / quotationId / customerId / currency / totalAmount`（+ 各事件专属字段）。
- SalesOrderDeliveryStarted / SalesOrderDelivered / SalesOrderCompleted 由 Sprint 4C Delivery 联动触发（本阶段仅注册）。

### 7. 模型边界锁定

**保留 4 模型：**

| 模型 | 职责 |
| --- | --- |
| SalesOrder | 销售订单头（含审批投影 + 交付投影字段） |
| SalesOrderLine | 销售订单行（继承 QuotationLine 商业价格，必含 priceSnapshotId） |
| SalesOrderRevision | 修改历史（唯一版本载体，商业条件变更时系统生成） |
| SalesOrderSnapshot | 关键状态证据（仅固化节点：CREATED/CONFIRMED/CANCELLED，待 4C 扩展） |

**禁止建：** SalesOrderApproval / SalesOrderPrice / SalesOrderAttachment。

**SalesOrderLine 必含字段：** `priceSnapshotId / itemId / description / quantity / uomId / unitPrice / lineAmount / taxAmount / totalAmount / lineNo`（继承自 QuotationLine，禁止重新定价）。

**SalesOrderRevision** 统一承载版本历史（salesOrderId / revisionNo / changeReason / snapshotData / createdById）；每次影响商业内容的修改都创建 Revision。

**SalesOrderSnapshot** 仅在固化节点生成：CREATED（转换）/ CONFIRMED / CANCELLED（后续 4C 扩展 DELIVERED / COMPLETED）。Revision 是修改历史，Snapshot 是关键状态证据，职责不重叠。

### 8. CTO Pending Decisions（未拍板前不实现）

| # | 问题 | 影响面 | 默认草案（未确认） |
| --- | --- | --- | --- |
| ① | 是否允许 Direct Sales Order（无 Quotation） | 是否开放 POST /api/sales-orders + quotationId 可空 | 不开放；quotationId 必填 |
| ② | Quotation → SO 后是否允许修改价格和数量 | PATCH 头/行范围、重定价流程 | 仅允许改数量/交期等非价格字段；改价需特殊权限 + 新快照 + 审批 |
| ③ | SO Confirm 是否需要再次审批 | confirm 是否创建 WorkflowInstance | Accepted Quotation 即审批终态，不重复审批 |
| ④ | 部分交付状态归属 | PARTIALLY_DELIVERED 维护方 | Delivery 聚合投影回写 |

## 影响

- Sprint 4B Schema（0015_sales_order_foundation，设计阶段不创建）：+2 枚举 / +4 表，仅新增不改既有。
- convert API 替换 4A 的 501 占位；审批复用 Workflow；价格复用 QuotationPriceSnapshot / PricingEngine；附件复用 File Center。
- 后续 4C Delivery / 4D Invoice 全部引用本 ADR 与 ADR-0015/0016，禁止重新设计审批/价格。
