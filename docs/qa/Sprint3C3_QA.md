# Sprint 3C-3 QA — Item Foundation（Item Master，ERP 核心主数据）

> Sprint：3C-3 | 模块：Item Master Foundation | PR：#9 | 日期：2026-08-06
> 关联：ADR-0012（Item Master）、ADR-0010（Supplier）、ADR-0008（File Center）、EVENTS.md
> 架构原则（CTO #2075 定稿）：ItemType 10 类分类、五级层级（Category→SubCategory→Series→Model→Variant）、
> 多 UOM（Stock/Purchase/Sales + Conversion）、ItemSpecification KV 表、附件复用 File Center、
> Lifecycle 与 Status 分离、ItemCost 只建接口、SupplierItem 多供应商、ItemRevision 独立留痕、ItemTag 独立 Relation。

## 1. 交付范围

### 1.1 Schema（+7 模型 / +4 枚举 → 总计 86 模型 / 40 枚举）
| 类型 | 模型/枚举 | 说明 |
| --- | --- | --- |
| 枚举 | ItemType | 10 类：FINISHED_GOOD/RAW_MATERIAL/SEMI_FINISHED/PURCHASED_PART/ACCESSORY/SERVICE/CONSUMABLE/ASSET/TOOLING/PACKAGING（原 ItemCategory 6 类升级） |
| 枚举 | ItemStatus | ACTIVE/INACTIVE/LOCKED/ARCHIVED（系统状态，与 Lifecycle 分离） |
| 枚举 | ItemCostType | STANDARD/LAST_PURCHASE/AVERAGE/CURRENT（只建接口） |
| 枚举 | AttachmentType | DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT（统一放 File Center） |
| 枚举 | ItemLifecycle | DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE（原 INTRO/GROWTH/MATURE/DECLINE/EOL 重命名） |
| 主档 | Item（升级） | itemType/categoryId/series/model/variant（五级层级 Level3-5）/barcode/qrCode/revision（Identification）/status/多 UOM（stock/purchase/sales）/isSalable/isPurchasable/isManufacturable |
| 树 | ItemCategory | 两级树（Level1 Category → Level2 SubCategory，自引用，CTO 不设第六层） |
| 子表 | ItemSpecification | key/value/unit/sort KV 表 |
| 子表 | UomConversion | fromUom/toUom/factor（1 from = factor to，@@unique([itemId, fromUomId, toUomId])） |
| 子表 | ItemCost | costType/amount/currency/effectiveFrom/effectiveTo/source（时间维度） |
| 子表 | SupplierItem | itemId+supplierId+supplierCode/moq/leadTime/currency/purchasePrice/isPreferred/incoterm/paymentTerm（一个 Item 多供应商） |
| 子表 | ItemRevision | revisionNo/revision/changeSummary/releasedById/releasedAt/status（DRAFT/RELEASED/SUPERSEDED） |
| 子表 | ItemTag | itemId+tagId（Tag 统一主数据 + PartnerTag/ItemTag/ProjectTag 三张 Relation） |

所有模型带统一审计字段，软删除、禁止物理删除、onDelete 明确。

### 1.2 迁移 0011_item_foundation
- Item 表 ALTER：RENAME COLUMN category→itemType + ADD COLUMN（categoryId/series/variant/barcode/qrCode/revision/status/stockUomId/purchaseUomId/salesUomId/isSalable/isPurchasable/isManufacturable）——**不改既有列，保持 priceListItems/projectProducts/standards 引用稳定**
- 枚举演进：ItemCategory RENAME→ItemType + ADD VALUE 4 个；ItemLifecycle RENAME VALUE 5 个
- FileAttachment ADD COLUMN attachmentType（AttachmentType 枚举，统一放 File Center）
- 7 新表 + 索引 + 外键；仅新增/加列，不重建表

### 1.3 RBAC（+8 子模块）
item（动作级已存在）+ item-category / item-specification / item-uom / item-cost / item-supplier / item-revision / item-tag / item-attachment（MANAGER 动作级全量）。

### 1.4 API（16 路由文件）
| 分组 | 端点 | 权限 |
| --- | --- | --- |
| 主档 | GET/POST /api/items；GET/PATCH/DELETE /api/items/:id | item:* |
| 分类树 | GET/POST /api/item-categories；GET/PATCH/DELETE /:id | item-category:* |
| 规格 | GET/POST /:id/specifications；PATCH/DELETE /:id/specifications/:specId | item-specification:* |
| UOM 换算 | GET/POST /:id/uom-conversions；PATCH/DELETE /:id/uom-conversions/:conversionId | item-uom:* |
| 成本 | GET/POST /:id/costs；PATCH/DELETE /:id/costs/:costId | item-cost:* |
| 供应商物料 | GET/POST /:id/supplier-items；PATCH/DELETE /:id/supplier-items/:supplierItemId | item-supplier:* |
| 版本 | GET/POST /:id/revisions（发布自动 revisionNo+1，同步 Item.revision） | item-revision:* |
| 标签 | GET/POST /:id/tags；DELETE /:id/tags/:tagId | item-tag:* |
| 附件 | GET/POST /:id/attachments（复用 File Center，businessType=item，attachmentType） | item-attachment:* |

