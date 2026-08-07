# Sales Order API 测试用例（Sprint 4B Sales Order Foundation）

> 模块：Sales Order Foundation（convert 唯一入口 + 主档 CRUD + lines + revisions/snapshots + confirm/cancel + Workflow 条件触发）
> 关联：docs/qa/Sprint4B_QA.md、ADR-0015、ADR-0016、ADR-0017、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.4
> 说明：覆盖 8 路由（10 端点）+ convert 实现；重点覆盖 CTO 锁定项：唯一创建入口（无 POST /sales-orders）、
> 价格红线（schema 无 unitPrice、重定价走 PricingEngine）、溯源（quotationLineId 永不清除 + priceSnapshotId 更新）、
> convert 并发安全（行锁 + 原子取号 + P2002→409）、confirm 不重复审批、Workflow 条件触发、乐观锁 409、快照金额 Decimal 字符串。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/sales-orders | 401 AUTHENTICATION_ERROR |
| A2 | 无 sales-order:view | GET /api/sales-orders | 403 FORBIDDEN |
| A3 | 无 sales-order:edit | PATCH /api/sales-orders/:id | 403 |
| A4 | 无 sales-order-line:view | GET /api/sales-orders/:id/lines | 403 |
| A5 | 无 sales-order-line:edit | PATCH /api/sales-orders/:id/lines/:lineId | 403 |
| A6 | 无 sales-order-revision:view | GET /api/sales-orders/:id/revisions | 403 |
| A7 | 无 sales-order-snapshot:view | GET /api/sales-orders/:id/snapshots | 403 |
| A8 | 无 sales-order:approve | POST /api/sales-orders/:id/confirm | 403 |
| A9 | 无 sales-order:close | POST /api/sales-orders/:id/cancel | 403 |
| A10 | 权限码覆盖 8 个 | sales-order* / sales-order-line* / sales-order-revision* / sales-order-snapshot* | 无权限 403 |

## B. 主档 CRUD（/api/sales-orders）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 列表分页+过滤 | GET ?page&pageSize&code&quotationId&customerId&status&dateFrom&dateTo | 200 分页，软删除过滤 |
| B2 | 列表项摘要 | GET | 每项含 customer/quotation 摘要 + lines 计数 |
| B3 | 详情 | GET /:id | 200 含 lines/revisions/snapshots + customer + quotation 摘要 |
| B4 | 详情不存在 | GET /:id（无效 id） | 404 SALES_ORDER_NOT_FOUND |
| B5 | 更新头 | PATCH /:id {paymentTerm, changeReason, version} | 200 version+1，生成 Revision，发布 SalesOrderUpdated |
| B6 | 更新 version 冲突 | PATCH /:id（旧 version） | 409 VERSION_CONFLICT |
| B7 | CONFIRMED 后更新 | PATCH（CONFIRMED 状态） | 409 SALES_ORDER_NOT_EDITABLE（仅 DRAFT，走 amendment） |
| B8 | 更新提交 unitPrice | PATCH /:id 带 unitPrice | 无该字段，被忽略 |
| B9 | 更新商业字段触发审批 | PATCH 改 paymentTerm/incoterm/requestedDeliveryDate | 有 SALES_ORDER 策略时创建 WorkflowInstance |
| B10 | 无 POST 端点 | POST /api/sales-orders | 404（路由不存在，Direct SO 禁止） |

## C. 行管理（/api/sales-orders/:id/lines，定价红线 + 溯源）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 行列表 | GET /lines | 200，含 item + priceSnapshot |
| C2 | 改数量重定价 | PATCH /lines/:lineId {quantity, changeReason, version} | 200：新 priceSnapshotId + 价格回写 + totals 重算 + Revision |
| C3 | 改 UOM 重定价 | PATCH /lines/:lineId {uomId, version} | 200：同 C2（uomId 变化 = 商业条件变化） |
| C4 | 只改 description/lineNo | PATCH /lines/:lineId {description, version} | 200：不重定价（repricing=false），仅字段 + Revision |
| C5 | 提交 unitPrice | PATCH /lines/:lineId 带 unitPrice | 无该字段，被忽略 |
| C6 | 乐观锁冲突 | PATCH /lines/:lineId（旧 version） | 409 VERSION_CONFLICT |
| C7 | CONFIRMED 后改行 | PATCH（CONFIRMED 状态） | 409 SALES_ORDER_NOT_EDITABLE |
| C8 | 定价失败 | PATCH 改数量（物料无价格配置） | 400 SALES_ORDER_PRICE_FAILED，无半更新（DB 保持原状） |
| C9 | 溯源保留 | 重定价后查行 | quotationLineId 仍保留（不清除），priceSnapshotId 为新快照 |
| C10 | 行不存在 | PATCH /lines/:lineId（无效 id） | 404 SALES_ORDER_LINE_NOT_FOUND |
| C11 | 无 POST/DELETE | POST /lines、DELETE /lines/:lineId | 404（Line 来自 Convert，不开放追加/删除） |

