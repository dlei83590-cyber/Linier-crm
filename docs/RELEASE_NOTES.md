# Release Notes

## v0.7.0-alpha — Linier ERP Purchase · Inventory · AP Accounting & Frontend Operations（2026-08-18 Release Candidate）

> **Release 标题：** Linier ERP v0.7.0-alpha — Purchase, Inventory & AP Accounting + Frontend Operations
> **Release 摘要：** Sprint 5（5A Purchase Requisition/PO、5B Goods Receipt & Inbound、5C-1 Supplier Invoice / 3-Way Match / GRIR / AP）与 Sprint 6（6A Inventory Ledger、6B Inventory Operations）后端事实链全部 FINAL，叠加 Track A Frontend Operations（10 模块 List Workspace → F2-6B 动作接线 → B2-2A/B2-2B 项目财务/进度工作台 → Project Lifecycle L0-L2B1），使已 FINAL 的后端能力成为可操作工作台，并完成采购 → 入库 → 暂估应付 → 三单匹配 → 应付挂账（GRIR CONSUME + AP Liability + AP Open Item）的会计事实闭环。
> **Release Gate：** 候选条件达成（CTO Directive 2026-08-12 §21：5C-1 FINAL + Frontend Operations Iteration 1 可用基线）——5C-1 已合并 main `5a8dcae`（CTO #9048/#9238/#9678 系列 FINAL）；B2-2A/B2-2B **31/31 Runtime Acceptance PASS — ACCEPTED**（docs/qa/B2-2_Runtime_QA.md）；发布基线 commit CI 全绿（Quality Gates / Build / Secret Scanning）；生产 migration baseline 已核验 = `0028_grir_historical_fact_backfill`（/api/health/ready）。证据：docs/reviews/ReleaseGate_v0.7.0_Acceptance.md
> **Tag：** `v0.7.0-alpha`（annotated tag；GitHub Pre-release）
> **版本治理：** 以 Git Tag 为发布事实源；`RELEASE_VERSION` manifest = v0.7.0-alpha（/api/health 与前端 Footer/Dashboard 统一消费 `NEXT_PUBLIC_RELEASE_VERSION`）；root package.json 不随本版修改。

### Compatibility / Upgrade Guide

- **Schema baseline**：Migration 0001–0028（0027 = FROZEN BASELINE 禁改；0028 = GRIR Historical Backfill FINAL 已冻结）。
- **Database**：PostgreSQL 16（依赖 `UNIQUE NULLS NOT DISTINCT`、`FOR UPDATE SKIP LOCKED`）。
- **Migration**：部署自动执行 `prisma migrate deploy`（Railway）；生产 baseline 已核验 = `0028_grir_historical_fact_backfill`。
- **Breaking Changes**：无破坏性变更（0001–0028 全部增量迁移）；GRIR / AP / MatchRun 为不可变会计事实（禁止 UPDATE）；`InventoryMovement` COMMITTED 后不可变（纠错只能追加 Reversal/Correction）。
- **Upgrade Guide**：v0.6.0-alpha → 直接部署新版本（0027/0028 自动应用）；0028 为幂等 historical backfill，无需人工数据动作；升级后 /api/health/ready 返回 baseline=true 即验证成功。

### 新增能力（业务视角）

- **采购履约全链**：请购 → 审批 → 采购订单（**APPROVED ≠ CONFIRMED**，CONFIRMED 才可收货）→ 到货收货 → 质检（SKIP/SPOT/FULL）→ 入库（**Created ≠ Posted**，Posted 生效）→ 退货（来源可退额度 + 锁内防超退 + REPLACE_REQUIRED 重开 PO 履约）
- **库存账本（SSOT）**：入库/退货/调拨/盘点/调整/转换全部经 Shared InventoryLedgerCommand 原子落账；库存流水不可变、五元幂等、禁负库存、可追溯
- **供应商发票与应付**：SINV 创建即取号 → 三单匹配（immutable MatchRun + Workflow Approval Reference）→ 过账（POST）**同事务**产生 GRIR CONSUME + AP Liability + AP Open Item——采购暂估应付 → 到票 → 匹配 → 应付挂账会计闭环；金额一律 Server-side Decimal canonical
- **Frontend 工作台**：10 采购/库存模块 List+Detail+Create/Edit + Sales O2C 只读与 source-driven actions（convert/delivery/invoice）+ CRM/Project Workspace（机会/项目/子资源/预算/费用/进度）+ Dashboard v2（四区模型）+ **Supplier Invoice 前端（创建/匹配/过账）** + audit-logs 页面
- **Project Lifecycle**：验收（Acceptance Tab）/ 结项（Close，stage 为 authoritative，closure 不可删）/ 附件（Attachment contract）/ 阶段流转（Transition + allowedTransitions Read Contract）

### Known Limitations（2026-08-18）

1. **5C-2 HOLD**：供应商付款、AP 核销、付款冲销、供应商贷项/借项通知单、AP 坏账核销、GL 过账未实现（前端 Supplier CN/DN 权限置 null，不伪造权限入口）
2. **Reservation / AvailableQty HOLD**：预留库存与可用量未实现（Stock Projection 仅表达已 FINAL 的 quantity fact）
3. **Inventory Costing HOLD**：FIFO / 移动平均 / 库存价值 / unitCost 未实现
4. **Inventory Read Model Query API 未发布**：StockProjection / InventoryMovement Query Contract 设计先行、实现 HOLD——前端库存余额/流水页为 Placeholder，禁止自拼余额或 SUM Movement 当权威余额
5. **Sprint 7 财务（GL / 总账 / 利润 / 现金流）HOLD**；BI / OA / Mobile 未开始
6. **Contract（合同）模块未开始**；Notification 模板可配置但真实发送后续
7. **Project Lifecycle Contract Audit 待收口**：L0-L2-B1 已合并，FINAL/GAP/HOLD matrix 审计为下一 Governance 项
8. **版本显示**：前端 Footer 与 /api/health 显示 RELEASE_VERSION manifest（v0.7.0-alpha）；Web package.json（0.2.0-alpha）不再作为系统版本展示

### HOLD 清单（解除需 CTO 单独指令）

5C-2（Supplier Payment / AP Allocation / Supplier CN-DN / AP Write-Off / GL Posting）、Reservation、AvailableQty、FIFO、Moving Average、Inventory Costing、General Ledger、Financial Statements、BI、OA、Mobile、Inventory Read Model 实现。

## Sprint 6A — Inventory Ledger Foundation（2026-08-10，PR #21 待 CTO Final Review——CTO Inventory Consumer + Ledger Command FINAL APPROVED 99/100 #7683，6A 核心库存账闭环成立）

> **业务价值：** 库存数量从此有了**唯一的账本事实源**——入库、退货不再只是单据流转，而是真正形成可追溯、不可篡改的库存流水和实时库存余额。

### 业务可感知能力

