# PRICE_STRATEGY 价格策略

> 状态：Design（Sprint 3C-4 Price Foundation 前置文档，CTO #2138 要求）
> 定位：Price 是 Sales/Purchase 的核心引擎，策略先行，模型后建。
> 关联：ROADMAP.md（3C-4 Price Foundation）、MASTER_DATA_DEPENDENCY.md、ERROR_CODES.md、EVENTS.md

## 1. 目标

统一企业价格体系：销售价（Customer Price）、采购价（Supplier Price）、促销价（Promotion），
支持多币种、税率、有效期、价格策略（Price Policy）自动匹配，供 Quotation / PO 直接引用。

## 2. 核心概念

### 2.1 Price Policy（价格策略）

| 策略 | 说明 | 示例 |
| --- | --- | --- |
| STANDARD | 标准价（价目表兜底） | 价目表基准价 |
| CUSTOMER_SPECIFIC | 客户专属价（CustomerPrice 覆盖） | 战略客户价 |
| SUPPLIER_SPECIFIC | 供应商专属价（SupplierPrice） | 供应商协议价 |
| PROMOTION | 促销价（Promotion 限时） | 季度促销 |
| REGIONAL | 区域价 | 华东/华南差异 |
| VOLUME | 阶梯价（按数量） | 100+ 件 95 折 |

匹配优先级：PROMOTION > CUSTOMER_SPECIFIC > VOLUME > REGIONAL > STANDARD（策略引擎按序命中，输出最优价）。

### 2.2 Price List（价目表）

- 价目表 = 价格策略的载体（如"2026 标准价目表"、"华东区域价"）。
- 字段：code/name/priceType（SALES/PURCHASE）/currency/validFrom/validTo/status/isDefault。
- 一个物料可属于多张价目表，命中策略后取最优。

### 2.3 Price List Item（价目表明细）

- 价目表行：itemId + unitPrice + minQty（阶梯起点）+ taxRate + discountRate + validFrom/validTo。
- 支持阶梯价：同一物料多行（minQty 0 / 100 / 500）。

### 2.4 Customer Price（客户价）

- 客户专属：customerId（Customer，Partner 角色）+ itemId + unitPrice + currency + validFrom/validTo。
- 覆盖价目表：命中 CUSTOMER_SPECIFIC 策略时优先。

### 2.5 Supplier Price（供应商价）

- 供应商报价：supplierId（BusinessPartner type=SUPPLIER/BOTH）+ itemId + unitPrice + currency + validFrom/validTo。
- 与 SupplierItem（3C-3）衔接：SupplierItem.purchasePrice 为默认参考，SupplierPrice 为协议价历史。

### 2.6 Promotion（促销）

- 促销：code/name/itemId(s)/discountType（PERCENT/AMOUNT）/discountValue/validFrom/validTo/status。
- 命中 PROMOTION 策略时叠加或替代（策略配置决定）。

## 3. Currency（币种）

- 统一以 `currency` 字段建模（ISO 4217 三位码：CNY/USD/EUR）。
- 汇率转换：Finance 模块后续承接（本 Sprint 只存币种与金额，不做换算算法）。
- 多币种价目表：每张价目表单一币种；跨币种报价由 Finance 汇率表处理。

## 4. Tax（税率）

- 税率不写死：`DEFAULT_TAX_RATE` 环境变量（默认 13）。
- Price 行级 `taxRate` 可覆盖；税额计算：`taxAmount = (unitPrice * qty - discount) * taxRate / 100`。
- 含税/未税：行内 `taxIncluded` 标志（true=报价含税，false=未税另加）。

## 5. Validity（有效期）

- 所有价格记录带 `validFrom / validTo`，查询时 `NOW() BETWEEN validFrom AND validTo` 过滤。
- 过期价格保留历史（不物理删除），策略引擎只取有效期内。

## 6. 定价引擎（策略匹配，Sprint 3C-4 实现）

```
输入：customerId / supplierId / itemId / qty / date / currency
输出：最优价 { priceType, unitPrice, discountRate, taxRate, source(价目表/客户价/促销) }
流程：
1. 按 date 过滤有效期
2. 命中 PROMOTION → 计算促销价
3. 命中 CUSTOMER_SPECIFIC / SUPPLIER_SPECIFIC → 专属价
4. 命中 VOLUME（minQty ≤ qty 的最大档）→ 阶梯价
5. 兜底 STANDARD（价目表）
```

## 7. 数据流

```
PricePolicy（策略配置）
  └── PriceList（价目表）
        └── PriceListItem（明细/阶梯）
              ├── CustomerPrice（客户专属覆盖）
              ├── SupplierPrice（供应商协议价）
              └── Promotion（促销叠加）
                    ↓
Quotation（Sprint 4 引用销售价） / PO（采购引用 SupplierPrice）
```

## 8. Schema 草案（Prisma，不落地）

```prisma
enum PricePolicyType { STANDARD CUSTOMER_SPECIFIC SUPPLIER_SPECIFIC PROMOTION REGIONAL VOLUME }

model PricePolicy {
  id       String @id @default(cuid())
  code     String @unique
  name     String
  policyType PricePolicyType
  priority Int    @default(100) // 数值越小优先级越高
  // 统一审计字段
}

model PriceList {
  id        String @id @default(cuid())
  code      String @unique
  name      String
  priceType String // SALES / PURCHASE
  currency  String @default("CNY")
  validFrom DateTime?
  validTo   DateTime?
  status    String @default("DRAFT") // DRAFT/ACTIVE/ARCHIVED
  // 统一审计字段
}

model PriceListItem {
  id          String @id @default(cuid())
  priceListId String
  itemId      String
  unitPrice   Decimal @db.Decimal(18, 4)
  minQty      Decimal @default(0) @db.Decimal(18, 4)
  taxRate     Decimal @default(13) @db.Decimal(5, 2)
  discountRate Decimal @default(0) @db.Decimal(5, 2)
  validFrom   DateTime?
  validTo     DateTime?
  // 统一审计字段
}

model CustomerPrice {
  id        String @id @default(cuid())
  customerId String // Customer（Partner 角色）
  itemId    String
  unitPrice Decimal @db.Decimal(18, 4)
  currency  String @default("CNY")
  validFrom DateTime?
  validTo   DateTime?
  // 统一审计字段
}

model SupplierPrice {
  id         String @id @default(cuid())
  supplierId String // BusinessPartner type=SUPPLIER/BOTH
  itemId     String
  unitPrice  Decimal @db.Decimal(18, 4)
  currency   String @default("CNY")
  validFrom  DateTime?
  validTo    DateTime?
  // 统一审计字段
}

model Promotion {
  id            String @id @default(cuid())
  code          String @unique
  name          String
  itemId        String?
  discountType  String // PERCENT / AMOUNT
  discountValue Decimal @db.Decimal(18, 4)
  validFrom     DateTime?
  validTo       DateTime?
  status        String @default("DRAFT")
  // 统一审计字段
}
```

## 9. 验收要点（Sprint 3C-4）

1. 策略优先级可配置（PricePolicy.priority）
2. 有效期过滤统一（NOW() BETWEEN）
3. 阶梯价支持（PriceListItem.minQty）
4. 税率环境变量驱动，行级可覆盖
5. 价格变更发 Domain Event：PriceChanged（EVENTS.md）
6. 只建数据模型 + 定价引擎接口，不写财务算法
