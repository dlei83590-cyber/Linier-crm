# ADR-0015：Quotation must consume Pricing Engine（报价必须走定价引擎）

- 状态：**Accepted**（CTO 批准，2026-08-07；Sprint 4A Quote Foundation 架构决议）
- 日期：2026-08-07
- 关联：ADR-0013（Price Foundation）、ADR-0014（Project Foundation，priceSnapshotId 同构）、Sprint4A_Quote_Review.md、Sprint4_Quote_Domain.md、ROADMAP.md、EVENTS.md
- 背景：Sprint 3C-4 已交付 `PricingEngineService.resolvePrice()` 唯一入口 + `QuotationPriceSnapshot` 完整定价链（Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final），3C-5 ProjectProduct 已落地 `priceSnapshotId`（FK QuotationPriceSnapshot，SetNull）。Sprint 4 报价设计初稿存在行级手工传价（unitPrice/discountRate）的回归风险，违反 CTO #2225/#2249「价格来源可追溯」红线。本 ADR 锁定：**所有业务单据的价格必须消费 Pricing Engine，禁止任何模块自行计算价格。**

## 决策

### 1. 报价行必须引用价格快照（Blocking-1）

- `QuotationLine` 增加 `priceSnapshotId`，FK → `QuotationPriceSnapshot`（SetNull，与 ProjectProduct.priceSnapshotId 完全同构）。
- **禁止直接由前端决定 unitPrice。** 所有报价统一走：

```
PricingEngine.resolvePrice()
        ↓
QuotationPriceSnapshot
        ↓
QuotationLine（unitPrice 仅为快照冗余展示）
```

### 2. 全业务链统一引用本 ADR

- Quotation（Sprint 4A）、Sales Order（Sprint 4B）、Delivery（Sprint 4C）、Invoice（Sprint 4D）、Purchase（Sprint 5）、Project（3C-5 已落地）—— 全部引用本 ADR，**不会再有任何人重新写价格计算**。
- 行级展示字段（unitPrice/discountRate/taxRate/taxAmount/lineTotal）只允许为快照冗余，价格计算与来源一律以 `QuotationPriceSnapshot` 为准。

### 3. 定价引擎红线（沿用 ADR-0013）

- 全程 Decimal，禁止 Float。
- 有效期统一 effectiveFrom/effectiveTo（PriceList/PartnerPrice/PromotionRule/TaxRate/ExchangeRate）。
- 价格变更走 PriceAudit 独立审计（oldPrice/newPrice/reason/approvedBy/effectiveTime）。

### 4. 快照生命周期

- 报价提交/审批通过时固化快照（QuotationSnapshot，仅用于审批通过时冻结）。
- 转单（CONVERTED → Sales Order）以快照为准，后续价格变动不影响已批准单据。

## 影响

- Sprint 4A Schema 阶段：QuotationLine 必须含 priceSnapshotId；QuotationRevision/QuotationSnapshot 快照内容必须包含价格来源（命中 Policy/Rule/PartnerPrice/Promotion 等）。
- 禁止任何业务模块绕过 PricingEngineService.resolvePrice() 直接写价格。
- 本 ADR 与 ADR-0013、ADR-0014 共同构成「价格一条链」架构基线，调整必须新增 ADR（架构冻结）。
