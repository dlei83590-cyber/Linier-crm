# ADR-0049：商品来源 + 配方（BOM）+ 生产/外协工单

- 状态：**Accepted（Implemented，2026-08-24）**
- 日期：2026-08-24
- 维护者：CIO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/SPRINTS/Item_Sourcing_BOM_Design.md（Design Gate）；docs/SPRINTS/Production_Item_Model_Design.md（P-1~P-3）；用户指令「整理商品逻辑——成品三大来源 + 吨→米/件/个」

---

## 背景

商品（成品）来源有 3 种：① 外购成品直接销售；② 物料组合后的成品（自己生产 / OEM 外协）；③ 原料按吨采购、成品按米/件/个计量。现有模型：`ProductionInbound` 仅支持「半成品→产成品 1:1」；`UomConversion`/`InventoryConversion` 仅同商品；无 BOM / 无外协。

## 决策

1. **Item.sourcingType**（`BOUGHT / SELF_MANUFACTURED / OEM_OUTSOURCED`，默认 BOUGHT）：显式表达成品来源业务事实；外购成品走既有采购链（零新流程）；`isPurchasable/isManufacturable` 保持功能开关不混淆。
2. **ItemBom + ItemBomLine（配方）**：1 成品 = N 行原料；每行 `qtyPerFinishedUnit`（系数）+ `lossRate`（损耗率）；`bomVersion` 多版本 + `ACTIVE` 唯一（activate 时同成品其他 ACTIVE 置 ARCHIVED）；`bomNo` 自动生成（BOM-{成品code}-{version}，非 DocumentSequence）。
3. **吨→米/件/个 换算链 = 配方系数**（`需求量 = 成品数 × 系数 × (1+损耗率)`），不建跨商品 UOM 换算表；红线：`componentUomId` 必须 = 原料库存单位，成品产出单位必须 = 成品库存单位。
4. **ProductionOrder + ProductionOrderLine（生产/外协工单）**：`productionType = SELF_MANUFACTURE / OEM_OUTSOURCING`；行 `lineType = MATERIAL / FINISHED`；OEM 时 `supplierId`（外协厂）+ `processingFee`（加工费）。
5. **POSTED 同事务事实边界**（对齐 6B/5C 模式）：FOR UPDATE 锁 → 状态门禁 → 有 BOM 时原料行数量 ≥ 配方需求量 → 稳定 `movementGroupId`（复用/冻结）→ 原料行 OUT（executeLedgerAtoms，role=CONSUME）+ 成品 IN（role=PRODUCE）→ 成品成本 = Σ原料出库成本 + OEM 加工费 → `upsertInboundCost` 入移动加权成本层（幂等 sourceKey）→ CAS 回写 POSTED + 成品行 unitCost/amount 证据。
6. **权限**：`bom:view/create/edit/approve/delete`（activate→:approve）；`production-order:view/create/edit/close/delete`（submit/post→:edit，cancel→:close）；register 到 PERMISSION_MODULES + seed（ADR-0028 静态门）。
7. **ProductionInbound 保留兼容**（半成品→成品 1:1 简化入口），不迁移不删除。

## 影响

- Migration 0047（Item.sourcingType + ItemBom/Line + ProductionOrder/Line + DocumentType.PRODUCTION_ORDER）
- 新 API：`/api/boms`（CRUD + activate）、`/api/production-orders`（CRUD + submit/post/cancel）
- 库存流水 sourceType 复用 `PRODUCTION`（与 ProductionInbound 同源，referenceNo 区分）；零新事件
- **已知边界**：原料领料 OUT 经共享 Core 自动过账 COGS（借 6401 贷库存科目）——与 ProductionInbound 现状一致；生产领料科目（生产成本）待「生产成本归集」解锁后纠正（本 Gate 先记原料成本口径）
- 生产成本归集（人工/制造费用/分批/在制品）、工序/工时/良率、工单红字冲销 = HOLD

## 兼容性

- 零破坏：现有 Item/ProductionInbound/UomConversion/InventoryConversion 语义不变；sourcingType 默认 BOUGHT
- DB 迁移向后兼容；新表无既有数据迁移需求

---

## 追加（2026-09-17，用户指令「物料管理 修改一」，Migration 0056）

- **决策 1 扩展——商品来源第 4 值**：`ItemSourcingType` 追加 **`OEM_OUTSOURCED_FULL`＝OEM 外协（含工含料：外协厂包工包料）**；既有 `OEM_OUTSOURCED` 明确为**含工不含料：我方供料 + 加工费**（语义未变，仅中文标注补齐）。二者为**并列来源事实**，不是工单类型：本次不新增生产/外协工单流程，`ProductionOrderType.OEM_OUTSOURCING`（我方供料 + 加工费 + 领料 OUT → 成品 IN）保持原样，含工含料是否走工单化留待后续 Gate。
- **决策 1 附带——Item 技术属性两列**：`Item.precisionGrade`（产品精度等级）、`Item.preload`（预压值）为**通用物料技术属性**（可空、无默认、无回填）。与既有 `LinearGuideSpecification.precisionGrade/preload`（直线导轨 1:1 专用扩展列）**并存但不互为真相**：导轨专用规格仍以 LinearGuideSpecification 为权威，本次不建立双向同步（避免平行真相写入）。
- **技术属性表单收敛（前端范围）**：物料新建/编辑「技术属性」分区移除 变型 / 条码 / 图号 / 图版 / 版本；对应 `Item` 列与 API 字段**保留**（`/api/items/:id/revisions` 仍写 `Item.revision`），本次仅收敛页面呈现，零数据删除。
- **影响**：Migration 0056（仅 ALTER TYPE ADD VALUE + ALTER TABLE ADD COLUMN）；`POST/PATCH /api/items` zod schema 追加 `precisionGrade/preload` 与 `OEM_OUTSOURCED_FULL`；零新权限、零新错误码、零新事件、零新 API。
- **边界**：不触碰 BOM 需求量、移动加权成本、库存 Ledger、GL；不改 `isPurchasable/isManufacturable` 功能开关语义。
