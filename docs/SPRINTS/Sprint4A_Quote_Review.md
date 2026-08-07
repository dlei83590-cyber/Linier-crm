# Sprint 4A：Quotation Foundation Design Review（报价领域设计复审）

- 状态：**Approved with Changes Required**（CTO 批准，2026-08-07）
- 日期：2026-08-07
- 分支：feature/sprint4-sales
- 关联：Sprint4_Quote_Domain.md / Sprint4_Quote_ERD.md / Sprint4_Quote_API.md / Sprint4_Quote_Workflow.md、ADR-0015（Quotation must consume Pricing Engine）、EVENTS.md、API_GUIDELINES.md、ERROR_CODES.md

> **本文件是 Sprint 4A 架构决议，后续所有开发一律以此为准，不再依赖聊天记录。**
> 范围：Quote Domain / Quote ERD / Quote API / Quote Workflow 四份设计文档复审。

---

## 1. Review Scope

本次只复审：

- `Sprint4_Quote_Domain.md`（领域模型）
- `Sprint4_Quote_ERD.md`（ERD）
- `Sprint4_Quote_API.md`（API 设计）
- `Sprint4_Quote_Workflow.md`（审批流程）

**不修改代码，不修改 Schema。** 本文件只输出架构决议。

---

## 2. Review Conclusion

**整体评价：Design Approved with Changes Required**

| 维度 | 评分 |
| --- | --- |
| Architecture | ★★★★★ |
| Reusability | ★★★★★ |
| Consistency | ★★★★★ |
| Completeness | ★★★★☆ |
| **Overall** | **92/100** |

设计方向正确：Quotation 作为销售主链核心单据，正确复用了 Sprint 3 已交付的平台能力（Workflow/Approval、File Center、BusinessPartner、Item、Pricing Engine）。扣分项集中在价格来源与历史模型冗余两处，见 Blocking Issues。

---

## 3. Blocking Issues（阻断项，必须完成）

### Blocking-1：QuotationLine 必须引用价格快照，禁止前端直定 unitPrice

- **动作**：`QuotationLine` 增加 `priceSnapshotId`
- **引用**：`QuotationPriceSnapshot`（Sprint 3C-4 Price Foundation 已交付，FK SetNull，与 `ProjectProduct.priceSnapshotId` 完全同构）
- **规则**：禁止直接由前端决定 `unitPrice`。所有报价统一走：

```
PricingEngine.resolvePrice()
        ↓
QuotationPriceSnapshot
        ↓
QuotationLine（unitPrice 仅为快照冗余展示）
```

- **一致性**：与 ProjectProduct（3C-5）、Price Foundation（3C-4）完全一致；SO / PO / Invoice / Purchase / Project 全部沿用 ADR-0015。

### Blocking-2：历史模型统一为 Revision + Snapshot 两套，删除 QuotationVersion

- **动作**：
  - 统一保留 `QuotationRevision`（版本留痕，versionNo 递增 + 变更前快照）
  - **删除 `QuotationVersion`**（与 QuotationRevision 同构冗余，禁止三套历史）
  - 保留 `QuotationSnapshot`，**仅用于审批通过时冻结**（转单以快照为准）
- **结果**：整个模型只有两套历史：

```
Revision（每次修改留痕）
   ↓
Snapshot（审批通过时冻结）
```

- **禁止**：Revision / Version / Snapshot 三套历史并存。

---

## 4. CTO Decision Required（待 CTO 拍板）

以下三项保持开放，标 `Pending CTO Decision`，**在 CTO 决策前不进入 Schema 设计**：

| # | 决策项 | 选项 | 状态 |
| --- | --- | --- | --- |
| D-1 | 审批留痕是否建 `QuotationApproval` 表 | A. 不建表：直接查 WorkflowInstance + WorkflowAction（businessType=quotation）；B. 建表：仅作冗余留痕视图，与 Workflow 动作双写 | Pending CTO Decision |
| D-2 | `EXPIRED` 状态如何产生 | A. 惰性判定：读取/列表时按 validUntil 计算，不落库；B. 平台补定时调度器（需新增 ADR，架构冻结） | Pending CTO Decision |
| D-3 | 事件注册 | QuotationApproved / QuotationRejected / QuotationConverted 需在开发前补进 EVENTS.md（3A 原则：事件先行注册） | Pending CTO Decision |

---

## 5. Architecture Notes（架构补充建议，已批准）

### A. Quotation 不再保存 discountAmount

- `discountAmount` 可由 `subtotal × discountRate` 计算得到，**禁止 `discountRate` + `discountAmount` 双维护**。

### B. 税率不保存 taxRate，保存 taxProfileId + taxSnapshot

- Quote 层不直接保存 `taxRate` 数值（税率调整后无法追溯）。
- 改为保存：`taxProfileId`（FK TaxProfile）+ `taxSnapshot`（税率快照，行级可覆盖）。
- 依据：3C-4 TaxProfile / TaxRate 时间维度设计。

### C. 汇率快照只存 Header

- Quote Header 保存 `exchangeRateSnapshot`（1 次），**禁止每行重复保存**。
- 行级金额统一按 Header 汇率折算；行不存汇率字段。

---

## 6. Sprint 4 Development Order（开发顺序，固定不可跳步）

```
4A Review
   ↓
Schema
   ↓
Migration
   ↓
Seed
   ↓
RBAC
   ↓
Pricing
   ↓
API
   ↓
Workflow
   ↓
OpenAPI
   ↓
QA
   ↓
CI
   ↓
Review
```

> 以后谁开发都不能跳步骤。每个 Sprint 4 子阶段（4A Quote / 4B Sales Order / 4C Delivery / 4D Invoice）均按此顺序执行。

---

## 7. 后续 Sprint 4 文档命名规范

- Sprint 4A：`Sprint4A_Quote_Review.md`（本文档）
- Sprint 4B：`Sprint4B_SalesOrder_Review.md`（届时创建）
- Sprint 4C：`Sprint4C_Delivery_Review.md`（届时创建）
- Sprint 4D：`Sprint4D_Invoice_Review.md`（届时创建）

命名与现有 `Sprint3A_QA`、`Sprint3C5_Design` 保持一致，检索清晰。
