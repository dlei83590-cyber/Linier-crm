# Phase 2 Batch 2 — 采购链纵向深审（Purchase Chain Deep Semantics）

> 依据：docs/BUSINESS_UX_RATIONALIZATION_PHASE2.md（Phase 2 主提示词）
> 范围：1 个业务流程（采购链：Requisition → PO → Receipt → Inspection → Return → WHR → Supplier Invoice → AP）
> 分支：feat/ux-phase2-batch2-purchase

## Business Context

- 真实角色：申请人（提需求）、采购员（转 PO/议价/确认下单）、采购主管（审批）、仓管（收货/入库）、质检员（检验）、财务（发票/AP）
- 任务：内部需求 → 采购申请（PR，纯需求无金额）→ 审批 → 转采购订单（PO，承诺事实+价格）→ 收货（Receipt 现场事实）→ 质检（Inspection）→ 入库（WHR→库存）→ 供应商发票（三单匹配）→ 应付
- 事实链：PR（需求）→ PO（承诺，价格双通道快照）→ Receipt（到货）→ Inspection（质量判定）→ WHR（入库）→ InventoryMovement(IN)（6A 库存 SSOT）；Supplier Invoice/AP 属 5C

## Current Contract（关键事实）

### 状态机
- PR：DRAFT → SUBMITTED → APPROVED → CONVERTED；DRAFT/SUBMITTED → CANCELLED（REJECTED 支持重提——单实例复用）
- PO：DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED / RECEIVED；DRAFT → CANCELLED（**APPROVED ≠ CONFIRMED**；GR 只认 CONFIRMED+）
- Receipt：DRAFT → RECEIVED / CANCELLED（普通收货不审批）
- WHR：DRAFT → POSTED / CANCELLED（POSTED 才触发库存）
- Return：DRAFT → RETURNED / CANCELLED
- Inspection：完成制（complete 动作）

### 关键契约红线（ADR-0023 / CTO 拍板）
- PR = 需求事实源：**Header/Line 无任何金额字段**（suggestedUnitPrice 不带入）
- PO = 承诺事实源：金额=服务端 Decimal 聚合，禁客户端直传；**PO 不修改 PR 数量/金额事实**（转单=复制投影）
- 价格双通道：SUPPLIER_PRICE_SNAPSHOT（优先，服务端解析 PartnerPrice）/ MANUAL（授权 + priceReason/priceSetById/priceSetAt 审计留痕）
- 税率先例快照：税档变化不影响已 APPROVED PO；PO 不调 Pricing Engine、不重算
- receivedQty/remainingReceiveQty：仅 5B 回写，5A 禁改
- 审批复用 Workflow 单实例（PR/PO 各自独立；REJECTED 后复用实例重提）
- GR 门禁：仅 CONFIRMED / PARTIALLY_RECEIVED 可收货

## Field Decision Matrix（采购链核心字段）

### PurchaseRequisition（需求事实源，无金额）
| 字段 | 来源 | 行为 | 编辑权限 |
|---|---|---|---|
| code | 系统取号 | 只读 | 永不可改 |
| requesterId | 用户输入（默认当前用户） | 创建必填 | 不可改（PATCH schema 无此字段）|
| departmentId | 用户输入 | 可选 | 不可改 |
| status | 系统状态机 | 只读 | 动作 API 驱动 |
| needDate | 用户输入 | 可选（创建时） | DRAFT 可改 |
| remark | 用户输入 | 可选 | DRAFT 可改 |
| lines[].itemId/description/quantity/uomId/needDate/remark | 用户输入 | 创建时行必填 | DRAFT 可改（PATCH 行全量替换）|
| workflowInstanceId/approvedAt/approvalStatus | 系统投影 | 只读 | 不可改 |
| version | CAS | 只读 | 乐观锁 |