- **采购入库后库存正式增加**：入库单过账（Posted）后，库存按仓库/库位/物料/批次/序列号自动入账，无需人工登记库存；同一笔入库不会重复入账（系统幂等）
- **已入库采购退货后库存正式减少**：退货完成后按原入库的仓库/库位/批次/序列号精确扣减库存；库存不足时拒绝扣减（不会出现负库存）
- **批次/序列号可追溯**：序列号管理的物料按每个序列号单独记账，每一件都能追溯到来源单据
- **可靠性保障**：库存流水一旦入账不可修改（只能冲销/更正）；异常消费会自动重试并保留失败记录（不会静默丢失库存变动）

> **边界说明：** 本阶段只完成**库存账本 Foundation**（库存流水 + 库存余额投影 + 可靠消费）。**不包含**调拨、盘点、转换、预留库存（ReservedQty）和成本核算（FIFO/移动平均）——这些将在后续独立阶段实现。

## Sprint 6B — Inventory Operations（2026-08-11，PR #22 待 CTO Sprint 6B Final Review——Transfer/Stock Count/Adjustment/Conversion 四块 Vertical Slice 全部 FINAL APPROVED，Sprint 6B Finalization 完成）

> **业务价值：** 库存从“只能被动记账”走向**主动运营**——仓库间调拨、实地盘点、盘盈盘亏调整、包装/计量单位转换，全部经同一个库存账本（Shared InventoryLedgerCommand）原子落账，库存余额永远可解释、可追溯。

### 业务可感知能力

- **调拨（Transfer）**：跨仓库/库位转移库存，出库与入库**同一笔事务双边落账**（不会出现“扣了没进”）；同仓同库位自调拨被拒绝；批次/序列号按单精确继承
- **盘点（Stock Count）**：按盘点单录入实盘数量，系统在录入时点**冻结账面数**；完成盘点时只确认差异，**绝不直接改库存账**——差异事实与库存流水完全分离，盘点历史可审计
- **盘盈盘亏调整（Inventory Adjustment）**：盘点差异自动生成调整单；人工调整必须有原因；**提交人与执行人不能是同一人**（maker-checker）；同一盘点行的差异不会被重复入账
- **转换/Repack（Conversion）**：同一种物料的包装/计量单位转换（如 10 箱 → 100 个），数量守恒由系统强制（消耗 = 产出）；**不信任前端算好的数量**，系统用换算率重新计算并校验；批次精确继承、序列号不重新生成
- **全程同一账本**：调拨、调整、转换的库存变动全部经**共享 Ledger Command** 落账（与 6A 入库/退货同一套幂等机制），**没有任何业务代码直接写库存流水/余额**——全局红线扫描 0 直写

> **边界说明：** 本阶段**不包含**预留库存（ReservedQty/availableQty）和成本核算（FIFO/移动平均）——CTO 明令继续 HOLD；调拨/转换/盘点的纠错（Reversal/Correction）与序列号级 Repack 留给未来独立 Gate。

## Sprint 5B — Goods Receipt & Inbound Foundation（2026-08-10，PR #20 已合并 main `7bd98cb`——CTO PurchaseReturn FINAL APPROVED 98/100 #7303，Sprint 5B 核心事实链 CLOSED）

> **业务价值：** 采购从“下单即结束”走向完整履约链——到货收货 → 质检 → 入库 → 退货，每个环节都是独立可审计的业务事实；库存数量事实源（InventoryMovement）保持纯净，未被采购模块提前污染。

### 业务可感知能力

- **到货收货（PurchaseReceipt）**：供应商送货到达后登记收货单——到了什么、多少、有没有当场拒收；只有已正式下单（CONFIRMED）的采购订单才能收货，全部收完后订单自动变为“已收货”状态，无法再普通追加收货
- **质检（Inspection）**：收货后按物料配置免检（SKIP）、抽检（SPOT）或全检（FULL）——合格多少、拒收多少系统记录；免检也留下质检记录（不绕过），拒收数量自动成为可退货额度
- **入库（WarehouseReceipt）**：质检合格的数量正式入到仓库/库位，同时采集批次、序列号、生产日期、有效期（库存追溯信息从这里开始）；入库单先创建、后过账——**只有过账（Posted）才是库存生效点**，为后续库存流水（6A）留好事实边界
- **退货（PurchaseReturn）**：现场拒收、质检拒收、入库后退货三种场景统一走独立退货单；退货必须指明真实来源，退货量不得超过来源可退额度（防止同一批货被重复退）；**“要求补货”的退货会在同一笔事务里重新打开采购订单的待交数量**——供应商还欠货，订单回到部分收货状态
- **数量安全边界**：现场拒收不计入“已收货量”；超收有硬性上限（默认 0%，不允许白送超收）；多张单并发退货/收货有数据库行锁防超退/超收

> **边界说明：** 本阶段（5B）**不写入任何库存余额/库存流水**（那是 6A 的唯一职责），也不做供应商发票与三单匹配（5C）。整个收货/质检/入库/退货链全程保持“库存事实源零污染”。

## Sprint 5A — Purchase Requisition & Purchase Order Foundation（2026-08-09，PR #19 已合并）

> **业务价值：** 采购从“Excel/口头管理”走向系统化——请购 → 审批 → 下单 → 确认的完整采购承诺链，为后续收货、入库、应付提供事实基础。

### 业务可感知能力

- **请购单（Purchase Requisition）**：员工/部门发起采购需求（要什么、多少、什么时候要），不再需要手工传 Excel；申请可提交审批，审批通过后一键转采购订单
- **采购订单（Purchase Order）**：两种下单方式——从已审批请购单转换（自动带出行明细），或直接创建采购订单（临时采购无需先走请购）；订单记录供应商、物料、数量、单价、税率、交期、采购员与采购部门
- **采购价格透明**：优先取供应商协议价（系统自动带出）；特殊情况下可手工定价，但必须填写原因并由系统记录是谁、什么时候改的价——每次采购都能回答“这个价格从哪来、谁定的”
- **下单前双重确认**：采购订单先走内部审批（金额达到阈值自动触发），审批通过后仍需**显式“确认下单”**才会正式形成对供应商的采购承诺——避免“财务批了 = 已经下单了”的误解；确认后订单状态进入 CONFIRMED，之后才能收货
- **取消边界**：草稿/已审批但未下单的订单可直接取消；已确认下单的订单禁止随意取消（需走线下供应商沟通/变更流程），防止口头承诺无记录
- **订单留痕**：每次修改、确认、取消都有历史版本与快照，谁在什么时候做了什么一目了然；同一订单多次审批不会互相覆盖历史
- **采购员/部门维度**：每张采购订单归属采购员与采购部门，为后续“采购员采购额、部门采购额、交期达成率”等管理报表打底

> **边界说明：** 本阶段不包含收货（Goods Receipt，5B）、供应商发票与三单匹配（5C）——收货必须从已确认（CONFIRMED）的采购订单发起，防止超收。

## v0.6.0-alpha — Linier ERP Sales & Finance O2C Foundation（2026-08-08 发布）

