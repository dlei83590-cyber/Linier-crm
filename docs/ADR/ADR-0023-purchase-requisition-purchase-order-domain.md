# ADR-0023：Purchase Requisition & Purchase Order Domain（采购申请与采购订单领域决策）

- 状态：**Proposed（2026-08-08，提交 CTO Design Review）**
- 关联：Sprint5A_PurchaseRequisition_PO_Design.md / EVENTS.md v1.14 / ROADMAP v1.17
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5 进入采购域（Procure-to-Pay）。5A 先锁定 Purchase Requisition（采购申请）+ Purchase Order（采购订单）Foundation，明确 PR/PO 事实源边界、Supplier 复用、审批、价格/金额事实来源、GR 边界；**本阶段只做 Design / ADR / EVENTS，禁止 Schema / Migration / API**（Gate 模式延续 Sprint 4 纪律）

## 决策

### D1：PR = 需求事实源，PO = 承诺事实源（事实源边界锁死）

- `PurchaseRequisition` = 内部需求申请事实源：表达"需要什么、多少、何时要"，**非供应商交互单据**；不携带对供应商的价格承诺
- `PurchaseOrder` = 采购承诺事实源：对供应商的正式承诺（向谁买、买什么、多少、什么价、何时交）；**PO 行金额 = 快照复制，服务端 Σ 计算，禁客户端直传头金额**
- **PO 不修改 PR 的数量/金额事实**（转单是复制投影，不是改写——对齐 CN/DN 不修改原 Invoice 金额事实红线）
- Supplier 主数据**已存在**（Sprint 3C-1），Sprint 5A **不新建**，PO 只引用 supplierId 快照不写回

### D2：PO 是 GR 的唯一来源（5B 边界）

- 不存在 Direct GR（对齐无 Direct Delivery 锁定项）；GR 防超收 = PO Line 数量 ceiling（5B 锁内校验）
- **GR 只回写 PO 数量投影（receivedQty），不碰 PO 单价/行金额**（对齐 Invoice 投影思想）
- 本阶段不建 receivedQty 列（5B 实现时按 computeDeliveryAllocation 思路动态计算——对齐 4C 先例）

### D3：审批复用 Workflow，不建 Approval 表

- ApprovalPolicy(module=`PURCHASE_REQUISITION` / `PURCHASE_ORDER`) → WorkflowDefinition → WorkflowInstance → 投影回写
- businessType=`purchase-requisition` / `purchase-order`（workflow actions 路由分支）
- **审批 ≠ 生效**：审批只回写投影；PO 的"正式下单"语义 = APPROVED（无独立 Apply 动作）

### D4：编号 DocumentSequence 创建即取号

- PO：docType=`PURCHASE_ORDER`（**枚举已有**），PO-2026-xxxx
- PR：docType=`PURCHASE_REQUISITION`（**枚举需新增**，Schema 阶段），PR-2026-xxxx

### D5：事件先注册后开发（EVENTS.md v1.14，见 2.3.8）

- 10 个事件注册：PurchaseRequisitionCreated/Submitted/Approved/Rejected/Converted + PurchaseOrderCreated/Submitted/Approved/Rejected/Cancelled
- GR/Supplier Invoice 事件属 5B/5C 不注册；PurchaseOrderPartiallyReceived/Received 投影事件 5B 注册

### D6：金额事实链（对齐销售侧价格红线）

- Supplier 价格（PartnerPrice priceSource=SUPPLIER，Sprint 3C-4 已有）→ PO Line 单价快照 → PO.totalAmount（Σ 行，服务端计算）
- **PO 不调 Pricing Engine、不重算**；税率 taxRate 快照复制

### D7：红线（本阶段无越界实现）

- ❌ 不创建 Schema / Migration / API（Design 阶段只写草案）
- ❌ 不新建 Supplier 主数据；不建 Approval 表
- ❌ 不实现 GR/GRN（5B）、Supplier Invoice/三单匹配/AP（5C）、采购付款（5D+）
- ❌ PR/PO 不承载库存动作（库存属 Sprint 6）

## 未决状态（7 个 Pending，CTO Design Review 拍板）

| # | Pending | 选项 | CIO 倾向 |
| --- | --- | --- | --- |
| ① | PR/PO 审批链 | A. PR+PO 双审批 ｜ B. PR 免审、PO 必审 ｜ C. 条件审批各自独立 | C（ApprovalPolicy 各自 module，命中才审；对齐 WriteOff/CN-DN 条件审批先例） |
| ② | PO 创建入口 | A. 仅 PR convert ｜ B. PR convert + 直接创建（requisitionId 可空）｜ C. 仅直接创建 | B（支持紧急直采，但推荐主流程走 PR→PO convert） |
| ③ | PO 价格事实来源 | A. Supplier 价格快照复制 ｜ B. 手工录入快照 ｜ C. PR suggestedUnitPrice 带入 | A（对齐销售侧价格红线，可追溯） |
| ④ | 税率快照策略 | A. 行 taxRate 快照复制，税档变化不影响已 APPROVED PO ｜ B. 实时取当前税档 | A（对齐 Invoice 快照税务） |
| ⑤ | PR 是否带金额 | A. PR 无金额（纯需求，金额事实在 PO）｜ B. PR 带预估金额 | A（金额事实唯一在 PO；PR suggestedUnitPrice 仅预估参考） |
| ⑥ | PR Revision/Snapshot | A. PR 仅 Revision ｜ B. PR 全套 Revision+Snapshot | A（PR 无财务事实，快照价值低；PO 全套 Revision+Snapshot 对齐 SO） |
| ⑦ | PO 修改重审 | A. SUBMITTED 后 PATCH 财务字段触发重审 ｜ B. SUBMITTED 后冻结仅 DRAFT 可改 | A（对齐 Invoice keyFinancialChanged 重审先例） |
