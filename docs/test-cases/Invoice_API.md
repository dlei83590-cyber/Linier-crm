# Invoice API 测试用例（Sprint 4D Invoice Foundation）

> 模块：Invoice Foundation（创建/Partial/Consolidated Billing + Issue/Cancel + 查询 API + Workflow 集成）
> 关联：docs/qa/Sprint4D_QA.md、ADR-0019、Sprint4D_Invoice_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.7
> 说明：覆盖 8 端点；重点覆盖 CTO Review 96/100 锁定项：唯一创建入口（无 POST /api/invoices，唯一入口 POST /api/deliveries/{id}/invoice）、
> Partial Billing（DeliveryLine 投影 invoicedQty/remainingInvoiceQty 防超开票 409）、Consolidated Invoice（财务属性一致校验 409）、
> DRAFT 不占号（code=NULL）+ Issue 原子取号（INV-2026-000123）+ 并发 409 不消耗编号、Cancel 释放开票投影、金额永不重算（四段溯源链，
> 不调 Pricing Engine）、Decimal 全程无 Float、Snapshot 税务/汇率快照 + 金额 toString()、Workflow 审批门禁、PATCH 财务字段限制 + 重审逻辑。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/invoices | 401 AUTHENTICATION_ERROR |
| A2 | 无 invoice:view | GET /api/invoices | 403 FORBIDDEN |
| A3 | 无 invoice:view | GET /api/invoices/:id | 403 |
| A4 | 无 invoice:create | POST /api/deliveries/:id/invoice | 403 |
| A5 | 无 invoice:edit | PATCH /api/invoices/:id | 403 |
| A6 | 无 invoice:approve | POST /api/invoices/:id/issue | 403 |
| A7 | 无 invoice:close | POST /api/invoices/:id/cancel | 403 |
| A8 | 无 invoice-line:view | GET /api/invoices/:id/lines | 403 |
| A9 | 无 invoice-revision:view | GET /api/invoices/:id/revisions | 403 |
| A10 | 无 invoice-snapshot:view | GET /api/invoices/:id/snapshots | 403 |
| A11 | 权限码覆盖 4 模块 | invoice* / invoice-line* / invoice-revision* / invoice-snapshot* | 无权限 403 |

## B. 创建（Create，POST /api/deliveries/{id}/invoice）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 唯一入口 | POST /api/invoices | 404（路由不存在，Direct Invoice 禁止） |
| B2 | 创建成功 | POST /api/deliveries/:id/invoice {lines:[{deliveryLineId, quantity}]} | 201，status=DRAFT，code=NULL |
| B3 | 创建后头字段 | 201 响应 | deliveryId/salesOrderId/customerId/currency/taxProfileId/paymentTerm 继承来源 |
| B4 | 创建后金额 | 201 响应 | subtotal/taxAmount/invoiceTotal/balanceAmount 正确（Decimal）；paidAmount=0 |
| B5 | 来源不存在 | POST /api/deliveries/:badId/invoice | 404 DELIVERY_NOT_FOUND |
| B6 | 来源非 DELIVERED | 来源 Delivery=DISPATCHED | 409 INVOICE_INVALID_STATE（仅 DELIVERED 可开票） |
| B7 | 来源已取消 | 来源 Delivery=CANCELLED | 409 INVOICE_INVALID_STATE |
| B8 | 行不存在 | lines[0].deliveryLineId 无效 | 404 INVOICE_LINE_NOT_FOUND |
| B9 | 行不属于来源 | deliveryLineId 属于其他 Delivery | 409 INVOICE_INVALID_STATE（LINE_NOT_IN_SOURCE） |
| B10 | 数量必须为正 | quantity=0 或负数 | 409 INVOICE_INVALID_STATE（QTY_INVALID） |
| B11 | 无行 | lines=[] 或缺失 | 400 校验失败 |
| B12 | 开票后投影回写 | 创建成功 | DeliveryLine.invoicedQty += qty；remainingInvoiceQty -= qty |
| B13 | 创建后 Revision | 201 | 生成 InvoiceRevision（revisionNo=1，CREATED 快照） |
| B14 | 创建后快照 | 201 | InvoiceSnapshot(CREATED) 含 Header+Lines+税务快照（taxProfileId/taxRate/sstNo/currencyRate/exchangeRate） |
| B15 | 创建事件 | 201 | 发布 InvoiceCreated + AuditLog |
| B16 | 金额快照字符串 | 快照 snapshotData | 金额一律字符串（Decimal toString），无 number |
| B17 | 不调用 Pricing Engine | 代码审查 | 无 PricingEngine 调用；金额复制自价格快照 |
| B18 | 四段溯源链 | 行 priceSnapshotId | = DeliveryLine→SalesOrderLine→QuotationPriceSnapshot（priceSnapshotId 复制） |

