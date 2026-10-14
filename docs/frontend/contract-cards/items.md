# Contract Card — 物料管理

- 模块：`items`（基础资料 · 物料管理）
- 判定：**Ready（F2-2 Wave 1 已交付）**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-2 Wave 1
- Backend Contract：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力   | 端点                           | 方法   | 说明                             |
| ------ | ------------------------------ | ------ | -------------------------------- |
| List   | `/api/items`                   | GET    | 分页/筛选（code/name/类别等）    |
| Detail | `/api/items/{id}`              | GET    | 详情（含规格/成本/供应商子资源） |
| Create | `/api/items`                   | POST   | —                                |
| Edit   | `/api/items/{id}`              | PATCH  | CAS version                      |
| Delete | `/api/items/{id}`              | DELETE | —                                |
| Sub    | `/api/items/{id}/revisions` 等 | GET    | 版本/规格/成本/供应商/标签/附件  |

## Permission

- `item:view` / `item:create` / `item:edit`（动作级权限已 seed，RBAC 已注册）

## Status Machine

- 主数据无审批状态机（`isActive` 启用/停用）。**2026-09-27 改造后表单不再提供状态入口**（状态列与 API 保留）

## Selectors（2026-09-27 引用加载修复）

- UOM（`/api/unit-of-measures`，GET FINAL）—— 库存 / 采购 / 销售三处共用
- Item Category（`/api/item-categories`，GET FINAL）
- **取数契约**：每个引用源**独立取数**（`lib/use-reference-options.ts`：独立 loading / error / reload）——**禁止**再用单个 Promise.all 聚合多源（任一源失败会让整组下拉一起空白）；失败必须字段级可见（403 显示缺失权限码、500/网络显示真实 code）+ 可单独重试，禁止静默空列表。
- **联动**：库存单位 → 采购单位 / 销售单位 默认跟随（手工改过即解除该字段跟随，改回空值或与库存单位一致时恢复）；编辑页按详情值推导初始跟随态，不覆盖既有数据。

## Error Codes

- 409：version 冲突（并发编辑）
- 422：校验失败（必填/格式）

## 字段契约（表单，2026-09-27 第 3 轮「继续优化」后为最终形态）

表单**只有一个分区「基本信息」**，字段顺序固定为 9 个：

| 序 | 字段 | 后端事实 | 说明 |
| --- | --- | --- | --- |
| 1 | 编码 | `Item.code` | 必填；唯一 |
| 2 | 名称 | `Item.name` | 必填 |
| 3 | 系列 | `Item.series` | 自由文本 |
| 4 | 型号 | `Item.model` | 自由文本 |
| 5 | 规格 | `Item.spec` | 自由文本 |
| 6 | **材料类型** | → **`Item.categoryId`**（`categoryName` 解析） | **自由文本**；保存时按名称匹配/新建**物料分类**并写入分类，**不再写 `Item.itemType`**（沿用 DB 默认）。**与「分类」不联动**（2026-09-27 用户指令）：两控件各自独立，输入不回填下拉、选择不回填输入；两者都填写且不一致时前端拦下要求二选一（不静默覆盖显式选择） |
| 7 | 分类 | `Item.categoryId` | `ReferenceSelector`（分类源，独立取数 + 字段级重试）；与「材料类型」互不联动，但两者最终都落到分类（材料类型优先，文本为空时用所选分类） |
| 8 | 计量单位 | `Item.stockUomId` | **唯一计量单位字段**（绑定库存单位列：BOM 原料单位红线 / 生产工单行单位 / 换算基准都依赖它）；已移除 采购单位、销售单位 及其跟随联动 |
| 9 | OEM 编码 | `Item.oemCode` | 自由文本 |

**本轮从表单移除**：助记码、商品来源（`sourcingType`）、描述（`description`）、采购单位 / 销售单位（`purchaseUomId/salesUomId`）。上一轮已移除：供应商与采购价、采购/销售标记、生命周期、状态、品牌、制造商、产品精度等级、预压值。

