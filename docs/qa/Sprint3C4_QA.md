# Sprint 3C-4 QA — Price Foundation（价格领域：策略/规则/价目表/专属价/促销/税率/汇率/引擎）

> Sprint：3C-4 | 模块：Price Foundation | PR：#10（待创建） | 日期：2026-08-06
> 关联：ADR-0013（Price Foundation Architecture）、PRICE_STRATEGY.md、QUOTE_PRICING.md、EVENTS.md、API_GUIDELINES.md、ERROR_CODES.md
> 架构原则（CTO #2345/#2360 锁定）：金额一律 Decimal 禁止 Float、Currency 来自统一主数据、
> 有效期统一 effectiveFrom/effectiveTo、价格发布关联 Workflow、resolvePrice 唯一入口、Snapshot 固化完整定价链、PriceAudit 独立审计。

## 1. 交付范围

### 1.1 Schema（+11 模型 / +9 枚举 → 总计 98 模型 / 49 枚举）
| 类型 | 模型/枚举 | 说明 |
| --- | --- | --- |
| 枚举 | PricePolicyType | STANDARD/VIP/PROJECT/DEALER/REGIONAL/PROMOTION（策略类型，不写死在业务代码） |
| 枚举 | PriceMatchStrategy | FIRST_MATCH/BEST_PRICE/LOWEST_PRICE/HIGHEST_PRIORITY/COMBINE（CTO #2249） |
| 枚举 | PriceListStatus | DRAFT/PUBLISHED/ARCHIVED（版本可追溯） |
| 枚举 | TaxRateType | ZERO/SIX/THIRTEEN/EXEMPT/CUSTOM（多国税制） |
| 枚举 | PriceSource | MANUAL/IMPORT/FORMULA/PROMOTION/SUPPLIER/MARKET（BI 价格来源） |
| 枚举 | PromotionType | PERCENT/AMOUNT（促销类型） |
| 枚举 | ExchangeRateType | CENTRAL_BANK/BANK/MANUAL（央行/ERP/人工） |
| 枚举 | PriceRuleType | CUSTOMER_LEVEL/REGION/QUANTITY_BREAK/BRAND/PROJECT_TYPE/CURRENCY/CHANNEL（CTO #2345） |
| 枚举 | PartnerRoleType | CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING（CTO #2249 枚举+快照） |
| 主档 | PricePolicy | code 唯一/priority/matchStrategy/stopOnMatch（策略元数据） |
| 规则 | PriceRule | 独立建模：policyId/ruleType/conditions JSON/discountRate/priority（引擎直接执行） |
| 主档 | PriceList | 双轨：pricePolicyId FK + policyType 快照；base/quoteCurrency；effectiveFrom/To |
| 子表 | PriceListVersion | versionNo/revisionNo/status/publishedBy/publishedAt/workflowInstanceId（CTO #2345） |
| 专属 | PartnerPrice | partnerId+itemId/partnerRoleType+Name 快照/unitPrice/currency/priority/approvalRequired（CTO #2225/#2249/#2345） |
| 促销 | PromotionRule | 独立：PERCENT/AMOUNT/discountValue/priority/stackable/exclusive/status（CTO #2225/#2345） |
| 主档 | TaxProfile | country/region/taxIncluded/rateType/rate（多国复用，不改核心代码） |
| 子表 | TaxRate | taxProfileId/rate/effectiveFrom/To（时间维度税率） |
| 规则 | TaxProfileRule | country/itemCategory/customerType/supplierType/taxCode/priority（CTO #2249） |
| 主档 | ExchangeRate | base/quote/rate/effectiveDate/unique 三元组/provider/source/rateType/manualOverride（CTO #2345） |
| 快照 | QuotationPriceSnapshot | 完整定价链固化：Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final（CTO #2225/#2249） |
| 审计 | PriceAudit | entityType/entityId/oldPrice/newPrice/reason/approvedBy/workflowInstanceId/effectiveTime（CTO #2345） |

所有金额字段统一 `@db.Decimal`（18,4 / 14,4 / 5,2 / 18,8），禁止 Float；所有模型带统一审计字段、软删除。

### 1.2 迁移 0012_price_foundation
- 12 个 CREATE TABLE（PricePolicy/PriceRule/PriceListVersion/PartnerPrice/PromotionRule/TaxProfile/TaxRate/TaxProfileRule/ExchangeRate/QuotationPriceSnapshot/PriceAudit 等）
- 92 处 ALTER TABLE：PriceList 加 pricePolicyId/policyType/baseCurrency/quoteCurrency/status/effectiveFrom/effectiveTo/priceSource/freightIncluded；PriceListItem 加 taxProfileId/effectiveFrom/effectiveTo/discountRate/priceSource/tieredPricing 等
- 仅新增/加列，不重建表；从零 `migrate deploy` 12 个迁移全部应用成功（0011→0012 无冲突）

