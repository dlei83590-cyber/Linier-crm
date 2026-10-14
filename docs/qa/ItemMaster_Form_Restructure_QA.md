# 物料管理表单改造 QA（2026-09-27）

> 指令：用户「物料管理改造，基本信息中移除品牌和制造商，类型改为手动输入，移除供应商和采购价关联，计量与状态中移除生命周期和状态，技术属性更改描述为材料属性并移除产品精度等级和预压值，移除采购/销售标记。」
> 范围：apps/web 前端（物料「新建 / 编辑」表单）+ 共享类型输入模块 + docs ｜类型：普通前端改造（FRT-01，无 Schema/Migration ⇒ 不需要 Design/Scope Gate）

## 改造清单（分区前后对照）

| 分区 | 改造前 | 改造后 |
| --- | --- | --- |
| 基本信息 | 编码 / 名称 / 助记码 / 类型(下拉) / 商品来源 / 分类 / 品牌 / 制造商 | 编码 / 名称 / 助记码 / **类型(手动输入 + datalist)** / 商品来源 / 分类 / **描述（迁入）** |
| 供应商与采购价 | 多供应商行 + 采购价 + 付款条款 + 优选 | **整区移除**（表单不再取 `/api/suppliers`、`/api/commercial-terms`，不再写 supplier-items） |
| 计量与状态 | 库存/采购/销售单位 + 生命周期 + 状态 | 更名 **计量单位**：库存 / 采购 / 销售单位（**联动保留**） |
| 技术属性 | 系列 / 型号 / 规格 / OEM 编码 / 产品精度等级 / 预压值 | 更名 **材料属性**：系列 / 型号 / 规格 / OEM 编码 |
| 采购 / 销售标记 | 可采购 / 可销售 / 可生产 + 描述 | **整区移除**（描述已迁入基本信息） |

## 类型「手动输入」的实现契约

- `Item.itemType` 是 **DB 枚举**（`ItemType` 10 值）⇒ 本次**不改 Schema**，实现为「文本输入 + 候选」：
  - 共享模块 `apps/web/src/lib/item-type.ts`：`ITEM_TYPE_OPTIONS` / `ITEM_TYPE_LABELS` / `ITEM_TYPE_INPUT_HINT` / `normalizeItemTypeInput(raw)` / `itemTypeLabel(code)`。
  - 归一化接受：枚举码（大小写不敏感）｜中文业务名（如「成品」）。
  - 无法识别 → 前端 `ApiClientError(400, "类型无法识别，请填写：…", "VALIDATION")` 并**阻止提交**；后端 zod 枚举仍为最终权威（400）。
  - 空输入 → 不提交该字段（`itemType` 可选，DB 默认 `FINISHED_GOOD`）。
- 编辑页回填用中文业务名（`itemTypeLabel`），未修改时归一化结果与库中值一致；库中未知值原样展示（不隐藏真实数据）。
- 若将来要「任意新类型」（枚举 → 自由文本/字典表）：属 Schema/Migration + 领域模型变更，**需单独 Design/Scope Gate**。

## 边界（明确没改）

- **零 Schema / Migration / 业务 API / Error Code / Event / 权限码变更**：`POST` / `PATCH /api/items` 的 zod schema 与列全部保留，这些字段仍可经 API 维护。
- **零数据删除**：既有 `brand/manufacturer/lifecycle/status/precisionGrade/preload/isSalable/isPurchasable/isManufacturable` 与 `SupplierItem` 行**一律保留**；编辑页把这些字段从 PATCH payload 移除 ⇒ 不再被覆盖或清空（**不是**显式写 null）。
- 保留上一轮修复：引用源每源独立取数 + 字段级错误可见 + 重试；库存单位 → 采购/销售单位联动；Dirty guard；编码/名称必填；409 CAS 重载。
- 详情页 / 列表页**未改**（见下"待决策"）。

## 能力收窄（必须知情：这些操作从此没有页面入口，仍可走 API）

| 收窄项 | 影响 |
| --- | --- |
| 品牌 / 制造商 | 新增与修改需走 API；既有值在详情页仍显示 |
| 生命周期 / 状态 | **无法再从页面停用 / 归档物料**（`status` 仍可经 API 改）；新建固定 `ACTIVE` |
| 可采购 / 可销售 / 可生产 | 新建沿用 DB 默认（true / true / false），与改造前表单默认完全一致；**无法再设置为否**。注：BOM / 生产等后端流程**未**校验 `isManufacturable`（仅作投影展示），故不阻塞配方创建 |
| 产品精度等级 / 预压值 | 新增与修改需走 API；存量值保留（`LinearGuideSpecification` 同名字段不受影响） |
| 供应商与采购价 | 物料↔供应商（`SupplierItem`）**只能走 API 维护**；采购选商品自动带出「默认供应商 / 采购价 / 付款条款」（PR #194）仅对已配置的物料生效 ⇒ 新物料不再具备该自动带出 |

## 验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| R1 | 基本信息不再出现 品牌 / 制造商 | ✅ 静态 |
| R2 | 类型为文本输入 + datalist，中文名/枚举码均可提交，非法值阻止提交并提示 | ✅ 单测 |
| R3 | 供应商与采购价分区及其取数/请求全部消失（无 supplier-items 调用） | ✅ 单测（fetch 断言） |
| R4 | 计量单位仅剩三个 UOM 且联动仍生效 | ✅ 单测 |
| R5 | 材料属性保留 系列/型号/规格/OEM 编码；精度等级/预压值消失 | ✅ 静态 |
| R6 | 采购 / 销售标记分区消失，描述迁入基本信息 | ✅ 静态 |
| R7 | 提交 payload 不再包含 brand/manufacturer/lifecycle/status/precisionGrade/preload/isSalable/isPurchasable/isManufacturable | ✅ 单测 |
| S1 | 零 Schema / Migration / API / Error Code / Event / RBAC 变更 | ✅ |
| S2 | 上一轮引用加载修复与联动无回归 | ✅ 单测 |

## 验证策略

- CI-First：lint → Prisma Client → type-check → unit tests → Build → Secret Scanning 全绿为准（本地不执行高负载验证）。
- 部署后人工：新建物料（类型手输「成品」；不选供应商）→ 保存 → 详情；编辑该物料（类型回显「成品」）→ 改名称保存 → 既有品牌/状态/供应商数据未被清空。

## 待决策（未实施）

1. 详情页 / 列表页是否同步移除这些字段的**只读呈现**（品牌、制造商、状态、可采购/可销售/可生产、默认供应商与采购价、精度等级、预压值）——本次按"只改表单"执行。
2. 「类型」是否要做成**任意自由文本**（新领域建模：枚举 → 字典 / 文本列）——需 Design/Scope Gate。
3. 物料↔供应商是否彻底下线（连 `SupplierItem` 子资源与采购自动带出一起）——需产品决策 + Schema/领域变更 Gate。