## C. Partial Billing（部分开票）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 部分数量开票 | 开票 qty < DeliveryLine.quantity | 201；remainingInvoiceQty 正确递减 |
| C2 | 足额开票 | qty = DeliveryLine.quantity | 201；remainingInvoiceQty=0 |
| C3 | 超开票 | qty > remainingInvoiceQty | 409 INVOICE_QUANTITY_EXCEEDED |
| C4 | 超开票不消耗投影 | 409 后 | DeliveryLine.invoicedQty/remainingInvoiceQty 不变 |
| C5 | 分多次累计开票 | 第 1 次 60% + 第 2 次 40% | 两次成功；累计 ≤ 100% |
| C6 | 累计超开票 | 第 1 次 60% + 第 2 次 50% | 第二次 409 INVOICE_QUANTITY_EXCEEDED |
| C7 | 行级混合开票 | 部分行足额 + 部分行部分 | 每行独立校验，各行投影正确 |
| C8 | 剩余可开票量查询 | GET DeliveryLine | remainingInvoiceQty 反映累计开票 |

## D. Consolidated Billing（合并开票）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 多 Delivery 合并成功 | deliveryIds=[d2]（同 customer/currency/taxProfile/paymentTerm） | 201；单 Invoice 含多 Delivery 行 |
| D2 | 财务属性不一致 | d2.customerId 不同 | 409 INVOICE_SOURCE_NOT_COMPATIBLE |
| D3 | 币种不一致 | d2.currency 不同 | 409 INVOICE_SOURCE_NOT_COMPATIBLE |
| D4 | 税率档案不一致 | d2.taxProfileId 不同 | 409 INVOICE_SOURCE_NOT_COMPATIBLE |
| D5 | 付款条款不一致 | d2.paymentTerm 不同 | 409 INVOICE_SOURCE_NOT_COMPATIBLE |
| D6 | 附加来源不存在 | deliveryIds 含无效 id | 404 DELIVERY_NOT_FOUND |
| D7 | 附加来源非 DELIVERED | d2=DISPATCHED | 409 INVOICE_INVALID_STATE |
| D8 | deliveryIds 去重 | deliveryIds=[d2,d2] | 只锁一次，无重复行 |
| D9 | 合并行归属校验 | 行属于 d2 但主来源是 d1 | 正确归属；LINE_NOT_IN_SOURCE 校验按实际 Delivery |
| D10 | 合并金额汇总 | 2 Delivery 各 100 | invoiceTotal=200（子行各自快照金额） |

## E. 查询（Query）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 列表分页 | GET /api/invoices?page&pageSize | 200 分页；软删除过滤 |
| E2 | 列表 code 过滤 | ?code=INV-2026-000123 | 精确匹配 |
| E3 | 列表 customerId 过滤 | ?customerId | 过滤正确 |
| E4 | 列表 status 过滤 | ?status=DRAFT | 过滤正确 |
| E5 | 列表 approvalStatus 过滤 | ?approvalStatus=APPROVED | 过滤正确（CTO Phase 4 指令） |
| E6 | 列表日期过滤 | ?dateFrom&dateTo | 按 invoiceDate 过滤 |
| E7 | 列表到期日过滤 | ?dueDateFrom&dueDateTo | 按 dueDate 过滤 |
| E8 | 列表币种过滤 | ?currency=CNY | 过滤正确 |
| E9 | 列表 salesOrderId 过滤 | ?salesOrderId | 过滤正确（冗余投影列） |
| E10 | 列表 deliveryId 过滤 | ?deliveryId | 过滤正确 |
| E11 | 列表项摘要 | GET /api/invoices | 每项含 customer/delivery 摘要 + lines 计数 |
| E12 | 详情一次带出 | GET /:id | Invoice + Customer + Workflow + Delivery Summary + SalesOrder Summary + Lines（含 item/priceSnapshot）+ Latest Revision + Latest Snapshot |
| E13 | 详情不存在 | GET /:id（无效 id） | 404 INVOICE_NOT_FOUND |
| E14 | 行列表 | GET /:id/lines | 200，含 item + priceSnapshot，lineNo asc |
| E15 | 修订列表 | GET /:id/revisions | 200，revisionNo desc |
| E16 | 快照列表 | GET /:id/snapshots | 200，generatedAt desc |
| E17 | 子资源不存在 | GET /:badId/lines | 404 INVOICE_NOT_FOUND |

