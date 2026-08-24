# Item API 测试用例（Sprint 3C-3 Item Master）

> 模块：Item Master Foundation（ERP 核心主数据）
> 关联：docs/qa/Sprint3C3_QA.md、ADR-0012、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md
> 说明：以下用例供自动化测试复用；覆盖 items 主档 + 分类树 + 规格/UOM/成本/供应商/版本/标签/附件子资源。
>
> **Phase 1B detail aggregate contract（2026-08-24）**：GET /api/items/:id 除主档字段外必须聚合返回 `sourcingType / bomFinished（成品配方）/ bomComponents（原料被配方使用）/ costBalance（移动加权成本）/ productionOrderFinished（生产外协工单）/ stockProjections（库存余额 SSOT）/ partnerPrices（伙伴价格）/ supplierItems（供应商）`——只读聚合，复用 Item/BOM/SupplierItem/StockProjection/CostBalance/PartnerPrice 权威模型，零字段复制。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 items | GET /api/items | 401 |
| A2 | MEMBER 无 item:create 权限 | POST /api/items | 403 |
| A3 | MANAGER 可访问全部 item:* 动作 | GET/POST/PATCH/DELETE | 200/201 |
| A4 | 子模块权限码（item-category 等 8 模块） | 各子资源 | 无权限 403 |

## B. Items 主档

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建物料（基础字段） | POST /api/items | 201 |
| B2 | 创建物料（itemType 10 类枚举） | POST /api/items（itemType=RAW_MATERIAL） | 201 |
| B3 | 编码重复 | POST /api/items（同 code） | 409 CONFLICT |
| B4 | 五级层级字段（categoryId/series/model/variant） | POST /api/items | 201，层级可查 |
| B5 | 分页+过滤（code/name/itemType/status/categoryId） | GET /api/items | 200，meta 分页 |
| B6 | 详情含分类/多 UOM/规格/成本/供应商/版本/标签 | GET /api/items/:id | 200 全量 include |
| B7 | 更新（乐观锁 version） | PATCH /api/items/:id | 200，version+1 |
| B8 | 更新（version 冲突） | PATCH /api/items/:id | 409 VERSION_CONFLICT |
| B9 | 软删除（子资源级联标记） | DELETE /api/items/:id | 200 `{deleted:true}` |
| B10 | 被价格表/项目引用时删除 | DELETE /api/items/:id（有 priceListItems） | 409 CONFLICT |
| B11 | 删除后查询 | GET /api/items/:id | 404 |
| B12 | status 切换（ACTIVE→LOCKED） | PATCH /api/items/:id | 200；locked 后拒绝编辑（待前端/后端校验） |

## C. ItemCategory 分类树

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 新增 Level1 Category | POST /api/item-categories（level=1） | 201 |
| C2 | 新增 Level2 SubCategory（parentId=Category） | POST /api/item-categories（level=2） | 201 |
| C3 | 三级分类被拒绝（CTO：仅两级） | POST /api/item-categories（parentId=SubCategory） | 409 CONFLICT |
| C4 | 分类列表（level/parentId 过滤 + 子分类/物料计数） | GET /api/item-categories | 200 |
| C5 | 更新分类（乐观锁） | PATCH /api/item-categories/:id | 200 |
| C6 | 删除有子分类的分类 | DELETE /api/item-categories/:id | 409 CONFLICT |
| C7 | 删除分类下存在物料的分类 | DELETE /api/item-categories/:id | 409 CONFLICT |
| C8 | 编码唯一 | POST /api/item-categories（同 code） | 409 |

## D. ItemSpecification（KV 表）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 新增规格（key/value/unit/sort） | POST /api/items/:id/specifications | 201 |
| D2 | 规格列表（sort/specKey 排序） | GET /api/items/:id/specifications | 200 |
| D3 | 更新规格（乐观锁） | PATCH .../specifications/:specId | 200 |
| D4 | 删除规格（软删） | DELETE .../specifications/:specId | 200 |

## E. UOM 换算

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 新增换算（fromUom/toUom/factor） | POST /api/items/:id/uom-conversions | 201 |
| E2 | from==to 拒绝 | POST .../uom-conversions（同 UOM） | 409 |
| E3 | 重复换算关系 | POST .../uom-conversions（同 from/to） | 409 |
| E4 | 换算列表（含 UOM 信息） | GET .../uom-conversions | 200 |
| E5 | 更新/删除换算 | PATCH/DELETE .../uom-conversions/:conversionId | 200 |

## F. ItemCost（接口，不写算法）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 写入成本（costType=STANDARD + 时间维度） | POST /api/items/:id/costs | 201 |
| F2 | 成本列表（costType 过滤） | GET /api/items/:id/costs | 200 |
| F3 | 4 种 costType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT） | POST × 4 | 201 |
| F4 | 更新成本（effectiveFrom/effectiveTo） | PATCH .../costs/:costId | 200 |
| F5 | 删除成本 | DELETE .../costs/:costId | 200 |

