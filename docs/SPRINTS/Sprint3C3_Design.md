# 3C-3 Item Foundation（Item Master）领域设计（草稿）

> 状态：Requirement → Design（CTO 流水线：PR #8=CI/Review、Item=Requirement→Design、Project/Price=Waiting）
> 分支：待 PR #8（Supplier Foundation）合并后创建 `feature/sprint3-item-foundation`
> 原则：**只做设计，不写实现代码、不提交 PR**（CTO #2064）
> 定位：**Item Master 是 ERP 核心主数据**，Sales / Purchase / Inventory / Warehouse / BOM / Production / Cost / Finance 全部引用它。宁可现在多设计一天，也不要以后重构。

---

> [!NOTE]
> **CTO 最终审阅（#2075）已确认**：① 五级层级采纳（Level1 Category → Level2 SubCategory → Level3 Series → Level4 Model → Level5 Variant，不设第六层，特殊规格进 ItemSpecification）
> ② ItemCost 增加时间维度（effectiveFrom/effectiveTo/currency/source）③ attachmentType 放 File Center 统一 AttachmentType 枚举（Drawing/Certificate/Photo/Manual/3DModel/Video/InspectionReport，全模块共用）
> ④ Item Tag 不复用 PartnerTag，Tag 统一主数据 + PartnerTag/ItemTag/ProjectTag 三张 Relation ⑤ item 权限升级动作级（已存在 item:view/create/edit/delete/approve/audit/import/export/assign/close）
> 新增要求：ItemRevision 独立（含 Status）、SupplierItem 增强（PreferredSupplier/Incoterm/PaymentTerm）、Item Status（Active/Inactive/Locked/Archived）与 Lifecycle 分离。
> 本文档为设计定稿，实现以迁移 0011 / ADR-0012 为准。


## 1. 定位与设计原则

- Item Master 为**唯一物料主档**，全 ERP 引用（销售/采购/库存/仓储/BOM/生产/成本/财务）。
- 所有标识（编码/条码/图号/版本）、单位（多 UOM）、规格（KV 表）、附件（File Center）、生命周期、成本接口、供应商关系（SupplierItem）集中在此。
- 不做算法：成本只建接口（数据源由财务/采购写入）。
- 事件驱动：Item 生命周期事件进 EVENTS.md，Notification/BI/Webhook 监听。

---

## 2. ① Schema 设计（Prisma 草案，不落地）