## F. PATCH 头更新（仅 DRAFT + 乐观锁 + 字段白名单）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 更新 remark | PATCH /:id {remark, version} | 200 version+1；生成 Revision；发布 InvoiceUpdated |
| F2 | 更新 dueDate | PATCH /:id {dueDate, version} | 200；生成 Revision |
| F3 | 更新 paymentTerm | PATCH /:id {paymentTerm, version} | 200；生成 Revision |
| F4 | 乐观锁冲突 | PATCH（旧 version） | 409 VERSION_CONFLICT |
| F5 | 非 DRAFT 更新 | PATCH（ISSUED 状态） | 409 INVOICE_INVALID_STATE（仅 DRAFT） |
| F6 | 缺 version | PATCH 无 version | 400 校验失败 |
| F7 | 空更新 | PATCH {}（仅 version） | 400（至少一个更新字段） |
| F8 | 禁止改金额 | PATCH {invoiceTotal: 999} | 400/409（schema 无此字段） |
| F9 | 禁止改数量 | PATCH {quantity} | 400（schema 无此字段；行只读） |
| F10 | 禁止改 status | PATCH {status: ISSUED} | 400（状态只能系统动作改） |
| F11 | 禁止改 code | PATCH {code} | 400（取号只能 issue） |
| F12 | remark 不触发重审 | PATCH {remark}（已 APPROVED 状态） | approvalStatus 不变（不重新审批） |
| F13 | paymentTerm 触发重审 | PATCH {paymentTerm 变化} | 同事务 maybeTriggerInvoiceApproval：无实例→创建；终态→重新 SUBMIT |
| F14 | dueDate 触发重审 | PATCH {dueDate 变化} | 同上 |
| F15 | 重审策略缺失 | 无 INVOICE_APPROVAL 策略定义 | 409 INVOICE_WORKFLOW_FAILED（整体回滚，字段不变） |

## G. Workflow（审批集成）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 命中策略创建实例 | 创建 Invoice 且 INVOICE 策略存在 | workflowInstanceId 回写；approvalStatus=PENDING |
| G2 | 审批终态回写 | POST /api/workflows/instances/:id/actions（approve） | Invoice.approvalStatus=APPROVED + approvedAt/approvedById |
| G3 | 驳回回写 | actions（reject） | approvalStatus=REJECTED |
| G4 | 无 InvoiceApproval 表 | 代码审查 | 无 InvoiceApproval 模型/表（Workflow 唯一事实源） |
| G5 | 终态复用 resubmit | 已 APPROVED 后 PATCH paymentTerm | 同 WorkflowInstance 重新 SUBMIT（旧 Approver 失效，新 PENDING） |
| G6 | 审批不生成快照 | 审批终态 | 无 APPROVED 快照（仅 CREATED/ISSUED/CANCELLED） |
| G7 | 审批动作复用 | actions 路由 | businessType="invoice" 分支调用 syncInvoiceApproval |

