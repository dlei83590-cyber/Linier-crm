# ADR-0018：Delivery Domain（交付领域模型边界与交付事实源/聚合投影决策）

- 状态：**Accepted + Implemented（Sprint 4C 实现完成，2026-08-07；PR #14 待验收合并）**
- 日期：2026-08-07
- 关联：ADR-0015（Quotation must consume Pricing Engine）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、Sprint4C_Delivery_Design.md、EVENTS.md（v1.5 已注册）、Sprint4B_SO_Design.md（已实现，PR #13）、ROADMAP.md
- 背景：Sprint 4B Sales Order Foundation 已合并（PR #13，3747eba）。Sprint 4C 进入 Delivery 设计。CTO 决策：**先设计后实现**；**Delivery 是交付事实源，SalesOrder 只保存聚合投影**；本阶段不开发 Invoice/Payment；本 ADR 锁定模型边界，保证 Sales 模块（4A Quote / 4B SO / 4C Delivery / 4D Invoice）与 Sprint 3 平台能力（Workflow、Pricing、File Center、BusinessPartner）完全一致。
- **CTO Review（2026-08-07，94/100 APPROVED WITH CHANGES）**：9 项必改全部落实——① 区分预留量/已交付量（deliveredQty 仅 DELIVERED/COMPLETED 累计，DRAFT/READY/DISPATCHED 动态占用 availableQty 防超交，不新增 allocatedQty 列）② remainingQty 由 0016 迁移初始化为 quantity ③ Direct Delivery 禁止 ④ 超交禁止（409 DELIVERY_QUANTITY_EXCEEDED）⑤ DELIVERED=客户确认收货 ⑥ POD=File Center+最小投影字段 ⑦ READY 行彻底冻结 ⑧ COMPLETED 仅枚举不实现 action ⑨ Migration 0016 = 4 枚举 + 4 表 + 2 投影列。

## 决策

### 1. Delivery 是交付事实源，SalesOrder 只保存聚合投影

- **核心原则：交付数量以 DeliveryLine 为唯一事实。** SalesOrderLine 的 `deliveredQty / remainingQty` 是只读投影，由 Delivery 聚合回写；禁止手工 PATCH。
- SalesOrder.status 的 `PARTIALLY_DELIVERED / DELIVERED` 由 Delivery confirm-delivery 事务聚合判定后回写（SalesOrder.deliveredAt 同步回写）；**不提供任何手工修改入口**。
- DeliveryLine 记录**本次实际交付量**（quantity）；`orderedQty / deliveredQty` 仅为该校验/展示用的快照，非事实源。
- **CTO Review 修正（预留量 vs 已交付量）**：
  - `deliveredQty` = **已实际交付量**，仅 status ∈ {DELIVERED, COMPLETED} 的 DeliveryLine 累计，由 confirm-delivery 聚合回写；DRAFT/READY/DISPATCHED **不计入**。
  - `remainingQty` = `orderedQty - deliveredQty`，始终表达真正尚未实际交付的数量。
  - **预留/占用不落列**：创建/编辑 DeliveryLine 时事务内动态计算 `confirmedDeliveredQty` / `openDeliveryQty`（status ∈ {DRAFT, READY, DISPATCHED}）/ `availableQty = orderedQty - confirmedDeliveredQty - openDeliveryQty`，用于防超交校验。
  - 防止两个未完成 Delivery 同时分配超过订单数量 → `availableQty` 校验，超出 → 409 `DELIVERY_QUANTITY_EXCEEDED`。

### 2. 不建 DeliveryApproval 表（Workflow 为唯一审批事实源）

- 与 ADR-0016 决策①同构：审批状态、审批人、意见、时间一律以 Workflow（WorkflowInstance / WorkflowAction / WorkflowHistory）为唯一事实源。
- Delivery 本阶段不触发审批（交付为执行单据）；后续如需（超交审批等，CTO Review ②已拍板本阶段不做）复用 `POST /api/workflows/instances/:id/actions` + ApprovalPolicy `module="DELIVERY"`（仅设计）。
- SalesOrder 聚合回写（PARTIALLY_DELIVERED/DELIVERED）为系统动作，不开放权限、不占审批。

### 3. POD（Proof of Delivery）：File Center 存文件 + Delivery 最小投影字段（CTO Review ④拍板）

