# Phase 1B 产品/原料合同视图 QA

> 日期：2026-08-24 ｜ CTO Directive Phase 1B（产品/原料 Contract Workspace）
> 验证事实源：GitHub CI

## 范围

- **后端**：GET /api/items/:id 扩展只读聚合（bomFinished / bomComponents / costBalance / productionOrderFinished / stockProjections / partnerPrices）
- **前端**：items 详情页新增「产品/原料合同视图」section（商品来源 / 移动加权成本 / 库存结存 / 作为成品的配方 BOM / 作为原料被配方使用 BOM Usage / 供应商 SupplierItem / 库存余额 StockProjection / 生产外协工单）
- **原料视图**：复用 items 列表 itemType 过滤（Item 业务过滤，非独立 RawMaterial Entity）

## 验收

- [ ] 产品详情可追：Item → 配方(BOM) → 供应商 → 库存 → 成本 → 生产/外协工单
- [ ] 原料详情可追：Item(itemType=RAW_MATERIAL) → 单位 → 供应商 → 成本 → 库存 → BOM Usage（被哪些配方使用）
- [ ] 零新表：Product / RawMaterial / CRMProduct 均未建立（复用 Item SSOT）

## 边界

- 零 Schema / 零 Migration / 零平行模型 / 零字段复制；严格禁止 Product/RawMaterial 第二主数据表
- 「原料档案」= Item 业务过滤/Workspace，非独立 Entity；「产品有哪些供应商」继续复用 SupplierItem
