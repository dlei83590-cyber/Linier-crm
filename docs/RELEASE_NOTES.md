# Release Notes

## Sprint 4E-1 — Accounts Receivable Foundation（2026-08-08，PR #16 已合并，未发布 Tag）

> PR: #16（Sprint 4E-1 Accounts Receivable Foundation，feature/sprint4-sales）
> 状态：MERGED（squash f58fd87；未打 Tag；待 Sprint 4 Sales 完整闭环（4E-2 Receipt + 4E-3 CN/DN）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4E-1 Accounts Receivable Foundation **APPROVE & MERGE（98/100）**（CTO Final Review Cover：docs/reviews/Sprint4E1_CTO_Review_Cover.md，Checklist 12 项全部 ✅；Blocking Issues 0；核心架构复核全 PASS）

### Sprint 4E-1 Accounts Receivable Foundation（PR #16，已合并）

- **应收领域模型（余额事实源）**：AccountsReceivable / AccountsReceivableRevision / AccountsReceivableSnapshot（+3 模型 / +3 枚举，迁移 0018_accounts_receivable_foundation，仅新增不改既有；**禁止修改 Invoice 表**——CTO 拍板）；Invoice 1:1 AR（invoiceId @unique）；**Invoice = 单据事实源，AR = 余额事实源**（Invoice 上 paidAmount/balanceAmount 仅投影回写）
- **余额唯一口径（CTO 锁定）**：balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount；服务端唯一计算（computeBalance 单入口），前端禁止 PATCH 金额，由 4E-2 Receipt/4E-3 CN-DN 动作或下游事实表驱动
- **AR 唯一来源 Invoice（拍板①）**：Invoice ISSUED 后同事务自动创建（不延迟，失败整体回滚）；无独立创建端点
- **OVERDUE 惰性投影（拍板②）**：status ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → effectiveStatus = OVERDUE（不落库、不新增 Scheduler，与 Quotation EXPIRED 一致）
- **agingBucket 不存库（必改①）**：effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，属 Projection）
- **Snapshot 来源枚举（必改②）**：snapshotSource = ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL
- **Invoice 删除保护（必改③）**：AR exists → 禁止删除 Invoice（Restrict）；Cancel 也不删 AR，只能 CLOSED
- **Workflow 边界（必改④）**：AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 属 4E-2
- **查询 API（只读）**：GET 列表（含 effectiveStatus 惰性过滤 + 摘要 + 投影）、GET /aging（账龄分析）、GET 详情、GET revisions/snapshots；无 POST/PATCH
- **RBAC**：3 模块×10 动作（accounts-receivable* 全 view 语义）；**事件**：EVENTS.md v1.9（8 个 AR 事件注册，Closed 为 CTO Review 追加）
- **文档**：OpenAPI +5 端点/+13 schemas（161 paths/423 schemas）、Sprint4E1_QA.md（T1-T15）、AccountsReceivable_API.md（76 用例）、DOMAIN_MODEL v1.12（第 23 章）、ADR-0020（Approved with Changes → Accepted + Implemented）、Review Cover
- **质量门禁**：Phase 1-3 全绿（#31206666645/#31206929056/#31207456840）；OpenAPI/QA/TestCases 文档 commit 已推送（#31207456840 后）

## Sprint 4D — Invoice Foundation（2026-08-08，PR #15 已合并，未发布 Tag）

> PR: #15（Sprint 4D Invoice Foundation，feature/sprint4-sales）
> 状态：MERGED（squash cea4162；未打 Tag；待 Sprint 4 Sales 完整闭环（4D Invoice + 4E AR/Payment）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4D Invoice Foundation **APPROVE & MERGE（98/100）**（CTO Final Review Cover：docs/reviews/Sprint4D_CTO_Review_Cover.md，Checklist 14 项全部 ✅；Domain Design 98 / Architecture 98 / Transaction 98 / Pricing 100 / Workflow 98 / Documentation 100）

### Sprint 4D Invoice Foundation（PR #15，已合并）

