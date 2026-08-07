# CHANGELOG

所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased] - Sprint 4A Quotation Foundation（2026-08-07，PR #12 已合并，未打 Tag）

### 新增（Sprint 4A：Quotation Foundation，PR #12）

- **Quotation 报价领域**：Quotation / QuotationLine / QuotationRevision / QuotationSnapshot（+4 模型 / +3 枚举，迁移 `0014_quotation_foundation`，仅新增不改既有）
- **定价红线（ADR-0015）**：行价必须来自 `PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId`，schema 无 unitPrice 字段，禁止前端直接改价；quantity/uomId 变更均触发重新定价
- **审批集成（ADR-0016）**：Workflow 为唯一审批事实源（不建 QuotationApproval）；submit 创建 WorkflowInstance，审批终态事务化回写投影 + 生成 APPROVED 快照
- **API**：12 路由文件 / 18 端点（主档 CRUD + lines/revisions/snapshots + submit/accept/cancel/convert，convert 为 Sprint 4B 预留 501）
- **RBAC**：13 权限码（quotation* / quotation-line* / quotation-revision* / quotation-snapshot*）
- **事件**：EVENTS.md v1.3——11 个 Quotation 事件注册，7 个已发布（总线落地前以 AuditLog 留痕）
- **文档**：OpenAPI +12 路径/+26 schemas、docs/qa/Sprint4A_QA.md、docs/test-cases/Quotation_API.md、DOMAIN_MODEL v1.9（第 19 节）、ADR-0015/0016 状态确认 Implemented

### 变更（Sprint 4A 质量门禁）

- 2026-08-07：lint 修复（`import type` 163 处）→ CI #76 全绿；RequestMeta 类型修复；CTO Final Review 3 阻断项修复（QuotationLine PATCH 原子化 / Workflow 投影事务化 + APPROVED 快照 / Snapshot 金额 Decimal.toString()）→ `03efceb` CI #78 全绿

## [v0.5.0-alpha] - 2026-08-07（Sprint 3C：Business Foundation 完整发布，Sprint 3 全部完成）

### 新增（Sprint 3C：Business Foundation）

#### 3C-1 Customer Foundation（PR #7，已合并）

- **Customer 主档**：Customer / CustomerContact / CustomerAddress / CustomerTag / Industry / Tag / CustomerCredit（+7 模型/+4 枚举）
- **迁移**：0009_customer_foundation（仅新增，不改既有表）
- **RBAC**：+7 模块动作级权限，MANAGER 全量
- **API**：customers 主档 CRUD + contacts/addresses/tags/credit 子资源 + industries/tags 字典
- **文档**：ADR-0009、DOMAIN_MODEL v1.6、OpenAPI 13 端点、Sprint3C1_QA.md、test-cases/Customer_API.md
- **统一规范三件套**（Sprint 3C 起）：API_GUIDELINES.md / ERROR_CODES.md / EVENTS.md

#### 3C-2 Supplier Foundation（PR #8，已合并）

- **BusinessPartner 唯一主体 + 角色化**：BusinessPartnerRole（PartnerRoleType：CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING，可无限扩展）
- **Partner 级共享五件套**：PartnerContact / PartnerAddress（PartnerAddressType 含 Billing/Shipping/Registered/Warehouse/Factory）/ PartnerTag / PartnerBankAccount / PartnerCredit
- **Supplier 独有仅三项**：SupplierQualification（QualificationType）/ SupplierCertificate / SupplierSettlement
- **Customer 不返工**：ADR-0011 BusinessPartner Consolidation 规划 Sprint 5 统一迁移
- **迁移**：0010_supplier_foundation（10 表 + 4 枚举，仅新增）
- **RBAC**：+10 模块动作级权限（supplier/supplier-qualification/supplier-certificate/supplier-settlement/business-partner-role/partner-contact/partner-address/partner-tag/partner-bank-account/partner-credit）
- **API**：18 路由文件（suppliers 主档 + 三子资源 + 共享视图 + partner roles）
- **seed**：SUP-0001/0002 + 3 条 PartnerRole（幂等 upsert）
- **文档**：ADR-0010、ADR-0011、DOMAIN_MODEL v1.7、OpenAPI 75 paths/203 schemas、Sprint3C2_QA.md、test-cases/Supplier_API.md
- **Sprint 4 预备（仅设计）**：Sprint4_Quote_Domain / Quote_ERD / Quote_API / Quote_Workflow 四份文档

#### 3C-3 Item Foundation（PR #9，已合并）

