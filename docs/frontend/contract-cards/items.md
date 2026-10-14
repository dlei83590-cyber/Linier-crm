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

## 字段契约（表单分区，2026-09-27 用户指令「物料管理改造」）

| 分区 | 字段 | 后端事实 | 说明 |
| --- | --- | --- | --- |
| 基本信息 | 编码 / 名称 / 助记码 | `Item.code/name/mnemonic` | 编码 + 名称必填 |
| 基本信息 | **类型（手动输入）** | `Item.itemType`：`ItemType` **枚举（10 值）** | 由下拉改为**文本输入 + datalist 候选**；提交前经 `lib/item-type.ts#normalizeItemTypeInput` 归一化（接受枚举码或中文业务名）；无法识别 → **阻止提交并提示**，不静默改写 |
| 基本信息 | 商品来源 | `ItemSourcingType`：BOUGHT / SELF_MANUFACTURED / OEM_OUTSOURCED / OEM_OUTSOURCED_FULL | 下拉，保留 |
| 基本信息 | 分类 | `ItemCategory`（独立取数 + 字段级重试） | 保留 |
| 基本信息 | 描述 | `Item.description` | 由原「采购 / 销售标记」分区**迁入**（用户只要求移除该分区，未要求删描述） |
| 计量单位 | 库存 / 采购 / 销售单位 | `Item.stockUomId/purchaseUomId/salesUomId` | 保留；库存单位 → 采购/销售单位联动 |
| 材料属性 | 系列 / 型号 / 规格 / OEM 编码 | `Item.series/model/spec/oemCode` | 原「技术属性」更名 |
| ~~供应商与采购价~~ | — | `SupplierItem`（API 保留） | 2026-09-27 **从表单移除**（不再取 `/api/suppliers`、`/api/commercial-terms`，不再写 supplier-items；**既有数据不删不改**） |
| ~~采购 / 销售标记~~ | — | `Item.isSalable/isPurchasable/isManufacturable` | 2026-09-27 **从表单移除**；新建沿用 DB 默认（salable/purchasable=true、manufacturable=false），编辑不再变更 |
| ~~生命周期 / 状态~~ | — | `Item.lifecycle/status` | 2026-09-27 **从表单移除**；新建沿用 DB 默认（status=ACTIVE）；编辑不再变更 |

**从表单移除但列与 API 保留（零数据删除）**：`brand`、`manufacturer`、`lifecycle`、`status`、`precisionGrade`、`preload`、`isSalable`、`isPurchasable`、`isManufacturable`、`variant/barcode/drawingNo/drawingVersion/revision`。

> API（POST/PATCH `/api/items`）**未改动**：这些字段仍可选、仍可经 API 维护（列与 zod schema 保留），本改造只收窄**页面入口**。彻底废弃字段属 Schema 变更，需单独 Design/Scope Gate。

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