- **发票领域模型（财务事实源）**：Invoice / InvoiceLine / InvoiceRevision / InvoiceSnapshot（+4 模型 / +4 枚举，迁移 0017_invoice_foundation，仅新增不改既有）；DeliveryLine +2 开票投影列（invoicedQty / remainingInvoiceQty，remainingInvoiceQty 由迁移初始化为 quantity）；Invoice.code 可空（DRAFT 不占号）
- **唯一创建入口（CTO 锁定①）**：无 Direct Invoice（不开放 POST /api/invoices）；`POST /api/deliveries/{id}/invoice`（按 id ASC 锁全部来源 Delivery → 校验 DELIVERED → 按 id ASC 锁 DeliveryLine 防超开票 → 四段溯源链取价 → DRAFT 建头 + 行 → 回写投影 → Revision + CREATED 快照）
- **Partial Billing（CTO 拍板①）**：DeliveryLine 投影支持一张 Delivery 拆多张发票；超开票 409 INVOICE_QUANTITY_EXCEEDED；cancel 对称回滚投影
- **Consolidated Invoice（CTO 拍板②）**：多 Delivery 合并开票，Customer/Currency/TaxProfile/PaymentTerm 必须一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE
- **金额红线（ADR-0019 §4）**：四段溯源链取价（DeliveryLine→sourceSalesOrderLineId→SalesOrderLine→priceSnapshotId→QuotationPriceSnapshot），直接复制价格快照，永不重算、不调用 Pricing Engine
- **编号延后生成（CTO 必改①）**：DRAFT code=NULL 不占号；issue 原子取号 INV-2026-000123；并发 issue 第二个请求稳定 409 不消耗编号
- **快照税务/汇率（CTO 必改②）**：InvoiceSnapshot 含 taxProfileId/taxRate/sstNo/currencyRate/exchangeRate，多年后 100% 还原
- **Lifecycle（CTO 拍板③④）**：DRAFT→ISSUED→（PARTIALLY_PAID/PAID 4E 投影）+ DRAFT→CANCELLED；InvoiceLine 系统生成只读（无 lines PATCH）；仅 DRAFT 可取消（ISSUED+ 走 Credit Note，无 VOID）
- **Workflow 集成**：ApprovalPolicy(module=INVOICE)→WorkflowInstance 单实例；终态回写投影；不建 InvoiceApproval 表；issue 审批门禁（有实例须 APPROVED）；PATCH 重审（paymentTerm/dueDate 变更触发，remark 不触发，策略缺失 409 INVOICE_WORKFLOW_FAILED）
- **查询 API（CTO Phase 4 指令）**：GET 列表（含 approvalStatus 过滤）+ GET 详情一次带出（Customer/Workflow/Delivery/SalesOrder 摘要/Lines/Latest Revision/Snapshot）+ lines/revisions/snapshots 只读 + PATCH 头（仅 DRAFT + 乐观锁 + 严格 remark/dueDate/paymentTerm）
- **API**：8 端点；**RBAC**：4 模块×10 动作（create→invoice:create、issue→invoice:approve、cancel→invoice:close）；**事件**：EVENTS.md v1.8（InvoiceCreated/Issued/Cancelled 已发布；PartiallyPaid/Paid 注册待 4E）
- **文档**：OpenAPI +8 端点/+19 schemas（156 paths/410 schemas）、Sprint4D_QA.md（T1-T18）、Invoice_API.md（137 用例，A-M 13 组）、DOMAIN_MODEL v1.11（第 22 章）、ADR-0019（Accepted+Implemented）、Review Cover
- **质量门禁**：Phase 1-4 全绿（#31192127210/#31193316359/#31199349323/#31201507334/#31201664772/#31202368518）；CI 修复 1 轮（fail helper import）

## Sprint 4C — Delivery Foundation（2026-08-07，PR #14 已合并，未发布 Tag）

> PR: #14（Sprint 4C Delivery Foundation，feature/sprint4-sales）
> 状态：MERGED（squash d1d8106；未打 Tag；待 Sprint 4 Sales 完整闭环（4D Invoice + 4E AR/Payment）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4C Delivery Foundation **APPROVED & MERGE**（CTO Final Review Cover：docs/reviews/Sprint4C_CTO_Review_Cover.md，Checklist 12 项全部 ✅）

### Sprint 4C Delivery Foundation（PR #14，已合并）

