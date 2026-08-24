# 商品来源与配方设计（Item Sourcing + BOM）— Design Gate

> 日期：2026-08-24 ｜ 决策输入：用户业务规则（商品三大来源 + 计量单位换算链）｜ 状态：**DRAFT — 待 CTO/产品批准后进入 Schema/API 实现**
> 前置文档：docs/SPRINTS/Production_Item_Model_Design.md（ProductionInbound P-1~P-3 已落地）；ADR-0038~0041（成本核算）；ROADMAP（生产成本归集 HOLD）

---

## 1. 业务规则（用户原话整理）

商品（成品）的来源有 **3 种形式**：

| # | 来源 | 业务含义 | 计量单位 |
|---|------|---------|---------|
| ① | **成品直接销售（外购成品）** | 从供应商采购已完工成品（标准型号导轨/滑块等），入库后直接销售，无任何加工 | 成品单位（米/件/个） |
| ② | **物料组合后的成品 · 自己生产** | 多种原料/半成品/外购件按配方组合，本厂加工成成品 | 原料按吨/公斤采购；成品按米/件/个 |
| ② | **物料组合后的成品 · OEM 外协** | 我方供料给外协厂，外协厂加工（收加工费），成品收回入库 | 同上 |
| ③ | **计量单位换算链** | 原料采购单位为**吨**，成品后变为**米 / 件 / 个** | 换算在配方系数中体现 |

**确认的决策**：①=外购成品直接销售；②OEM=我方供料+加工费；③=固定配方系数（含损耗率），吨→米/件/个在配方系数里表达。

---

## 2. 域模型设计

### 2.1 Item 扩展：商品来源（sourcingType）

> 现状 Item 已有功能开关（isPurchasable / isSalable / isManufacturable）与 10 类 itemType。新增 **sourcingType 显式表达成品来源**（业务事实），开关继续作为功能权限。

```prisma
enum ItemSourcingType {
  BOUGHT            // ①外购成品直接销售（默认）
  SELF_MANUFACTURED // ②自产（BOM 配方驱动，本厂加工）
  OEM_OUTSOURCED    // ②OEM 外协（我方供料 + 加工费）
}
```

- 加在 Item：`sourcingType ItemSourcingType @default(BOUGHT)`（全物料可用；成品语义最重）
- 约束建议（业务层）：`sourcingType = SELF_MANUFACTURED / OEM_OUTSOURCED ⇒ isManufacturable = true 且存在 ACTIVE BOM`；`BOUGHT ⇒ isPurchasable = true`
- 外购成品：走既有 采购→收货→入库→销售 链（**零新流程**）

### 2.2 BOM 配方（物料组合固定配方）

```prisma
enum BomStatus { DRAFT ACTIVE ARCHIVED }

model ItemBom {
  id             String   @id @default(cuid())
  bomNo          String   @unique          // 配方编码（BOM 前缀）
  finishedItemId String                        // 成品（1 配方 = 1 成品）
  finishedItem   Item     @relation("BomFinishedItem", fields: [finishedItemId], references: [id])
  version        Int      @default(1)          // 版本（同成品多版本，ACTIVE 唯一）
  status         BomStatus @default(DRAFT)
  isDefault      Boolean  @default(false)      // 当前默认配方（生产工单自动带出）
  remark         String?
  createdById/updatedById/approvedById/approvalStatus/version/deletedAt/createdAt/updatedAt // 审计字段统一
  lines          ItemBomLine[]
  @@unique([finishedItemId, version])
}

model ItemBomLine {
  id                String  @id @default(cuid())
  bomId             String
  bom               ItemBom @relation(fields: [bomId], references: [id], onDelete: Cascade)
  componentItemId   String                       // 原料/半成品/外购件（可多个）
  componentItem     Item    @relation("BomComponentItem", fields: [componentItemId], references: [id])
  componentUomId    String                       // 原料计量单位（吨/公斤/件…）——必须 = 该原料的库存单位
  componentUom      UnitOfMeasure? @relation(fields: [componentUomId], references: [id])
  qtyPerFinishedUnit Decimal @db.Decimal(18, 6)  // 生产 1 单位成品所需该原料数量（配方系数，吨→米/件/个在这里表达）
  lossRate          Decimal @default(0) @db.Decimal(8, 6) // 损耗率（0.02 = 2%）
  sort              Int     @default(0)
  remark            String?
  @@index([bomId])
}
```