- **不建 DeliveryPOD 表。**
- Delivery 增加最小 POD 投影字段：`podStatus（DeliveryPodStatus：PENDING/RECEIVED/WAIVED）/ podReceivedAt / podConfirmedById`。
- POD 原始文件（签收单/照片/盖章 DO）走 `FileAttachment`，`businessType = "delivery"`、`businessId = delivery.id`、`attachmentType = "POD"`。
- `podStatus = WAIVED`（业务不需要 POD）时允许 `confirm-delivery`；`PENDING` 时禁止确认（409）。
- 数据库可快速回答：该 Delivery 是否已签收？何时？谁确认？

### 4. 不建 DeliveryPrice 表（交付不持有价格）

- 价格事实源在 SalesOrder / QuotationPriceSnapshot（ADR-0015）；Delivery 不重新定价、不持有价格。
- DeliveryLine 金额参考（如需展示）从 SalesOrderLine 快照读取，禁止在 Delivery 侧存储价格或计算。

### 5. Delivery 创建唯一入口（CTO Review ①拍板：Direct Delivery 禁止）

- **唯一入口：** `POST /api/sales-orders/:salesOrderId/deliveries`；**不开放** `POST /api/deliveries`。
- `salesOrderId` **NOT NULL**（CTO Review ①锁定）：ERP 销售链 Quotation→SalesOrder→Delivery→Invoice 明确，Direct Delivery 会绕开订单数量、客户、价格与后续开票来源，现阶段没有必要。
- 前置校验：SalesOrder.status ∈ {CONFIRMED, PARTIALLY_DELIVERED}（DRAFT 未确认、DELIVERED/CANCELLED 禁止新建交付）。
- 创建流程（事务）：DocumentSequence 取号（docType=DELIVERY_ORDER，前缀 DO）→ 创建 Delivery(DRAFT) → 复制可选 SalesOrderLine → DeliveryLine（sourceSalesOrderLineId 溯源）→ DeliverySnapshot(CREATED) → AuditLog → DeliveryCreated 事件。

### 6. 并发安全（防超交，事务规则核心；CTO Review ②拍板：禁止任何超交）

- **两单同交同一 SO Line 必须串行化：** SalesOrderLine 以 `SELECT ... FOR UPDATE` 真实行锁锁定；第二个事务阻塞到第一个提交后重读 availableQty 再校验。
- confirm-delivery 事务内先锁 SalesOrder（FOR UPDATE）再锁各 SalesOrderLine，避免聚合回写竞争。
- 禁止"读-算-写"分离的乐观更新（防止两个事务读到相同 availableQty 造成超交）。
- 防超交硬规则（CTO Review ②）：`new allocated quantity <= availableQty`；超出 → 409 `DELIVERY_QUANTITY_EXCEEDED`。
- **不做固定 +5%、不加超交审批**（不同商品公差差异大）；后续真正需要时建 `DeliveryTolerancePolicy` 或 Item/SO Line 级 `overDeliveryTolerancePct`（本阶段仅设计）。

### 7. Delivery 状态机与边界（CTO Review ③⑦⑧拍板）

- 状态：`DRAFT → READY → DISPATCHED → DELIVERED`；`DRAFT/READY → CANCELLED`。
- **READY 行彻底冻结**（⑦）：READY 后行只读，不支持修改/重新 ready；发现错误 → cancel → 新建 Delivery（不引入 amendment 流程，避免第二次 READY Snapshot 撞唯一约束）。
- **DELIVERED = 客户确认收货 / 可证明已实物交付**（③，非物流送达）：DISPATCHED = 已出库/已发运/运输中；`confirm-delivery` 是**业务确认动作**（要求 podStatus ∈ {RECEIVED, WAIVED}），非物流状态自动更新（后续 Invoice/AR 依赖交付事实）。
- **COMPLETED 仅保留枚举、不实现 action**（⑧）：Sprint 4C 不提供 `/complete`；待后续（Delivery + POD + Invoice/其他闭环条件 → COMPLETED）。
- **主状态明确排除** Invoice/Payment 状态：发票/收款由 4D 模块承载，Delivery 不持有。

### 8. EVENTS 先注册后开发（EVENTS.md v1.5 已注册）

- 注册 8 个 Delivery 事件：DeliveryCreated / DeliveryUpdated / DeliveryReady / DeliveryDispatched / DeliveryConfirmed / DeliveryCancelled / SalesOrderPartiallyDelivered / SalesOrderDelivered。
- 统一载荷至少包含：`deliveryId / deliveryCode / salesOrderId / customerId`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
- 4B 已注册的 `SalesOrderDeliveryStarted`（首次交付触发）在 4C 由首次 confirm-delivery 联动发布；`SalesOrderCompleted` 待 4D（交付+回款）。

