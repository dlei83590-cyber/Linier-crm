# 商品模型设计 — 基于福建利尼尔工业生产入库表

> 日期：2026-08-21 ｜ 输入：2026年01月生产入库表（真实业务数据）
> 目标：商品（Item）数据模型承载「半成品加工→产成品入库→出库→月末结存」完整业务链。

---

## 1. 表结构业务语义解析

| 段 | 业务含义 | 关键列 |
| --- | --- | --- |
| ① 生产入库 | 半成品 → 产成品（加工转换） | 生产日期 / 产品名称（半成品）/ 半成品规格型号（长宽高尺寸）/ 单价 / 数量 / 金额；产品名称（产成品）/ 产成品型号（系列型号）/ 数量 / 金额 |
| ② 结存 | 库存期初期末 | 上月结存数量/金额、本月累计库存/库存金额 |
| ③ 出库明细 | 本月出库（销售/领用） | 入库日期 / 入库成品型号 / 出库数量 / 出库金额 |
| ④ 月末结存 | 期末库存 | 月末结存数量 / 结存金额 |

**核心事实链**：月末结存 = 上月结存 + 本月生产入库 − 本月出库；金额 = 单价 × 数量（成本口径）。

**产品体系**（名称前缀 = 业务分类）：
- 滑块：`*机床*滑块` / `*轴承*滑块` / `*线性*滑块` / `*通用设备*滑块`
- 直线导轨：`*机床*直线导轨`（按米）
- 丝杆螺母：`*金属制品*丝杆螺母`（Tr 系列 + TSY 定制）

## 2. 商品分类树（ItemCategory，两级）

| Level1 | code | Level2 | code |
| --- | --- | --- | --- |
| 滑块 | SLIDER | 机床滑块 / 轴承滑块 / 线性滑块 / 通用设备滑块 | SLIDER.MACHINE / .BEARING / .LINEAR / .GENERAL |
| 直线导轨 | LINEAR_GUIDE | 机床直线导轨 | LINEAR_GUIDE.MACHINE |
| 丝杆螺母 | SCREW_NUT | 金属制品丝杆螺母 | SCREW_NUT.METAL |

categoryPath 分段：`001` / `001.001`（子树 LIKE 查询）。

## 3. 产品系列 / 型号（Item.series + model + variant）

| 产品 | series（系列族） | model（具体型号）示例 | variant（定制变型）示例 |
| --- | --- | --- | --- |
| 滑块 | SMH / SMS / SRH / SGH / SML / SVN / SVW / MGN | SMH15A / SMS20B / SRH35BL / MGN12C | SMH20A-1-R150-Z0-N-15/15（成品定制段） |
| 直线导轨 | 按截面：SMH15 / SMS20 / SRH30 / KR25 等 | 15*10 / 23*18 / 28*26（截面 mm） | KR25-R1844-N-22/22（成品定制段） |
| 丝杆螺母 | Tr / TSY | Tr110*20 / Tr65×10 | TSY-MW76(6.3)-01-05-2（客户图纸号） |

## 4. Item 字段映射与扩展

| 表列 | Item 字段 | 说明 |
| --- | --- | --- |
| 产品名称（含分类前缀） | categoryId（Level2）+ name | 分类树承载；name 存业务名（机床滑块） |
| 半成品规格型号（24*34*56.8） | spec | 长宽高尺寸（半成品）/ 截面（导轨） |
| 产成品型号（SMH15A） | series + model | 系列族 + 具体型号 |
| 定制变型（含 R/Z0/K 段） | variant | 成品定制段 |
| 单位（个/米/根/块/只/件） | stockUom + unit 兼容 | 多 UOM 已有 |
| 单价（成本） | **新增 standardCost**（标准成本） | 生产入库成本口径；实际成本由 InventoryCostBalance 移动加权 |
| 半成品/成品 | itemType：SEMI_FINISHED / FINISHED_GOOD | 现有枚举（10 类） |
| 可生产 | isManufacturable=true | 半成品 + 可生产的成品 |

**建议 Item 新增字段（Migration 0040）**：`standardCost Decimal?`（标准成本，生产入库成本基数）。

## 5. 新增模型：ProductionInbound（生产入库单）

承载「半成品 → 产成品」生产入库（表格①段）。

```prisma
model ProductionInbound {
  id           String   @id @default(cuid())
  inboundNo    String   @unique // 生产入库单号
  inboundDate  DateTime // 生产日期
  warehouseId  String   // 入库仓库
  batchNo      String?  // 生产批次
  totalQty     Decimal  @db.Decimal(14, 3)
  totalAmount  Decimal  @db.Decimal(14, 2)
  status       ProductionInboundStatus @default(DRAFT)
  remark       String?
  lines        ProductionInboundLine[]
  version      Int      @default(1)
}

model ProductionInboundLine {
  id         String @id @default(cuid())
  inboundId  String
  fromItemId String // 半成品（消耗源）
  fromQty    Decimal @db.Decimal(14, 3)
  toItemId   String // 产成品（入库目标）
  toQty      Decimal @db.Decimal(14, 3)
  unitCost   Decimal @db.Decimal(14, 4) // 单位成本
  amount     Decimal @db.Decimal(14, 2) // = unitCost × toQty
}
```

**POSTED 库存效应（同事务）**：半成品 OUT（消耗 fromQty）→ InventoryMovement + StockProjection + InventoryCostBalance；产成品 IN（入库 toQty）→ 同。

## 6. 库存与成本逻辑

- 月末结存 = 上月结存 + 本月生产入库 − 本月出库（StockProjection 权威，禁止前端自拼）
- 生产入库金额 = Σ(unitCost × toQty)；产成品成本 = 半成品成本结转 + 加工（表内单价即成本口径）
- 出库金额 = 移动加权出库成本（InventoryCostBalance applyOutboundCost 复用，ADR-0039）

## 7. 落地批次建议

| 批次 | 内容 |
| --- | --- |
| P-1 | Migration 0040：Item.standardCost + ProductionInbound/Line 模型 + Seed 分类树/系列字典 |
| P-2 | 后端 API：ProductionInbound CRUD + POSTED（同事务库存效应 + CAS） |
| P-3 | 前端：生产入库单录入页（半成品→成品行编辑、成本自动带出）+ 列表/详情 + 报表 |

## 8. 边界

- BOM（多半成品→一成品配方）、工序/工时、良率 = 后续阶段（本模型先支撑「一进一出」生产入库事实）
- 出库侧（销售/领用）复用既有 InventoryMovement/出库结转，不新建
- 报表（表样式汇总/明细）待 BI reports 清单