- **交付领域模型（交付事实源）**：Delivery / DeliveryLine / DeliveryRevision / DeliverySnapshot（+4 模型 / +4 枚举，迁移 0016_delivery_foundation，仅新增不改既有）；SalesOrderLine +2 投影列（deliveredQty / remainingQty，remainingQty 由迁移初始化为 quantity）；SalesOrder +deliveredAt
- **唯一创建入口（CTO 锁定①）**：无 Direct Delivery；`POST /api/sales-orders/{id}/deliveries`（FOR UPDATE 锁 SO → 校验 CONFIRMED/PARTIALLY_DELIVERED → 原子取号 DO → 显式 lines 建行，分批发货）；不开放 POST /api/deliveries
- **防超交（CTO 锁定②）**：availableQty = orderedQty - confirmedDeliveredQty - openDeliveryQty 事务内动态计算（不新增 allocatedQty 列）；创建/编辑/READY/confirm 均重新校验；超出 → 409 DELIVERY_QUANTITY_EXCEEDED；PATCH 自身行排除当前行
- **Lifecycle（CTO 锁定⑤⑧⑨）**：DRAFT→READY→DISPATCHED→DELIVERED + DRAFT/READY→CANCELLED；READY 后行彻底冻结（不支持重新 ready，错误→cancel→新建）；confirm-delivery 固定 12 步事务（锁 Delivery→锁 SalesOrder→按 id ASC 锁全部源行防死锁→复查行→重新聚合→DELIVERED+POD 投影→DELIVERED 快照→回写 SO Line→聚合 SO→事件）；COMPLETED 仅枚举不提供 /complete
- **POD（CTO 锁定④）**：File Center 存文件 + Delivery 最小投影（podStatus PENDING/RECEIVED/WAIVED + podReceivedAt + podConfirmedById）；不建 DeliveryPOD 表；confirm-delivery POD 门禁（RECEIVED/WAIVED，否则 409）
- **SalesOrder 聚合**：confirm-delivery 后每行回写 deliveredQty/remainingQty，全部行 remainingQty≤0 → SO=DELIVERED+deliveredAt=now，否则有 confirmed → PARTIALLY_DELIVERED（不因 READY/DISPATCHED 提前标记）
- **API**：10 端点（主档 4 + lines 2 + ready/dispatch/confirm-delivery/cancel 4）；**RBAC**：4 模块×10 动作（ready/dispatch→edit、confirm→approve、cancel→close）；**事件**：EVENTS.md v1.6（Delivery 8 事件全部发布）
- **文档**：OpenAPI +10 端点/+20 schemas（148 paths/391 schemas）、Sprint4C_QA.md（T1-T15）、Delivery_API.md（111 用例）、DOMAIN_MODEL v1.10（第 20/21 章，补全 Sales Order 章节）、ADR-0018（Accepted+Implemented）、Review Cover
- **质量门禁**：Phase 1-4 全绿（#31174585598/#31175832377/#31179279069/#31182288149/#31184199449/#31186228815）；CI 修复 2 轮（NextRequest import / 动态段 slug 统一 [id]）

## Sprint 4B — Sales Order Foundation（2026-08-07，PR #13 已合并，未发布 Tag）

> PR: #13（Sprint 4B Sales Order Foundation，feature/sprint4-sales）
> 状态：MERGED（squash 3747eba；未打 Tag；待 Sprint 4 Sales 更完整后统一发布）
> CTO 结论：Sprint 4B Sales Order Foundation **APPROVED**（Final Review 3 阻断项 + 最终复审 1 阻断项全部修复，CI 全绿）

### Sprint 4B Sales Order Foundation（PR #13，已合并）

