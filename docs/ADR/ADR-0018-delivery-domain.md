# ADR-0018：Delivery Domain（交付领域模型边界与交付事实源/聚合投影决策）

- 状态：**Draft（待 CTO Review，2026-08-07；Sprint 4C 设计阶段，禁止写业务代码）**
- 日期：2026-08-07
- 关联：ADR-0015（Quotation must consume Pricing Engine）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、Sprint4C_Delivery_Design.md、EVENTS.md（v1.5 待注册）、Sprint4B_SO_Design.md（已实现，PR #13）、ROADMAP.md
- 背景：Sprint 4B Sales Order Foundation 已合并（PR #13，3747eba）。Sprint 4C 进入 Delivery 设计。CTO 决策：**先设计后实现**；**Delivery 是交付事实源，SalesOrder 只保存聚合投影**；本阶段不开发 Invoice/Payment；本 ADR 锁定模型边界，保证 Sales 模块（4A Quote / 4B SO / 4C Delivery / 4D Invoice）与 Sprint 3 平台能力（Workflow、Pricing、File Center、BusinessPartner）完全一致。

## 决策

### 1. Delivery 是交付事实源，SalesOrder 只保存聚合投影

- **核心原则：交付数量以 DeliveryLine 为唯一事实。** SalesOrderLine 的 `deliveredQty / remainingQty` 是只读投影，由 Delivery 聚合回写；禁止手工 PATCH。
- SalesOrder.status 的 `PARTIALLY_DELIVERED / DELIVERED` 由 Delivery confirm-delivery 事务聚合判定后回写（SalesOrder.deliveredAt 同步回写）；**不提供任何手工修改入口**。
- DeliveryLine 记录**本次实际交付量**（quantity）；`orderedQty / deliveredQty` 仅为该校验/展示用的快照，非事实源。

### 2. 不建 DeliveryApproval 表（Workflow 为唯一审批事实源）

- 与 ADR-0016 决策①同构：审批状态、审批人、意见、时间一律以 Workflow（WorkflowInstance / WorkflowAction / WorkflowHistory）为唯一事实源。
- Delivery 本阶段不触发审批（交付为执行单据）；如后续需要（超交审批等）复用 `POST /api/workflows/instances/:id/actions` + ApprovalPolicy `module="DELIVERY"`（仅设计）。
- SalesOrder 聚合回写（PARTIALLY_DELIVERED/DELIVERED）为系统动作，不开放权限、不占审批。

### 3. 不建 DeliveryAttachment 表（复用 File Center）

- 附件走 `FileAttachment`，`businessType = "delivery"`（与 quotation/sales-order/project/contract 统一引用）。
- **CTO Pending 问题④**：POD（Proof of Delivery）是否需要直接建模——默认完全走 File Center；如需签收确认再追加投影字段（未拍板前不实现）。

### 4. 不建 DeliveryPrice 表（交付不持有价格）

- 价格事实源在 SalesOrder / QuotationPriceSnapshot（ADR-0015）；Delivery 不重新定价、不持有价格。
- DeliveryLine 金额参考（如需展示）从 SalesOrderLine 快照读取，禁止在 Delivery 侧存储价格或计算。

### 5. Delivery 创建唯一入口（Sprint 4C 核心）

- **唯一入口：** `POST /api/sales-orders/:salesOrderId/deliveries`；**不开放** `POST /api/deliveries`（Direct Delivery 为 CTO Pending 问题①，默认不允许）。
- 前置校验：SalesOrder.status ∈ {CONFIRMED, PARTIALLY_DELIVERED}（DRAFT 未确认、DELIVERED/CANCELLED 禁止新建交付）。
- 创建流程（事务）：DocumentSequence 取号（docType=DELIVERY_ORDER，前缀 DO）→ 创建 Delivery(DRAFT) → 复制可选 SalesOrderLine → DeliveryLine（sourceSalesOrderLineId 溯源）→ DeliverySnapshot(CREATED) → AuditLog → DeliveryCreated 事件。

### 6. 并发安全（防超交，事务规则核心）

- **两单同交同一 SO Line 必须串行化：** SalesOrderLine 以 `SELECT ... FOR UPDATE` 真实行锁锁定；第二个事务阻塞到第一个提交后重读 deliveredQty 再校验。
- confirm-delivery 事务内先锁 SalesOrder（FOR UPDATE）再锁各 SalesOrderLine，避免聚合回写竞争。
- 禁止"读-算-写"分离的乐观更新（防止两个事务读到相同 remainingQty 造成超交）。
- 防超交校验：`本次 quantity <= orderedQty - deliveredQty`（超交见 CTO Pending 问题②）。