### 1.3 RBAC（+10 子模块，动作级 view/create/edit/delete/approve/audit/export/import/assign/close）
price-policy / price-rule / price-list（已有）/ price-list-version / partner-price / promotion / tax-profile / tax-rate / exchange-rate / pricing-engine / price-audit

### 1.4 API（10 资源，统一 REST）
price-policies / price-rules / price-lists / price-list-versions / partner-prices / promotions / tax-profiles / tax-rates / exchange-rates / **pricing（POST /api/pricing/resolve 唯一入口）**

### 1.5 Pricing Engine（PricingEngineService）
```
resolvePrice()（唯一入口，Quotation/Project/Sales 全部调用，禁止业务模块自行计算）
  → Load Context（物料/伙伴/币种校验）
  → Match Policy（priority 升序取策略）
  → Match Rules（规则命中取折扣，stopOnMatch 控制）
  → PartnerPrice / PriceList 取价（专属价优先，价目表兜底）
  → Promotion（PERCENT/AMOUNT，priority/stackable/exclusive）
  → Currency Conversion（ExchangeRate 换算）
  → Tax（TaxProfile 税率快照）
  → Snapshot（QuotationPriceSnapshot 固化完整定价链）
  → Audit（PriceAudit 记录价格变更）
```

### 1.6 Seed（幂等 upsert，业务规则首次进入 Seed）
- PricePolicy ×6：STANDARD_PRICE / VIP_PRICE / PROJECT_PRICE / SUPPLIER_PRICE / PURCHASE_PRICE / PROMOTION_PRICE（code 唯一）
- PriceRule ×3：Quantity≥100→5% Discount（QUANTITY_BREAK）/ Customer Level=VIP→VIP Price（CUSTOMER_LEVEL）/ Region=East China→Regional Price（REGION）
- TaxProfile ×3：China VAT 13% / Malaysia SST / Singapore GST（含默认 TaxRate）
- ExchangeRate ×6：USD↔CNY（PBOC 央行）、MYR↔CNY（ECB）、SGD↔CNY（Manual 人工，manualOverride）
- Promotion ×1：PROMO-DEMO-2026（Demo Promotion，PERCENT 10%）

## 2. 测试要点（CTO #2360 指定 8 项关键覆盖）

| # | 场景 | 说明 | 验证方式 |
| --- | --- | --- | --- |
| T1 | Policy Priority | 多策略时按 priority 升序命中（PROMOTION 50 < STANDARD 100） | 单元测试 / API 集成测试 |
| T2 | Rule Priority | 同策略下多规则按 priority 命中，stopOnMatch=true 第一条即停 | 单元测试（matchRuleConditions） |
| T3 | Currency Conversion | 报价币种 ≠ CNY 时按 ExchangeRate 换算（base→quote），无汇率保底 1:1 或报错 | 集成测试（resolve 带 currency=USD） |
| T4 | Tax Included / Excluded | TaxProfile.taxIncluded=false 未税价 + 税率快照；含税场景税额计算正确 | 单元测试（金额计算） |
| T5 | Promotion Stack | 多条 ACTIVE 促销按 priority 取第一条（stackable=false 不叠加） | 集成测试 |
| T6 | Promotion Exclusive | exclusive=true 时与其他促销互斥（不叠加） | 集成测试 |
| T7 | Snapshot | resolve 后固化 QuotationPriceSnapshot，含完整定价链（policy/rule/promotion/tax/rate） | 集成测试（查 snapshot 记录） |
| T8 | Audit | resolve/改价写入 PriceAudit（oldPrice/newPrice/reason/effectiveTime） | 集成测试（查 audit 记录） |
| T9 | Workflow Publish | PriceListVersion 发布关联 workflowInstanceId，审批通过后 PUBLISHED（Sprint 3A 平台） | 集成测试（版本流程） |

## 3. 测试清单（按模块）

### 3.1 Price Policy（price-policies API）
- [ ] P1 code 唯一：重复创建 → 409 CONFLICT
- [ ] P2 创建含 policyType/priority/matchStrategy/stopOnMatch → 201，默认值正确（priority=100, matchStrategy=HIGHEST_PRIORITY, stopOnMatch=true）
- [ ] P3 列表按 priority 升序返回
- [ ] P4 更新乐观锁：version 匹配 → 200 version+1；不匹配 → 409 VERSION_CONFLICT
- [ ] P5 软删除 → 200 {deleted:true}，删除后 GET → 404