```prisma
// ============ Sprint 3C-3 Item Foundation（Item Master）============

enum ItemType {
  FINISHED_GOOD    // 成品
  RAW_MATERIAL     // 原材料
  SEMI_FINISHED    // 半成品
  PURCHASED_PART   // 外购件
  ACCESSORY        // 辅料/配件
  SERVICE          // 服务
  CONSUMABLE       // 消耗品
  ASSET            // 资产
  TOOLING          // 工装/模具
  PACKAGING        // 包装材料
}

enum ItemLifecycle {
  DESIGN           // 设计
  TRIAL            // 试产
  MASS_PRODUCTION  // 量产
  DISCONTINUED     // 停产
  OBSOLETE         // 淘汰
}

enum UomUsage {
  STOCK            // 库存单位
  PURCHASE         // 采购单位
  SALES            // 销售单位
}

enum ItemCostType {
  STANDARD         // 标准成本
  LAST_PURCHASE    // 最近采购价
  AVERAGE          // 移动平均
  CURRENT          // 现行成本
}

/// 物料分类（Category → SubCategory 两级树，自引用）
model ItemCategory {
  id          String   @id @default(cuid())
  code        String   @unique
  name        String
  parentId    String?  // SubCategory 指向 Category；Category 的 parentId=null
  parent      ItemCategory? @relation("CategoryTree", fields: [parentId], references: [id], onDelete: Restrict)
  children    ItemCategory[] @relation("CategoryTree")
  level       Int      @default(1) // 1=Category, 2=SubCategory
  sort        Int      @default(0)
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  items       Item[]
  @@index([parentId])
  @@index([deletedAt])
}

/// 物料主档（Item Master，ERP 核心）
model Item {
  id          String   @id @default(cuid())
  code        String   @unique // InternalCode 内部编码（唯一，DocumentSequence 生成）
  name        String   // 品名
  itemType    ItemType // FINISHED_GOOD / RAW_MATERIAL / ...
  lifecycle   ItemLifecycle @default(DESIGN)
  categoryId  String?  // SubCategory（两级树叶子）
  category    ItemCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  series      String?  // 系列（如 SM）
  model       String?  // 型号（如 SMH45）
  variant     String?  // 变型（如 SMH45A 或 SMH45A-R1515）
  // Identification 标识体系（CTO 第三部分）
  // InternalCode = code（唯一主编码）；OEMCode/Barcode/QRCode/DrawingNo/Revision/Version 放主档
  // CustomerCode → 客户物料编码：由客户关系表承载（Sprint 4 Sales 引入 CustomerItem）
  // SupplierCode → 供应商物料编码：由 SupplierItem.supplierCode 承载（一个 Item 多供应商）
  oemCode     String?  // OEM 编码
  barcode     String?  // 条码（唯一）
  qrCode      String?  // 二维码内容
  drawingNo   String?  // 图号（关联 File Center attachmentType=Drawing）
  revision    String?  // 当前图纸/技术版本（如 A、B、1.0）
  // UOM（多单位：库存/采购/销售，复用 Sprint 2 UnitOfMeasure）
  stockUomId    String?
  stockUom      UnitOfMeasure? @relation("StockUom", fields: [stockUomId], references: [id], onDelete: SetNull)
  purchaseUomId String?
  purchaseUom   UnitOfMeasure? @relation("PurchaseUom", fields: [purchaseUomId], references: [id], onDelete: SetNull)
  salesUomId    String?
  salesUom      UnitOfMeasure? @relation("SalesUom", fields: [salesUomId], references: [id], onDelete: SetNull)
  // 业务开关
  isSalable       Boolean @default(true)   // 可销售
  isPurchasable   Boolean @default(true)   // 可采购
  isManufacturable Boolean @default(false) // 可生产
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  specifications ItemSpecification[]
  uomConversions UomConversion[]
  costs          ItemCost[]
  supplierItems  SupplierItem[]
  revisions      ItemRevision[]

  @@index([code])
  @@index([itemType])
  @@index([lifecycle])
  @@index([categoryId])
  @@index([barcode])
  @@index([deletedAt])
}

/// 规格（key/value/unit/sort，独立 KV 表，不建几十个字段）
model ItemSpecification {
  id        String   @id @default(cuid())
  itemId    String
  item      Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  specKey   String   // 规格键（如 精度等级/行程/承载/材质）
  specValue String   // 规格值
  unit      String?  // 单位（可选）
  sort      Int      @default(0)
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@index([itemId])
  @@index([deletedAt])
}

/// UOM 换算（Stock ↔ Purchase ↔ Sales）
model UomConversion {
  id        String   @id @default(cuid())
  itemId    String
  item      Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  fromUomId String   // 源单位
  fromUom   UnitOfMeasure @relation("FromUom", fields: [fromUomId], references: [id], onDelete: Restrict)
  toUomId   String   // 目标单位
  toUom     UnitOfMeasure @relation("ToUom", fields: [toUomId], references: [id], onDelete: Restrict)
  factor    Decimal  @db.Decimal(18, 6) // 换算系数（1 from = factor to）
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([itemId, fromUomId, toUomId])
  @@index([itemId])
  @@index([deletedAt])
}

/// 物料成本（只建接口，不写算法；Finance 引用）
model ItemCost {
  id          String   @id @default(cuid())
  itemId      String
  item        Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  costType    ItemCostType // STANDARD / LAST_PURCHASE / AVERAGE / CURRENT
  amount      Decimal  @db.Decimal(18, 4)
  currency    String   @default("CNY")
  effectiveDate DateTime? // 生效日期
  source      String?  // 数据来源（手工/采购单/财务导入）
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@index([itemId])
  @@index([costType])
  @@index([deletedAt])
}

/// 供应商物料（Item ↔ Supplier 多对多；一个 Item 多个供应商，不建 SupplierId 单值字段）
model SupplierItem {
  id           String   @id @default(cuid())
  itemId       String
  item         Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  supplierId   String   // BusinessPartner type=SUPPLIER/BOTH
  supplier     BusinessPartner @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  supplierCode String?  // 供应商料号
  moq          Decimal? @db.Decimal(18, 4) // 最小起订量
  leadTime     Int?     // 交期（天）
  currency     String   @default("CNY")
  purchasePrice Decimal? @db.Decimal(18, 4) // 采购参考价
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([itemId, supplierId])
  @@index([itemId])
  @@index([supplierId])
  @@index([deletedAt])
}

/// 物料版本发布（图纸/技术版本留痕）
model ItemRevision {
  id           String   @id @default(cuid())
  itemId       String
  item         Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)
  revisionNo   Int      // 版本号（1,2,3...）
  revision     String   // 版本标识（A/B/1.0）
  changeSummary String  // 变更说明
  releasedById String?  // 发布人
  releasedAt   DateTime @default(now())
  // 统一审计字段
  isActive    Boolean  @default(true)
  createdById String?
  updatedById String?
  approvalStatus ApprovalStatus @default(DRAFT)
  version     Int      @default(1)
  deletedAt   DateTime?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)

  @@unique([itemId, revisionNo])
  @@index([itemId])
  @@index([deletedAt])
}
```

