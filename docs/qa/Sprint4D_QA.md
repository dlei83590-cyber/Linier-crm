# Sprint 4D QA — Invoice Foundation（发票领域：Schema/Migration 0017 + Seed/RBAC + Create/Partial/Consolidated Billing + Issue/Cancel + 查询 API + Workflow 集成）

> Sprint：4D | 模块：Invoice Foundation（已通过代码门禁） | PR：#15（feature/sprint4-sales，待验收合并） | 日期：2026-08-08
> 状态：✅ 代码门禁通过（CI 全绿：Phase 1 #31192127210 / Phase 2 #31193316359 / Phase 3 #31199349323 / Phase 4 #31201507334 #31201664772 #31202368518）；文档收尾后交 CTO Final Review
> 关联：ADR-0019（Invoice Domain，Approved with Changes 96/100）、Sprint4D_Invoice_Design.md、EVENTS.md v1.7（v1.8 更新中）、openapi.yaml（Invoice 8 端点）、ERROR_CODES.md
> 架构原则（CTO Review 96/100 锁定）：
> ① Invoice 唯一来源 Delivery——禁 Direct Invoice（无 POST /api/invoices），唯一入口 `POST /api/deliveries/{id}/invoice`；
> ② Partial Billing 允许——DeliveryLine 加 invoicedQty/remainingInvoiceQty 投影，开票 qty>0 且 ≤ remainingInvoiceQty，否则 409 INVOICE_QUANTITY_EXCEEDED（真实行锁 FOR UPDATE）；
> ③ Consolidated Invoice 允许——primaryDeliveryId + deliveryIds[]，Customer/Currency/TaxProfile/PaymentTerm 必须一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE；
> ④ 禁止编辑 Line——InvoiceLine 系统生成只读（无 lines PATCH）；
> ⑤ 仅 DRAFT 可取消——ISSUED+ 走 Credit Note（后续阶段，不提供 VOID）；
> ⑥ Invoice.code 可空（必改①）——DRAFT 不占号 code=NULL，仅 ISSUE 时 DocumentSequence 取号 INV-2026-000123；并发 issue 第二个请求稳定 409 不消耗编号（FOR UPDATE 锁 + status 校验）；
> ⑦ InvoiceSnapshot 含完整税务/汇率快照（必改②）——taxProfileId/taxRate/sstNo/currencyRate/exchangeRate，多年后 100% 还原；
> ⑧ 金额永不重算——四段溯源链取价（DeliveryLine→sourceSalesOrderLineId→SalesOrderLine→priceSnapshotId→QuotationPriceSnapshot），不调用 Pricing Engine；Decimal 全程 Prisma.Decimal，Snapshot JSON 一律 toString() 禁止 toNumber()；
> ⑨ 禁 InvoiceApproval/Attachment/Price 表——Workflow 为唯一审批事实源（复用 ApprovalPolicy(module=INVOICE)→WorkflowDefinition→WorkflowInstance→投影回写）；
> ⑩ 不开发 AR/Payment/Credit Note——paidAmount/balanceAmount 仅投影固定 0（4E 回写）；PartiallyPaid/Paid 事件仅注册不实现。

## 1. 交付范围

### 1.1 API（8 端点，均在 `apps/web/src/app/api/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 创建 | POST `/api/deliveries/{id}/invoice` | **唯一创建入口**：事务内按 id ASC 锁全部来源 Delivery（primary + deliveryIds[] 去重）→ 校验全部 DELIVERED → Consolidated 财务属性一致校验（409 INVOICE_SOURCE_NOT_COMPATIBLE）→ 按 id ASC 锁 DeliveryLine → 防超开票（qty>0 且 ≤ remainingInvoiceQty，409 INVOICE_QUANTITY_EXCEEDED）→ 四段溯源链取价（不调 Pricing Engine）→ Invoice(DRAFT, code=null) + Lines（金额快照复制）→ 回写投影（invoicedQty += qty; remainingInvoiceQty -= qty）→ Revision + CREATED 快照（含税务/汇率）→ AuditLog + InvoiceCreated |
| 主档 | GET `/api/invoices` | 列表（分页 + code/customerId/status/approvalStatus/dateFrom/dateTo/dueDateFrom/dueDateTo/currency/salesOrderId/deliveryId 过滤 + customer/delivery 摘要 + lines 计数；**无 POST**——Direct Invoice 禁止） |
| 主档 | GET `/api/invoices/{id}` | 详情（一次带出：Invoice + Customer + Workflow + Delivery Summary + SalesOrder Summary + Lines + Latest Revision + Latest Snapshot——CTO Phase 4 指令） |
| 主档 | PATCH `/api/invoices/{id}` | 头更新（仅 DRAFT + 乐观锁 version；**严格限制 remark/dueDate/paymentTerm**——schema 无 reference 列；变更生成 Revision + InvoiceUpdated；paymentTerm/dueDate 变更触发重审） |
| 行 | GET `/api/invoices/{id}/lines` | 行列表（含 item + priceSnapshot；只读，系统生成，无 POST/PATCH） |
| 历史 | GET `/api/invoices/{id}/revisions` | 修订列表（只读，desc） |
| 历史 | GET `/api/invoices/{id}/snapshots` | 快照列表（只读，desc；CREATED/ISSUED/CANCELLED） |
| Action | POST `/api/invoices/{id}/issue` | DRAFT → ISSUED（FOR UPDATE 锁 → DRAFT+有行+total>0+code=null → 审批门禁（有实例须 APPROVED）→ nextInvoiceCode 原子取号 INV-2026-000123 → ISSUED 快照（issuedAt/issuedById 记 snapshotData）→ InvoiceIssued；并发第二个 409 不消耗编号） |
| Action | POST `/api/invoices/{id}/cancel` | 仅 DRAFT → CANCELLED（锁 Invoice → 按 id ASC 锁 DeliveryLine 回滚投影 invoicedQty -= qty / remainingInvoiceQty += qty → CANCELLED 快照 → InvoiceCancelled；ISSUED+ 禁止——走 Credit Note） |