## H. Issue（DRAFT → ISSUED）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 成功取号 | POST /api/invoices/:id/issue | 200；status=ISSUED；code=INV-2026-000123 |
| H2 | DRAFT 不占号 | 创建后 GET | code=NULL（未消耗编号） |
| H3 | 重复 issue | 再次 issue 同一 Invoice | 409 INVOICE_INVALID_STATE（ALREADY_ISSUED，不消耗第二个编号） |
| H4 | 非 DRAFT issue | CANCELLED 状态 issue | 409 INVOICE_INVALID_STATE |
| H5 | 无行 issue | 空行 Invoice | 409 INVOICE_INVALID_STATE（NO_LINES） |
| H6 | 零金额 issue | invoiceTotal=0 | 409 INVOICE_INVALID_STATE（TOTAL_ZERO） |
| H7 | 审批门禁（未审批） | 有 workflowInstanceId 且 approvalStatus=PENDING | 409 INVOICE_INVALID_STATE（APPROVAL_GATE，仅 APPROVED 可开票） |
| H8 | 审批门禁（被驳回） | approvalStatus=REJECTED | 409 INVOICE_INVALID_STATE（APPROVAL_GATE；需修改后重审） |
| H9 | 审批通过后可开票 | approvalStatus=APPROVED | 200 成功取号 |
| H10 | ISSUED 快照 | issue 成功 | InvoiceSnapshot(ISSUED) 含 issuedAt/issuedById（snapshotData） |
| H11 | 编号格式 | 取号结果 | INV-YYYY-000123（DocumentSequence docType=INVOICE，prefix=INV，padLength=6） |
| H12 | 编号唯一 | 连续 issue 两张 | 两个不同 code；无唯一约束冲突 |
| H13 | issue 事件 | 200 | 发布 InvoiceIssued + AuditLog |

## I. Cancel（仅 DRAFT → CANCELLED）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | 成功取消 | POST /api/invoices/:id/cancel（DRAFT） | 200；status=CANCELLED |
| I2 | 投影回滚 | 取消后查 DeliveryLine | invoicedQty -= qty；remainingInvoiceQty += qty（对称回滚） |
| I3 | 释放后可再开票 | cancel 后重新开票同数量 | 成功（remainingInvoiceQty 已恢复） |
| I4 | ISSUED 禁止取消 | ISSUED 状态 cancel | 409 INVOICE_INVALID_STATE（走 Credit Note） |
| I5 | PAID 禁止取消 | PAID 状态 cancel | 409 INVOICE_INVALID_STATE |
| I6 | 重复取消 | 已 CANCELLED 再 cancel | 409 INVOICE_INVALID_STATE |
| I7 | CANCELLED 快照 | cancel 成功 | InvoiceSnapshot(CANCELLED) 生成 |
| I8 | cancel 事件 | 200 | 发布 InvoiceCancelled + AuditLog |
| I9 | 不存在 | POST /api/invoices/:badId/cancel | 404 INVOICE_NOT_FOUND |

## J. Snapshot（快照体系）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 三节点快照 | 完整生命周期 | CREATED / ISSUED / CANCELLED 各一个（按快照类型） |
| J2 | 快照只读 | GET snapshots | 无 POST/PATCH snapshots 路由 |
| J3 | 税务快照字段 | CREATED/ISSUED 快照 | 含 taxProfileId/taxRate/sstNo/currencyRate/exchangeRate |
| J4 | 金额字符串 | snapshotData | 金额/数量一律字符串（禁止 toNumber） |
| J5 | 快照修订号 | snapshot.revisionNo | 与对应 revision 一致 |
| J6 | 快照可还原 | 多年后按快照重建 | 税务/汇率/金额/行完全一致（CTO 必改②） |

## K. Audit / Event

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| K1 | InvoiceCreated | 创建成功 | 事件发布 + AuditLog 留痕 |
| K2 | InvoiceUpdated | PATCH 成功 | 事件发布 + AuditLog |
| K3 | InvoiceIssued | issue 成功 | 事件发布 + AuditLog（含 code） |
| K4 | InvoiceCancelled | cancel 成功 | 事件发布 + AuditLog |
| K5 | 事件载荷 | 各事件 payload | 含 invoiceId/invoiceCode/deliveryId/customerId（EVENTS.md v1.7 统一载荷） |
| K6 | 4E 事件仅注册 | EVENTS.md | InvoicePartiallyPaid/InvoicePaid ⏳ 注册待实现（4E） |

## L. 并发（Concurrency）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| L1 | 并发 issue 同一发票 | 2 请求同时 issue | 1 成功取号 + 1 稳定 409；DocumentSequence 只 increment 一次 |
| L2 | 并发开票同一 DeliveryLine | 2 请求不同 Invoice 同时开票 | 投影串行化；累计不超 remainingInvoiceQty |
| L3 | 并发超开票 | 2 请求各开 80%（剩余 100） | 1 成功 + 1 409 INVOICE_QUANTITY_EXCEEDED |
| L4 | 多 Delivery 锁序 | Consolidated 开票 | 按 id ASC 锁（防死锁） |
| L5 | PATCH 并发乐观锁 | 2 请求同 version | 1 成功 + 1 409 VERSION_CONFLICT |