**新增枚举**：ItemType / ItemLifecycle / UomUsage / ItemCostType（+4）。
**新增模型**：ItemCategory / Item / ItemSpecification / UomConversion / ItemCost / SupplierItem / ItemRevision（+7）。
**复用**：UnitOfMeasure（Sprint 2）/ BusinessPartner（Sprint 2，type=SUPPLIER/BOTH）/ File Center（Sprint 3B，附件不建表）/ Tag（Sprint 3C-1，可给 Item 打标签）。
**预计 Schema 总量**：86 模型 / 41 枚举。

---

## 3. ② ERD（Item Master，供 DOMAIN_MODEL 更新）

```mermaid
erDiagram
    ItemCategory ||--o{ ItemCategory : parent_sub
    ItemCategory ||--o{ Item : classifies
    Item ||--o{ ItemSpecification : has
    Item ||--o{ UomConversion : converts
    UnitOfMeasure ||--o{ Item : stock_uom
    UnitOfMeasure ||--o{ Item : purchase_uom
    UnitOfMeasure ||--o{ Item : sales_uom
    UnitOfMeasure ||--o{ UomConversion : from
    UnitOfMeasure ||--o{ UomConversion : to
    Item ||--o{ ItemCost : costs
    Item ||--o{ SupplierItem : sources
    BusinessPartner ||--o{ SupplierItem : supplies
    Item ||--o{ ItemRevision : versions
    FileAttachment ||--o{ Item : attaches

    Item {
        string id PK
        string code UK
        string name
        ItemType itemType
        ItemLifecycle lifecycle
        string categoryId FK
        string series
        string model
        string variant
        string oemCode
        string barcode
        string qrCode
        string drawingNo
        string revision
        string stockUomId FK
        string purchaseUomId FK
        string salesUomId FK
        bool isSalable
        bool isPurchasable
        bool isManufacturable
        int version
        datetime deletedAt
    }

    ItemCategory {
        string id PK
        string code UK
        string name
        string parentId FK
        int level
        int sort
        datetime deletedAt
    }

    ItemSpecification {
        string id PK
        string itemId FK
        string specKey
        string specValue
        string unit
        int sort
        datetime deletedAt
    }

    UomConversion {
        string id PK
        string itemId FK
        string fromUomId FK
        string toUomId FK
        Decimal factor
        datetime deletedAt
    }

    ItemCost {
        string id PK
        string itemId FK
        ItemCostType costType
        Decimal amount
        string currency
        datetime effectiveDate
        string source
        datetime deletedAt
    }

    SupplierItem {
        string id PK
        string itemId FK
        string supplierId FK
        string supplierCode
        Decimal moq
        int leadTime
        string currency
        Decimal purchasePrice
        datetime deletedAt
    }

    ItemRevision {
        string id PK
        string itemId FK
        int revisionNo
        string revision
        string changeSummary
        string releasedById
        datetime releasedAt
        datetime deletedAt
    }
```