**需求计算公式**：
`原料需求量 = 成品数量 × qtyPerFinishedUnit × (1 + lossRate)`
例：1 件滑块 = 0.05 吨钢材（损耗 2%）→ 生产 100 件 → 领料 100 × 0.05 × 1.02 = 5.1 吨。
**吨→米/件/个 的换算链即配方系数**（原料单位吨 × 系数 → 成品单位件/米），不新增跨商品 UOM 换算表。

### 2.3 生产/外协工单（ProductionOrder）

> 设计取舍：**新增 ProductionOrder 承载 BOM 驱动的多原料生产与 OEM 外协**；现有 ProductionInbound（半成品→产成品 1:1）保留为简化/历史入口（兼容，不迁移）。

```prisma
enum ProductionOrderType {
  SELF_MANUFACTURE  // 自产
  OEM_OUTSOURCING   // OEM 外协（我方供料 + 加工费）
}
enum ProductionOrderStatus { DRAFT SUBMITTED POSTED CANCELLED }

model ProductionOrder {
  id           String   @id @default(cuid())
  orderNo      String   @unique                // 工单号（PRD 前缀，DocumentSequence）
  productionType ProductionOrderType @default(SELF_MANUFACTURE)
  bomId        String?                        // 引用配方（ACTIVE；可选——支持无配方手工工单）
  bom          ItemBom? @relation(fields: [bomId], references: [id], onDelete: Restrict)
  finishedItemId String                       // 成品
  finishedItem Item     @relation("ProdOrderFinished", fields: [finishedItemId], references: [id])
  plannedQty   Decimal  @db.Decimal(18, 4)     // 计划/实际产出数量（成品单位）
  warehouseId  String                         // 成品入库仓库
  warehouse    Warehouse @relation(fields: [warehouseId], references: [id])
  supplierId   String?                        // OEM：外协厂（BusinessPartner 供应商）
  supplier     BusinessPartner? @relation(fields: [supplierId], references: [id], onDelete: Restrict)
  processingFee Decimal? @db.Decimal(18, 2)   // OEM：加工费合计（计入成品成本）
  batchNo      String?
  productionDate DateTime?                    // 生产/完工日期
  status       ProductionOrderStatus @default(DRAFT)
  postedAt/postedById                        // POSTED 事实边界（同事务库存效应 + 成本）
  remark/audit/version/deletedAt/createdAt/updatedAt
  lines        ProductionOrderLine[]
}

model ProductionOrderLine {
  id          String @id @default(cuid())
  orderId     String
  order       ProductionOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  lineType    ProductionOrderLineType // MATERIAL（领料出库）/ FINISHED（成品入库）
  itemId      String                        // 原料行 = 原料；成品行 = 成品
  item        Item @relation(fields: [itemId], references: [id])
  uomId       String?                       // 行单位（原料=库存单位；成品=成品库存单位）
  quantity    Decimal @db.Decimal(18, 4)    // 数量（原料行=领料量；成品行=产出量）
  warehouseId String?                       // 原料行=领料仓库
  unitCost    Decimal? @db.Decimal(18, 4)   // 成品行=加权成本单价（POSTED 计算）
  amount      Decimal? @db.Decimal(18, 2)   // 成品行=入库成本
  remark      String?
  @@index([orderId])
  @@unique([orderId, lineType, itemId])     // 防重复
}
```