> **Release 标题：** Linier ERP v0.6.0-alpha — Sales & Finance O2C Foundation
> **Release 摘要：** Sprint 4 establishes the complete Sales & Finance Order-to-Cash foundation, covering Quotation → Sales Order → Delivery → Invoice → Accounts Receivable → Receipt & Allocation → Write-Off → Credit/Debit Note, with unified workflow, audit, financial projections, concurrency controls, and traceable business facts.
> **Release Gate：** Sprint 4 O2C Total Acceptance **PASS → RELEASE CANDIDATE**（9/9 节点 PASS、6/6 系统级不变量 PASS、Blocking Issues = 0）——证据：docs/reviews/Sprint4_O2C_Total_Acceptance.md
> **Tag：** `v0.6.0-alpha`（annotated tag；Pre-release）
> **版本治理：** 以 Git Tag 为发布事实源；package.json=0.1.0 不随本版修改（策略后续统一）

### Sprint 4A – Quotation Foundation（PR #12）

- Quotation = 报价事实源（Pricing Engine → QuotationPriceSnapshot 价格冻结）；审批唯一走 Workflow；QuotationSnapshot 版本留痕；报价转 SO（convert）

### Sprint 4B – Sales Order Foundation（PR #13）

- SalesOrder = 订单事实源（Quote→SO 溯源 quotationId）；Workflow 条件审批 + 状态事件；DocumentSequence 编号

### Sprint 4C – Delivery Foundation（PR #14）

- Delivery/DeliveryLine = 物流事实源（唯一入口经 SO，**无 Direct Delivery**）；防超交（availableQty 锁内校验）；READY 冻结 + POD 门禁；SO deliveredQty/remainingQty 聚合回写

### Sprint 4D – Invoice Foundation（PR #15）

- Invoice/InvoiceLine = 开票事实源（唯一入口经 Delivery，**无 Direct Invoice**）；防超开票（remainingInvoiceQty 锁内校验）；快照税务/汇率；Issue DocumentSequence 原子取号；条件审批（keyFinancialChanged）；DeliveryLine 开票投影

### Sprint 4E-1 – Accounts Receivable Foundation（PR #16）

- AccountsReceivable = 余额事实源（Invoice 1:1）；**balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount**（computeBalance 单入口）；OVERDUE/Aging 惰性投影不落库；Snapshot snapshotSource 可追溯；AR 不审批

### Sprint 4E-2 – Receipt & Payment Allocation Foundation（PR #17）

- Receipt = 唯一收款事实源（**创建≠核销**，UNALLOCATED + unallocatedAmount）；M:N 核销锁 AR（id ASC FOR UPDATE）+ 防超核销；同客户同币种；Allocation Reversal（≠CN）；VOID 边界；WriteOff 独立事实（**APPROVED ≠ APPLIED**，Apply 唯一回写入口，**不增加 Invoice.paidAmount**）；Workflow 条件审批

### Sprint 4E-3 – Credit Note / Debit Note Foundation（PR #18）

- CN/DN = Invoice Adjustment 事实源 + InvoiceAdjustment 事实中间层（唯一修改 AR.adjustedAmount 入口，客户端禁直接创建）；单票制 + 快照复制不调 Pricing Engine；**CN<0 / DN>0** signed；APPROVED ≠ APPLIED；累计防超调锁内重算（CREDIT 数量 ceiling / DEBIT 金额 ceiling，同类型聚合）；负 AR = Customer Credit 投影（禁 Receipt Allocation / WriteOff）；Invoice.balanceAmount 跟随 AR newBalance；Workflow 条件审批（businessType=credit-debit-note）

### Known Limitations（v0.6.0-alpha，不阻止 Alpha 发布）

1. 事件总线尚未落地：领域事件以 AuditLog 留痕承载（事件总线落地后替换 publish 语义）
2. package.json version = 0.1.0：版本治理以 Git Tag 为发布事实源，package version 策略后续统一
3. CN/DN Apply 逐行 FOR UPDATE：大量行场景可优化批量锁（非阻断观察项）
4. CN/DN Reversal 首版未实现（字段预留）；CustomerCredit 表/Refund 延后（负 AR 仅投影）
5. 跨币种核销/开票未开放（第一版禁跨币种，同 Customer+Currency 硬规则）
6. 整体成熟度 ≈92% 为估算口径

---
## Sprint 4E-3 — Credit Note / Debit Note Foundation（2026-08-08，PR #18 已合并，已纳入 v0.6.0-alpha）

> PR: #18（Sprint 4E-3 Credit Note / Debit Note Foundation，feature/sprint4-sales）
> 状态：**MERGED**（squash `675923c`；CTO Final Review **99/100 APPROVE & MERGE**，Blocking 0；未打 Tag，待 Sprint 4 Sales+Finance 总验收后统一发布 Alpha）
> CTO 结论：Design Review **98/100 APPROVED WITH CHANGES**（5 个 Pending 全部拍板）+ **Apply 专项复核 100/100 APPROVED（0 Blocking，5/5 核心项通过）** + **Final Review 99/100 APPROVE & MERGE（Blocking 0）**
> 关联：docs/reviews/Sprint4E3_CTO_Review_Cover.md（16 项 Checklist，**APPROVED & MERGED**）；CI 全绿：Quality Gates/Build/Secret Scanning

### Sprint 4E-3 Credit Note / Debit Note Foundation（PR #18）

- **发票调整领域模型**：CreditDebitNote / CreditDebitNoteLine / InvoiceAdjustment（+3 模型 / +2 枚举，迁移 0020_credit_debit_note_foundation，纯增量不改既有）；**CN/DN = Invoice Adjustment 事实源**；**InvoiceAdjustment = 事实中间层（唯一修改 AR.adjustedAmount 入口，客户端禁直接创建，只读）**
- **API（4 端点）**：POST/GET /api/credit-debit-notes（创建 DRAFT+lines / 列表）+ POST /{id}/submit（DRAFT→SUBMITTED + 条件审批触发）+ POST /{id}/apply（**唯一回写 AR.adjustedAmount 入口**）
- **财务边界（CTO 锁死）**：CN/DN 不修改原 Invoice 金额事实；APPROVED ≠ APPLIED；只有 Apply 创建 InvoiceAdjustment 并修改 AR.adjustedAmount；CN 负 adjustment / DN 正 adjustment（全系统唯一符号口径）；负 AR = Customer Credit projection（不新增 CREDIT 状态，禁止 Receipt Allocation / WriteOff）
- **累计防超调（CTO 98/100 最重要补充）**：CREDIT remainingAdjustableQty = 原行数量 - Σ已 APPLIED 未 reversed CREDIT quantity；DEBIT 累计金额 ≤ 原行金额 ceiling；金额按同类型聚合，CN/DN 不互相污染；锁内重算防并发穿透
- **Workflow 接入**：businessType="credit-debit-note" 终态回写（syncCreditDebitNoteApproval）；**绝不碰 AR**
- **文档**：OpenAPI（174 paths/466 schemas）+ QA（T1-T21）+ Test Cases（166 用例）+ ADR-0022（Accepted + Implemented）+ EVENTS v1.13 + DOMAIN_MODEL v1.15

## Sprint 4E-2 — Receipt & Payment Allocation Foundation（2026-08-08，PR #17 已合并，已纳入 v0.6.0-alpha）

