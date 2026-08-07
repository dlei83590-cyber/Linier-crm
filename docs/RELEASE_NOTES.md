# Release Notes

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