### 1.2 RBAC（权限码，动作级，零新造）
invoice:view / invoice:create（POST /api/deliveries/{id}/invoice）/ invoice:edit（PATCH + issue 编辑语义）/ invoice:approve（issue 映射）/ invoice:close（cancel 映射）
invoice-line:view（行只读）/ invoice-revision:view / invoice-snapshot:view
（seed 中 4 模块 × 10 动作自动生成，SEED_ACTION_MODULES 已注册 invoice/invoice-line/invoice-revision/invoice-snapshot）

### 1.3 Domain Events（EVENTS.md v1.7 注册 5 个，本阶段已发布 3 个）
已发布：InvoiceCreated / InvoiceIssued / InvoiceCancelled
注册待 4E 实现：InvoicePartiallyPaid / InvoicePaid（先注册后开发，CTO 启动令）

## 2. 测试要点（CTO 锁定项覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 唯一创建入口 | `POST /api/invoices` 不存在（404/405）；Invoice 只能经 `POST /api/deliveries/{id}/invoice` 创建 | 路由结构（无 POST）+ deliveries/[id]/invoice/route.ts |
| T2 | 来源必须 DELIVERED | 来源 Delivery status ≠ DELIVERED → 409 INVOICE_INVALID_STATE（仅已确认收货可开票） | deliveries/[id]/invoice/route.ts |
| T3 | Partial Billing 防超开票 | 开票 qty > remainingInvoiceQty → 409 INVOICE_QUANTITY_EXCEEDED（锁内读 remainingInvoiceQty，禁止事务外读算写） | deliveries/[id]/invoice/route.ts（事务第 5 步） |
| T4 | Consolidated 财务属性一致 | 多 Delivery 的 Customer/Currency/TaxProfile/PaymentTerm 不一致 → 409 INVOICE_SOURCE_NOT_COMPATIBLE | deliveries/[id]/invoice/route.ts（事务第 3 步） |
| T5 | 开票投影回写 | 创建成功 → DeliveryLine.invoicedQty += qty / remainingInvoiceQty -= qty；cancel 回滚（+=/-= 对称） | create + cancel 路由 |
| T6 | DRAFT 不占号 | 创建后 Invoice.code = NULL（不消耗 DocumentSequence 编号） | create 路由（code 不写） |
| T7 | Issue 原子取号 | issue 时 DocumentSequence 原子 increment 取号 INV-2026-000123；code 唯一约束 | issue 路由 + nextInvoiceCode |
| T8 | 并发 issue 不消耗编号 | 两个并发 issue 同一 Invoice：一个成功取号，第二个稳定 409（FOR UPDATE 锁 + status 校验） | issue 路由 |
| T9 | ISSUED 后禁止 Cancel | cancel 非 DRAFT → 409 INVOICE_INVALID_STATE（ISSUED+ 走 Credit Note） | cancel 路由 |
| T10 | 金额永不重算 | InvoiceLine 金额 = 复制 DeliveryLine 溯源 SalesOrderLine 价格快照（priceSnapshotId/unitPrice/discountRate/lineAmount/taxAmount/totalAmount）；代码无 Pricing Engine 调用 | deliveries/[id]/invoice/route.ts（四段溯源链） |
| T11 | Decimal 字符串快照 | Snapshot snapshotData 金额一律 toString()；代码无 toNumber() | helpers.ts createInvoiceSnapshot |
| T12 | 税务/汇率快照 | CREATED 快照含 taxProfileId/taxRate/sstNo/currencyRate/exchangeRate | createInvoiceSnapshot 参数 |
| T13 | Workflow 审批门禁 | Invoice 命中 INVOICE 审批策略（workflowInstanceId ≠ null）时，仅 approvalStatus=APPROVED 可 issue，否则 409 | issue/route.ts APPROVAL_GATE |
| T14 | PATCH 财务字段限制 | PATCH 只允许 remark/dueDate/paymentTerm；尝试改 quantity/unitPrice/totalAmount/status 等 → 400/409 | invoiceUpdateSchema + [id]/route.ts |
| T15 | 重审逻辑 | paymentTerm/dueDate 变更 → 同事务 maybeTriggerInvoiceApproval（无实例创建 / RUNNING 保持 / 终态复用重新 SUBMIT）；remark 不触发；策略缺失 → 409 INVOICE_WORKFLOW_FAILED 整体回滚 | [id]/route.ts PATCH + lib/invoice/workflow-sync.ts |
| T16 | 并发 Billing 锁序 | 多 Delivery 合并开票按 id ASC 锁（防死锁）；并发对同一 DeliveryLine 开票 → 数量投影串行化 | create 路由锁序 |
| T17 | Line 只读 | GET lines 返回行；无 PATCH/POST lines 路由 | 路由结构 |
| T18 | 审批终态回写投影 | Workflow 终态（COMPLETED→APPROVED / REJECTED→REJECTED）回写 approvalStatus/approvedAt/approvedById；不建 InvoiceApproval 表、不生成 APPROVED 快照 | actions/route.ts invoice 分支 + syncInvoiceApproval |

