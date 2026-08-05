# MASTER_DATA_DEPENDENCY 主数据依赖图

> 状态：Design（Sprint 3C-4 Price Foundation 前置文档，CTO #2138 要求）
> 目的：Sprint 4 以后整个系统的依赖关系完全清晰；任何模块改动必须沿依赖方向评估影响。

## 1. 主数据依赖链

```
BusinessPartner（唯一主体，Sprint 2 / 3C-2 角色化）
    │
    ├── Customer（角色扩展，3C-1）
    │     └── CustomerContact/Address/Tag/Credit（3C-1，Sprint 5 迁 Partner 共享）
    │
    └── Supplier（角色扩展，3C-2）
          └── SupplierQualification/Certificate/Settlement（3C-2 独有）
          └── PartnerContact/Address/Tag/BankAccount/Credit（3C-2 共享，Customer 共用）

Item（Item Master，3C-3，ERP 核心）
    ├── ItemCategory（分类树，3C-3）
    ├── ItemSpecification → SpecificationDefinition（规格，3C-3）
    ├── UomConversion / 多 UOM（3C-3）
    ├── ItemCost（成本接口，3C-3）
    ├── SupplierItem → Supplier（3C-3，一个 Item 多供应商）
    ├── ItemRevision（版本，3C-3）
    └── ItemTag（标签，3C-3）

Price（3C-4 Price Foundation）
    ├── PricePolicy（策略）
    ├── PriceList → PriceListItem（价目表）
    ├── CustomerPrice → Customer（客户专属价）
    ├── SupplierPrice → Supplier（供应商价）
    └── Promotion（促销）

Project（3C-5 Project Foundation）
    ├── Opportunity → Customer
    ├── Project → Customer / Supplier / Item
    └── Project 引用：Workflow / File / Audit（平台底座）

Quotation（Sprint 4 Sales）
    ├── Customer → Quotation → QuotationLine → Item
    ├── Quotation 价格来源：Price（CustomerPrice / PriceList / Promotion）
    ├── QuotationRevision / QuotationSnapshot（版本与快照）
    ├── QuotationApproval → Workflow + Approval Policy
    └── 事件：QuotationSubmitted（EVENTS.md）
```

## 2. 依赖方向（自底向上）

```
平台底座（Sprint 3A/3B）：Workflow / Approval / Notification / Audit / Menu / Dashboard / File / Dictionary / Settings
        ↑
主数据（Sprint 2/3C）：BusinessPartner → Customer / Supplier → Item（Item Master）
        ↑
价格（3C-4）：PricePolicy → PriceList → PriceListItem / CustomerPrice / SupplierPrice / Promotion
        ↑
项目（3C-5）：Opportunity / Project（引用 Customer / Supplier / Item / Price）
        ↑
销售（Sprint 4）：Quotation（引用 Customer / Item / Price / Workflow / File / Audit）
```

## 3. 依赖规则（架构纪律）

1. **只允许向下依赖**：上层模块可引用下层，下层绝不引用上层。
   - Quotation 可引用 Item / Price / Customer；Item 绝不引用 Quotation。
2. **平台底座先行**：Workflow / File / Audit 是公共能力，业务模块（Customer/Supplier/Item/Price/Project/Quotation）统一复用，禁止各自实现。
3. **BusinessPartner 唯一主体**：Customer / Supplier 都是角色，共享 Partner 级子表（Sprint 5 完成 Customer 侧迁移）。
4. **Item 是价格与单据的锚点**：Price / Quotation / PO 全部引用 Item Master；SupplierItem 是采购价的基础。
5. **Price 先于 Project**（CTO #2138）：Project 会引用 Price，故 3C-4 Price Foundation 先于 3C-5 Project Foundation。
6. **单据版本化**：Quotation 只增不改（QuotationRevision/QuotationSnapshot），审批链路不被破坏。
7. **事件解耦**：跨模块通知走 Domain Events（EVENTS.md），模块间不直接调用。

## 4. 影响评估矩阵（改动某层需检查的依赖）

| 改动层 | 受影响的层 |
| --- | --- |
| BusinessPartner | Customer / Supplier / Item（SupplierItem）/ Price（SupplierPrice）/ Project / Quotation |
| Item（Item Master） | Price（PriceListItem/CustomerPrice/SupplierPrice）/ Quotation（QuotationLine）/ Project |
| Price | Quotation（取价）/ PO（采购取价，Sprint 5） |
| Customer / Supplier | Price（CustomerPrice/SupplierPrice）/ Project / Quotation |
| Workflow / File / Audit | 全部业务模块（审批/附件/审计复用） |

## 5. 当前落地状态（2026-08-06）

| 层 | 状态 |
| --- | --- |
| 平台底座 | ✅ Sprint 3A/3B 已交付（Workflow/Approval/Notification/Audit/Menu/Dashboard/File/Dictionary/Settings） |
| BusinessPartner 主数据 | ✅ Sprint 2 + 3C-1 Customer + 3C-2 Supplier（角色化 + Partner 共享） |
| Item Master | ✅ 3C-3 已实现（PR #9） |
| Price Foundation | 🔄 3C-4（设计：PRICE_STRATEGY.md） |
| Project Foundation | ⬜ 3C-5（最后，因引用全部底座） |
| Quotation（Sales） | 📝 Sprint 4 预备（Sprint4_Quote_* 四份文档） |