> PR: #17（Sprint 4E-2 Receipt & Payment Allocation Foundation，feature/sprint4-sales）
> 状态：MERGED（squash b84b036；未打 Tag；待 Sprint 4 Sales 完整闭环（4E-2 + 4E-3 CN/DN）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4E-2 Receipt & Payment Allocation Foundation **APPROVE & MERGE（Blocking: 0）**（CTO Final Review Cover：docs/reviews/Sprint4E2_CTO_Review_Cover.md，Checklist 16 项全部 ✅；3 项财务一致性阻断项修复后复核全部 PASS；CI 全绿：Quality Gates/Build/Secret Scanning）

### Sprint 4E-2 Receipt & Payment Allocation Foundation（PR #17）

- **收款领域模型（收款事实源）**：Receipt / ReceiptAllocation / ReceiptRevision / ReceiptSnapshot + WriteOff / WriteOffAllocation（+6 模型 / +4 枚举，迁移 0019_receipt_payment_foundation，仅新增不改既有）；**Receipt = 唯一收款事实源（Payment 不单独建表）**；Receipt.code / WriteOff.code DocumentSequence **创建即取号**（RCT-/WO-2026-xxxx，拍板④）
- **创建与核销分离（拍板①）**：POST /api/receipts 只记录实际收到的钱（UNALLOCATED，unallocatedAmount=amount，不核销）；POST /api/receipts/{id}/allocate 显式核销且一次请求原子化（多 AR 批量同事务）
- **核销 M:N + 事务红线**：Lock Receipt → Lock 全部目标 AR（**id ASC FOR UPDATE**）→ 同 Customer / 同 Currency 校验（409 RECEIPT_CUSTOMER_MISMATCH / RECEIPT_CURRENCY_MISMATCH，第一版禁止跨币种）→ 校验 ≤ unallocatedAmount（409）→ 校验每笔 ≤ AR.balanceAmount（409，并发防超核销）→ Create ReceiptAllocation → 回写 AR（computeBalance 单入口）/ Invoice / Receipt 三方投影 → AR Revision + Snapshot(PAYMENT) → 事件
- **Allocation Reversal（≠ Credit Note）**：解除核销并留痕（reversedAt/reversedBy/reverseReason 写入原记录，**不删除**）；恢复三方投影；重复冲销 409 RECEIPT_ALLOCATION_REVERSED；CN 属 4E-3 发票调整域，不承担收款冲销（银行退票不是 CN）
- **VOID 规则（拍板②）**：仅 UNALLOCATED 可 VOID；已核销先 Reversal（否则 409 RECEIPT_VOID_FORBIDDEN）；无 CN 语义
- **WriteOff 独立事实（拍板③）**：WriteOff + WriteOffAllocation（不做三件套——审批历史 Workflow、审计 AuditLog）；创建校验同 Customer / 同 Currency（409 WRITE_OFF_SOURCE_NOT_COMPATIBLE）、amount>0、头金额=Σ allocations（服务端计算）；**创建/提交/审批均不修改 AR**
- **APPROVED ≠ APPLIED（CTO 锁死）**：WriteOff 按 ApprovalPolicy(module=WRITE_OFF) 条件触发 Workflow；submit 同事务 maybeTriggerWriteOffApproval（命中→PENDING 须 APPROVED 后才能 Apply / 未命中→可直接 Apply）；**Apply 是唯一修改 AR.writeOffAmount / balanceAmount 的入口**；重复 Apply 稳定 409 WRITE_OFF_ALREADY_APPLIED（幂等）
- **WriteOff ≠ Payment（财务红线）**：Apply 同事务 AR.writeOffAmount += / balanceAmount 重算 / **Invoice.balanceAmount 投影↓ 但 paidAmount 绝不增加**（防止报表把坏账核销误认为客户实际付款）→ AR Revision + Snapshot(WRITE_OFF) → WriteOff=APPLIED+appliedAt → 事件 WriteOffApplied + AccountsReceivableWrittenOff
- **Workflow actions 接入**：businessType="write-off" → COMPLETED→syncWriteOffApproval(APPROVED) / REJECTED→REJECTED；保持 APPROVED ≠ APPLIED
- **API**：10 端点（Receipt 创建/列表/详情/allocate/revisions/snapshots/void + Allocation reverse + WriteOff 创建/列表/submit/apply）；**RBAC**：6 模块（receipt / receipt-allocation / receipt-revision / receipt-snapshot / write-off / write-off-allocation）
- **事件**：EVENTS.md v1.11——4E-2 事件 10 个全部实现（ReceiptCreated/ReceiptAllocated/ReceiptFullyAllocated/ReceiptAllocationReversed/ReceiptVoided + WriteOffCreated/WriteOffSubmitted/WriteOffApproved/WriteOffRejected/WriteOffApplied；ReceiptUpdated 无 PATCH 端点保留注册）；AR WrittenOff 等联动发布
- **文档**：OpenAPI +10 端点/+30 schemas（171 paths/453 schemas）、docs/qa/Sprint4E2_QA.md（T1-T18）、docs/test-cases/Receipt_WriteOff_API.md（140+ 用例，A-N 14 组）、DOMAIN_MODEL v1.13（第 24 章）、ADR-0021（Accepted + Implemented，Ready for Final Review）、Review Cover
- **质量门禁**：分阶段提交链全部 CI 全绿（Receipt Create `d076e3a` / Allocation `c075dde`+`0440cd8` / Reversal-Void `68d697c`+`2353c8f` / WriteOff 三件套 `35bde4e`+`3b44ed0` / Create-Submit `4a89268`+`68fbe53` / Apply `224624d` / Workflow actions `aabedf2`）

## Sprint 4E-1 — Accounts Receivable Foundation（2026-08-08，PR #16 已合并，已纳入 v0.6.0-alpha）

> PR: #16（Sprint 4E-1 Accounts Receivable Foundation，feature/sprint4-sales）
> 状态：MERGED（squash f58fd87；未打 Tag；待 Sprint 4 Sales 完整闭环（4E-2 Receipt + 4E-3 CN/DN）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4E-1 Accounts Receivable Foundation **APPROVE & MERGE（98/100）**（CTO Final Review Cover：docs/reviews/Sprint4E1_CTO_Review_Cover.md，Checklist 12 项全部 ✅；Blocking Issues 0；核心架构复核全 PASS）

### Sprint 4E-1 Accounts Receivable Foundation（PR #16，已合并）