## 3. 状态机

```
                    ┌─────────────┐
  POST /deliveries/ │  DRAFT      │  code = NULL（不占号）
  {id}/invoice ───► │  (可编辑头)  │  仅 DRAFT 可 PATCH / CANCEL
                    └──────┬──────┘
                           │ issue（审批门禁：命中策略须 APPROVED）
                           ▼
                    ┌─────────────┐
                    │  ISSUED     │  code = INV-2026-000123（原子取号）
                    └──────┬──────┘  ISSUED+ 禁止 Cancel（走 Credit Note）
                           │ 4E Receipt 回写投影（本阶段不实现）
                           ▼
              PARTIALLY_PAID ──► PAID
```

## 4. 测试清单（测试用例详见 docs/test-cases/Invoice_API.md）

- [ ] 权限：invoice* / invoice-line* / invoice-revision* / invoice-snapshot* 无权限 403
- [ ] 创建：唯一入口 / 来源 DELIVERED 校验 / 防超开票 / Consolidated 属性一致 / 投影回写 / 快照税务字段
- [ ] Partial Billing：部分行部分数量开票、剩余量递减、跨多张发票累计不超
- [ ] Consolidated：多 Delivery 合并成功、财务属性不一致 409、行归属校验
- [ ] 查询：列表过滤（含 approvalStatus）/ 详情一次带出 / lines/revisions/snapshots 只读
- [ ] PATCH：仅 DRAFT / 乐观锁 / 字段白名单 / 重审触发与不触发 / INVOICE_WORKFLOW_FAILED
- [ ] Workflow：创建触发审批 / 终态回写 / issue 门禁 / REJECTED 后修改重审 / 终态复用 resubmit
- [ ] Issue：状态机 / 原子取号 / 并发不消耗编号 / ISSUED 快照含 issuedAt
- [ ] Cancel：仅 DRAFT / 投影回滚 / CANCELLED 快照 / ISSUED 禁止
- [ ] Snapshot：CREATED/ISSUED/CANCELLED 三节点 / Decimal 字符串 / 税务汇率快照
- [ ] Audit/Event：InvoiceCreated/Issued/Cancelled 发布 + AuditLog 留痕
- [ ] 并发：并发 issue / 并发 billing 同一 DeliveryLine / 锁序防死锁
- [ ] 边界/错误映射：INVOICE_NOT_FOUND / INVOICE_INVALID_STATE / INVOICE_LINE_NOT_FOUND / INVOICE_QUANTITY_EXCEEDED / INVOICE_SOURCE_NOT_COMPATIBLE / INVOICE_WORKFLOW_FAILED / VERSION_CONFLICT

## 5. 红线核验（Final Review checklist 前置）

- [x] 无 Direct Invoice（无 POST /api/invoices；无 POST /api/deliveries 开票之外的入口）
- [x] 无 Pricing Engine 调用（四段溯源链直接复制价格快照）
- [x] 无 InvoiceApproval / InvoiceAttachment / InvoicePrice 表
- [x] 无 VOID；无 4E 实现（paidAmount/balanceAmount 固定 0 投影）
- [x] 无 Credit Note（ISSUED+ 取消语义后续阶段）
- [x] InvoiceLine 无 PATCH（系统生成只读）
- [x] Migration 0017 纯增量（TYPE 4 / TABLE 4 / ADD COLUMN 2 / UPDATE 1 / INDEX 18 / FK 10；0 违规）
- [x] Decimal 全程 Prisma.Decimal；Snapshot JSON 金额 toString() 无 toNumber()
- [x] code 可空 + issue 原子取号 + 并发 409 不消耗编号
- [x] Snapshot 税务/汇率五字段快照