- **销售订单领域**：SalesOrder / SalesOrderLine / SalesOrderRevision / SalesOrderSnapshot（+4 模型 / +3 枚举，迁移 0015_sales_order_foundation，仅新增不改既有）
- **唯一创建入口（CTO 锁定①）**：无 Direct SO；`POST /api/quotations/{id}/convert` 正式实现（FOR UPDATE 行锁 + 原子取号 + P2002→409；复制 Line 继承价格 + sourceQuotationLineId 溯源，不重新定价）
- **价格红线（CTO 锁定②）**：schema 无 unitPrice；数量/UOM 变更走 `SalesOrderPricingService`（只调 PricingEngine.resolvePrice()，快照不写 quotationLineId 防污染溯源）→ 新 Revision + Snapshot
- **审批联动（CTO 锁定③ + 复审）**：Confirm 不重复审批；关键商业字段变更触发重新审批（无实例创建 / RUNNING 等待 / 终态复用同实例重新 SUBMIT：先失效旧 Approver 再建新 PENDING，清空 approvedAt/approvedById）；Confirm 审批门禁（有实例须 APPROVED 否则 409）
- **状态机**：DRAFT→CONFIRMED→PARTIALLY_DELIVERED→DELIVERED→COMPLETED；DRAFT/CONFIRMED→CANCELLED；交付状态由 Delivery 聚合回写（Sprint 4C，仅投影）
- **API**：8 路由文件 / 10 端点；**RBAC**：8 权限码（无 create）；**事件**：EVENTS.md v1.4（7 注册 / 5 发布）
- **文档**：OpenAPI convert 501→200 + 8 端点 + 16 schemas（139 paths/371 schemas）、Sprint4B_QA.md（T1-T15）、SalesOrder_API.md（A-H）、ADR-0017
- **质量门禁**：lint 修复 → CI #31158155759 全绿；CTO Final Review 3 阻断项修复 → `b68495a` CI #31160760480 全绿；最终复审阻断项修复（旧 Approver 失效 + 投影清空）→ `60a4290` CI #31161908240 全绿

## Sprint 4A — Quotation Foundation（2026-08-07，PR #12 已合并，未发布 Tag）

> PR: #12（Sprint 4A Quotation Foundation，feature/sprint4-sales）
> 状态：MERGED（未打 Tag；待 Sprint 4 Sales 更完整后统一发布）

### Sprint 4A Quotation Foundation（PR #12，已合并）

- **报价领域模型**：Quotation / QuotationLine / QuotationRevision / QuotationSnapshot（+4 模型 / +3 枚举，迁移 0014_quotation_foundation，仅新增不改既有）
- **定价红线（ADR-0015）**：行价必须来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId；schema 无 unitPrice 字段；quantity/uomId 变更均触发重新定价
- **审批集成（ADR-0016）**：Workflow 唯一事实源；submit 创建 WorkflowInstance；审批终态事务化回写投影 + APPROVED 快照；不建 QuotationApproval 表
- **API**：12 路由文件 / 18 端点（主档 CRUD + lines/revisions/snapshots + submit/accept/cancel/convert，convert 预留 501）
- **RBAC**：13 权限码；**事件**：EVENTS.md v1.3（11 注册 / 7 发布，总线前 AuditLog 留痕）
- **文档**：OpenAPI +12 路径/+26 schemas、Sprint4A_QA.md、Quotation_API.md、DOMAIN_MODEL v1.9、ADR-0015/0016 Implemented
- **质量门禁**：lint/type 修复 → CI #76 全绿；CTO Final Review 3 阻断项修复（lines PATCH 原子化 / Workflow 投影事务化 / Snapshot Decimal.toString()）→ CI #78 全绿

## v0.5.0-alpha — Sprint 3C: Business Foundation（2026-08-07 发布）

> PR: #7（3C-1 Customer）、#8（3C-2 Supplier）、#9（3C-3 Item）、#10（3C-4 Price）、#11（3C-5 Project Foundation）已全部合并
> 状态：RELEASED（v0.5.0-alpha：Sprint 3C 完整交付，Sprint 3 全部完成）

### Sprint 3C-1 Customer Foundation（PR #7，已合并）

- **Customer 主档**：Customer / CustomerContact / CustomerAddress / CustomerTag / Industry / Tag / CustomerCredit（+7 模型/+4 枚举）
- 迁移 0009_customer_foundation；RBAC +7 模块；API 13 端点；ADR-0009；DOMAIN_MODEL v1.6；OpenAPI 13 端点；Sprint3C1_QA.md；test-cases/Customer_API.md
- 统一规范三件套（Sprint 3C 起）：API_GUIDELINES.md / ERROR_CODES.md / EVENTS.md

### Sprint 3C-2 Supplier Foundation（PR #8，已合并）