## M. 边界 / 错误映射（Boundary / Error mapping）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| M1 | INVOICE_NOT_FOUND | 无效 id 任意端点 | 404 |
| M2 | INVOICE_INVALID_STATE | 状态机不允许流转 | 409 |
| M3 | INVOICE_LINE_NOT_FOUND | 开票行不存在 | 404 |
| M4 | INVOICE_QUANTITY_EXCEEDED | 超开票 | 409 |
| M5 | INVOICE_SOURCE_NOT_COMPATIBLE | Consolidated 属性不一致 | 409 |
| M6 | INVOICE_WORKFLOW_FAILED | 审批策略缺失 | 409（PATCH 重审整体回滚） |
| M7 | DELIVERY_SOURCE_LINE_INVALID | 溯源行无效/已删 | 400 |
| M8 | VERSION_CONFLICT | 乐观锁过期 | 409 |
| M9 | Decimal 精度 | 金额 18,4 / 汇率 18,8 | 全程 Prisma.Decimal，无 Float/Number 转换 |
| M10 | 软删除隔离 | deletedAt 记录不出现在查询 | 过滤正确 |
| M11 | 分页边界 | pageSize>100 | 钳制 100 |
| M12 | 空列表 | 无数据 | 200 空数组 + meta |

## N. 销售侧 GL（ADR-0042，2026-08-20）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| N1 | InvoiceIssued Outbox 原子写 | issue 事务 | 同事务写 OutboxMessage（幂等键 InvoiceIssued|invoiceId），载荷含 subtotal/taxAmount/invoiceTotal |
| N2 | 收入确认凭证 | GL consumer 消费 InvoiceIssued | 借 1122 应收（含税）/ 贷 6001 收入（未税）/ 贷 22210102 销项税（税额）；借贷平衡 |
| N3 | 零税额发票 | taxAmount=0 | 省略销项税行（1122 = 6001） |
| N4 | 金额不一致 | subtotal+tax≠invoiceTotal | 409 GL_UNBALANCED（fail-closed，不静默） |
| N5 | 幂等防重复过账 | 重复消费同事件 | GlJournalEntry @@unique(sourceType,sourceId) 跳过创建 |
| N6 | 收入确认时点 | DRAFT/取消 | 不产生任何 GL 凭证（仅 ISSUE 后） |

> 合计：11（A）+ 18（B）+ 8（C）+ 10（D）+ 17（E）+ 15（F）+ 7（G）+ 13（H）+ 9（I）+ 6（J）+ 6（K）+ 5（L）+ 12（M）+ 6（N）+ 7（O）= **150 用例**

## O. 增值税发票管理（ADR-0043，2026-08-20）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| O1 | 发票类型必填 | issue 缺 invoiceType | 409 INVOICE_TYPE_REQUIRED（I4 fail-closed） |
| O2 | 专票 12+8 校验 | issue SPECIAL_VAT | 格式非法 → 400 TAX_INVOICE_CODE/NO_INVALID；合法 → 通过（I7） |
| O3 | 数电票 20 位且 code 空 | issue ELECTRONIC_VAT | code 非空 → 400；20 位 → 通过 |
| O4 | 开票资料门禁 | customer 未关联 Partner / 无开票资料 | 409 PARTNER_LINK_REQUIRED / PARTNER_INVOICE_INFO_MISSING（I10） |
| O5 | 红字引用 | redInvoiceRefId 指向 DRAFT/红字 | 409 RED_INVOICE_REF_STATUS_INVALID（R2/R6） |
| O6 | 红字金额取反+防超冲 | 红字 issue | 金额=原票取反（R3）；Σ超原票 → 409 RED_INVOICE_OVERFLOW（R4） |
| O7 | 冻结 | ISSUED 后改 VAT 字段 | PATCH schema 不含 VAT 字段（I3 天然冻结） |

