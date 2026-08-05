# DOMAIN_MODEL 领域模型

- 版本：v1.0
- 日期：2026-08-05
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：[PRODUCT_VISION.md](./PRODUCT_VISION.md) ｜ [ROADMAP.md](./ROADMAP.md) ｜ [ADR](./ADR/)

## 1. 业务主链（客户 → 项目 → 订单 → 交付 → 回款）

```
BusinessPartner（客户/供应商，统一往来单位）
        │
        ▼
Opportunity（项目机会：线索→准入→方案→报价）
        │  1:0..1
        ▼
Project（项目：试样→测试→小批量→批量供货→暂停/失败/结项）
        │  含 Stakeholder/Member/Milestone/Task/Budget/Expense/Product/Risk/Visit/Progress/Acceptance/Closure
        ▼
Quotation（报价单）──> Sales Order（销售订单）──> Contract（合同）
        │                                      │
        ▼                                      ▼
Delivery（发货 DO）                       Invoice（发票 CI）
        │                                      │
        ▼                                      ▼
Inventory（库存出库）                    Payment（收款核销）
                                                │
                                                ▼
                                              AR（应收）
```

## 2. 物料与供应链链（物料 → 价格 → 库存 → 采购/销售）

```
Item（物料：成品/原材料/配件/外购件/服务/包装物 + 工业字段）
  │
  ├── PriceList / PriceListItem（9 类价格：采购/销售/VIP/代理/工程/战略/区域/客户专属/历史）
  │
  └── Warehouse（仓库）──> Stock（库存余额）──> Batch（批次）
           │                    │
           ▼                    ▼
  Inventory Movement（出入库流水）──> Stock Count（盘点）/ Transfer（调拨）
           │
           ├── Purchase（采购：PR → PO → GRN → Supplier Invoice → Payment → AP）
           └── Sales（销售：Quotation → SO → Delivery → Invoice → Payment → AR）
```

## 3. 主数据关系

```
UnitOfMeasure ──< Item >── LinearGuideSpecification（1:1 扩展）
                    │
                    ├──< ItemStandard >── TechnicalStandard（GB/T 等）
                    │
                    └──< PriceListItem >── PriceList（priceType/含税体系）

BusinessPartner（uscc 唯一）──< ProjectOpportunity / Project

DocumentSequence（17 种单据类型，全局编号）
CommercialTerm（EXW/FOB/CIF/NET30）
```

## 4. 数据流（单据 → 财务）

```
Quotation ──> Sales Order ──> Delivery ──> Invoice ──> Payment ──> AR
                                                          │
Purchase Request ──> Purchase Order ──> GRN ──> Supplier Invoice ──> Payment ──> AP
                                                          │
Project Expense / 日常 Expense ──> 审批流 ──> Voucher（凭证）
                                                          │
                                              Journal ──> General Ledger ──> Profit / Cash Flow
```

## 5. 状态机（核心枚举）

| 对象 | 枚举 |
| --- | --- |
| 项目阶段 | LEAD → QUALIFIED → SOLUTION → QUOTATION → SAMPLING → TESTING → SMALL_BATCH → MASS_SUPPLY → PAUSED / FAILED / CLOSED |
| 关系人角色 | REQUESTER / TECHNICAL / PURCHASER / DECISION_MAKER / END_USER |
| 回款状态 | UNPAID / PARTIAL / PAID / OVERDUE |
| 里程碑 | PLANNED / IN_PROGRESS / COMPLETED / DELAYED |
| 任务 | TODO / IN_PROGRESS / DONE / CANCELLED |
| 风险 | OPEN / MITIGATING / CLOSED |
| 走访 | VISIT / PHONE / VIDEO / MEETING / OTHER |
| 验收 | PASSED / CONDITIONAL_PASS / FAILED / PENDING |
| 价格类型 | PURCHASE / SALES / VIP / AGENT / ENGINEERING / STRATEGIC / REGIONAL / CUSTOMER / HISTORICAL |
| 单据类型 | QUOTATION / SALES_ORDER / PURCHASE_ORDER / PROFORMA_INVOICE / COMMERCIAL_INVOICE / DELIVERY_ORDER / GOODS_RECEIPT_NOTE / GOODS_ISSUE / INVOICE / CREDIT_NOTE / DEBIT_NOTE / PAYMENT_VOUCHER / RECEIPT / EXPENSE / JOURNAL / CONTRACT / PROJECT |

## 6. 已落地 vs 规划中

- ✅ 已落地（Sprint 2，PR #4）：Item / LinearGuideSpecification / BusinessPartner / PriceList / TechnicalStandard / UnitOfMeasure / CommercialTerm / DocumentSequence + 项目领域 14 模型
- ⬜ 规划中（Sprint 4-7）：Quotation / Sales Order / Contract / Delivery / Invoice / Payment / Purchase / GRN / Warehouse / Stock / AR / AP / Voucher / Journal / GL

> 详细字段标准见数据库 schema（`prisma/schema.prisma`）与 [architecture/domain-model.md](./architecture/domain-model.md)。
