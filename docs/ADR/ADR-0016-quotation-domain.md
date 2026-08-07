# ADR-0016：Quotation Domain（报价领域模型边界与审批/过期/事件决策）

- 状态：**Accepted + Design Approved + Implemented**（CTO 审核 95/100，2026-08-07；Sprint 4A Phase 3 已落地）
- 实现确认（2026-08-07）：不建 QuotationApproval 表（submit 创建 WorkflowInstance，审批终态由 syncQuotationApproval 回写投影）；EXPIRED 惰性判定（effectiveStatusOf 投影，不落库）；11 个事件注册（已发布 7 个，事件总线落地前以 AuditLog 留痕）；Action API 锁定（submit/accept/cancel/convert 独立端点，不 PATCH status）。
- 日期：2026-08-07
- 关联：ADR-0015（Quotation must consume Pricing Engine）、Sprint4A_Quote_Review.md、Sprint4A_Quote_Design.md、EVENTS.md v1.2、Sprint4_Quote_Domain/ERD/API/Workflow、ROADMAP.md
- 背景：Sprint 3 全部完成（v0.5.0-alpha，PR #7-#11）。Sprint 4A 进入 Schema 设计。CTO 对复审阶段遗留的 3 项决策（审批表 / EXPIRED 机制 / EVENTS 注册）正式拍板，本 ADR 锁定模型边界，保证 Sales 模块（4A Quote / 4B SO / 4C Delivery / 4D Invoice）与 Sprint 3 平台能力（Workflow、Pricing、File Center、BusinessPartner）完全一致。

## 决策

### 1. 不建 QuotationApproval 表（Workflow 为唯一审批事实源）

- Sprint 3A 已有 `WorkflowInstance / WorkflowAction / WorkflowHistory`；再建 `QuotationApproval` 会形成双写。
- 审批状态、审批人、意见、时间一律以 Workflow 为唯一事实源。
- Quotation 仅保存投影字段：
  - `workflowInstanceId`：关联审批实例
  - `approvalStatus`：仅作为查询投影字段（复用统一审计字段 ApprovalStatus 枚举）
  - `approvedAt / approvedById`：最终批准结果的快捷投影
- 详细审批过程一律查询 Workflow。
- 如后续 Dashboard 查询性能不足，可做只读 View，不建业务表。

### 2. EXPIRED 采用惰性判定（Sprint 4A 不增调度器）

- 不修改平台架构，Sprint 4A 不增加调度器。
- 判定规则：`storedStatus ∈ {SENT, APPROVED}` 且 `validUntil < now` → `effectiveStatus = EXPIRED`。
- API 返回投影：`{ status, effectiveStatus, isExpired }`。
- 限制：
  - 数据库暂不主动把状态更新为 `EXPIRED`；
  - 已过期报价禁止接受、转 Sales Order 或继续审批；
  - 延期操作 → 创建新 Revision 或更新有效期，并写 AuditLog；
  - Sprint 9 OA / 独立 Scheduler 阶段再增加定时同步任务。
- `EXPIRED` 枚举保留，但不依赖后台调度器写入。

### 3. EVENTS 先注册后开发（EVENTS.md v1.2）

- 立即注册 11 个 Quotation 事件：QuotationCreated / QuotationUpdated / QuotationRevisionCreated / QuotationSubmitted / QuotationApproved / QuotationRejected / QuotationSent / QuotationExpired / QuotationAccepted / QuotationConverted / QuotationCancelled。
- 统一载荷至少包含：`eventId / eventType / occurredAt / actorId / quotationId / quotationCode / revisionNo / customerId / projectId / workflowInstanceId / currency / totalAmount`。
- `QuotationApproved`：Workflow 最终批准时产生；`QuotationRejected`：Workflow 最终驳回时产生；`QuotationConverted`：报价转 Sales Order 时产生；`QuotationExpired`：仅在读取或业务操作发现过期时记录，不要求定时发布。

### 4. 模型边界锁定

**保留 6 模型：**

| 模型 | 职责 |
| --- | --- |
| Quotation | 报价单头（含审批投影字段） |
| QuotationLine | 报价行（必须含 priceSnapshotId） |
| QuotationRevision | 修改历史（唯一版本载体，删除 QuotationVersion） |
| QuotationSnapshot | 关键状态证据（仅固化节点） |
| ApprovalPolicy | 审批策略（只选择 Workflow，不执行审批） |
| ApprovalPolicyRule | 策略规则（金额/毛利/客户信用/项目类型 → workflowDefinitionId） |