**层级示例（Category → SubCategory → Series → Model → Variant）**：
```
Linear Guide（Category）
  └── SM（SubCategory）
        └── SMH45（Series）
              └── SMH45A（Model）
                    └── SMH45A-R1515（Variant → Item.code）
```

---

## 4. ③ ADR-0012 要点（Item Master Foundation）

- 决策：Item Master 定位为 ERP 核心主数据（Sales/Purchase/Inventory/Warehouse/BOM/Production/Cost/Finance 全部引用），一次设计到位。
- 决策：ItemType 枚举 10 类（FINISHED_GOOD/RAW_MATERIAL/SEMI_FINISHED/PURCHASED_PART/ACCESSORY/SERVICE/CONSUMABLE/ASSET/TOOLING/PACKAGING），未来不加字段只加枚举值。
- 决策：五级层级 Category→SubCategory→Series→Model→Variant（ItemCategory 两级树 + Item 三级字段），不放 Item Name。
- 决策：标识体系（InternalCode/OEMCode/Barcode/QRCode/DrawingNo/Revision/Version）集中在 Item 主档，图号与 File Center 图纸关联。
- 决策：多 UOM（Stock/Purchase/Sales + UomConversion），复用 Sprint 2 UnitOfMeasure，不建单一 Unit。
- 决策：规格独立 ItemSpecification（key/value/unit/sort），支持导轨/轴承/油缸等任意品类。
- 决策：附件不建表，直接引用 File Center（FileAttachment businessType=item，attachmentType: Drawing/Manual/Certificate/Image/3D Model）。
- 决策：生命周期 Lifecycle（Design/Trial/MassProduction/Discontinued/Obsolete），停产直接控制。
- 决策：ItemCost 只建接口（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT），不写算法，Finance 引用。
- 决策：**不建 SupplierId 单值字段**，建 SupplierItem（itemId+supplierId+supplierCode/MOQ/LeadTime/Currency/PurchasePrice），一个 Item 多供应商。
- 决策：Domain Events 进 EVENTS.md（ItemCreated/ItemUpdated/ItemObsoleted/ItemPriceChanged/ItemRevisionReleased），不后补。

---

## 5. ④ OpenAPI 草稿（Item API 清单，不实现）

| 方法 | 路径 | 权限码 | 说明 |
| --- | --- | --- | --- |
| GET | /api/items | item:view | 分页+过滤（code/name/itemType/lifecycle/categoryId） |
| POST | /api/items | item:create | 创建 Item Master（含 category/series/model/variant） |
| GET | /api/items/:id | item:view | 详情（含 specs/uoms/costs/suppliers/revisions） |
| PATCH | /api/items/:id | item:edit | 更新（乐观锁 version） |
| DELETE | /api/items/:id | item:delete | 软删除（有交易引用时拒绝） |
| GET | /api/items/:id/specifications | item-specification:view | 规格列表 |
| POST | /api/items/:id/specifications | item-specification:create | 新增规格（key/value/unit/sort） |
| PATCH | /api/items/:id/specifications/:specId | item-specification:edit | 更新规格 |
| DELETE | /api/items/:id/specifications/:specId | item-specification:delete | 软删规格 |
| GET | /api/items/:id/uom-conversions | item-uom:view | UOM 换算列表 |
| POST | /api/items/:id/uom-conversions | item-uom:create | 新增换算 |
| GET | /api/items/:id/costs | item-cost:view | 成本列表（按 costType） |
| POST | /api/items/:id/costs | item-cost:create | 写入成本（接口，无算法） |
| GET | /api/items/:id/supplier-items | item-supplier:view | 供应商物料列表 |
| POST | /api/items/:id/supplier-items | item-supplier:create | 新增供应商（supplierId+code/MOQ/LeadTime/Price） |
| DELETE | /api/items/:id/supplier-items/:supplierItemId | item-supplier:delete | 移除供应商 |
| POST | /api/items/:id/revision | item-revision:create | 发布新版本（revisionNo+1，触发 ItemRevisionReleased） |
| GET | /api/items/:id/revisions | item-revision:view | 版本历史 |
| GET/POST | /api/items/:id/attachments | item-attachment:view/create | 附件（复用 File Center，businessType=item） |
| GET/POST | /api/item-categories | item-category:view/create | 分类树 CRUD |
| PATCH/DELETE | /api/item-categories/:id | item-category:edit/delete | 分类更新/删除（有子类/物料时拒绝） |