### 7. Delivery 状态机与边界

- 状态：`DRAFT → READY → DISPATCHED → DELIVERED → COMPLETED`；`DRAFT/READY → CANCELLED`。
- READY 后行只读（修改走 Revision + 重新 ready）；DISPATCHED+ 禁止取消。
- COMPLETED 为 4C 预留状态（事实源后续补充，不实现触发）。
- **主状态明确排除** Invoice/Payment 状态：发票/收款由 4D 模块承载，Delivery 不持有。

### 8. EVENTS 先注册后开发（EVENTS.md v1.5 待注册）

- 注册 8 个 Delivery 事件：DeliveryCreated / DeliveryUpdated / DeliveryReady / DeliveryDispatched / DeliveryConfirmed / DeliveryCancelled / SalesOrderPartiallyDelivered / SalesOrderDelivered。
- 统一载荷至少包含：`deliveryId / deliveryCode / salesOrderId / customerId`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
- 4B 已注册的 `SalesOrderDeliveryStarted`（首次交付触发）在 4C 由首次 confirm-delivery 联动发布；`SalesOrderCompleted` 待 4D（交付+回款）。

### 9. 模型边界锁定

**保留 4 模型：**

| 模型 | 职责 |
| --- | --- |
| Delivery | 交付单头（交付事实源，1:N 关联 SalesOrder；DO 编号） |
| DeliveryLine | 交付单行（本次实际交付量；sourceSalesOrderLineId 溯源） |
| DeliveryRevision | 修改历史（唯一版本载体，交付内容变更时系统生成） |
| DeliverySnapshot | 关键状态证据（仅固化节点：CREATED/READY/DISPATCHED/DELIVERED/CANCELLED） |

**禁止建：** DeliveryApproval / DeliveryAttachment / DeliveryPrice。

**DeliveryLine 必含字段：** `sourceSalesOrderLineId / itemId / description / quantity（本次交付量）/ uomId / orderedQty（校验快照）/ deliveredQty（校验快照）/ lineNo`。

**SalesOrderLine 追加投影（Migration 0016）：** `deliveredQty Decimal @default(0)` / `remainingQty Decimal @default(0)`（只读，由 Delivery 聚合回写）。

**DeliveryRevision** 统一承载版本历史（deliveryId / revisionNo / changeReason / snapshotData / createdById）；每次影响交付内容的修改都创建 Revision。

**DeliverySnapshot** 仅在固化节点生成：CREATED / READY / DISPATCHED / DELIVERED / CANCELLED。Revision 是修改历史，Snapshot 是关键状态证据，职责不重叠。

### 10. CTO Pending Decisions（未拍板前不实现）

| # | 问题 | 影响面 | 默认草案（未确认） |
| --- | --- | --- | --- |
| ① | 是否允许无 SalesOrder 的 **Direct Delivery**？ | 是否开放 POST /api/deliveries + salesOrderId 可空 | 不允许；salesOrderId 必填（唯一入口经 SO 创建） |
| ② | 是否允许**超交（over-delivery）**？阈值多少？ | confirm-delivery 校验逻辑、remainingQty 语义、超交审批 | 不允许超交（quantity <= remainingQty 硬校验）；如需允许建议 +5% 阈值且需审批（待确认） |
| ③ | **DELIVERED 是物流送达还是客户签收**？ | confirm-delivery 语义、deliveredAt 定义、POD 关联 | 物流送达（DISPATCHED → 送达即 DELIVERED）；客户签收场景走 POD（待确认） |
| ④ | **POD 字段直接建模**还是完全走 File Center？ | Delivery 是否加 POD 投影字段、附件引用 | 完全走 File Center（businessType="delivery"）；如需签收确认再加投影字段（待确认） |

## 影响

- Sprint 4C Schema（0016_delivery_foundation，设计阶段不创建）：+3 枚举 / +4 表 / SalesOrderLine +2 投影列，仅新增不改既有。
- 防超交走 SalesOrderLine `FOR UPDATE` 真实行锁 + 事务内原子累计（对齐 4B convert 行锁模式）。
- 聚合回写（PARTIALLY_DELIVERED/DELIVERED + deliveredAt）为系统动作，禁止手工 PATCH。
- 后续 4D Invoice / Payment 引用本 ADR 与 ADR-0015/0016/0017，禁止重新设计交付/价格。
