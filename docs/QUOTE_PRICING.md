# QUOTE_PRICING 报价计价流程

> 状态：Design（Sprint 4 Quotation 前置文档，CTO #2225 要求）
> 定位：报价（Quotation）计价必须按固定流程执行，保证一致性、可追溯、可审批。
> 关联：PRICE_STRATEGY.md、Sprint3C4_Design.md（Price Foundation）、Sprint4_Quote_*.md、EVENTS.md

## 1. 计价流程（Price → Discount → Promotion → Tax → Currency → Approval）

```
输入：customerId / itemId / qty / date / currency
  │
  ▼
① Price（取价）        ── PriceEngine.getSellingPrice()
  │                       PriceList（价目表）→ PriceListItem（阶梯价）
  │                       PartnerPrice（roleType=CUSTOMER 客户专属价覆盖）
  ▼
② Discount（折扣）     ── 价目表 discountRate + 行级折扣（QuotationLine.discountRate）
  │                       阶梯价 minQty 命中取最大档
  ▼
③ Promotion（促销）    ── PriceEngine.getPromotion() → PromotionRule
  │                       （PERCENT/AMOUNT；命中则按规则计算，是否叠加由策略决定）
  ▼
④ Tax（税率）          ── PriceEngine.getTax() → TaxProfile（0%/6%/13%/免税/自定义）
  │                       环境默认：DEFAULT_TAX_PROFILE_CODE → 默认 TaxProfile
  ▼
⑤ Currency（币种）     ── PriceEngine.getCurrency() → ExchangeRateReference
  │                       Base Currency → Quote Currency（不写死汇率）
  ▼
⑥ Approval（审批）     ── Approval Policy（金额匹配流程）
                           <5000 主管 / 5000~50000 经理 / >50000 总经理
                           Workflow 执行、Policy 选择（CTO #2138）
  │
  ▼
输出：QuotationPriceSnapshot（报价价格快照，固化本次计价结果）
```

## 2. 各步骤规则

| 步骤 | 输入 | 规则 | 输出 |
| --- | --- | --- | --- |
| ① Price | customerId/itemId/qty/date | 策略优先级：PROMOTION > CUSTOMER_SPECIFIC > VOLUME > REGIONAL > STANDARD；有效期过滤 effectiveFrom/effectiveTo | unitPrice（基础价） |
| ② Discount | unitPrice/折扣率 | 价目表 discountRate + 行级折扣；阶梯价按 minQty 命中最大档 | 折后单价 |
| ③ Promotion | itemId/date | PromotionRule 命中（PERCENT/AMOUNT），按策略决定叠加或替代 | 促销价（可选） |
| ④ Tax | itemId/taxProfileId/date | TaxProfile 税率；taxAmount = 折后金额 × rate / 100；含税/未税标志 | taxRate / taxAmount |
| ⑤ Currency | baseCurrency/quoteCurrency/date | ExchangeRateReference 汇率换算；无汇率则同币种 1:1 | 报价币种金额 |
| ⑥ Approval | 报价 total | ApprovalPolicy 按金额区间匹配流程；Workflow 执行审批 | approvalStatus |

## 3. 快照（QuotationPriceSnapshot，CTO #2225）

- 报价单不实时读取 PriceList：**计价结果固化到快照**，保证报价历史价格永远可追溯。
- 快照内容：quotationId / lineId / itemId / unitPrice / discountRate / promotionId? / taxRate / taxAmount / currency / exchangeRate / priceListVersionId / policyType / priceSource / effectiveAt。
- 作用：改价、促销结束、汇率波动均不影响已报价单；审批与转单以快照为准。

## 4. 审批（Approval Policy，CTO #2138）

| 金额区间 | 审批人 | 流程 |
| --- | --- | --- |
| < 5,000 | 主管 | QUOTATION_APPROVAL（单签） |
| 5,000 ~ 50,000 | 经理 | QUOTATION_APPROVAL（经理签） |
| > 50,000 | 总经理 | QUOTATION_APPROVAL（总经理终审） |

- **Policy 负责选择流程**（按金额匹配），**Workflow 负责执行**（Sprint 3A 平台）。
- 金额变更 → 重新匹配 Policy，历史审批按 QuotationSnapshot 追溯。

## 5. 事件（EVENTS.md 追加）

- QuotationSubmitted（已有）
- QuotationPriceLocked（计价完成/快照固化）——建议追加
- PriceChanged（Price 变更，3C-4）——建议追加

## 6. 验收要点（Sprint 4 实现时）

1. 计价顺序固定：Price → Discount → Promotion → Tax → Currency → Approval
2. 每次计价生成 QuotationPriceSnapshot（不实时读 PriceList）
3. 审批按 ApprovalPolicy 自动匹配流程（Policy 选择、Workflow 执行）
4. 税率/汇率不写死（TaxProfile / ExchangeRateReference 可配置）
5. 所有价格带 effectiveFrom/effectiveTo（时间窗口）