- **Item Master（ERP 核心主数据）**：ItemType 10 类枚举 + 五级层级（Category→SubCategory→Series→Model→Variant）+ Identification（OEM/Barcode/QRCode/DrawingNo/Revision）+ 多 UOM（Stock/Purchase/Sales + UomConversion）+ isSalable/isPurchasable/isManufacturable
- **SpecificationDefinition（CTO #2138）**：定义/实例分离（code/name/unit/dataType/isRequired），ItemSpecification.definitionId 关联，过滤/排序/范围查询友好
- **ItemCategory 改 CategoryPath（CTO #2138）**：去 parentId 递归 → 001/001.003/001.003.005（unique），子树 startsWith 查询免递归
- **ItemStatus 与 ItemLifecycle 分离（CTO #2138）**：系统状态 ACTIVE/INACTIVE/LOCKED/ARCHIVED vs 产品生命周期 DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE
- **ItemRevision 独立**：revisionNo/revision/changeSummary/releasedById/releasedAt/status（RELEASED 同步 Item.revision、旧版 SUPERSEDED）
- **SupplierItem**：一个 Item 多供应商（supplierCode/MOQ/LeadTime/Currency/PurchasePrice/isPreferred/Incoterm/PaymentTerm，不建 Item.supplierId 单值字段）
- **ItemCost 只建接口**：costType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT）+ 时间维度 effectiveFrom/effectiveTo/currency/source
- **AttachmentType 统一放 File Center**（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT）
- **迁移**：0011_item_foundation（Item ALTER 加列 + 8 新表，仅新增/加列不改既有列）
- **RBAC**：item 动作级 + 8 子模块（item-category/item-specification/item-uom/item-cost/item-supplier/item-revision/item-tag/item-attachment）
- **API**：18 路由文件（items 主档 + 分类树 + specifications/specification-definitions/uom-conversions/costs/supplier-items/revisions/tags/attachments）
- **文档**：ADR-0012、ADR-0013（Price 设计）、DOMAIN_MODEL v1.8、EVENTS v1.1（ItemCreated 等 5 事件）、Sprint3C3_QA.md、test-cases/Item_API.md、OpenAPI 93 paths/251 schemas
- **Price 前置**：PRICE_STRATEGY.md + MASTER_DATA_DEPENDENCY.md（CTO #2138）

#### 3C-5 Project Foundation（PR #11，已合并）

- **项目领域增强（+1 模型 → 总计 99 模型 / 48 枚举）**：ProjectTag 复用全局 Tag；Project +priority（高/中/低）+ progressPercent（汇总进度）；ProjectProduct +priceSnapshotId（引用 QuotationPriceSnapshot，SetNull）；ProjectOpportunity +convertedAt/convertedBy（唯一转换入口回写）
- **Opportunity → Project 唯一转换入口**：POST /api/project-opportunities/:id/convert 事务（**真实行锁 SELECT ... FOR UPDATE** + DocumentSequence.nextNo **原子 increment** + P2002 兜底 409，并发安全，CTO 架构审核通过）
- **阶段流转集中校验 + 结项规则**：projects transition 集中校验（PATCH 不可改 stage）；结项默认强制阻断 + 双权限（project:close + project:approve）强制结项
- **迁移**：0013_project_foundation（仅新增/加列，不重建既有 14 个 Project 模型）
- **RBAC**：+12 子模块动作级权限（project-stakeholder/member/milestone/task/budget/expense/product/progress/acceptance/closure/tag/attachment）
- **API**：16 路由 / 34 文件（opportunities 主档 + convert；projects 主档 + transition + close；14 个子资源）
- **Domain Events（EVENTS.md 注册）**：ProjectOpportunityConverted / ProjectCreated / ProjectStageChanged / ProjectMemberAssigned / ProjectMilestoneCompleted / ProjectRiskRaised / ProjectRiskClosed / ProjectAccepted / ProjectClosed / ProjectForceClosed
- **文档**：ADR-0014（Accepted）、Sprint3C5_QA.md、test-cases/Project_API.md、OpenAPI 更新

#### 3C-4 Price Foundation（PR #10，已合并）