## P. 红冲（Red Invoice——用户指令：销售发票应支持红冲，2026-08-20）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| P1 | 蓝票一键红冲 | POST /api/invoices/:id/red-invoice（ISSUED 蓝票） | 200；创建红字 DRAFT（redLetter=true + redInvoiceRefId=原票 id，R1 一致）；复制 header+行（金额快照）；code=null |
| P2 | 非 ISSUED 禁止红冲 | DRAFT/PAID/CANCELLED 原票 | 409 RED_INVOICE_REF_STATUS_INVALID（R2） |
| P3 | 红字禁止再红冲 | redLetter=true 原票 | 409 RED_INVOICE_REF_STATUS_INVALID（R6 禁链式） |
| P4 | 重复红冲 | 已有 ISSUED 红字 | 409 RED_INVOICE_OVERFLOW（R4 预检：全额红冲语义每票一张） |
| P5 | 红字草稿不回写 delivery | red-invoice 后查 DeliveryLine | invoicedQty/remainingInvoiceQty 不变（红字不新增占用） |
| P6 | 红字草稿 issue | 红字 DRAFT issue（不重填引用） | 成功：DB 预填 redInvoiceRefId 回退生效；金额=原票取反（R3）；R4 排除本票不误判 |
| P7 | 红字草稿 issue 跳过 GL | 红字 issue 后查 Outbox | 无 InvoiceIssued Outbox（红字 GL = backlog） |
| P8 | 权限 | 无 invoice:create | 403 |
| P9 | 审计 | red-invoice 后 | AuditLog action=invoice.red-invoice + InvoiceCreated（含 redLetter/redInvoiceRefId/originalCode） |
| P10 | 列表/详情红字标识 | GET 详情 | redLetter=true + redInvoiceRefId 返回；前端展示"红字"标记 |

## Q. 红冲应收回退 + 红字删除（用户指令 2026-08-21）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| Q1 | 红字 ISSUE 回退原票应收 | 红字发票 ISSUE | 不创建独立负 AR；原票 AR.adjustedAmount -= |红字|；balanceAmount=computeBalance 重算；原票 Invoice.balanceAmount 同步；AR Revision+Snapshot(ADJUSTED/ADJUSTMENT) |
| Q2 | 原票应收归零 | 蓝票 113 红冲 113 | 原票 AR.balanceAmount = 0（113 + (-113)） |
| Q3 | 原票 AR 不存在 | 红字 ISSUE 但原票无 AR | 409 CN_DN_SOURCE_NOT_COMPATIBLE（ORIGINAL_AR_NOT_FOUND） |
| Q4 | 红字 DRAFT 删除 | DELETE 红字（DRAFT） | 200 软删；无应收影响 |
| Q5 | 红字 ISSUED 删除=撤销红冲 | DELETE 红字（ISSUED） | 200；原票 AR.adjustedAmount += |红字|（恢复）；原票 Invoice.balanceAmount 恢复；AR Revision+Snapshot |
| Q6 | 蓝票删除保持现状 | DELETE 蓝票（ISSUED） | 409（仅 CANCELLED 可删；红冲只回退应收不改蓝票状态） |
| Q7 | 红字重复删除 | 删除后再次 DELETE | 404 INVOICE_NOT_FOUND（deletedAt 过滤） |
| Q8 | 红字 CANCELLED 删除（用户指令修复） | DELETE 红字（CANCELLED，无关联） | 200 软删（无应收恢复——原票应收已不存在时跳过恢复直接删） |

## R. 反开票撤销（红冲语义修正——用户指令 2026-08-21：红冲=反开票撤销错误开票）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| R1 | ISSUED 蓝票反开票成功 | POST /api/invoices/:id/reverse-issue（ISSUED 未收款） | 200；原票 status=CANCELLED；AR 软删（应收清除）；DeliveryLine.invoicedQty -= qty / remainingInvoiceQty += qty（释放开票数量）；CANCELLED Snapshot(reverseIssue=true) |
| R2 | 非 ISSUED 反开票 | DRAFT/CANCELLED/红字发票 | 409 INVOICE_INVALID_STATE（仅 ISSUED 蓝票可撤销） |
| R3 | 有收款禁止反开票 | paidAmount>0 | 409 INVOICE_INVALID_STATE（先冲销核销） |
| R4 | 有未冲销核销禁止反开票 | ReceiptAllocation reversedAt IS NULL | 409 INVOICE_INVALID_STATE |
| R5 | 红字发票禁止反开票 | redLetter=true | 409 INVOICE_INVALID_STATE |
| R6 | 撤销后可删除清理 | 反开票后 DELETE | 200（CANCELLED 且无 AR → 可删） |
| R7 | 事件/审计 | 反开票后 | AuditLog action=invoice.reverse-issue + InvoiceCancelled（payload 含 reverseIssue=true） |