## G. SupplierItem（一个 Item 多供应商）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 新增供应商（supplierId=BP-S-0001，type=SUPPLIER） | POST /api/items/:id/supplier-items | 201 |
| G2 | 新增供应商（type=CUSTOMER 拒绝） | POST .../supplier-items（BP-C-0001） | 409 |
| G3 | 重复供应商关联 | POST .../supplier-items（同 supplierId） | 409 |
| G4 | isPreferred 唯一（新优选清除旧优选） | POST 两个 isPreferred=true | 仅一个 true |
| G5 | 供应商物料列表（含 supplier 信息） | GET .../supplier-items | 200 |
| G6 | 更新（MOQ/LeadTime/Currency/PurchasePrice/Incoterm/PaymentTerm） | PATCH .../supplier-items/:id | 200 |
| G7 | 删除供应商关联 | DELETE .../supplier-items/:id | 200 |
| G8 | 商品列表带优选供应商行 | GET /api/items（用户指令 2026-08-21） | 200；每项 supplierItems=take 1（isPreferred desc，采购自动引用） |
| G9 | 优选唯一 | 商品多个供应商行标 isPreferred | 服务端 updateMany 取消其余行，仅一行 isPreferred=true（POST/PATCH 均处理） |
| G10 | 商品表单维护 | 创建商品时随行 POST supplier-items；编辑时增删改 diff | 采购选商品自动带出优选行采购价/付款条款/供应商 |

## H. ItemRevision（版本发布）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 发布版本（revisionNo 自动 +1） | POST /api/items/:id/revisions | 201，revisionNo=1 |
| H2 | 再次发布（revisionNo=2；旧 RELEASED→SUPERSEDED） | POST .../revisions | 201，revisionNo=2 |
| H3 | 发布 RELEASED 同步 Item.revision | POST 后 GET /api/items/:id | item.revision 同步 |
| H4 | 版本历史（revisionNo desc） | GET .../revisions | 200 |

## I. ItemTag（独立 Relation）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | 打标签 | POST /api/items/:id/tags | 201 |
| I2 | 重复标签 | POST .../tags（同 tagId） | 409 |
| I3 | 标签不存在 | POST .../tags（无效 tagId） | 404 |
| I4 | 标签列表（含 tag 信息） | GET .../tags | 200 |
| I5 | 移除标签 | DELETE .../tags/:tagId | 200 |

## J. SpecificationDefinition（CTO #2138 定义/实例分离）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 新增规格定义（code/name/unit/dataType/isRequired） | POST /api/specification-definitions | 201 |
| J2 | 定义列表（分页） | GET /api/specification-definitions | 200 |
| J3 | 定义详情 | GET /api/specification-definitions/:id | 200 |
| J4 | 更新定义（乐观锁） | PATCH .../specification-definitions/:id | 200 |
| J5 | 删除被引用的定义 | DELETE ...（有 ItemSpecification 引用） | 409 |
| J6 | 编码唯一 | POST ...（同 code） | 409 |
| J7 | 规格引用定义（definitionId） | POST /api/items/:id/specifications | 201，definition 可查 |
| J8 | 规格按 definitionId 过滤 | GET .../specifications?definitionId=xxx | 200 |
| J9 | 无效 definitionId | POST .../specifications（无效 id） | 404 |

## K. ItemCategory CategoryPath（CTO #2138 去递归）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| K1 | 新增 Level1（categoryPath=001） | POST /api/item-categories | 201 |
| K2 | 新增 Level2（categoryPath=001.003，父级存在） | POST /api/item-categories | 201 |
| K3 | Level2 父级不存在 | POST（父路径无对应记录） | 404 |
| K4 | 路径唯一 | POST（categoryPath 重复） | 409 |
| K5 | 子树查询（categoryPath=001 → 含 001.003） | GET /api/item-categories?categoryPath=001 | 200，前缀匹配 |
| K6 | 详情含 descendants（startsWith 免递归） | GET /api/item-categories/:id | 200，descendants 数组 |
| K7 | 删除有子树分类 | DELETE /:id（存在 001.003） | 409 |
| K8 | 删除有物料分类 | DELETE /:id | 409 |

## L. ItemAttachment（复用 File Center）



| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 关联附件（fileId + attachmentType=DRAWING） | POST /api/items/:id/attachments | 201，businessType=item |
| J2 | 附件列表（含 file 信息） | GET .../attachments | 200 |
| J3 | 文件不存在 | POST .../attachments（无效 fileId） | 404 |
| J4 | 7 种 AttachmentType 校验 | POST（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT） | 201 |

## M. 通用规范（API_GUIDELINES）

| # | 用例 | 预期 |
| --- | --- | --- |
| K1 | 统一响应结构 | `{success,data,meta}` / `{success:false,error:{code,message}}` |
| K2 | Zod 校验失败 | 400，VALIDATION_001 |
| K3 | requestMeta 审计 | AuditLog 记录 requestId/traceId/ip/device/browser/result |
| K4 | 软删除统一 | 所有 DELETE 置 deletedAt/isActive=false |
| K5 | 分页上限 | pageSize > 100 被钳制 |
| K6 | Item 生命周期事件 | 发布版本/变更触发 ItemCreated/ItemUpdated/ItemRevisionReleased 等事件（EVENTS.md） |