**权限模块（待建）**：item / item-specification / item-uom / item-cost / item-supplier / item-revision / item-attachment / item-category（8 模块 × 10 动作，MANAGER 全量）。
**注意**：`item` 模块在 PERMISSION_MODULES 中已存在（Sprint 2 主数据），3C-3 为其补全动作级权限；其余 7 模块新增。

---

## 6. EVENTS.md 更新（追加，不后补）

```yaml
# 追加到 EVENTS.md Domain Events 列表
- event: ItemCreated          # 物料创建
  entity: item
  payload: { itemId, code, name, itemType, createdBy, createdAt }
- event: ItemUpdated          # 物料更新
  entity: item
  payload: { itemId, code, changedFields, updatedBy, updatedAt }
- event: ItemObsoleted        # 物料停产/淘汰（lifecycle → DISCONTINUED/OBSOLETE）
  entity: item
  payload: { itemId, code, lifecycle, obsoletedBy, obsoletedAt }
- event: ItemPriceChanged     # 物料成本/价格变更
  entity: item
  payload: { itemId, code, costType, oldAmount, newAmount, currency, changedBy, changedAt }
- event: ItemRevisionReleased # 物料新版本发布
  entity: item
  payload: { itemId, code, revisionNo, revision, changeSummary, releasedBy, releasedAt }
```
监听方：Notification（通知研发/采购）、BI（物料主数据统计）、Webhook（下游系统同步物料档案）。

---

## 7. 流水线状态

| 模块 | 状态 |
| --- | --- |
| Customer | ✅ Closed（PR #7 合并） |
| Supplier | CI / Review（PR #8 CI 全绿 ✅，待 CTO 审核） |
| Item | Requirement → Design（本文档） |
| Project | Waiting |
| Price | Waiting |

## 8. CTO 决策确认（#2075）与实现要点

| 决策项 | CTO 结论 | 实现落点 |
| --- | --- | --- |
| 五级层级 | ✅ 采纳，Level1-5 正式定义，不设第六层 | ItemCategory 树 + Item.series/model/variant；特殊规格进 ItemSpecification |
| ItemCost 时间维度 | ✅ 采纳 + effectiveFrom/effectiveTo/currency/source | ItemCost 表加 4 字段 |
| attachmentType | ✅ 放 File Center 统一 AttachmentType（Drawing/Certificate/Photo/Manual/3DModel/Video/InspectionReport） | FileAttachment.attachmentType（迁移 0011 ALTER 加列） |
| Item Tag | ✅ 不复用 PartnerTag；Tag 主数据 + PartnerTag/ItemTag/ProjectTag | 新增 ItemTag（itemId+tagId） |
| item 权限 | ✅ 升级动作级（与 Workflow 一致） | item 模块动作级已存在；新增 7 子模块 |
| ItemRevision | ✅ 独立表 + Status | ItemRevision（revisionNo/revision/changeSummary/releasedBy/releasedAt/status） |
| SupplierItem | ✅ 增强 PreferredSupplier/LeadTime/MOQ/Incoterm/PaymentTerm | SupplierItem 加 5 字段 |
| Item Status | ✅ 与 Lifecycle 分离（Active/Inactive/Locked/Archived） | Item.status（ItemStatus 枚举） |