## D. 修订 / 快照（只读）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 修订历史 | GET /revisions | 200，revisionNo desc |
| D2 | 修订自动生成 | 头/行 PATCH 后查 /revisions | 新增 revisionNo+1，changeReason 记录 |
| D3 | 快照列表 | GET /snapshots | 200，generatedAt desc |
| D4 | 快照节点 | convert 后 / confirm 后 / cancel 后查 /snapshots | CREATED / CONFIRMED / CANCELLED 各一次 |
| D5 | 快照金额字符串 | GET /snapshots | snapshotData.totalAmount 为字符串（Decimal toString） |
| D6 | 无写端点 | POST/PATCH/DELETE /revisions、/snapshots | 404（只读） |

## E. Action API（confirm / cancel）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | confirm 成功 | POST /:id/confirm（DRAFT） | 200 {status:CONFIRMED} + CONFIRMED 快照 + SalesOrderConfirmed |
| E2 | confirm 非 DRAFT | POST /:id/confirm（CONFIRMED 等） | 409 SALES_ORDER_INVALID_STATE |
| E3 | confirm 不重复审批 | confirm 后查 WorkflowInstance | 不创建（businessType="sales-order" 实例数为 0） |
| E4 | cancel 成功 DRAFT | POST /:id/cancel（DRAFT） | 200 {status:CANCELLED} + CANCELLED 快照 + SalesOrderCancelled |
| E5 | cancel 成功 CONFIRMED | POST /:id/cancel（CONFIRMED） | 200 CANCELLED |
| E6 | cancel 已交付/完成 | POST /:id/cancel（PARTIALLY_DELIVERED 等） | 409 SALES_ORDER_INVALID_STATE |

## F. Workflow 条件触发（Sprint 4B）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 无策略不阻塞 | PATCH 商业字段（无 SALES_ORDER 策略） | 编辑成功，无 WorkflowInstance（skipped=no-policy） |
| F2 | 有策略触发 | PATCH 商业字段（策略 + rule 命中） | 创建 WorkflowInstance（businessType="sales-order"，RUNNING + SUBMIT + 首步审批人），SO 回写 workflowInstanceId + approvalStatus=PENDING |
| F3 | 单一实例去重 | 再次 PATCH（已有实例） | 不重复创建（skipped=instance-exists） |
| F4 | 非商业字段不触发 | PATCH 只改 remark | 不触发（skipped=no-commercial-change） |
| F5 | 审批通过回写 | Workflow COMPLETED | SO approvalStatus=APPROVED + approvedAt/approvedById |
| F6 | 审批驳回回写 | Workflow REJECTED | SO approvalStatus=REJECTED |
| F7 | 复用审批动作 | POST /api/workflows/instances/:id/actions | businessType="sales-order" 分支生效（syncSalesOrderApproval） |

## G. Quotation → SO 转换（唯一入口 POST /api/quotations/:id/convert）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 转换成功 | POST（ACCEPTED + 未过期 + 未转换） | 200：SO 创建（DRAFT，code=SO 前缀 6 位），Line 复制（继承价格 + priceSnapshotId + quotationLineId），CREATED 快照，Quotation 回写（salesOrderId/convertedAt/convertedById/status=CONVERTED），双事件（QuotationConverted + SalesOrderCreated） |
| G2 | 非 ACCEPTED | POST（DRAFT/APPROVED/SENT） | 409 QUOTATION_INVALID_STATE |
| G3 | 过期 | POST（ACCEPTED 但过期） | 409 QUOTATION_EXPIRED |
| G4 | 已转换 | POST（salesOrderId 非空） | 409 QUOTATION_ALREADY_CONVERTED |
| G5 | 并发转换 | 两请求同时 | 稳定 409（唯一约束冲突兜底） |
| G6 | 不重新定价 | 转换后查 SO Line | 价格 = Quotation Line 价格，同一 priceSnapshotId |
| G7 | 无有效行 | POST（Quotation 无行） | 409 QUOTATION_NO_LINES |
| G8 | 权限 | POST（无 quotation:convert） | 403 |
| G9 | 转换后原报价只读 | PATCH 已 CONVERTED 报价 | 409 QUOTATION_NOT_EDITABLE |

## H. 错误码映射（ERROR_CODES.md 对齐）

| 错误码 | 场景 | HTTP |
| --- | --- | --- |
| SALES_ORDER_NOT_FOUND | 主档/行不存在 | 404 |
| SALES_ORDER_NOT_EDITABLE | 非 DRAFT 编辑（CONFIRMED 后） | 409 |
| SALES_ORDER_INVALID_STATE | confirm/cancel 状态不合法 | 409 |
| SALES_ORDER_LINE_NOT_FOUND | 行不存在/不属于该 SO | 404 |
| SALES_ORDER_PRICE_FORBIDDEN | 尝试直接改价（预留） | 403 |
| SALES_ORDER_PRICE_FAILED | 重定价失败 | 400 |
| VERSION_CONFLICT | 乐观锁冲突 | 409 |
| QUOTATION_INVALID_STATE / QUOTATION_EXPIRED / QUOTATION_ALREADY_CONVERTED / QUOTATION_NO_LINES | convert 前置校验 | 409 |