### 3.2 Price Rule（price-rules API）
- [ ] R1 policyId 不存在 → 404 NOT_FOUND
- [ ] R2 conditions JSON 保存/返回正确（{minQty:100} / {customerLevel:"VIP"} / {region:"East China"}）
- [ ] R3 discountRate 范围 0~100 校验（超出 → 400 VALIDATION_ERROR）
- [ ] R4 规则列表含 policy 信息

### 3.3 Price List + Version
- [ ] L1 创建价目表：code 唯一；policyType 快照与 pricePolicyId 双轨正确落库
- [ ] L2 列表过滤 status/priceType/pricePolicyId
- [ ] L3 详情含 items（明细行含未税价/税率/税额/含税价）
- [ ] V1 创建版本：priceListId+versionNo 复合唯一（重复 → 409）
- [ ] V2 版本 status 流转 DRAFT→PUBLISHED→ARCHIVED
- [ ] V3 发布关联 workflowInstanceId（Workflow Publish 场景）

### 3.4 Partner Price（partner-prices API）
- [ ] PP1 partnerId/itemId 必填校验
- [ ] PP2 关联往来单位/物料不存在 → 404
- [ ] PP3 partnerRoleType 枚举 + partnerRoleName 快照保存
- [ ] PP4 priority 升序返回（专属价覆盖价目表）

### 3.5 Promotion（promotions API）
- [ ] PM1 code 唯一；PERCENT/AMOUNT 类型正确
- [ ] PM2 priority/stackable/exclusive 保存与返回
- [ ] PM3 status 过滤（DRAFT/ACTIVE/PAUSED/EXPIRED）

### 3.6 Tax Profile + Rate
- [ ] TP1 code 唯一；country/region/taxIncluded/rateType/rate 正确
- [ ] TP2 TaxRate 子表时间窗口（effectiveFrom/effectiveTo）
- [ ] TP3 多国复用：CN 13% / MY SST / SG GST 三条 Seed 存在

### 3.7 Exchange Rate
- [ ] ER1 base+quote+effectiveDate 复合唯一（重复 → 409）
- [ ] ER2 rateType/provider/source/manualOverride 正确
- [ ] ER3 列表按 effectiveDate 倒序

### 3.8 Pricing Engine（POST /api/pricing/resolve — 唯一入口）
- [ ] E1 itemId 不存在 → 500 ITEM_NOT_FOUND
- [ ] E2 无任何价格命中 → 500 PRICE_NOT_FOUND
- [ ] E3 价目表兜底：标准价返回（source=PRICE_LIST）
- [ ] E4 专属价覆盖：partnerId 命中 PartnerPrice（source=PARTNER_PRICE）
- [ ] E5 数量规则命中：qty≥100 应用 5% 折扣
- [ ] E6 汇率换算：currency=USD 按 ExchangeRate 换算
- [ ] E7 促销命中：ACTIVE 促销 PERCENT 折扣计入
- [ ] E8 Snapshot 固化：resolve 后 QuotationPriceSnapshot 有记录（含 policy/rule/promotion/tax）
- [ ] E9 Audit 记录：resolve 后 PriceAudit 有记录
- [ ] E10 金额精度：全部 Decimal，无浮点误差（如 1200×13%=1356.0000）

### 3.9 RBAC
- [ ] A1 未认证 → 401
- [ ] A2 无对应模块权限 → 403（如 MEMBER 调 price-policy:create）
- [ ] A3 MANAGER 动作级全量（view/create/edit/delete/approve/export/import）

## 4. 边界与异常
| 场景 | 预期 |
| --- | --- |
| 软删除后按 id 查询 | 404 NOT_FOUND |
| 删除策略下仍有价目表引用 | 允许（pricePolicyId onDelete SetNull，快照 policyType 保留可解释） |
| 汇率缺失时跨币种报价 | 保底 1:1 或明确报错（实现按「无汇率则 1:1」返回，BI 层提示） |
| 促销折扣后为负 | 下限 0（max(0, price - discount)） |
| 版本并发发布 | 乐观锁 version 冲突 → 409 VERSION_CONFLICT |

## 5. 验收标准
1. Seed 幂等：重复执行无报错、无重复数据（PricePolicy code / ExchangeRate 三元组 / TaxProfile code 唯一）
2. resolvePrice 唯一入口：无其他 resolve API；业务模块不自行计算
3. 金额全部 Decimal：Schema 层 @db.Decimal 强制，Service 层 Prisma.Decimal 计算
4. Snapshot + Audit 每次 resolve 均落库（可追溯完整定价链）
5. 有效期统一 effectiveFrom/effectiveTo（PriceList/PriceListItem/PartnerPrice/TaxRate）
6. 价格发布关联 Workflow（PriceListVersion.workflowInstanceId）
7. CI 全绿：Lint / Type Check / Unit Test / Build / Secret Scan