- **应收领域模型（余额事实源）**：AccountsReceivable / AccountsReceivableRevision / AccountsReceivableSnapshot（+3 模型 / +3 枚举，迁移 0018_accounts_receivable_foundation，仅新增不改既有；**禁止修改 Invoice 表**——CTO 拍板）；Invoice 1:1 AR（invoiceId @unique）；**Invoice = 单据事实源，AR = 余额事实源**（Invoice 上 paidAmount/balanceAmount 仅投影回写）
- **余额唯一口径（CTO 锁定）**：balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount；服务端唯一计算（computeBalance 单入口），前端禁止 PATCH 金额，由 4E-2 Receipt/4E-3 CN-DN 动作或下游事实表驱动
- **AR 唯一来源 Invoice（拍板①）**：Invoice ISSUED 后同事务自动创建（不延迟，失败整体回滚）；无独立创建端点
- **OVERDUE 惰性投影（拍板②）**：status ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → effectiveStatus = OVERDUE（不落库、不新增 Scheduler，与 Quotation EXPIRED 一致）
- **agingBucket 不存库（必改①）**：effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，属 Projection）
- **Snapshot 来源枚举（必改②）**：snapshotSource = ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL
- **Invoice 删除保护（必改③）**：AR exists → 禁止删除 Invoice（Restrict）；Cancel 也不删 AR，只能 CLOSED
- **Workflow 边界（必改④）**：AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 属 4E-2
- **查询 API（只读）**：GET 列表（含 effectiveStatus 惰性过滤 + 摘要 + 投影）、GET /aging（账龄分析）、GET 详情、GET revisions/snapshots；无 POST/PATCH
- **RBAC**：3 模块×10 动作（accounts-receivable* 全 view 语义）；**事件**：EVENTS.md v1.9（8 个 AR 事件注册，Closed 为 CTO Review 追加）
- **文档**：OpenAPI +5 端点/+13 schemas（161 paths/423 schemas）、Sprint4E1_QA.md（T1-T15）、AccountsReceivable_API.md（76 用例）、DOMAIN_MODEL v1.12（第 23 章）、ADR-0020（Approved with Changes → Accepted + Implemented）、Review Cover
- **质量门禁**：Phase 1-3 全绿（#31206666645/#31206929056/#31207456840）；OpenAPI/QA/TestCases 文档 commit 已推送（#31207456840 后）

## Sprint 4D — Invoice Foundation（2026-08-08，PR #15 已合并，已纳入 v0.6.0-alpha）

> PR: #15（Sprint 4D Invoice Foundation，feature/sprint4-sales）
> 状态：MERGED（squash cea4162；未打 Tag；待 Sprint 4 Sales 完整闭环（4D Invoice + 4E AR/Payment）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4D Invoice Foundation **APPROVE & MERGE（98/100）**（CTO Final Review Cover：docs/reviews/Sprint4D_CTO_Review_Cover.md，Checklist 14 项全部 ✅；Domain Design 98 / Architecture 98 / Transaction 98 / Pricing 100 / Workflow 98 / Documentation 100）

### Sprint 4D Invoice Foundation（PR #15，已合并）

- **发票领域模型（财务事实源）**：Invoice / InvoiceLine / InvoiceRevision / InvoiceSnapshot（+4 模型 / +4 枚举，迁移 0017_invoice_foundation，仅新增不改既有）；DeliveryLine +2 开票投影列（invoicedQty / remainingInvoiceQty，remainingInvoiceQty 由迁移初始化为 quantity）；Invoice.code 可空（DRAFT 不占号）
- **唯一创建入口（CTO 锁定①）**：无 Direct Invoice（不开放 POST /api/invoices）；`POST /api/deliveries/{id}/invoice`（按 id ASC 锁全部来源 Delivery → 校验 DELIVERED → 按 id ASC 锁 DeliveryLine 防超开票 → 四段溯源链取价 → DRAFT 建头 + 行 → 回写投影 → Revision + CREATED 快照）
- **Partial Billing（CTO 拍板①）**：DeliveryLine 投影支持一张 Delivery 拆多张发票；超开票 409 INVOICE_QUANTITY_EXCEEDED；cancel 对称回滚投影
- **Consolidated Invoice（CTO 拍板②）**：多 Delivery 合并开票，Customer/Currency/TaxProfile/PaymentTerm 必须一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE
- **金额红线（ADR-0019 §4）**：四段溯源链取价（DeliveryLine→sourceSalesOrderLineId→SalesOrderLine→priceSnapshotId→QuotationPriceSnapshot），直接复制价格快照，永不重算、不调用 Pricing Engine
- **编号延后生成（CTO 必改①）**：DRAFT code=NULL 不占号；issue 原子取号 INV-2026-000123；并发 issue 第二个请求稳定 409 不消耗编号
- **快照税务/汇率（CTO 必改②）**：InvoiceSnapshot 含 taxProfileId/taxRate/sstNo/currencyRate/exchangeRate，多年后 100% 还原
- **Lifecycle（CTO 拍板③④）**：DRAFT→ISSUED→（PARTIALLY_PAID/PAID 4E 投影）+ DRAFT→CANCELLED；InvoiceLine 系统生成只读（无 lines PATCH）；仅 DRAFT 可取消（ISSUED+ 走 Credit Note，无 VOID）
- **Workflow 集成**：ApprovalPolicy(module=INVOICE)→WorkflowInstance 单实例；终态回写投影；不建 InvoiceApproval 表；issue 审批门禁（有实例须 APPROVED）；PATCH 重审（paymentTerm/dueDate 变更触发，remark 不触发，策略缺失 409 INVOICE_WORKFLOW_FAILED）
- **查询 API（CTO Phase 4 指令）**：GET 列表（含 approvalStatus 过滤）+ GET 详情一次带出（Customer/Workflow/Delivery/SalesOrder 摘要/Lines/Latest Revision/Snapshot）+ lines/revisions/snapshots 只读 + PATCH 头（仅 DRAFT + 乐观锁 + 严格 remark/dueDate/paymentTerm）
- **API**：8 端点；**RBAC**：4 模块×10 动作（create→invoice:create、issue→invoice:approve、cancel→invoice:close）；**事件**：EVENTS.md v1.8（InvoiceCreated/Issued/Cancelled 已发布；PartiallyPaid/Paid 注册待 4E）
- **文档**：OpenAPI +8 端点/+19 schemas（156 paths/410 schemas）、Sprint4D_QA.md（T1-T18）、Invoice_API.md（137 用例，A-M 13 组）、DOMAIN_MODEL v1.11（第 22 章）、ADR-0019（Accepted+Implemented）、Review Cover
- **质量门禁**：Phase 1-4 全绿（#31192127210/#31193316359/#31199349323/#31201507334/#31201664772/#31202368518）；CI 修复 1 轮（fail helper import）

## Sprint 4C — Delivery Foundation（2026-08-07，PR #14 已合并，未发布 Tag）

> PR: #14（Sprint 4C Delivery Foundation，feature/sprint4-sales）
> 状态：MERGED（squash d1d8106；未打 Tag；待 Sprint 4 Sales 完整闭环（4D Invoice + 4E AR/Payment）后统一发布下一个 Alpha）
> CTO 结论：Sprint 4C Delivery Foundation **APPROVED & MERGE**（CTO Final Review Cover：docs/reviews/Sprint4C_CTO_Review_Cover.md，Checklist 12 项全部 ✅）

### Sprint 4C Delivery Foundation（PR #14，已合并）