### PurchaseOrder（承诺事实源，金额服务端聚合）
| 字段 | 来源 | 行为 | 编辑权限 |
|---|---|---|---|
| code | 系统取号 | 只读 | 永不可改 |
| sourceType | REQUISITION/DIRECT（创建时决定） | 只读 | 不可改 |
| supplierId | 用户输入 | 创建必填 | 不可改（承诺事实锁定）|
| requisitionId | REQUISITION 必填 / DIRECT 空 | 溯源 | 不可改 |
| purchaserId/departmentId | 用户输入 | 可选 | DRAFT 可改 |
| currency | 用户输入（默认供应商币种） | 创建可选 | **不可改（承诺事实锁定）** |
| paymentTerm/expectedDeliveryDate/remark | 用户输入 | 可选 | DRAFT 可改 |
| subtotal/taxAmount/totalAmount | 服务端 Decimal 聚合 | 计算字段 | 只读（禁客户端直传）|
| confirmedAt/confirmedById | confirm 动作 | 只读投影 | 不可改 |
| lines[].unitPrice/taxRate/lineAmount/taxAmount/totalAmount | 价格双通道快照 | 快照只读 | DRAFT 可经 PATCH 全量替换（重新解析）|
| lines[].receivedQty/remainingReceiveQty | 5B 回写 | 只读 | 5A 禁改 |
| lines[].priceSource/sourcePartnerPriceId/priceReason | 价格审计 | 只读 | MANUAL 需 priceReason |

### 收货/质检/退货/WHR
- Receipt：code/PO/supplier（快照自 PO）/warehouse（仅 WAREHOUSE）/receivedAt/receivedById；行=PO Line 溯源 + 收货数量
- Inspection：mode（SKIP/SPOT/FULL）+ result（QUALIFIED/PARTIAL/REJECTED/PENDING）+ qualifiedQty/rejectedQty + inspectedAt
- Return：type（REJECTED_ON_RECEIPT/RETURN_AFTER_STOCK_IN/QUALITY_ISSUE）+ disposition（REPLACE_REQUIRED/CREDIT_ONLY）+ sourceType（RECEIPT_LINE/WHR_LINE/INSPECTION）
- WHR：来源收货单 + warehouse/location + postedAt/postedById（POSTED 才触发库存）

## Action / State Matrix（采购链前端入口现状）

| 单据 | DRAFT | SUBMITTED | APPROVED | CONFIRMED | 前端入口现状 |
|---|---|---|---|---|---|
| PR | 编辑✅ 提交✅ | 取消? | 转PO✅ | — | **cancel 入口缺失？需确认** |
| PO | 编辑✅ 提交✅ | 取消? | 确认✅ | 收货(5B) | submit/confirm/cancel 确认弹窗✅ |

## Problems Found（采购链）

- **P1-1（已修复）**：PO 详情页摘要缺关键金额（未税/税额/含税）——Phase 2「详情页顶部优先关键金额」未落地；已补金额 + 确认时间投影
- **P2-1（已修复）**：PO 新建页 currency 是自由文本输入（字段所有权：币种应受控）——已改受控下拉 + 供应商币种自动带出（Supplier.currency）
- **P3（已修复）**：PO 详情 sourceType 显示原始枚举（REQUISITION/DIRECT）→ 中文化；PR 详情页「创建时间」混入业务摘要 → 移入审计信息区
- **CONTRACT ISSUE C-1（不实施，标记待 ADR）**：PR 状态机声明 CANCELLED（DRAFT/SUBMITTED 可取消），但 purchase-requisitions/[id] 下无 cancel route（仅 convert/route/submit）——CANCELLED 状态不可达；前端不做假按钮
- **CONTRACT ISSUE C-2（不实施）**：PO 编辑页改交期/付款条件不触发重定价（税率先例快照为正确契约，前端已保持只读金额）——无需整改，记录确认

## Implemented（本轮已实施，纯前端 + 零后端变更）

1. ✅ PO 详情页：摘要补未税合计/税额/含税合计 + 确认时间投影（Phase 2「详情页顶部优先关键金额」）
2. ✅ PO 新建页：currency 自由文本 → 受控下拉（CNY/USD/EUR/HKD/GBP/JPY）+ 供应商选择后自动带出 Supplier.currency（可再改；空=自动供应商默认，与后端 `currency ?? supplier.currency ?? 'CNY'` 一致）
3. ✅ PO 详情页：sourceType 中文化（REQUISITION→来自采购申请 / DIRECT→直接采购）
4. ✅ PR 详情页：「创建时间」移出业务摘要 → 新增「审计信息」区

**Backend Contract Preserved**：零后端变更、零 Schema/Migration、零新依赖；金额服务端聚合、价格双通道、税率先例快照、receivedQty/remainingReceiveQty 仅 5B 回写全部不变

## Validation
- lint / type-check / unit / build → GitHub CI（CI-First）
