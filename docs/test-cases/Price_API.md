# Price API 测试用例（Sprint 3C-4 Price Foundation）

> 模块：Price Foundation（策略/规则/价目表/版本/专属价/促销/税率/汇率/定价引擎）
> 关联：docs/qa/Sprint3C4_QA.md、ADR-0013、API_GUIDELINES.md、ERROR_CODES.md
> 说明：以下用例供自动化测试复用；覆盖 10 个 API 资源 + POST /api/pricing/resolve 唯一入口。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/price-policies | 401，`{success:false, error:{code:AUTHENTICATION_ERROR}}` |
| A2 | MEMBER 无 price-policy:create 权限 | POST /api/price-policies | 403 FORBIDDEN |
| A3 | MANAGER 可访问全部 price-* 动作 | GET/POST/PATCH/DELETE | 200/201 |
| A4 | 权限码覆盖 10 模块 | price-policy/price-rule/price-list/price-list-version/partner-price/promotion/tax-profile/tax-rate/exchange-rate/pricing-engine | 无权限 403 |

## B. Price Policies（/api/price-policies）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建策略（STANDARD_PRICE，policyType=STANDARD） | POST /api/price-policies | 201，默认 priority=100/matchStrategy=HIGHEST_PRIORITY/stopOnMatch=true |
| B2 | code 重复 | POST /api/price-policies（同 code） | 409 CONFLICT |
| B3 | policyType 非法 | POST /api/price-policies | 400 VALIDATION_ERROR |
| B4 | 列表按 priority 升序 | GET /api/price-policies | 200，meta 分页 |
| B5 | 过滤 policyType/isActive/code | GET /api/price-policies?policyType=VIP | 200 |
| B6 | 详情含 rules + priceLists 计数 | GET /api/price-policies/:id | 200 |
| B7 | 更新（乐观锁 version） | PATCH /api/price-policies/:id | 200，version+1 |
| B8 | 更新（version 冲突） | PATCH /api/price-policies/:id | 409 VERSION_CONFLICT |
| B9 | 软删除 | DELETE /api/price-policies/:id | 200 `{deleted:true}`；删除后 GET 404 |

## C. Price Rules（/api/price-rules）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 创建规则（policyId 必填） | POST /api/price-rules | 201 |
| C2 | policyId 不存在 | POST /api/price-rules | 404 NOT_FOUND |
| C3 | conditions JSON 保存/返回 | POST + GET | 200，conditions 原样返回 |
| C4 | discountRate 0~100 校验 | POST /api/price-rules（discountRate=150） | 400 |
| C5 | 列表按 priority 升序 + policy 信息 | GET /api/price-rules | 200 |
| C6 | 更新/软删除（乐观锁） | PATCH/DELETE | 200 |

## D. Price Lists（/api/price-lists）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 创建价目表（code/name） | POST /api/price-lists | 201，默认 status=DRAFT/currency=CNY |
| D2 | 双轨：pricePolicyId + policyType 快照 | POST /api/price-lists（含 policyId） | 201，两字段均落库 |
| D3 | code 重复 | POST /api/price-lists | 409 |
| D4 | pricePolicyId 不存在 | POST /api/price-lists | 404 |
| D5 | 列表过滤 status/priceType | GET /api/price-lists?status=PUBLISHED | 200 |
| D6 | 详情含 policy/versions/items | GET /api/price-lists/:id | 200 |
| D7 | 更新状态/时间窗口（乐观锁） | PATCH | 200 |
| D8 | 软删除 | DELETE | 200 `{deleted:true}` |

## E. Price List Versions（/api/price-list-versions）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 创建版本（priceListId+versionNo） | POST | 201 |
| E2 | versionNo 复合唯一冲突 | POST（同 priceListId+versionNo） | 409 |
| E3 | priceListId 不存在 | POST | 404 |
| E4 | status 流转 DRAFT→PUBLISHED→ARCHIVED | PATCH | 200 |
| E5 | 发布关联 workflowInstanceId | PATCH（workflowInstanceId + publishedAt） | 200（Workflow Publish 场景） |
| E6 | 列表按 versionNo 倒序 | GET | 200 |