- **交付领域模型（交付事实源）**：Delivery / DeliveryLine / DeliveryRevision / DeliverySnapshot（+4 模型 / +4 枚举，迁移 0016_delivery_foundation，仅新增不改既有）；SalesOrderLine +2 投影列（deliveredQty / remainingQty，remainingQty 由迁移初始化为 quantity）；SalesOrder +deliveredAt
- **唯一创建入口（CTO 锁定①）**：无 Direct Delivery；`POST /api/sales-orders/{id}/deliveries`（FOR UPDATE 锁 SO → 校验 CONFIRMED/PARTIALLY_DELIVERED → 原子取号 DO → 显式 lines 建行，分批发货）；不开放 POST /api/deliveries
- **防超交（CTO 锁定②）**：availableQty = orderedQty - confirmedDeliveredQty - openDeliveryQty 事务内动态计算（不新增 allocatedQty 列）；创建/编辑/READY/confirm 均重新校验；超出 → 409 DELIVERY_QUANTITY_EXCEEDED；PATCH 自身行排除当前行
- **Lifecycle（CTO 锁定⑤⑧⑨）**：DRAFT→READY→DISPATCHED→DELIVERED + DRAFT/READY→CANCELLED；READY 后行彻底冻结（不支持重新 ready，错误→cancel→新建）；confirm-delivery 固定 12 步事务（锁 Delivery→锁 SalesOrder→按 id ASC 锁全部源行防死锁→复查行→重新聚合→DELIVERED+POD 投影→DELIVERED 快照→回写 SO Line→聚合 SO→事件）；COMPLETED 仅枚举不提供 /complete
- **POD（CTO 锁定④）**：File Center 存文件 + Delivery 最小投影（podStatus PENDING/RECEIVED/WAIVED + podReceivedAt + podConfirmedById）；不建 DeliveryPOD 表；confirm-delivery POD 门禁（RECEIVED/WAIVED，否则 409）
- **SalesOrder 聚合**：confirm-delivery 后每行回写 deliveredQty/remainingQty，全部行 remainingQty≤0 → SO=DELIVERED+deliveredAt=now，否则有 confirmed → PARTIALLY_DELIVERED（不因 READY/DISPATCHED 提前标记）
- **API**：10 端点（主档 4 + lines 2 + ready/dispatch/confirm-delivery/cancel 4）；**RBAC**：4 模块×10 动作（ready/dispatch→edit、confirm→approve、cancel→close）；**事件**：EVENTS.md v1.6（Delivery 8 事件全部发布）
- **文档**：OpenAPI +10 端点/+20 schemas（148 paths/391 schemas）、Sprint4C_QA.md（T1-T15）、Delivery_API.md（111 用例）、DOMAIN_MODEL v1.10（第 20/21 章，补全 Sales Order 章节）、ADR-0018（Accepted+Implemented）、Review Cover
- **质量门禁**：Phase 1-4 全绿（#31174585598/#31175832377/#31179279069/#31182288149/#31184199449/#31186228815）；CI 修复 2 轮（NextRequest import / 动态段 slug 统一 [id]）

## Sprint 4B — Sales Order Foundation（2026-08-07，PR #13 已合并，未发布 Tag）

> PR: #13（Sprint 4B Sales Order Foundation，feature/sprint4-sales）
> 状态：MERGED（squash 3747eba；未打 Tag；待 Sprint 4 Sales 更完整后统一发布）
> CTO 结论：Sprint 4B Sales Order Foundation **APPROVED**（Final Review 3 阻断项 + 最终复审 1 阻断项全部修复，CI 全绿）

### Sprint 4B Sales Order Foundation（PR #13，已合并）

- **销售订单领域**：SalesOrder / SalesOrderLine / SalesOrderRevision / SalesOrderSnapshot（+4 模型 / +3 枚举，迁移 0015_sales_order_foundation，仅新增不改既有）
- **唯一创建入口（CTO 锁定①）**：无 Direct SO；`POST /api/quotations/{id}/convert` 正式实现（FOR UPDATE 行锁 + 原子取号 + P2002→409；复制 Line 继承价格 + sourceQuotationLineId 溯源，不重新定价）
- **价格红线（CTO 锁定②）**：schema 无 unitPrice；数量/UOM 变更走 `SalesOrderPricingService`（只调 PricingEngine.resolvePrice()，快照不写 quotationLineId 防污染溯源）→ 新 Revision + Snapshot
- **审批联动（CTO 锁定③ + 复审）**：Confirm 不重复审批；关键商业字段变更触发重新审批（无实例创建 / RUNNING 等待 / 终态复用同实例重新 SUBMIT：先失效旧 Approver 再建新 PENDING，清空 approvedAt/approvedById）；Confirm 审批门禁（有实例须 APPROVED 否则 409）
- **状态机**：DRAFT→CONFIRMED→PARTIALLY_DELIVERED→DELIVERED→COMPLETED；DRAFT/CONFIRMED→CANCELLED；交付状态由 Delivery 聚合回写（Sprint 4C，仅投影）
- **API**：8 路由文件 / 10 端点；**RBAC**：8 权限码（无 create）；**事件**：EVENTS.md v1.4（7 注册 / 5 发布）
- **文档**：OpenAPI convert 501→200 + 8 端点 + 16 schemas（139 paths/371 schemas）、Sprint4B_QA.md（T1-T15）、SalesOrder_API.md（A-H）、ADR-0017
- **质量门禁**：lint 修复 → CI #31158155759 全绿；CTO Final Review 3 阻断项修复 → `b68495a` CI #31160760480 全绿；最终复审阻断项修复（旧 Approver 失效 + 投影清空）→ `60a4290` CI #31161908240 全绿

## Sprint 4A — Quotation Foundation（2026-08-07，PR #12 已合并，未发布 Tag）

> PR: #12（Sprint 4A Quotation Foundation，feature/sprint4-sales）
> 状态：MERGED（未打 Tag；待 Sprint 4 Sales 更完整后统一发布）

### Sprint 4A Quotation Foundation（PR #12，已合并）

- **报价领域模型**：Quotation / QuotationLine / QuotationRevision / QuotationSnapshot（+4 模型 / +3 枚举，迁移 0014_quotation_foundation，仅新增不改既有）
- **定价红线（ADR-0015）**：行价必须来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId；schema 无 unitPrice 字段；quantity/uomId 变更均触发重新定价
- **审批集成（ADR-0016）**：Workflow 唯一事实源；submit 创建 WorkflowInstance；审批终态事务化回写投影 + APPROVED 快照；不建 QuotationApproval 表
- **API**：12 路由文件 / 18 端点（主档 CRUD + lines/revisions/snapshots + submit/accept/cancel/convert，convert 预留 501）
- **RBAC**：13 权限码；**事件**：EVENTS.md v1.3（11 注册 / 7 发布，总线前 AuditLog 留痕）
- **文档**：OpenAPI +12 路径/+26 schemas、Sprint4A_QA.md、Quotation_API.md、DOMAIN_MODEL v1.9、ADR-0015/0016 Implemented
- **质量门禁**：lint/type 修复 → CI #76 全绿；CTO Final Review 3 阻断项修复（lines PATCH 原子化 / Workflow 投影事务化 / Snapshot Decimal.toString()）→ CI #78 全绿

## v0.5.0-alpha — Sprint 3C: Business Foundation（2026-08-07 发布）