### 1.5 seed
SEED_LINEAR_GUIDE_ITEMS 同步：category→itemType、lifecycle 新枚举值（DESIGN/TRIAL/MASS_PRODUCTION）、移除已删字段。

## 2. 验收清单

### 2.1 Schema / 迁移
- [x] 7 新模型 + 4 新枚举；Item 升级（五级层级/Identification/多 UOM/status/业务开关）字段齐全
- [x] 反向关系全部配对（ItemCategory.items/Item.specifications/uomConversions/costs/supplierItems/revisions/tags；UnitOfMeasure stock/purchase/sales + from/toConversions；Tag.itemTags；BusinessPartner.supplierItems；FileAttachment.attachmentType）
- [x] 迁移 0011 仅新增表/加列/枚举演进，未重建既有表；既有 Item 引用（priceListItems/projectProducts/standards/linearGuide）稳定
- [x] 禁止物理删除；统一审计字段齐全

### 2.2 业务规则（CTO #2075 逐条落实）
- [x] ItemType 10 类分类枚举（未来只加枚举值不加字段）
- [x] 五级层级：ItemCategory 两级树 + Item.series/model/variant（Category→SubCategory→Series→Model→Variant）；不设第六层，特殊规格进 ItemSpecification
- [x] Identification：InternalCode(=code)/OEMCode/Barcode/QRCode/DrawingNo/Revision；CustomerCode/SupplierCode 由 SupplierItem 承载（不建 Item.supplierId 单值字段）
- [x] 多 UOM：stockUomId/purchaseUomId/salesUomId（复用 Sprint 2 UnitOfMeasure）+ UomConversion 换算
- [x] 附件复用 File Center：FileAttachment.businessType=item + attachmentType（AttachmentType 枚举统一放 File Center 侧）
- [x] Lifecycle 与 Status 分离：ItemLifecycle（产品生命周期）/ ItemStatus（系统状态）
- [x] ItemCost 只建接口（costType 枚举 + 时间维度 effectiveFrom/effectiveTo/currency/source），不写算法
- [x] SupplierItem：一个 Item 多供应商（@@unique([itemId, supplierId])），isPreferred 唯一，含 MOQ/LeadTime/Currency/PurchasePrice/Incoterm/PaymentTerm
- [x] ItemRevision 独立留痕：revisionNo 自动递增、RELEASED 时同步 Item.revision、旧版本标记 SUPERSEDED
- [x] ItemTag 独立 Relation（不复用 PartnerTag），Tag 统一主数据

### 2.3 API 规范（API_GUIDELINES）
- [x] 统一响应/错误结构；Zod 校验；requestMeta 审计；乐观锁；软删除；transaction；请求日志；ERROR_CODES
- [x] 分类删除保护（有子分类/物料拒绝）；物料删除保护（被价格表/项目引用拒绝）
- [x] 重复校验（换算关系/供应商关联/标签 409；编码唯一）

### 2.4 文档
- [x] ADR-0012（Item Master Foundation，含 CTO 5 决策 + 3 新要求）
- [x] Sprint3C3_Design.md（Schema 草案 + ERD + OpenAPI 草稿 + EVENTS 更新 + 决策确认）
- [x] Sprint3C3_QA.md（本文档）/ test-cases/Item_API.md
- [x] DOMAIN_MODEL v1.8（Item Master ERD）/ OpenAPI +items 端点 / Sprint3.md / EVENTS.md（ItemCreated/ItemUpdated/ItemObsoleted/ItemPriceChanged/ItemRevisionReleased）

## 3. 已知风险 / 后续项
1. 迁移 0011 对 Item 表做 RENAME COLUMN + ADD COLUMN（不改既有列），需要 Railway 运行验证。
2. CustomerCode 关系（CustomerItem）待 Sprint 4 Sales 引入；本项目仅在 SupplierItem 承载 SupplierCode。
3. ItemCost 算法（标准成本/移动平均计算）由 Finance 后续实现，本 Sprint 只建数据接口。
4. 运行级验证待 Railway 部署后执行（本机禁止 install/build/test，CI 远程验证）。

## 4. CI 验证（远程）
- [ ] Quality Gates（Lint/Prisma/Type-check/单测）
- [ ] Build
- [ ] Secret Scanning
