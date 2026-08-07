# Sprint 4B QA — Sales Order Foundation（销售订单领域：convert 唯一入口 + CRUD/Lines + Actions + Workflow 条件触发）

> Sprint：4B | 模块：Sales Order Foundation（已通过代码门禁） | PR：#13（feature/sprint4-sales，待验收合并） | 日期：2026-08-07
> 状态：✅ 代码门禁通过（CI #81/#82/#83/#31158155759/#31158705373/#31159194039 全绿：Quality Gates / Build / Secret Scanning）；文档收尾后交 CTO Review
> 关联：ADR-0015（Quotation must consume Pricing Engine）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、Sprint4B_SO_Design.md、EVENTS.md v1.4、API_GUIDELINES.md、ERROR_CODES.md
> 架构原则（CTO 审核锁定 4 项 + 3 条补充）：
> ① 不允许 Direct Sales Order——quotationId 必填，唯一创建入口 `POST /api/quotations/{id}/convert`，不开放 `POST /api/sales-orders`；
> ② 允许改数量、禁止直接改价格——数量/UOM 商业条件变更必须重新走 PricingEngine，生成新 SalesOrderRevision + SalesOrderSnapshot；价格字段不得前端写入（schema 无 unitPrice）；
> ③ SO Confirm 不重复审批——Accepted Quotation 已完成商业审批，confirm 只做状态流转；仅当 SO 修改数量/价格/付款条件/交货条件等关键商业字段时才触发新审批（Workflow 条件触发）；
> ④ PARTIALLY_DELIVERED/DELIVERED 由 Delivery 聚合回写（SO 只存投影，本阶段不实现 Delivery）；
> 补充：SalesOrderLine 必须保留 quotationLineId + priceSnapshotId 溯源；convert 并发安全（真实行锁 + DocumentSequence 原子 increment + 唯一约束冲突→409）；Snapshot 金额 Decimal 字符串（禁止 toNumber()）。

## 1. 交付范围

### 1.1 API（8 路由文件 / 10 端点 + convert 实现，均在 `apps/web/src/app/api/sales-orders/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 主档 | GET `/api/sales-orders` | 列表（分页 + code/quotationId/customerId/status/dateFrom/dateTo 过滤；**无 POST**——Direct SO 禁止） |
| 主档 | GET/PATCH `/api/sales-orders/{id}` | 详情（含 lines/revisions/snapshots + customer + quotation 摘要）；头更新（仅 DRAFT，乐观锁 version，变更生成 Revision + SalesOrderUpdated） |
| 行 | GET `/api/sales-orders/{id}/lines` | 行列表（含 item + priceSnapshot；只读，不开放 POST——Line 来自 Quotation Convert） |
| 行 | PATCH `/api/sales-orders/{id}/lines/{lineId}` | 行更新（仅 DRAFT；quantity/uomId 变化 → 先 PricingEngine（事务外）→ 单事务更新 line + 新 priceSnapshotId + 重算 totals + Revision；sourceQuotationLineId 溯源永不清除；禁 unitPrice） |
| 修订 | GET `/api/sales-orders/{id}/revisions` | 修订历史（revisionNo desc，只读；Revision 只能系统生成） |
| 快照 | GET `/api/sales-orders/{id}/snapshots` | 快照列表（generatedAt desc，只读；金额 Decimal 字符串） |
| Action | POST `/api/sales-orders/{id}/confirm` | 确认订单（DRAFT → CONFIRMED + CONFIRMED 快照 + SalesOrderConfirmed；不重复审批） |
| Action | POST `/api/sales-orders/{id}/cancel` | 取消（DRAFT/CONFIRMED → CANCELLED + CANCELLED 快照 + SalesOrderCancelled；已交付/完成禁止） |
| 转换 | POST `/api/quotations/{id}/convert` | **唯一创建入口**（Sprint 4B 正式实现，替代 4A 的 501）：ACCEPTED + 未过期 + 未转换 → DRAFT SO + 复制 Line（继承价格，不重新定价）+ CREATED 快照 + 回写 Quotation（CONVERTED）+ 双事件 |

### 1.2 RBAC（权限码，动作级）
sales-order:view / sales-order:edit / sales-order:approve（confirm 映射）/ sales-order:close（cancel 映射）
sales-order-line:view / sales-order-line:edit
sales-order-revision:view
sales-order-snapshot:view
（无 sales-order:create——转换唯一入口；审批动作走 workflow 模块既有权限体系）