> PR: #7（3C-1 Customer）、#8（3C-2 Supplier）、#9（3C-3 Item）、#10（3C-4 Price）、#11（3C-5 Project Foundation）已全部合并
> 状态：RELEASED（v0.5.0-alpha：Sprint 3C 完整交付，Sprint 3 全部完成）

### Sprint 3C-1 Customer Foundation（PR #7，已合并）

- **Customer 主档**：Customer / CustomerContact / CustomerAddress / CustomerTag / Industry / Tag / CustomerCredit（+7 模型/+4 枚举）
- 迁移 0009_customer_foundation；RBAC +7 模块；API 13 端点；ADR-0009；DOMAIN_MODEL v1.6；OpenAPI 13 端点；Sprint3C1_QA.md；test-cases/Customer_API.md
- 统一规范三件套（Sprint 3C 起）：API_GUIDELINES.md / ERROR_CODES.md / EVENTS.md

### Sprint 3C-2 Supplier Foundation（PR #8，已合并）

- **BusinessPartner 唯一主体 + 角色化**：BusinessPartnerRole（PartnerRoleType：CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING 无限扩展）
- **Partner 级共享五件套**：PartnerContact / PartnerAddress（PartnerAddressType 含 Billing/Shipping/Registered/Warehouse/Factory）/ PartnerTag / PartnerBankAccount / PartnerCredit
- **Supplier 独有仅三项**：SupplierQualification / SupplierCertificate / SupplierSettlement；Customer 不返工（ADR-0011 规划 Sprint 5 统一迁移）
- 迁移 0010_supplier_foundation（10 表+4 枚举）；RBAC +10 模块；API 18 路由文件；seed SUP-0001/0002 + 3 PartnerRole
- 文档：ADR-0010/0011、DOMAIN_MODEL v1.7（79 模型/37 枚举）、OpenAPI 75 paths/203 schemas、Sprint3C2_QA.md、test-cases/Supplier_API.md
- Sprint 4 预备（仅设计）：Sprint4_Quote_Domain/ERD/API/Workflow 四份文档

### Sprint 3C-3 Item Foundation（PR #9，已合并）

- **Item Master（ERP 核心主数据）**：ItemType 10 类枚举 + 五级层级（Category→SubCategory→Series→Model→Variant）+ Identification（OEM/Barcode/QRCode/DrawingNo/Revision）+ 多 UOM（Stock/Purchase/Sales + UomConversion）+ isSalable/isPurchasable/isManufacturable
- **SpecificationDefinition（CTO #2138）**：定义/实例分离（code/name/unit/dataType/isRequired），ItemSpecification.definitionId 关联，过滤/排序/范围查询友好
- **ItemCategory 改 CategoryPath（CTO #2138）**：去 parentId 递归 → 001/001.003/001.003.005（unique），子树 startsWith 查询免递归
- **ItemStatus 与 ItemLifecycle 分离（CTO #2138）**：系统状态 ACTIVE/INACTIVE/LOCKED/ARCHIVED vs 产品生命周期 DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE
- **ItemRevision 独立**：revisionNo/revision/changeSummary/releasedById/releasedAt/status（RELEASED 同步 Item.revision、旧版 SUPERSEDED）
- **SupplierItem**：一个 Item 多供应商（supplierCode/MOQ/LeadTime/Currency/PurchasePrice/isPreferred/Incoterm/PaymentTerm，不建 Item.supplierId 单值字段）
- **ItemCost 只建接口**：costType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT）+ 时间维度 effectiveFrom/effectiveTo/currency/source
- **AttachmentType 统一放 File Center**（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT）
- 迁移 0011_item_foundation（Item ALTER 加列 + 8 新表，仅新增/加列不改既有列）；RBAC item 动作级 + 8 子模块；API 18 路由文件
- 文档：ADR-0012、DOMAIN_MODEL v1.8（87 模型/40 枚举）、EVENTS v1.1（ItemCreated 等 5 事件）、Sprint3C3_QA.md、test-cases/Item_API.md、OpenAPI 93 paths/251 schemas
- Price 前置：PRICE_STRATEGY.md + MASTER_DATA_DEPENDENCY.md（CTO #2138）

### Sprint 3C-4 Price Foundation（PR #10，已合并）

- **价格领域完整建模（+11 模型 / +9 枚举 → 总计 98 模型 / 49 枚举）**：PricePolicy / PriceRule / PriceListVersion / PartnerPrice / PromotionRule / TaxProfile / TaxRate / TaxProfileRule / ExchangeRate / QuotationPriceSnapshot / PriceAudit
- **PricePolicy 双轨**（pricePolicyId FK + policyType 快照）+ matchStrategy/stopOnMatch（CTO #2249）；**PriceRule 独立建模**（7 类规则，CTO #2345）
- **PartnerPrice 统一**（partnerRoleType 枚举 + partnerRoleName 快照 + priority/approvalRequired）；**PromotionRule 独立**（PERCENT/AMOUNT + priority/stackable/exclusive）
- **TaxProfile 多国复用**（CN 13%/MY SST/SG GST + taxIncluded）+ TaxRate 时间维度 + TaxProfileRule 规则
- **ExchangeRate 独立维护**（base/quote/rate/effectiveDate 复合唯一 + provider/source/rateType/manualOverride）
- **QuotationPriceSnapshot 完整定价链**（Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final）+ **PriceAudit 独立审计**
- **PricingEngineService**：resolvePrice() 唯一入口（Policy→Rules→PartnerPrice/PriceList→Promotion→Currency→Tax→Snapshot→Audit），全程 Decimal 禁止 Float
- 迁移 0012_price_foundation（12 新表 + 92 ALTER，仅新增）；RBAC +10 模块；API 10 资源（含 POST /api/pricing/resolve 唯一入口）
- Seed 幂等：6 策略 + 3 规则 + 3 税档 + 6 汇率 + Demo Promotion
- 文档：ADR-0013（Implemented）、OpenAPI 10 资源 + Resolve Price Sequence、Sprint3C4_QA.md（8 关键场景）、test-cases/Price_API.md、ERD 更新

### Sprint 3C-5 Project Foundation（PR #11，已合并）

- **项目领域增强（+1 模型 → 总计 99 模型 / 48 枚举）**：ProjectTag 复用全局 Tag；Project +priority + progressPercent；ProjectProduct +priceSnapshotId（引用 QuotationPriceSnapshot，SetNull）；ProjectOpportunity +convertedAt/convertedBy
- **Opportunity → Project 唯一转换入口**：convert 事务（**真实行锁 SELECT ... FOR UPDATE** + DocumentSequence.nextNo **原子 increment** + P2002 兜底 409，并发安全）
- **阶段流转集中校验 + 结项规则**：transition 集中校验；结项默认强制阻断 + 双权限（project:close + project:approve）强制结项
- 迁移 0013_project_foundation（仅新增/加列，不重建既有 14 个 Project 模型）；RBAC +12 子模块；API 16 路由 / 34 文件
- Domain Events（EVENTS.md 注册）：ProjectOpportunityConverted / ProjectCreated / ProjectStageChanged / ProjectMemberAssigned / ProjectMilestoneCompleted / ProjectRiskRaised / ProjectRiskClosed / ProjectAccepted / ProjectClosed / ProjectForceClosed
- 文档：ADR-0014（Accepted）、Sprint3C5_QA.md、test-cases/Project_API.md、OpenAPI 更新