**禁止建：** QuotationApproval / QuotationVersion / 独立报价价格表 / 独立附件表。

**QuotationLine 必含字段：** `priceSnapshotId / itemId / description / quantity / uomId / unitPrice / lineAmount / taxAmount / totalAmount / sortOrder`。
- `priceSnapshotId` → QuotationPriceSnapshot（ADR-0015，与 ProjectProduct 同构）；
- `unitPrice` 是快照结果冗余，禁止前端绕过 Pricing Engine 自由填写；
- 手工改价必须走特殊权限和审批，并生成新的价格快照及审计记录。

**QuotationRevision** 统一承载版本历史（quotationId / revisionNo / changeReason / snapshotData / createdById / createdAt）；每次影响商业内容的修改都创建 Revision（数量、单价、折扣、税、有效期、付款条款、交货条款）。

**QuotationSnapshot** 仅在关键节点固化：SUBMITTED / APPROVED / SENT / ACCEPTED / CONVERTED。Revision 是修改历史，Snapshot 是关键状态证据，两者职责不重叠。

### 5. ApprovalPolicy 独立建模（只选择 Workflow，不执行审批）

- ApprovalPolicy：`module = QUOTATION / priority / enabled`（后续 SO/PO/Invoice 复用）。
- ApprovalPolicyRule：`minAmount / maxAmount / grossMarginThreshold / customerCreditLevel / projectType / workflowDefinitionId`。
- 流程：Quotation Submit → 匹配 ApprovalPolicy → 选择 WorkflowDefinition → 创建 WorkflowInstance → Workflow 执行审批 → 回写 Quotation 状态投影。

### 6. 架构补充（Sprint4A_Quote_Review Architecture Notes）

- A. Quotation 不存 `discountAmount`（可由 subtotal × discountRate 计算，避免双维护）。
- B. 税率不存裸 `taxRate`，保存 `taxProfileId + taxSnapshot`（行级可覆盖，税率调整可追溯）。
- C. 汇率快照只存 Header（`exchangeRateSnapshot` 一次），行不重复保存。

### 7. CTO 审核补充（2026-08-07，Design Approved 95/100，5 项增量）

1. **Quotation + 转换投影**：增加 `convertedAt` / `convertedById` / `salesOrderId`（Sprint 4B Quotation→Sales Order 后回写，避免反复反查 SO；属于投影非重复业务）。
2. **QuotationLine sortOrder → lineNo**：行号 10/20/30/40 步进，插入 25 不整体重排，不依赖 sortOrder。
3. **ApprovalPolicyRule + priority**：多规则按 priority DESC 匹配，避免命中冲突。
4. **QuotationRevision + revisionStatus**：DRAFT / SUBMITTED / APPROVED / SUPERSEDED，避免全部为 Created 不可查。
5. **QuotationSnapshot node → snapshotType**：SUBMITTED / APPROVED / SENT / ACCEPTED / CONVERTED，不靠 remark。

### 8. 模型/字段冻结清单（正式锁定）

**批准保留：** Quotation / QuotationLine / QuotationRevision / QuotationSnapshot / ApprovalPolicy / ApprovalPolicyRule。
**禁止新增（以后不得重新提出，除非新增 ADR）：** QuotationApproval / QuotationVersion / QuoteAttachment / QuotePrice。
**API 锁定：** `POST /api/quotations/{id}/submit|accept|cancel|convert` 全部 Action API，不 PATCH status。
**Migration 0014 约束：** 仅 CREATE / ALTER / INDEX / FK，不得 DROP。
**Pricing 红线（重申）：** `QuotationLine.unitPrice` 必须来自 `PricingEngine.resolvePrice() → QuotationPriceSnapshot → QuotationLine`，禁止前端 `unitPrice = 123`。

## 影响

- Sprint 4A Schema（0014_quotation_foundation）：+2 枚举 / +6 表，仅新增不改既有。
- 审批动作复用 `POST /api/workflows/instances/:id/actions`；价格复用 `POST /api/pricing/resolve`。
- 附件走 File Center（businessType=quotation）。
- 后续 4B/4C/4D 及 Sprint 5 Purchase 全部引用本 ADR 与 ADR-0015，禁止重新设计审批/价格。