### 9. 模型边界锁定

**保留 4 模型：**

| 模型 | 职责 |
| --- | --- |
| Delivery | 交付单头（交付事实源，1:N 关联 SalesOrder；DO 编号；含 POD 最小投影 podStatus/podReceivedAt/podConfirmedById） |
| DeliveryLine | 交付单行（本次实际交付量；sourceSalesOrderLineId 溯源） |
| DeliveryRevision | 修改历史（唯一版本载体，交付内容变更时系统生成） |
| DeliverySnapshot | 关键状态证据（仅固化节点：CREATED/READY/DISPATCHED/DELIVERED/CANCELLED） |

**禁止建：** DeliveryApproval / DeliveryAttachment / DeliveryPrice / DeliveryPOD。

**DeliveryLine 必含字段：** `sourceSalesOrderLineId / itemId / description / quantity（本次交付量）/ uomId / orderedQty（校验快照）/ deliveredQty（校验快照）/ lineNo`。

**SalesOrderLine 追加投影（Migration 0016，CTO Review：不新增 allocatedQty 第三列）：**
- `deliveredQty Decimal @default(0)`（已实际交付量；仅 confirm-delivery 聚合回写）
- `remainingQty Decimal`（= quantity - deliveredQty；**由 0016 数据迁移初始化为 quantity**，DB default 无法引用 quantity，故不用 default(0)）

**DeliveryRevision** 统一承载版本历史（deliveryId / revisionNo / changeReason / snapshotData / createdById）；每次影响交付内容的修改都创建 Revision。

**DeliverySnapshot** 仅在固化节点生成：CREATED / READY / DISPATCHED / DELIVERED / CANCELLED。Revision 是修改历史，Snapshot 是关键状态证据，职责不重叠。

### 10. CTO Pending Decisions（已全部拍板，CTO Review 94/100）

| # | 问题 | 影响面 | **拍板结论（2026-08-07）** |
| --- | --- | --- | --- |
| ① | 是否允许无 SalesOrder 的 **Direct Delivery**？ | 是否开放 POST /api/deliveries + salesOrderId 可空 | **不允许**；salesOrderId NOT NULL；`POST /api/sales-orders/{id}/deliveries` 唯一入口；不开放 `POST /api/deliveries` |
| ② | 是否允许**超交（over-delivery）**？ | confirm-delivery 校验逻辑、remainingQty 语义、超交审批 | **Sprint 4C 不允许任何超交**：`new allocated quantity <= availableQty`；超出 → 409 `DELIVERY_QUANTITY_EXCEEDED`；不做固定 +5%、不加超交审批；后续需要时建 `DeliveryTolerancePolicy` / Item 级 `overDeliveryTolerancePct` |
| ③ | **DELIVERED 是物流送达还是客户签收**？ | confirm-delivery 语义、deliveredAt 定义、POD 关联 | **DELIVERED = 客户确认收货 / 可证明已实物交付**（非物流送达）；`confirm-delivery` 为业务确认动作 |
| ④ | **POD 字段直接建模**还是完全走 File Center？ | Delivery 是否加 POD 投影字段、附件引用 | **File Center 存文件 + Delivery 最小投影字段**（不建 DeliveryPOD 表）：podStatus（PENDING/RECEIVED/WAIVED）/ podReceivedAt / podConfirmedById；attachmentType="POD"；WAIVED 时允许 confirm-delivery |

## 影响

- Sprint 4C Schema（0016_delivery_foundation，CTO Review 后实现阶段创建）：**+4 枚举（DeliveryStatus / DeliverySnapshotType / DeliveryRevisionStatus / DeliveryPodStatus）/ +4 表 / SalesOrderLine +2 投影列**，仅新增不改既有。
- 防超交走 SalesOrderLine `FOR UPDATE` 真实行锁 + 事务内动态 availableQty 累计（对齐 4B convert 行锁模式）。
- 聚合回写（PARTIALLY_DELIVERED/DELIVERED + deliveredAt）为系统动作，禁止手工 PATCH；deliveredQty 仅在 confirm-delivery 时增加。
- 后续 4D Invoice / Payment 引用本 ADR 与 ADR-0015/0016/0017，禁止重新设计交付/价格。