### Compatibility / Database / Migration / Breaking Changes

- **Compatibility**：向下兼容 v0.4.0，无 Breaking Changes（Customer 子模型保留兼容，不返工）
- **Database**：新增 33 模型 + 12 枚举（迁移 0009-0013，仅新增不改既有表/列）
- **Migration**：0009_customer_foundation / 0010_supplier_foundation / 0011_item_foundation / 0012_price_foundation / 0013_project_foundation
- **Breaking Changes**：无，全部为新增表、字段、索引、权限及 API

### Known Risks（后续计划）

- Domain Event 目前仅注册，事件总线尚未真正发布（Sprint 4 业务事件驱动前落地）
- File Center 仍只管理元数据，对象存储尚未接入
- Notification 外部渠道（EMAIL/TELEGRAM/WEBHOOK）尚未接入
- Railway 运行级完整回归仍需执行
- BusinessPartner Consolidation（Customer 子模型迁移到 Partner 级共享）仍按 ADR-0011 延后处理（Sprint 5）

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.4.0-alpha — Sprint 3B: Platform Capabilities（2026-08-05）

> PR: #6 — `feature/sprint3-platform-capabilities`（已合并，merge commit e54567e67c）
> 状态：RELEASED（CTO Approve，综合成熟度 99/100）

### Sprint 3B 完成内容

- **Audit Center**：AuditLog +8 字段 + AuditResult 枚举 + requestMeta() + audit-logs API（ISO 审计/操作追溯/审批追踪/安全分析）
- **Menu Center**：MenuGroup + Menu 树 + RouteMeta（icon/sort/hidden/cache/externalLink/permission），前端直接读取
- **Dashboard API**：Widget/Layout/KPI/Chart 四模型，只提供数据 API（Sprint 8 BI 接入）
- **File Center**：File/Folder/Version/Attachment，业务单据统一附件引用
- **架构冻结**：ARCHITECTURE_BASELINE v1.0（调整必须 ADR）
- **迁移 0005-0008**：+8 模型/+3 枚举；**RBAC**：+10 模块动作级权限
- **文档**：ADR-0005~0008、DOMAIN_MODEL v1.5（62 模型/29 枚举）、OpenAPI 4100+ 行、test-cases 4 份

### Compatibility / Database / Migration / Breaking Changes

- **Compatibility**：向下兼容 v0.3.0，无 Breaking Changes
- **Database**：新增 8 模型 + 3 枚举；AuditLog ALTER 加列（不重建表）
- **Migration**：0005_audit_upgrade / 0006_menu_center / 0007_dashboard_api / 0008_file_center
- **Breaking Changes**：无

### Known Risks（后续计划）

- File 仅元数据建模（对象存储后续接入）、Preview 白名单判定、Dashboard 无页面（Sprint 8）、承接 3A 未完成项、运行级 Railway 验证待执行

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.3.0-alpha — Sprint 3A: Workflow Foundation（2026-08-05）

> PR: #5 — `feature/sprint3-platform-foundation`（已合并，merge commit 42ebf22262）
> 状态：RELEASED（CTO 条件批准，已知风险列入后续计划）

### Sprint 3A 完成内容

- **Workflow Engine（6 模型）**：Definition/Step/Condition/Instance/Action/History；统一动作 9 种；条件结构化存储；4 审批模式
- **Approval Engine（7 模型，解耦）**：Approver/ApproverGroup/Member/Delegate/Escalation/Timeout/Reminder
- **Notification（4 模型）**：Template/Message/Channel/Log（渠道建模，真实发送后续）
- **Dictionary（2 模型）+ Settings（3 模型）**：三层 Key-Value，encrypted 掩码
- **API 12 组端点**：统一响应/错误 + Zod + 权限 + 审计 + 乐观锁 + 软删除 + transaction
- **迁移 0004**：22 表 + 11 枚举 + 59 索引 + 13 外键
- **RBAC**：+21 平台模块动作级权限；**Seed 幂等**（稳定 code + upsert）
- **单测 21 用例 + OpenAPI 全端点 + ADR-0004 + ERD（DOMAIN_MODEL v1.1）+ QA 文档**

### Compatibility / Database / Migration

- **Compatibility**：向下兼容 Sprint 2 数据模型，无 Breaking Changes（仅新增表/枚举/权限）
- **Database**：新增 22 表 + 11 枚举，既有表未修改
- **Migration**：`0004_workflow_foundation`（幂等可重放）

### Known Risks（后续计划，未完成项）

- 无可视化流程设计器、无真实邮件/Telegram/Webhook 发送、无定时调度器/超时自动升级、Settings 加密为标记+掩码、运行级 Railway 验证待执行、业务审批页面 Sprint 4+

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.2.0-alpha — Sprint 2: Master Data & Project Domain（2026-08-05）

> PR: #4 — `feature/sprint2-master-data`（已合并，merge commit a00d4223e6）
> 状态：RELEASED（CTO 验收）

### Sprint 2 完成内容

- **中国版主数据**：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）+ PriceList 含税价格体系 + TechnicalStandard/UnitOfMeasure/CommercialTerm/DocumentSequence
- **项目领域 14 模型 + 8 枚举**：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- **企业字段补强（2C）**：BusinessPartner +14、Item +14、PriceList +priceType（9 类价格）、Project +9 财务字段、DocumentSequence +docType（17 种单据）
- **权限动作级设计**：view/create/edit/delete/approve/audit/export/import/assign/close
- **迁移**：`0002_master_data_cn` + `0003_project_domain`
- **文档体系**：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/、CHANGELOG.md

### 验收

- CI：Quality Gates ✅ / Secret Scanning ✅ / Build ✅
- PR #4：merged ✅

## v0.1.0-alpha — Sprint 1: Infrastructure（2026-08-04）

> PR: #3 — `feature/sprint1-infrastructure`（已合并）
> 状态：READY FOR DEPLOYMENT QA（CTO Review 2026-08-04）

### Sprint 1 完成内容

- **Monorepo 骨架**：pnpm workspace + Turborepo 2，`apps/web`（Next.js 15 App Router）+ `packages/{config,shared,types,ui}`
- **工程规范**：ESLint 9 + Prettier + Husky + lint-staged，strict TypeScript
- **Prisma 数据模型（6 个）**：User / Department / Role / Permission / UserRole / AuditLog
- **初始 Migration**：`prisma/migrations/0001_initial`
- **Seed**：Super Admin 角色 + 基础权限 + 默认 Department（ENG）+ 管理员账号
- **认证**：JWT（jose HS256）+ bcryptjs，`/api/auth/login`、`/api/auth/me`
- **健康检查**：`GET /api/health` → 200
- **RBAC**：SUPER_ADMIN/ADMIN/MANAGER/MEMBER/VIEWER

---

历史详细记录见 `docs/releases/`。