**分类自动解析契约（服务端，零 Schema 变更）**：`POST /api/items` 与 `PATCH /api/items/:id` 新增可选字段 `categoryName`：

- 先按名称（trim + 忽略大小写）匹配未软删的 `ItemCategory` → 命中即复用（不重复建）；
- 未命中则**在同一事务内**新建（`level=1`、`categoryPath`=下一个 3 位数字、`code=MAT-<path>`）并关联 → 事务失败整体回滚，不留孤儿分类；
- 新建需要 `item-category:create` 权限，否则 403（仅复用已有分类不需要该权限）；
- 非空时**优先于** `categoryId`。

**从表单移除但列与 API 保留（零数据删除）**：`mnemonic/sourcingType/description/purchaseUomId/salesUomId/brand/manufacturer/lifecycle/status/precisionGrade/preload/isSalable/isPurchasable/isManufacturable/variant/barcode/drawingNo/drawingVersion/revision`。

> API 侧字段与列全部保留，仍可经 API 维护；本改造只收窄**页面入口**。彻底废弃字段属 Schema 变更，需单独 Design/Scope Gate。

## 列表页字段（2026-09-27「重新整理列表字段显示」）

列与表单同序：**编码 / 名称 / 系列 / 型号 / 规格 / 材料类型 / 分类 / 计量单位 / OEM 编码**。

- 「材料类型」列 = 分类名（表单「材料类型」输入即匹配/新建物料分类）；「分类」列 = 分类树位置（`categoryPath` + 名称，如 `001.003 机床直线导轨`）——两列信息互补不重复。
- 移除列：状态、可采购、可销售、创建时间（**状态仍保留为筛选条件**，不丢能力）。
- 筛选：编码 / 名称 / **分类**（原「类型」枚举筛选改为分类筛选——表单已不再写 `itemType`）/ 状态；URL 参数 `itemType` → `categoryId`。
- 列表 API `GET /api/items` 的 `category` select 增加 `categoryPath`（纯新增字段，向后兼容）。
## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                           |
| ----------------- | ------------------------------ |
| List              | ⏸️ 未开放（占位页/入口未开放） |
| Detail            | ⏸️ 未开放（占位页/入口未开放） |
| Create            | ⏸️ new 页面未入 main           |
| Edit              | ⏸️ edit 页面未入 main          |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）       |
| Fact Actions      | HOLD（Tier 3 HARD HOLD）       |

## Current UI

- 真实列表页（EntityListWorkspace）+ 详情页（EntityDetailWorkspace + 审计）+ 新建/编辑表单（EntityFormWorkspace + ReferenceSelector + CAS version）

- 占位页（PlaceholderPage「尚未开放」），无列表/表单

## Gap

- 无剩余 Gap；审计已通过 /api/audit-logs（entityType=item）接入
- UX Hardening（CTO #11660）：Dirty-State Guard（useDirtyStateGuard）+ 409 CAS 冲突专用面板（isVersionConflict + 重新加载）已接入
- 引用下拉加载（问题三，2026-09-27）：分类 / 库存单位 / 采购单位 / 销售单位每源独立取数 + 字段级重试 + 失败可见；库存单位 → 采购/销售单位联动；编辑页引用源失败不再阻塞详情（QA：docs/qa/Items_Reference_Loading_Fix_QA.md）
- 表单改造（2026-09-27）：基本信息移除品牌/制造商、类型改手动输入；移除供应商与采购价分区、生命周期/状态、产品精度等级/预压值、采购/销售标记；「技术属性」更名「材料属性」；描述迁入基本信息（QA：docs/qa/ItemMaster_Form_Restructure_QA.md）
- **待决策（未实施，等指令）**：详情页 / 列表页仍展示 品牌、制造商、状态、可采购/可销售/可生产、默认供应商与采购价、产品精度等级、预压值——这些是既有真实数据的只读呈现，本次未按「表单移除」同步收窄