- **价格领域完整建模（+11 模型 / +9 枚举 → 总计 98 模型 / 49 枚举）**：PricePolicy / PriceRule / PriceListVersion / PartnerPrice / PromotionRule / TaxProfile / TaxRate / TaxProfileRule / ExchangeRate / QuotationPriceSnapshot / PriceAudit
- **PricePolicy 双轨（CTO #2225）**：pricePolicyId FK + policyType 快照（历史价格可解释）；matchStrategy（FIRST_MATCH/BEST_PRICE/LOWEST_PRICE/HIGHEST_PRIORITY/COMBINE）+ stopOnMatch（CTO #2249）
- **PriceRule 独立建模（CTO #2345）**：CUSTOMER_LEVEL/REGION/QUANTITY_BREAK/BRAND/PROJECT_TYPE/CURRENCY/CHANNEL，Pricing Engine 直接执行
- **PartnerPrice 统一**（CTO #2225/#2249/#2345）：partnerRoleType 枚举 + partnerRoleName 快照；priority/approvalRequired（VIP 价可审批）
- **PromotionRule 独立**：PERCENT/AMOUNT + priority/stackable/exclusive（CTO #2225/#2345）
- **TaxProfile 多国复用**：country/region/taxIncluded/rateType（ZERO/SIX/THIRTEEN/EXEMPT/CUSTOM）+ TaxRate 时间维度 + TaxProfileRule 规则（CTO #2249）
- **ExchangeRate 独立维护**（CTO #2249/#2345）：base/quote/rate/effectiveDate 复合唯一 + provider/source/rateType/manualOverride
- **QuotationPriceSnapshot 完整定价链**（CTO #2225/#2249）：Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final + pricingEngineVersion
- **PriceAudit 独立审计**（CTO #2345）：oldPrice/newPrice/reason/approvedBy/workflowInstanceId/effectiveTime
- **PricingEngineService**：resolvePrice() 唯一入口（Policy→Rules→PartnerPrice/PriceList→Promotion→Currency→Tax→Snapshot→Audit），全程 Decimal 禁止 Float，有效期统一 effectiveFrom/effectiveTo
- **迁移**：0012_price_foundation（12 新表 + 92 ALTER，仅新增不改既有表）
- **RBAC**：+10 模块动作级权限（price-policy/price-rule/price-list-version/partner-price/promotion/tax-profile/tax-rate/exchange-rate/pricing-engine/price-audit）
- **API**：10 资源（price-policies/price-rules/price-lists/price-list-versions/partner-prices/promotions/tax-profiles/tax-rates/exchange-rates + **POST /api/pricing/resolve 唯一入口**）
- **Seed（幂等）**：6 策略（STANDARD/VIP/PROJECT/SUPPLIER/PURCHASE/PROMOTION_PRICE）+ 3 规则（Quantity≥100/VIP/华东）+ 3 税档（CN 13%/MY SST/SG GST）+ 6 汇率（PBOC/ECB/Manual）+ Demo Promotion
- **文档**：ADR-0013（Implemented）、OpenAPI 10 资源 + Resolve Price Sequence、Sprint3C4_QA.md（8 关键场景）、test-cases/Price_API.md、ERD 更新

### 已知限制（Known Risks，后续计划）

- Domain Event 目前仅注册，事件总线尚未真正发布（Sprint 4 业务事件驱动前落地）
- File Center 仍只管理元数据，对象存储尚未接入
- Notification 外部渠道（EMAIL/TELEGRAM/WEBHOOK）尚未接入
- Railway 运行级完整回归仍需执行
- BusinessPartner Consolidation（Customer 子模型迁移到 Partner 级共享）仍按 ADR-0011 延后处理（Sprint 5）

## [v0.4.0-alpha] - 2026-08-05

### 新增（Sprint 3B：Platform Capabilities，PR #6，已合并）

- **Audit Center（升级）**：AuditLog +8 字段（beforeData/afterData 快照、requestId/traceId 链路追踪、device/browser、duration、result SUCCESS/FAILURE/PARTIAL）+ AuditResult 枚举；requestMeta() 统一提取；audit-logs API（分页+多维过滤/详情，audit:view 仅 SUPER_ADMIN/ADMIN）
- **Menu Center**：MenuGroup + Menu 树形（RouteMeta 内联：path/icon/sort/hidden/cache/externalLink/permission）；GET /api/menus?tree=true 前端直接读取；递归软删子树
- **Dashboard API**：DashboardWidget / DashboardLayout / DashboardKpi / DashboardChart（4 模型 + 3 枚举），/api/dashboard/widgets|layouts|kpis|charts CRUD；只提供数据 API，页面 Sprint 8 开发
- **File Center**：FileFolder（树）/ File（元数据）/ FileVersion（版本历史）/ FileAttachment（业务附件关联）；files CRUD + versions + preview；file-folders + attachments API；Quotation/Contract/SO/Invoice/Project 统一引用
- **架构冻结**：ARCHITECTURE_BASELINE v1.0（后续调整必须新增 ADR）；docs/test-cases/ 4 份测试用例模板（Audit/Menu/Dashboard/File API）
- **迁移**：0005_audit_upgrade / 0006_menu_center / 0007_dashboard_api / 0008_file_center（+8 模型/+3 枚举）
- **RBAC**：+10 模块（menu/menu-group/dashboard-*/file*/file-folder/file-version/file-attachment）动作级权限，MANAGER 全量
- **文档**：ADR-0005~0008、DOMAIN_MODEL v1.5（按模块拆图 62 模型/29 枚举）、OpenAPI 全端点覆盖（4100+ 行）