### 1.3 Domain Events（EVENTS.md v1.4 注册 7 个，本阶段已发布 5 个）
已发布：SalesOrderCreated（convert）/ SalesOrderUpdated（头/行 PATCH）/ SalesOrderConfirmed（confirm）/ SalesOrderCancelled（cancel）/ SalesOrderApprovalStarted（Workflow 条件触发留痕）
注册待后续：SalesOrderDeliveryStarted / SalesOrderDelivered / SalesOrderCompleted（Sprint 4C/4D Delivery 联动）

## 2. 测试要点（CTO 锁定项覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 唯一创建入口 | `POST /api/sales-orders` 不存在（404）；SO 只能经 convert 创建 | 路由结构（无 POST） |
| T2 | convert 前置校验 | 仅 ACCEPTED + 未过期 + 未转换可转；否则 409 QUOTATION_INVALID_STATE / QUOTATION_EXPIRED / QUOTATION_ALREADY_CONVERTED | convert/route.ts |
| T3 | convert 并发安全 | 两请求并发 → 一行锁（FOR UPDATE 真实锁定 Quotation）+ DocumentSequence 原子 increment + quotationId 唯一约束冲突 → 稳定 409 | convert/route.ts |
| T4 | convert 复制 Line 溯源 | SO Line 继承 itemId/quantity/uomId/unitPrice/taxAmount/lineAmount/totalAmount/priceSnapshotId + quotationLineId 溯源（不重新定价） | convert/route.ts |
| T5 | 价格红线（禁直接改价） | salesOrderUpdateSchema / salesOrderLineUpdateSchema 均无 unitPrice 字段 → 前端提交被 Zod 忽略 | schemas.ts |
| T6 | 商业条件变更重定价 | PATCH line 改 quantity/uomId → 先 PricingEngine（事务外）→ 新 priceSnapshotId + line 价格更新 + totals 重算 + Revision；quotationLineId 不清除 | lines/[lineId]/route.ts |
| T7 | 定价失败不留半更新 | 重定价抛错 → 400 SALES_ORDER_PRICE_FAILED，数据库保持原状态（无部分写入） | lines/[lineId]/route.ts |
| T8 | 状态限制：仅 DRAFT 可编辑 | CONFIRMED 后 PATCH 头/行 → 409 SALES_ORDER_NOT_EDITABLE（走后续 amendment 流程） | [id]/route.ts、lines/[lineId]/route.ts |
| T9 | 乐观锁 409 | PATCH 带旧 version → 409 VERSION_CONFLICT | [id]/route.ts、lines/[lineId]/route.ts |
| T10 | confirm 不重复审批 | DRAFT → CONFIRMED（不创建 WorkflowInstance）；仅 DRAFT 可确认 → 其他状态 409 SALES_ORDER_INVALID_STATE；生成 CONFIRMED 快照 | confirm/route.ts |
| T11 | cancel 状态限制 | DRAFT/CONFIRMED 可取消 → CANCELLED + CANCELLED 快照；PARTIALLY_DELIVERED/DELIVERED/COMPLETED 禁止 | cancel/route.ts |
| T12 | 快照金额 Decimal 字符串 | confirm/cancel 快照 snapshotData.totalAmount 为字符串（toString），JSON 不 toNumber() | confirm/cancel 路由 |
| T13 | Workflow 条件触发 | 头 PATCH 改 paymentTerm/incoterm/requestedDeliveryDate 或行 PATCH 重定价 → 有 SALES_ORDER 策略时创建 WorkflowInstance（businessType="sales-order"）并回写 workflowInstanceId/approvalStatus=PENDING；无策略则跳过不阻塞 | workflow-sync.ts + 两个 PATCH 路由 |
| T14 | 审批终态回写 | Workflow COMPLETED → SO approvalStatus=APPROVED + approvedAt/approvedById；REJECTED → REJECTED（投影，不生成快照——SO 快照类型无 APPROVED） | workflow-sync.ts + workflows/instances/[id]/actions |
| T15 | 权限不足正确拒绝 | 无对应权限码调用 → 403 FORBIDDEN（8 权限码全覆盖） | 各路由 requirePermission |

## 3. 测试清单（按模块）

### 3.1 认证与权限
- [ ] A1 未认证访问 GET /api/sales-orders → 401
- [ ] A2 MEMBER 无 sales-order:view → GET → 403
- [ ] A3 无 sales-order:edit → PATCH /:id → 403
- [ ] A4 无 sales-order-line:view → GET lines → 403
- [ ] A5 无 sales-order-line:edit → PATCH lines/:lineId → 403
- [ ] A6 无 sales-order-revision:view → GET revisions → 403
- [ ] A7 无 sales-order-snapshot:view → GET snapshots → 403
- [ ] A8 无 sales-order:approve → confirm → 403
- [ ] A9 无 sales-order:close → cancel → 403
- [ ] A10 权限码覆盖 8 个（sales-order*/sales-order-line*/revision*/snapshot*）→ 无权限 403