**POSTED 同事务事实边界**（不可变，防 partial success）：
1. 校验：有 BOM ⇒ 原料行数量 ≥ 配方需求量（允许调整，>0）；库存足够（并发锁序：collect itemIds → dedupe → sort → `FOR UPDATE`，对齐 Blocking Gate）
2. 原料行逐行 OUT：InventoryMovement(OUT) + StockProjection 减 + 成本结转（复用 ADR-0039 applyOutboundCost；**GL 生产领料科目（生产成本）待成本归集解锁后补**——本 Gate 先记原料成本口径）
3. 成品行 IN：InventoryMovement(IN) + StockProjection 加；成品单位成本 = (Σ原料成本 + OEM 加工费) / 产出数量（自产无加工费）
4. 全程同事务 + Outbox（InventoryLedgerCommand 复用）+ 幂等（movementGroupId 冻结，对齐 Conversion P11）

### 2.4 计量单位校验规则（③ 换算链红线）

- 原料：purchaseUom=吨（采购）、stockUom=吨/公斤（UomConversion 同商品换算 吨↔公斤 允许）
- 成品：salesUom/stockUom=米/件/个
- **BOM 系数单位必须 = 原料库存单位；成品产出单位必须 = 成品库存单位**（服务端校验，禁前端任意指定）
- **禁止跨商品直接 UOM 换算**（UomConversion 仅同 itemId）；跨商品换算一律走 BOM 系数

---

## 3. 状态机与权限

| 单据 | 状态机 | 权限（新增） |
|---|---|---|
| ItemBom | DRAFT → ACTIVE → ARCHIVED（DRAFT 可删；ACTIVE 唯一默认） | bom:view/create/edit/approve/delete |
| ProductionOrder | DRAFT → SUBMITTED → POSTED / CANCELLED（maker-checker：创建≠过账人） | production-order:view/create/edit/approve/post/delete |

- RBAC：新增 2 模块注册到 shared PERMISSION_MODULES + seed（ADR-0028 静态门 CI 校验）
- 状态机红线：SUBMITTED ≠ POSTED；POSTED 不可逆（红字冲销后续阶段）

---

## 4. 落地批次（每个批次独立 PR + CI + QA + test-cases + ADR）

| 批次 | 内容 | 产物 |
|---|---|---|
| **P-1 Schema** | Migration 0047：Item.sourcingType + ItemBom/Line + ProductionOrder/Line + enums；RBAC 注册 + seed | schema + migration + ADR-0049 |
| **P-2 BOM API** | ItemBom CRUD + ACTIVE 唯一性 + 系数校验 + 前端商品详情配方维护 | API + 页面 + test-cases |
| **P-3 工单 API** | ProductionOrder CRUD + POSTED（同事务领料 OUT→成品 IN + 成本 + OEM 加工费 + 锁序）+ maker-checker | API + 路由测试 |
| **P-4 工单前端** | 生产/外协工单录入（选成品→配方带料→可调整→OEM 选厂+加工费）+ 列表/详情 | 页面 + QA |

## 5. 边界（本 Gate 不做）

- **生产成本归集**（人工/制造费用/分批成本/在制品）仍 HOLD——本 Gate 成品成本口径 = 原料成本 + OEM 加工费（标准成本兜底）
- 工序/工时/良率/工单拆分合并、红字冲销工单 = 后续
- 现有 ProductionInbound（半成品→成品 1:1）保留兼容，不迁移不删除
- InventoryConversion（同商品改包装/换单位）与 BOM 无关，保持不动

## 6. 验收标准（P-1~P-4 全落地后）

- 外购成品：零新流程（采购→收货→入库→销售）✅
- 自产成品：建 BOM（多原料+系数+损耗）→ 开生产工单 → POSTED 后原料减少、成品增加、成本=Σ原料成本
- OEM 成品：建 BOM → 开工单（选外协厂+加工费）→ POSTED 后原料发出、成品入库、成本=原料+加工费
- 吨→米/件/个：BOM 系数正确驱动领料量（100 件滑块 × 0.05 吨 × 1.02 = 5.1 吨钢材）
- 全部同事务原子（无 partial success）；CI 全绿；文档（ADR/QA/test-cases/OpenAPI/ROADMAP）同步