- **BusinessPartner 唯一主体 + 角色化**：BusinessPartnerRole（PartnerRoleType：CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING 无限扩展）
- **Partner 级共享五件套**：PartnerContact / PartnerAddress（PartnerAddressType 含 Billing/Shipping/Registered/Warehouse/Factory）/ PartnerTag / PartnerBankAccount / PartnerCredit
- **Supplier 独有仅三项**：SupplierQualification / SupplierCertificate / SupplierSettlement；Customer 不返工（ADR-0011 规划 Sprint 5 统一迁移）
- 迁移 0010_supplier_foundation（10 表+4 枚举）；RBAC +10 模块；API 18 路由文件；seed SUP-0001/0002 + 3 PartnerRole
- 文档：ADR-0010/0011、DOMAIN_MODEL v1.7（79 模型/37 枚举）、OpenAPI 75 paths/203 schemas、Sprint3C2_QA.md、test-cases/Supplier_API.md
- Sprint 4 预备（仅设计）：Sprint4_Quote_Domain/ERD/API/Workflow 四份文档

### Sprint 3C-3 Item Foundation（PR #9，已合并）

- **Item Master（ERP 核心主数据）**：ItemType 10 类枚举 + 五级层级（Category→SubCategory→Series→Model→Variant）+ Identification（OEM/Barcode/QRCode/DrawingNo/Revision）+ 多 UOM（Stock/Purchase/Sales + UomConversion）+ isSalable/isPurchasable/isManufacturable
- **SpecificationDefinition（CTO #2138）**：定义/实例分离（code/name/unit/dataType/isRequired），ItemSpecification.definitionId 关联，过滤/排序/范围查询友好
- **ItemCategory 改 CategoryPath（CTO #2138）**：去 parentId 递归 → 001/001.003/001.003.005（unique），子树 startsWith 查询免递归
- **ItemStatus 与 ItemLifecycle 分离（CTO #2138）**：系统状态 ACTIVE/INACTIVE/LOCKED/ARCHIVED vs 产品生命周期 DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE
- **ItemRevision 独立**：revisionNo/revision/changeSummary/releasedById/releasedAt/status（RELEASED 同步 Item.revision、旧版 SUPERSEDED）
- **SupplierItem**：一个 Item 多供应商（supplierCode/MOQ/LeadTime/Currency/PurchasePrice/isPreferred/Incoterm/PaymentTerm，不建 Item.supplierId 单值字段）
- **ItemCost 只建接口**：costType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT）+ 时间维度 effectiveFrom/effectiveTo/currency/source
- **AttachmentType 统一放 File Center**（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT）
- 迁移 0011_item_foundation（Item ALTER 加列 + 8 新表，仅新增/加列不改既有列）；RBAC item 动作级 + 8 子模块；API 18 路由文件
- 文档：ADR-0012、DOMAIN_MODEL v1.8（87 模型/40 枚举）、EVENTS v1.1（ItemCreated 等 5 事件）、Sprint3C3_QA.md、test-cases/Item_API.md、OpenAPI 93 paths/251 schemas
- Price 前置：PRICE_STRATEGY.md + MASTER_DATA_DEPENDENCY.md（CTO #2138）

### Sprint 3C-4 Price Foundation（PR #10，已合并）

- **价格领域完整建模（+11 模型 / +9 枚举 → 总计 98 模型 / 49 枚举）**：PricePolicy / PriceRule / PriceListVersion / PartnerPrice / PromotionRule / TaxProfile / TaxRate / TaxProfileRule / ExchangeRate / QuotationPriceSnapshot / PriceAudit
- **PricePolicy 双轨**（pricePolicyId FK + policyType 快照）+ matchStrategy/stopOnMatch（CTO #2249）；**PriceRule 独立建模**（7 类规则，CTO #2345）
- **PartnerPrice 统一**（partnerRoleType 枚举 + partnerRoleName 快照 + priority/approvalRequired）；**PromotionRule 独立**（PERCENT/AMOUNT + priority/stackable/exclusive）
- **TaxProfile 多国复用**（CN 13%/MY SST/SG GST + taxIncluded）+ TaxRate 时间维度 + TaxProfileRule 规则
- **ExchangeRate 独立维护**（base/quote/rate/effectiveDate 复合唯一 + provider/source/rateType/manualOverride）
- **QuotationPriceSnapshot 完整定价链**（Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final）+ **PriceAudit 独立审计**
- **PricingEngineService**：resolvePrice() 唯一入口（Policy→Rules→PartnerPrice/PriceList→Promotion→Currency→Tax→Snapshot→Audit），全程 Decimal 禁止 Float
- 迁移 0012_price_foundation（12 新表 + 92 ALTER，仅新增）；RBAC +10 模块；API 10 资源（含 POST /api/pricing/resolve 唯一入口）
- Seed 幂等：6 策略 + 3 规则 + 3 税档 + 6 汇率 + Demo Promotion
- 文档：ADR-0013（Implemented）、OpenAPI 10 资源 + Resolve Price Sequence、Sprint3C4_QA.md（8 关键场景）、test-cases/Price_API.md、ERD 更新