### 已知限制（后续计划，非本版本交付）

- File 仅元数据建模（对象存储后续接入）、Preview 白名单判定、Dashboard 无页面（Sprint 8）、承接 3A 未完成项（可视化设计器/真实通知/调度器）、运行级 Railway 验证待执行

## [v0.3.0-alpha] - 2026-08-05

### 新增（Sprint 3A：Workflow Foundation，PR #5，已合并）

- **Workflow Engine（6 模型）**：WorkflowDefinition / WorkflowStep / WorkflowCondition / WorkflowInstance / WorkflowAction / WorkflowHistory（统一动作 SUBMIT/APPROVE/REJECT/RETURN/TRANSFER/DELEGATE/WITHDRAW/TERMINATE/COMMENT；条件结构化 field/operator/value；4 审批模式 SEQUENTIAL/PARALLEL/ANY_ONE/COUNTERSIGN）
- **Approval Engine（7 模型，与 Workflow 解耦）**：Approver / ApproverGroup / ApproverGroupMember / ApprovalDelegate / ApprovalEscalation / ApprovalTimeout / ApprovalReminder
- **Notification（4 模型）**：NotificationTemplate / NotificationMessage / NotificationChannel / NotificationLog（SYSTEM/EMAIL/TELEGRAM/WEBHOOK + WECHAT/DINGTALK 预留）
- **Dictionary（2 模型）**：DictionaryType / DictionaryItem
- **Settings（3 模型）**：SystemSetting / TenantSetting / UserSetting（三层 Key-Value，encrypted 掩码返回）
- **API（12 组端点）**：Workflow Definition 7（list/create/detail/update/delete/publish/archive）+ Workflow Instance 5（list/create/detail/actions/history）+ approver-groups / dictionaries / settings / notification-templates；统一响应/错误格式、Zod 校验、后端权限、AuditLog、乐观锁 version、软删除、Prisma transaction、请求日志
- **迁移**：`0004_workflow_foundation`（22 表 + 11 枚举 + 59 索引 + 13 外键）
- **RBAC**：PERMISSION_MODULES +21 平台模块，动作级权限（view/create/edit/delete/approve/audit/export/import/assign/close），MANAGER 全量
- **Seed 幂等**：SEED_WORKFLOW_DEFINITIONS（QUOTATION_APPROVAL/EXPENSE_APPROVAL）+ SEED_APPROVER_GROUPS（DIRECTORS/FINANCE），稳定 code + upsert
- **文档**：ADR-0004、DOMAIN_MODEL v1.1（模块拆图 + 状态机 + onDelete 策略）、openapi.yaml 全端点覆盖、docs/qa/Sprint3A_QA.md

### 变更

- 新增统一 API 规范层（apps/web/src/lib/api/：errors/response/schemas/logger）+ 工作流引擎纯函数层（lib/workflow/engine.ts）
- 所有新模型带统一审计字段 + 软删除（CTO 规则）

### 已知限制（后续计划，非本版本交付）

- 无可视化流程设计器、无真实外部通知发送、无定时调度器/超时自动升级、Settings 加密为标记+掩码、运行级验证待 Railway 部署

## [v0.2.0-alpha] - 2026-08-05

### 新增（Sprint 2B/2C，PR #4，已合并）

- 中国版主数据：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）
- 项目领域 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- 企业字段补强：BusinessPartner +14、Item +14（品牌/OEM/图号/替代料/MOQ/安全库存等）、PriceList +priceType（9 类价格）、Project +9 财务字段
- DocumentSequence +docType（DocumentType 17 种单据）
- 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close
- 迁移：`0002_master_data_cn` + `0003_project_domain`
- 文档体系：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/（规范目录）

### 变更

- 前端：移除 products/suppliers/materials 占位页，新增 10 个主数据/项目占位页
- 默认税率改为环境变量 `DEFAULT_TAX_RATE`（默认 13，不写死）

## [v0.1.0-alpha] - 2026-08-04

### 新增（Sprint 1，PR #3）

- Monorepo 骨架：pnpm workspace + Turborepo + Next.js 15 App Router
- 认证：JWT（jose HS256）+ bcryptjs，登录/会话接口
- RBAC：User/Department/Role/Permission/UserRole/AuditLog 6 模型
- CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- Railway 部署 + 测试账户

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。