### 3.2 主档 CRUD
- [ ] B1 列表分页+过滤（code/quotationId/customerId/status/dateFrom/dateTo）→ 200，软删除过滤
- [ ] B2 列表项含 customer/quotation 摘要 + lines 计数
- [ ] B3 详情含 lines/revisions/snapshots + customer + quotation 摘要
- [ ] B4 详情不存在 → 404 SALES_ORDER_NOT_FOUND
- [ ] B5 PATCH 头（paymentTerm/incoterm/remark + changeReason + version）→ 200，version+1，生成 Revision，发布 SalesOrderUpdated
- [ ] B6 PATCH 旧 version → 409 VERSION_CONFLICT
- [ ] B7 CONFIRMED 状态 PATCH → 409 SALES_ORDER_NOT_EDITABLE（仅 DRAFT）
- [ ] B8 PATCH 带 unitPrice → 字段被 schema 忽略（无该字段）
- [ ] B9 PATCH 改 paymentTerm/incoterm/requestedDeliveryDate → 触发 maybeTriggerSalesOrderApproval（有策略时建 WorkflowInstance）

### 3.3 行管理（定价红线 + 溯源）
- [ ] C1 行列表 → 200，含 item + priceSnapshot
- [ ] C2 PATCH 改 quantity → 重新定价：新 priceSnapshotId + 价格回写 + totals 重算 + Revision
- [ ] C3 PATCH 改 uomId → 同 C2（uomId 变化 = 商业条件变化）
- [ ] C4 PATCH 只改 description/lineNo → 不重定价（repricing=false），仅更新字段 + Revision
- [ ] C5 PATCH 带 unitPrice → 被 schema 忽略
- [ ] C6 PATCH 旧 version → 409
- [ ] C7 CONFIRMED 状态 PATCH 行 → 409 SALES_ORDER_NOT_EDITABLE
- [ ] C8 重定价失败（PRICE_NOT_FOUND）→ 400 SALES_ORDER_PRICE_FAILED，无半更新
- [ ] C9 重定价后 quotationLineId 仍保留（溯源永不清除）
- [ ] C10 行不存在 / 不属于该 SO → 404 SALES_ORDER_LINE_NOT_FOUND
- [ ] C11 无 POST/DELETE lines 端点（Line 来自 Convert，不开放追加/删除）

### 3.4 修订 / 快照（只读）
- [ ] D1 GET revisions → 200，revisionNo desc
- [ ] D2 头/行 PATCH 后 revisions 增加（revisionNo+1，changeReason 记录）
- [ ] D3 GET snapshots → 200，generatedAt desc
- [ ] D4 convert 生成 CREATED 快照；confirm 生成 CONFIRMED；cancel 生成 CANCELLED
- [ ] D5 快照 snapshotData 金额为字符串（Decimal toString，非 number）

### 3.5 Action API
- [ ] E1 confirm 成功（DRAFT）→ 200 {status:CONFIRMED} + CONFIRMED 快照 + SalesOrderConfirmed
- [ ] E2 confirm 非 DRAFT → 409 SALES_ORDER_INVALID_STATE
- [ ] E3 confirm 不创建 WorkflowInstance（不重复审批，锁定项③）
- [ ] E4 cancel 成功（DRAFT）→ 200 {status:CANCELLED} + CANCELLED 快照 + SalesOrderCancelled
- [ ] E5 cancel 成功（CONFIRMED）→ 200 CANCELLED
- [ ] E6 cancel 已交付/完成状态 → 409 SALES_ORDER_INVALID_STATE

### 3.6 Workflow 条件触发（Sprint 4B 新增）
- [ ] F1 无 SALES_ORDER 策略时：头/行 PATCH 商业字段 → 编辑成功且不创建 WorkflowInstance（skipped=no-policy，不阻塞）
- [ ] F2 有 SALES_ORDER 策略 + rule 命中金额区间 → 创建 WorkflowInstance（businessType="sales-order"，RUNNING + SUBMIT action/history + 首步审批人），SO 回写 workflowInstanceId + approvalStatus=PENDING
- [ ] F3 已有实例（单一实例模型 @@unique([businessType,businessId])）→ 不重复创建（skipped=instance-exists）
- [ ] F4 只改 remark（非商业字段）→ 不触发（skipped=no-commercial-change）
- [ ] F5 Workflow COMPLETED → syncSalesOrderApproval 回写 approvalStatus=APPROVED + approvedAt/approvedById
- [ ] F6 Workflow REJECTED → 回写 approvalStatus=REJECTED
- [ ] F7 审批动作复用 POST /api/workflows/instances/:id/actions（businessType="sales-order" 分支生效）