### Sprint 3C-5 Project Foundation（PR #11，已合并）

- **项目领域增强（+1 模型 → 总计 99 模型 / 48 枚举）**：ProjectTag 复用全局 Tag；Project +priority + progressPercent；ProjectProduct +priceSnapshotId（引用 QuotationPriceSnapshot，SetNull）；ProjectOpportunity +convertedAt/convertedBy
- **Opportunity → Project 唯一转换入口**：convert 事务（**真实行锁 SELECT ... FOR UPDATE** + DocumentSequence.nextNo **原子 increment** + P2002 兜底 409，并发安全）
- **阶段流转集中校验 + 结项规则**：transition 集中校验；结项默认强制阻断 + 双权限（project:close + project:approve）强制结项
- 迁移 0013_project_foundation（仅新增/加列，不重建既有 14 个 Project 模型）；RBAC +12 子模块；API 16 路由 / 34 文件
- Domain Events（EVENTS.md 注册）：ProjectOpportunityConverted / ProjectCreated / ProjectStageChanged / ProjectMemberAssigned / ProjectMilestoneCompleted / ProjectRiskRaised / ProjectRiskClosed / ProjectAccepted / ProjectClosed / ProjectForceClosed
- 文档：ADR-0014（Accepted）、Sprint3C5_QA.md、test-cases/Project_API.md、OpenAPI 更新

### Compatibility / Database / Migration / Breaking Changes

- **Compatibility**：向下兼容 v0.4.0，无 Breaking Changes（Customer 子模型保留兼容，不返工）
- **Database**：新增 33 模型 + 12 枚举（迁移 0009-0013，仅新增不改既有表/列）
- **Migration**：0009_customer_foundation / 0010_supplier_foundation / 0011_item_foundation / 0012_price_foundation / 0013_project_foundation
- **Breaking Changes**：无，全部为新增表、字段、索引、权限及 API

### Known Risks（后续计划）

- Domain Event 目前仅注册，事件总线尚未真正发布（Sprint 4 业务事件驱动前落地）
- File Center 仍只管理元数据，对象存储尚未接入
- Notification 外部渠道（EMAIL/TELEGRAM/WEBHOOK）尚未接入
- Railway 运行级完整回归仍需执行
- BusinessPartner Consolidation（Customer 子模型迁移到 Partner 级共享）仍按 ADR-0011 延后处理（Sprint 5）

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.4.0-alpha — Sprint 3B: Platform Capabilities（2026-08-05）

> PR: #6 — `feature/sprint3-platform-capabilities`（已合并，merge commit e54567e67c）
> 状态：RELEASED（CTO Approve，综合成熟度 99/100）

### Sprint 3B 完成内容

- **Audit Center**：AuditLog +8 字段 + AuditResult 枚举 + requestMeta() + audit-logs API（ISO 审计/操作追溯/审批追踪/安全分析）
- **Menu Center**：MenuGroup + Menu 树 + RouteMeta（icon/sort/hidden/cache/externalLink/permission），前端直接读取
- **Dashboard API**：Widget/Layout/KPI/Chart 四模型，只提供数据 API（Sprint 8 BI 接入）
- **File Center**：File/Folder/Version/Attachment，业务单据统一附件引用
- **架构冻结**：ARCHITECTURE_BASELINE v1.0（调整必须 ADR）
- **迁移 0005-0008**：+8 模型/+3 枚举；**RBAC**：+10 模块动作级权限
- **文档**：ADR-0005~0008、DOMAIN_MODEL v1.5（62 模型/29 枚举）、OpenAPI 4100+ 行、test-cases 4 份

### Compatibility / Database / Migration / Breaking Changes

- **Compatibility**：向下兼容 v0.3.0，无 Breaking Changes
- **Database**：新增 8 模型 + 3 枚举；AuditLog ALTER 加列（不重建表）
- **Migration**：0005_audit_upgrade / 0006_menu_center / 0007_dashboard_api / 0008_file_center
- **Breaking Changes**：无