## F. Partner Prices（/api/partner-prices）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | 创建专属价（partnerId+itemId+unitPrice） | POST | 201 |
| F2 | partnerId 不存在 | POST | 404 |
| F3 | itemId 不存在 | POST | 404 |
| F4 | taxProfileId 不存在 | POST | 404 |
| F5 | partnerRoleType 枚举 + partnerRoleName 快照 | POST + GET | 200 |
| F6 | 列表过滤 partnerId/itemId/partnerRoleType | GET | 200 |
| F7 | 更新价格/优先级（乐观锁） | PATCH | 200 |
| F8 | 软删除 | DELETE | 200 |

## G. Promotions（/api/promotions）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | 创建促销（PERCENT/AMOUNT） | POST | 201 |
| G2 | code 重复 | POST | 409 |
| G3 | discountValue 负数 | POST | 400 |
| G4 | priority/stackable/exclusive 保存 | POST + GET | 200 |
| G5 | 列表过滤 status/promotionType | GET | 200 |
| G6 | 更新状态（乐观锁） | PATCH | 200 |
| G7 | 软删除 | DELETE | 200 |

## H. Tax Profiles（/api/tax-profiles）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 创建税档（CN_VAT_13，THIRTEEN） | POST | 201 |
| H2 | code 重复 | POST | 409 |
| H3 | 多国复用（MY SST / SG GST） | POST | 201 |
| H4 | 列表过滤 country/rateType | GET | 200 |
| H5 | 详情含 taxRates/taxProfileRules | GET /:id | 200 |
| H6 | 更新 rate/taxIncluded（乐观锁） | PATCH | 200 |
| H7 | 软删除 | DELETE | 200 |

## I. Tax Rates（/api/tax-rates）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | 创建税率（taxProfileId+rate） | POST | 201 |
| I2 | taxProfileId 不存在 | POST | 404 |
| I3 | rate 范围 0~100 | POST（rate=200） | 400 |
| I4 | 列表过滤 taxProfileId | GET | 200 |
| I5 | 更新/软删除（乐观锁） | PATCH/DELETE | 200 |

## J. Exchange Rates（/api/exchange-rates）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 创建汇率（base+quote+rate+effectiveDate） | POST | 201 |
| J2 | 复合唯一冲突（同币种对同日） | POST | 409 |
| J3 | rateType/provider/source/manualOverride | POST + GET | 200 |
| J4 | 列表按 effectiveDate 倒序 | GET | 200 |
| J5 | 更新/软删除（乐观锁） | PATCH/DELETE | 200 |

## K. Pricing Engine（POST /api/pricing/resolve — 唯一入口）

| # | 用例 | 请求体 | 预期 |
| --- | --- | --- | --- |
| K1 | 价目表兜底 | `{itemId, quantity:1, currency:"CNY"}` | 200，source=PRICE_LIST |
| K2 | 专属价覆盖 | `{partnerId, itemId, quantity:1}` | 200，source=PARTNER_PRICE |
| K3 | 数量规则命中 | `{itemId, quantity:100}` | 200，discountRate=5 |
| K4 | 汇率换算 | `{itemId, quantity:1, currency:"USD"}` | 200，exchangeRate>1，finalUnitPrice=base×rate |
| K5 | 促销命中 | `{itemId, quantity:1}`（有 ACTIVE 促销） | 200，promotionRuleId 非空 |
| K6 | 快照固化 | resolve 后查询 | QuotationPriceSnapshot 有记录（snapshotId 返回） |
| K7 | 审计落库 | resolve 后查询 | PriceAudit 有记录 |
| K8 | itemId 不存在 | `{itemId:"nonexistent"}` | 500，提示物料不存在 |
| K9 | 无价格命中 | `{itemId}`（无价目表/专属价） | 500，提示未匹配到有效价格 |
| K10 | 金额精度 | resolve 后检查 | 全程 Decimal，无浮点误差（1200×13%=1356.0000） |
| K11 | 唯一入口约束 | 检索代码库 | 仅 /api/pricing/resolve，无 customer/supplier/project resolve 变体 |

## L. 金额与时间规范（架构红线）

| # | 用例 | 验证 |
| --- | --- | --- |
| L1 | 金额字段 Decimal | schema 中所有金额 @db.Decimal，无 Float |
| L2 | 有效期统一 | PriceList/PriceListItem/PartnerPrice/TaxRate 均 effectiveFrom/effectiveTo |
| L3 | 含税标志明确 | TaxProfile.taxIncluded 必填（默认 false） |
| L4 | 发布关联 Workflow | PriceListVersion.workflowInstanceId 字段存在并随发布写入 |