### 3.7 Quotation → SO 转换（唯一入口）
- [ ] G1 ACCEPTED + 未过期 + 未转换 → 200，SO 创建（DRAFT，code=SO 前缀 6 位），Line 复制（继承价格 + priceSnapshotId + quotationLineId），CREATED 快照，Quotation 回写（salesOrderId/convertedAt/convertedById/status=CONVERTED），双事件（QuotationConverted + SalesOrderCreated）
- [ ] G2 非 ACCEPTED → 409 QUOTATION_INVALID_STATE
- [ ] G3 过期 → 409 QUOTATION_EXPIRED
- [ ] G4 已转换（salesOrderId 非空）→ 409 QUOTATION_ALREADY_CONVERTED
- [ ] G5 并发转换 → 稳定 409（唯一约束冲突兜底）
- [ ] G6 convert 不重新定价（SO Line 价格 = Quotation Line 价格，同一 priceSnapshotId）
- [ ] G7 无有效行 → 409 QUOTATION_NO_LINES
- [ ] G8 convert 无 sales-order:create 权限要求（走 quotation:convert 权限）

## 4. EVENTS 实现差异说明（EVENTS.md v1.4 对齐）

| 事件 | 状态 | 说明 |
| --- | --- | --- |
| SalesOrderCreated / SalesOrderUpdated / SalesOrderConfirmed / SalesOrderCancelled / SalesOrderApprovalStarted | ✅ 已发布 | 事件总线未落地（Known Risk），当前以 AuditLog 留痕（action=eventType），总线落地后替换 |
| SalesOrderDeliveryStarted / SalesOrderDelivered / SalesOrderCompleted | ⏳ 注册待实现 | Sprint 4C/4D Delivery 聚合联动（本阶段禁止开发 Delivery/Invoice/Payment） |
| 审批事件（SalesOrderApproved/Rejected） | ⏳ AuditLog 留痕 | EVENTS.md 未注册领域事件，sync 内以 publishSalesOrderEvent 留痕（投影回写为主） |

## 5. 已知风险与边界

- 事件总线未落地：事件以 AuditLog 留痕，总线落地后需替换 publishSalesOrderEvent 实现
- SalesOrderSnapshotType 无 APPROVED 节点（仅 CREATED/CONFIRMED/CANCELLED）——审批终态只回写投影、不生成快照
- PARTIALLY_DELIVERED/DELIVERED/COMPLETED 为投影状态，事实源在后续 Delivery 模块（本阶段不实现）
- CONFIRMED 后禁止直接改数量/UOM，订单变更需后续 amendment/change-order action（本阶段未实现）
- ApprovalPolicy.module="SALES_ORDER" 未在 seed 预置——策略配置后 Workflow 条件触发自动生效；未配置时编辑不受影响
- 乐观锁 version 覆盖头与行（PATCH 必带）；confirm/cancel 无版本校验（仅状态校验）
- 本阶段未开发 Delivery / Invoice / Payment（按 CTO 指示只做接口预留）

## 6. 验收标准（对照 ACCEPTANCE_STANDARD.md）

- [ ] 唯一创建入口成立：无 POST /api/sales-orders，SO 全部经 convert（quotationId 必填）
- [ ] 价格红线成立：任何入口无法直接写入 unitPrice（schema 层禁止 + 重定价仅经 PricingEngine）
- [ ] 溯源成立：SO Line 保留 quotationLineId + priceSnapshotId（重定价更新 priceSnapshotId、不清 quotationLineId）
- [ ] convert 并发安全：行锁 + 原子取号 + 唯一约束冲突 → 409
- [ ] Workflow 为唯一审批事实源（无 SalesOrderApproval 表）；confirm 不重复审批；关键商业字段变更触发新审批
- [ ] Revision 全部系统生成（无自由编辑端点）；Snapshot 仅固化节点生成（只读端点）
- [ ] Snapshot 金额 Decimal 字符串，禁止 toNumber()
- [ ] 软删除 + 审计贯穿所有写操作
- [ ] 错误码符合 ERROR_CODES.md（SALES_ORDER_* 6 码 + VERSION_CONFLICT + 409 语义）