### Known Risks（后续计划）

- File 仅元数据建模（对象存储后续接入）、Preview 白名单判定、Dashboard 无页面（Sprint 8）、承接 3A 未完成项、运行级 Railway 验证待执行

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.3.0-alpha — Sprint 3A: Workflow Foundation（2026-08-05）

> PR: #5 — `feature/sprint3-platform-foundation`（已合并，merge commit 42ebf22262）
> 状态：RELEASED（CTO 条件批准，已知风险列入后续计划）

### Sprint 3A 完成内容

- **Workflow Engine（6 模型）**：Definition/Step/Condition/Instance/Action/History；统一动作 9 种；条件结构化存储；4 审批模式
- **Approval Engine（7 模型，解耦）**：Approver/ApproverGroup/Member/Delegate/Escalation/Timeout/Reminder
- **Notification（4 模型）**：Template/Message/Channel/Log（渠道建模，真实发送后续）
- **Dictionary（2 模型）+ Settings（3 模型）**：三层 Key-Value，encrypted 掩码
- **API 12 组端点**：统一响应/错误 + Zod + 权限 + 审计 + 乐观锁 + 软删除 + transaction
- **迁移 0004**：22 表 + 11 枚举 + 59 索引 + 13 外键
- **RBAC**：+21 平台模块动作级权限；**Seed 幂等**（稳定 code + upsert）
- **单测 21 用例 + OpenAPI 全端点 + ADR-0004 + ERD（DOMAIN_MODEL v1.1）+ QA 文档**

### Compatibility / Database / Migration

- **Compatibility**：向下兼容 Sprint 2 数据模型，无 Breaking Changes（仅新增表/枚举/权限）
- **Database**：新增 22 表 + 11 枚举，既有表未修改
- **Migration**：`0004_workflow_foundation`（幂等可重放）

### Known Risks（后续计划，未完成项）

- 无可视化流程设计器、无真实邮件/Telegram/Webhook 发送、无定时调度器/超时自动升级、Settings 加密为标记+掩码、运行级 Railway 验证待执行、业务审批页面 Sprint 4+

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.2.0-alpha — Sprint 2: Master Data & Project Domain（2026-08-05）

> PR: #4 — `feature/sprint2-master-data`（已合并，merge commit a00d4223e6）
> 状态：RELEASED（CTO 验收）

### Sprint 2 完成内容

- **中国版主数据**：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）+ PriceList 含税价格体系 + TechnicalStandard/UnitOfMeasure/CommercialTerm/DocumentSequence
- **项目领域 14 模型 + 8 枚举**：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- **企业字段补强（2C）**：BusinessPartner +14、Item +14、PriceList +priceType（9 类价格）、Project +9 财务字段、DocumentSequence +docType（17 种单据）
- **权限动作级设计**：view/create/edit/delete/approve/audit/export/import/assign/close
- **迁移**：`0002_master_data_cn` + `0003_project_domain`
- **文档体系**：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/、CHANGELOG.md

### 验收

- CI：Quality Gates ✅ / Secret Scanning ✅ / Build ✅
- PR #4：merged ✅

## v0.1.0-alpha — Sprint 1: Infrastructure（2026-08-04）

> PR: #3 — `feature/sprint1-infrastructure`（已合并）
> 状态：READY FOR DEPLOYMENT QA（CTO Review 2026-08-04）

### Sprint 1 完成内容

- **Monorepo 骨架**：pnpm workspace + Turborepo 2，`apps/web`（Next.js 15 App Router）+ `packages/{config,shared,types,ui}`
- **工程规范**：ESLint 9 + Prettier + Husky + lint-staged，strict TypeScript
- **Prisma 数据模型（6 个）**：User / Department / Role / Permission / UserRole / AuditLog
- **初始 Migration**：`prisma/migrations/0001_initial`
- **Seed**：Super Admin 角色 + 基础权限 + 默认 Department（ENG）+ 管理员账号
- **认证**：JWT（jose HS256）+ bcryptjs，`/api/auth/login`、`/api/auth/me`
- **健康检查**：`GET /api/health` → 200
- **RBAC**：SUPER_ADMIN/ADMIN/MANAGER/MEMBER/VIEWER

---

历史详细记录见 `docs/releases/`。
