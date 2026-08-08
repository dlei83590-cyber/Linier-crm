# ADR-0023：Purchase Requisition & Purchase Order Domain（采购申请与采购订单领域决策）

- 状态：**Approved with Changes（2026-08-09，CTO Design Review 97/100——7 个 Pending 全部拍板 + 3 项必改调整已落实；Schema/Migration 0021 待放行后启动）**
- 关联：Sprint5A_PurchaseRequisition_PO_Design.md / EVENTS.md v1.14 / ROADMAP v1.17
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5 进入采购域（Procure-to-Pay）。5A 先锁定 Purchase Requisition（采购申请）+ Purchase Order（采购订单）Foundation，明确 PR/PO 事实源边界、Supplier 复用、审批、价格/金额事实来源、GR 边界；**本阶段只做 Design / ADR / EVENTS，禁止 Schema / Migration / API**（Gate 模式延续 Sprint 4 纪律）

## 决策

### D1：PR = 需求事实源，PO = 承诺事实源（事实源边界锁死）

- `PurchaseRequisition` = 内部需求申请事实源：表达"需要什么、多少、何时要"，**非供应商交互单据**；不携带对供应商的价格承诺
- `PurchaseOrder` = 采购承诺事实源：对供应商的正式承诺（向谁买、买什么、多少、什么价、何时交）；**PO 行金额 = 快照复制，服务端 Σ 计算，禁客户端直传头金额**
- **PO 不修改 PR 的数量/金额事实**（转单是复制投影，不是改写——对齐 CN/DN 不修改原 Invoice 金额事实红线）
- Supplier 主数据**已存在**（Sprint 3C-1），Sprint 5A **不新建**，PO 只引用 supplierId 快照不写回

### D2：PO 是 GR 的唯一来源（5B 边界；拍板调整③锁死）

- **只有 Confirmed PO 才能成为 5B Goods Receipt 来源**（APPROVED ≠ CONFIRMED）
- 不存在 Direct GR（对齐无 Direct Delivery 锁定项）；GR 防超收 = PO Line 数量 ceiling（5B 锁内校验）
- **GR 只回写 PO 数量投影（receivedQty），不碰 PO 单价/行金额**（对齐 Invoice 投影思想）
- PO Line **预留** `receivedQty=0 / remainingReceiveQty=quantity` 投影字段（Schema 阶段建列；**5A 不允许客户端修改，5B 才是唯一回写方**）

### D3：审批复用 Workflow，不建 Approval 表（拍板①：各自独立条件审批）

- ApprovalPolicy(module=`PURCHASE_REQUISITION` / `PURCHASE_ORDER`) → WorkflowDefinition → WorkflowInstance → 投影回写；**PR/PO 各自独立条件审批**（各自 module，命中才审）
- businessType=`purchase-requisition` / `purchase-order`（workflow actions 路由分支）
- **审批 ≠ 生效**：审批只回写投影；**APPROVED ≠ CONFIRMED**（拍板调整③）——APPROVED = 内部审批通过，CONFIRMED = 正式下单给供应商；只有 Confirmed PO 才能成为 5B Goods Receipt 来源

### D4：编号 DocumentSequence 创建即取号

- PO：docType=`PURCHASE_ORDER`（**枚举已有**），PO-2026-xxxx；**sourceType=REQUISITION | DIRECT**（拍板②，Header 显式可审计）
- PR：docType=`PURCHASE_REQUISITION`（**枚举需新增**，Schema 阶段），PR-2026-xxxx

### D5：事件先注册后开发（EVENTS.md v1.14，见 2.3.8）

- 11 个事件注册：PurchaseRequisitionCreated/Submitted/Approved/Rejected/Converted + PurchaseOrderCreated/Submitted/Approved/**Confirmed**/Rejected/Cancelled（**PurchaseOrderConfirmed 为拍板调整③新增**：APPROVED → CONFIRMED 正式下单动作）
- GR/Supplier Invoice 事件属 5B/5C 不注册；PurchaseOrderPartiallyReceived/Received 投影事件 5B 注册

### D6：金额事实链（对齐销售侧价格红线；拍板③：双通道）

- **价格双通道**：`SUPPLIER_PRICE_SNAPSHOT`（优先，PartnerPrice priceSource=SUPPLIER 快照复制）｜`MANUAL`（授权手工，**必须记录 priceReason / priceSetById(actor) / priceSetAt——audit 留痕**）
- Supplier 价格 → PO Line 单价快照 → PO.totalAmount（Σ 行，**服务端 Decimal 聚合，客户端不可直接传总额**）
- **PO 不调 Pricing Engine、不重算**；税率 taxRate 快照复制（拍板④）

### D7：红线（本阶段无越界实现）

- ❌ 不创建 Schema / Migration / API（Design 阶段只写草案）
- ❌ 不新建 Supplier 主数据；不建 Approval 表
- ❌ 不实现 GR/GRN（5B）、Supplier Invoice/三单匹配/AP（5C）、采购付款（5D+）
- ❌ PR/PO 不承载库存动作（库存属 Sprint 6）

## Final Decisions（CTO Design Review 97/100 拍板结果，2026-08-09）

| # | Pending | **CTO 拍板结论** |
| --- | --- | --- |
| ① | PR/PO 审批链 | **各自独立条件审批**（ApprovalPolicy 各自 module=PURCHASE_REQUISITION / PURCHASE_ORDER，命中才审） |
| ② | PO 创建入口 | **允许 PR Convert + Direct Purchase**（sourceType=REQUISITION\|DIRECT；Direct 显式可审计、不能绕过 PO Approval） |
| ③ | PO 价格来源 | **Supplier Price Snapshot 优先，但必须允许授权 Manual Price**（双通道；MANUAL 记录 priceReason/actor/audit） |
| ④ | 税率策略 | **快照复制**（税档变化不影响已 APPROVED PO） |
| ⑤ | PR 是否带金额 | **不带金额**（纯需求，金额事实在 PO） |
| ⑥ | PR Revision/Snapshot | **仅 Revision**（PR 无财务事实，快照延后） |
| ⑦ | PO 修改重审 | **财务/承诺字段变更触发重新审批**（对齐 Invoice keyFinancialChanged） |

> **3 项必改调整（进入 Schema 前已落实）**：① PO 价格双通道（SUPPLIER_PRICE_SNAPSHOT/MANUAL + priceReason/actor/audit + 头金额服务端聚合）② Direct Purchase 显式可审计（sourceType + sourcePurchaseRequisitionLineId + 不能绕过 PO Approval）③ PO 生命周期锁死（DRAFT→SUBMITTED→APPROVED→CONFIRMED→PARTIALLY_RECEIVED→RECEIVED；DRAFT→CANCELLED；**APPROVED ≠ CONFIRMED**，只有 Confirmed PO 才是 5B GR 来源；PO Line 预留 receivedQty/remainingReceiveQty，5A 禁客户端改）
