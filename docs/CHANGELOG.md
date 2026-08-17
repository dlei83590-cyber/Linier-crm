# CHANGELOG

所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased] - Sprint 4A + 4B + 4C + 4D + 4E-1 + 4E-2 + 4E-3（Quotation / Sales Order / Delivery / Invoice / Accounts Receivable / Receipt & Payment Allocation / Credit Note & Debit Note Foundation，2026-08-08，PR #12-#18 已合并，未打 Tag）

### 新增（B2-2A / B2-2B：Project Budgets + Expenses + Progresses FINAL CLOSED，PR #70-#75，2026-08-17）

- **B2-2A FINAL CLOSED ✅ / B2-2B FINAL CLOSED ✅**（owner 签署，Production `dcefea3e`，**31/31 Runtime Acceptance PASS — ACCEPTED**，QA 证据见 docs/qa/B2-2_Runtime_QA.md）
- **B2-2A（Budgets + Expenses）**：前端 Add/Edit/Delete 工作台（PR #71 `a3c789c`）+ changed-only PATCH + amount blank gate hotfix（PR #72 `a866d10`）；Runtime 验证：Budget create/PATCH CAS/stale 409/soft delete、Expense create + incurredAt 时区 round-trip（+08 本地 → UTC Z instant-equivalence）、**note-only PATCH 前后 incurredAt 完整 ISO 不变**、clear→null、amount blank → 400 VALIDATION_ERROR、stale version 409、soft delete 全链路 PASS
- **B2-2B（Progresses）**：前端 Add/Edit/Delete（PR #73 `8b0af12`）+ backend aggregate integrity（PR #74 `fc7cc82`，`Project.progressPercent` 在 create/edit/delete 全链路维护）+ recordedAt datetime-local 时区转换（PR #74 `096a7f2`）；Runtime 验证：**POST 30 → header 30.0 → PATCH 60 → 60.0 → PATCH 80 → 80.0 → DELETE 次新 → fallback 80.0 → DELETE 最后 → null** 全链路 PASS、recordedAt +08 round-trip、stale 409
- **CLOSED 双层 Gate**：B2-0（PR #70 `2bb40d7`）为 budgets/expenses/progresses 补 `assertProjectWritable` transactional gate；Runtime 验证 force close 200（stage=CLOSED）后 Budget/Expense/Progress direct POST 全 **409 CONFLICT「项目已结项，不允许修改项目子资源」**
- **RBAC drift root cause（PR #75 `dcefea3e`，Runtime Blocking ①）**：`packages/shared/src/constants/index.ts` 的 `PERMISSION_MODULES` 缺注册 17 个 seed-only 模块（project-budget/expense/product/progress/acceptance/closure/tag/attachment + exchange-rate/partner-price/price-policy/price-rule/price-list-version/promotion/tax-rate/pricing-engine/price-audit）→ `ALL_ACTION_PERMISSIONS` 不含这些 action → SUPER_ADMIN 也 403；一次性补齐并同步 `PROJECT_MODULES`；静态审计 308 个 API 引用权限码缺失归零
- **B2-1B regression PASS**：PR #75 顺带修复 product/tag 潜伏 403；Runtime 验证 `capabilities.products/tags=true`、Product Add 201、Tag Add 201
- **治理规则（backlog，本轮不实现）**：`API referenced permission ⊆ ALL_ACTION_PERMISSIONS` 拟做成 CI 静态 Gate（独立 Governance Audit，不夹带进 Lifecycle 工作）；详见 ADR-0028

### 新增（Sprint 6A：Inventory Ledger Foundation，PR #21，待 CTO Final Review——CTO Inventory Consumer + Ledger Command FINAL APPROVED 99/100 #7683，6A 核心库存账闭环成立）

- **库存数量唯一事实源 = InventoryMovement（SSOT，ADR-0025）**：Migration `0025_inventory_ledger_foundation`（InventoryMovement + StockProjection + OutboxMessage + 6 枚举 + `INVENTORY_MOVEMENT` DocumentType + 不可变触发器 + 五维 NULLS NOT DISTINCT 唯一索引 + onHandQty>=0 CHECK + serial_atom_key_check）；**Movement 历史不可变**（COMMITTED 后禁止 UPDATE/DELETE，纠错只能追加 Reversal/Correction）
- **StockProjection 物化投影**：五维唯一（PG16 `UNIQUE NULLS NOT DISTINCT`，dimensionKey 仅查询/锁键非身份）+ onHandQty>=0 CHECK（负库存 DB 最后防线）
- **Transactional Outbox（P1/P8）**：业务事实 + Outbox 同事务（WarehouseReceipt POST → `WarehouseReceiptPosted` / PurchaseReturn RETURN → `PurchaseReturned`，仅 WAREHOUSE_RECEIPT_LINE 来源行）；Outbox `PENDING/PROCESSING/PROCESSED/DEAD_LETTER` + lease/retry 元数据；保留记录不删除
- **五元 atom 幂等**：`sourceType|sourceId|sourceLineId|movementRole|movementAtomKey`（serial-managed 每 serial 一条 quantity=1；非 serial BULK）；**serial 原子化 + 数量守恒 + 去重 + canonical dimensions 必填（itemId/warehouseId/quantity>0）**——poison Outbox 防线
- **Inventory Consumer + Ledger Command**：claim `FOR UPDATE SKIP LOCKED` + PROCESSING lease → validate payload / resolve source → 五元幂等（`ON CONFLICT DO NOTHING RETURNING`）→ 锁五维 StockProjection（IS NOT DISTINCT FROM + FOR UPDATE）→ OUT 禁负库存 → **INSERT Movement + UPSERT Projection + MARK Outbox PROCESSED 同事务** → retry 退避 / DEAD_LETTER / LEASE_LOST（lease fencing：消费前/完成时验证 `status=PROCESSING + lockedBy=workerId`）
- **事件**：`InventoryMovementCommitted` ⏳→✅（Consumer 单事务提交后发布，**不含投影余额**——P10 Final；EVENTS v1.26）；触发端点 `POST /api/inventory-ledger/consume`（权限 `inventory-ledger:consume`）
- **边界（不在 6A Foundation 范围）**：Transfer / Conversion / Count（盘点）/ Costing（FIFO/移动平均）/ ReservedQty（availableQty）/ 新 sourceType——后续独立阶段
- **Release Readiness（Seed/RBAC）**：DocumentSequence seed 新增 `INVENTORY_MOVEMENT`（code=MV，prefix MV，padLength 6，幂等 upsert——Consumer 取号依赖，缺失=配置错误 RETRY 无 fallback）；`inventory-ledger:consume` 注册为**受限系统权限**（SYSTEM_PERMISSIONS——仅 SUPER_ADMIN/ADMIN 静态授权，Manager/Member/Viewer 默认 403，QA A2/A3 保持无权限）
- **文档**：Sprint6A_QA.md、docs/test-cases/InventoryLedger_API.md、OpenAPI +1 端点/+3 schemas（Inventory Ledger consume 契约）、ADR-0025 → Implemented（Implementation Status I1-I12）、EVENTS v1.26、ROADMAP Sprint 6 → 🔄（6A ✅）

### 新增（Sprint 6B：Inventory Operations，PR #22，待 CTO Sprint 6B Final Review——Transfer/Stock Count/Adjustment/Conversion 四块 Vertical Slice 全部 FINAL APPROVED，Sprint 6B Finalization 完成）

- **四块库存作业 Vertical Slice 全部 FINAL（CTO：Transfer 98/100 #8471 / Stock Count 98/100 #8658 / Inventory Adjustment 98/100 #8658 / Conversion 99/100 #8726，Blocking 0）**：Migration `0026_inventory_operations_foundation`（InventoryTransfer/Line、StockCount/Line、InventoryAdjustment/Line、InventoryConversion/Line 业务事实层 + 终态证据 CHECK×3 + maker-checker CHECK×2 + sourceStockCountLineId UNIQUE + UNIQUE(conversionHeaderId, lineRole)）；四模块 5×4=20 个 API routes + Seed/RBAC + TRF/CNT/ADJ/CVT DocumentSequence（缺失 fail closed）
- **共享 InventoryLedgerCommand Core（Phase 6B-1）**：`apps/web/src/lib/inventory-ledger/ledger-command.ts` 抽取 `executeLedgerAtom(s)`（caller-owned tx；五元幂等 + immutable-fact equality + group-level invariant），6A Consumer 语义零回归（CTO #8233 98/100 FINAL APPROVED）；**四模块 0 直写 InventoryMovement/StockProjection**（全局红线扫描 ✅）
- **Inventory Transfer（调拨，6B-2）**：TRF 序列（缺失 fail closed）/ 5 routes（list/create/[id]/submit/cancel/**execute**）/ SOURCE_OUT + DESTINATION_IN 同一**稳定** movementGroupId（EXECUTE 时生成/复用并冻结——CTO Transfer Review Blocking ②）经 Shared `executeLedgerAtoms` 同事务双边落账（全有或全无）/ 自调拨拒绝（同仓同库位 409）/ serial 守恒 / 重试幂等；事件 `InventoryTransferExecuted` ✅
- **Stock Count（盘点，6B-3）**：CNT 序列 / 5 routes（list/create/[id]/lines/**complete**/cancel）/ 行录入时**同事务读五维 Projection 冻结**（bookQtyAtCount/countedAt/ledgerWatermark/varianceQty——盘点时点事实）/ Complete **FOR UPDATE + 锁后终态幂等**（COMPLETED/ADJUSTED 稳定响应不重复创建，事件一次性 `if (!result.idempotent)`）/ **variance 冻结不重算**（Count 永不直写 Projection；Adjustment Create/Apply 零重读）；事件 `InventoryCountCompleted` ✅
- **Inventory Adjustment（调整，6B-3）**：ADJ 序列 / 5 routes（list/create/[id]/submit/**apply**/cancel）/ **maker-checker**（apply 人 ≠ createdById，409 MAKER_CHECKER）/ 非零 Count variance 自动生成 COUNT_VARIANCE Adjustment 仍需审批（不绕过 maker-checker）/ 经 Shared LedgerCommand 追加 ADJUSTMENT Movement（movementGroupId=adjustment.id 稳定；sourceStockCountLineId @unique 防双重入账）/ 终态证据 CHECK（APPLIED ⇒ approvedById/appliedById/appliedAt 全非空）；事件 `InventoryAdjustmentApplied` ✅
- **Inventory Conversion（转换/Repack，6B-4）**：CVT 序列 / 5 routes（list/create/[id]/submit/**execute**/cancel）/ **baseQuantity 服务端 canonical**（schema 不收，`computeBaseQuantity` ROUND_HALF_UP(×,4) 唯一入口）+ **Execute 逐行 canonical 重验（stored === 重算值，400 BASE_QTY_INVALID——CTO #8706 Blocking ①）** + **baseUom==item.stockUom 重验（Blocking ②）** + 守恒（CONSUME==PRODUCE）+ same item（行无 itemId，结构锁死）+ batch 精确继承 + serial 禁 / CONSUME + PRODUCE 同一 movementGroupId 经 Shared Core 原子提交 / **无审批状态机**（DRAFT→SUBMITTED→EXECUTED/CANCELLED，计量事实不发明审批流）；事件 `InventoryConversionExecuted` ✅
- **事件终态（EVENTS v1.29）**：`InventoryTransferExecuted` / `InventoryCountCompleted` / `InventoryAdjustmentApplied` / `InventoryConversionExecuted` 全部 ⏳→✅（事务提交后 best-effort、**不含投影余额**，与账本原子事件 `InventoryMovementCommitted` 区分）
- **边界（不在 6B 范围，CTO #8726 明令 HOLD）**：Reservation / ReservedQty / AvailableQty / Costing / FIFO / Moving Average / Sales shipment OUT 等其他新 sourceType——后续独立阶段；`InventoryMovementType` 枚举 TRANSFER_OUT/TRANSFER_IN/CONSUME/PRODUCE/ADJUSTMENT 仍标"未来"（本轮以 direction OUT/IN + movementRole 表达）
- **文档**：Sprint6B_QA.md（6B-1~6B-4 四段 + Finalization 总检）、docs/test-cases/（InventoryTransfer_API.md / StockCount_Adjustment_API.md / Conversion_API.md）、OpenAPI Sprint 6B 段（4 tags × 5 endpoints + components）、ADR-0026 → Implemented（Implementation Status I1-I11）、EVENTS v1.29、ROADMAP Sprint 6 → 🔄（6A ✅ + 6B ✅）

### 新增（Sprint 5B：Goods Receipt & Inbound Foundation，PR #20，待 CTO Final Review——CTO PurchaseReturn FINAL APPROVED 98/100 #7303，Sprint 5B 核心事实链 CLOSED）

- **收货/入库拆两层事实（ADR-0024 D1）**：`PurchaseReceipt`（到货/收货事实，只保留收货现场事实 quantity/visibleDamageQty/rejectedOnReceiptQty/remark；更新 PO Line 收货投影）+ `WarehouseReceipt`（采购入库事实，仓库/库位/批次/序列号/效期；**库存追溯信息 canonical capture point P6**；驱动 6A InventoryMovement(IN) 的业务事实）
- **只有 CONFIRMED PO 才是收货合法来源（D2/D9）**：`CONFIRMED / PARTIALLY_RECEIVED` 可收；**RECEIVED 禁普通新增收货**（终止 Gate，追加需走 Reopen/Amendment/Over-Receipt Exception）；无 Direct GR
- **库存数量唯一事实源 = InventoryMovement（D3，6A）**：**5B 全程 0 写 Stock/InventoryMovement**（红线 D12）；WarehouseReceipt **D10：Created ≠ Posted，只有 Posted 才发布 WarehouseReceiptPosted 并触发 6A InventoryMovement(IN)**
- **质检唯一事实（D8）**：`Inspection` 独立模型（SKIP/SPOT/FULL）；inspectableQty = quantity - rejectedOnReceiptQty；**qualifiedQty + rejectedQty = inspectableQty（= 强制）**；SKIP 免检服务端强制 QUALIFIED（**不绕过 Inspection 记录**）；一次 Inspection 即最终结果（DB unique）；result 服务端推导
- **退货 = 独立 PurchaseReturn（D5/P5）**：非负 GR；**三来源 exactly-one FK + API 强制匹配**（RECEIPT_LINE / INSPECTION = 未入库退货不碰库存；WAREHOUSE_RECEIPT_LINE = 已入库退货必须来自 POSTED 入库事实，**不写 InventoryMovement(OUT)**）；**来源可退余额（CTO Re-review Blocking ①）**：RECEIPT_LINE=rejectedOnReceiptQty / INSPECTION=rejectedQty / WAREHOUSE_RECEIPT_LINE=POSTED 入库行 quantity（Create 预检查与 Return Gate 同源防分叉）；**Return Gate 锁真实来源 + 锁内重算累计 RETURNED（防并发超退）**；disposition 必填
- **REPLACE_REQUIRED 真正 reopen PO 履约（CTO Re-review Blocking ②）**：Return 事务内锁 PurchaseOrderLine，INSPECTION/WAREHOUSE 来源 `receivedQty -= returnQty`、`remainingReceiveQty` 重开待交；**RECEIPT_LINE 收货时未计入 receivedQty 不重复 reopen**；PO 原状态 RECEIVED + 有效 reopen → 重聚回 PARTIALLY_RECEIVED；原始事实不倒改
- **PO Line 收货投影（D6/P7）**：`receivedQty_new = receivedQty_old + (quantity - rejectedOnReceiptQty)`（现场拒收不计入）；remainingReceiveQty = max(quantity - receivedQty, 0) 服务端唯一计算（tolerance 只用于 receive ceiling）；PO 聚合状态 RECEIVED / PARTIALLY_RECEIVED
- **超收容差（D7/P2）**：System Default 0%；超容差 → 409 OVER_RECEIPT（不默认 5%）
- **事件（EVENTS.md v1.23 终态）**：`PurchaseReceiptReceived / InspectionCompleted / WarehouseReceiptPosted / PurchaseReturned / PurchaseOrderPartiallyReceived / PurchaseOrderReceived` 全部 ✅；**PurchaseReturned 载荷 line-level disposition**（lines[] + hasReplacementRequired/hasCreditOnly，弃第一行单值冒充整单）；事件均事务后发布、**不含库存余额**；DRAFT 创建/编辑不发领域事件
- **Schema/Migration 0023（纯增量）**：四模块模型 + 枚举（PurchaseReceiptStatus / InspectionMode / InspectionResult / WarehouseReceiptStatus / PurchaseReturnStatus / PurchaseReturnType / PurchaseReturnDisposition 等）
- **文档**：OpenAPI +13 端点/+40 schemas（Sprint 5B 四模块全生命周期 + 错误码；D9/D10/来源可退余额/reopen 语义/line-level disposition 全部写清）；QA/Test Cases（PurchaseReceipt_API.md + Inspection_API.md + WarehouseReceipt_API.md + PurchaseReturn_API.md + Sprint5B_QA.md）；ADR-0024 → Implemented；ROADMAP Sprint 5 🔄（5B ✅）；EVENTS v1.21→v1.23

### 新增（Sprint 5A：Purchase Requisition & Purchase Order Foundation，PR #19，已合并——CTO #6575 方案 A 重定义完整范围）

- **采购领域事实源（设计拍板③/⑤）**：`PurchaseRequisition` = 需求事实源（**无金额字段**，只表达要什么/多少/何时/为何）；`PurchaseOrder` = 对供应商的采购承诺事实源（金额服务端 Decimal 聚合，禁客户端直传头金额）；PR→PO Convert 是复制投影、不修改 PR 事实；Supplier 主数据复用（Sprint 3C-1）不新建
- **PO 生命周期锁死（拍板③）**：`DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`；`DRAFT → CANCELLED`；**APPROVED ≠ CONFIRMED**（审批通过 = 公司内部同意采购；显式 `POST /confirm` = 正式形成对供应商的采购承诺；**只有 CONFIRMED PO 才是 5B Goods Receipt 唯一合法来源**——代码/OpenAPI/QA/文档四处一致）
- **Schema/Migration（纯增量）**：Migration 0021（5 枚举 + 7 模型，0 DROP/RENAME/TRUNCATE）+ Migration 0022（**PurchaseOrderSnapshot 唯一约束修复** `[purchaseOrderId, snapshotType]` → `[purchaseOrderId, snapshotType, revisionNo]`——多轮审批快照不冲突；PO Header +**purchaserId/departmentId** 采购员/采购部门维度）
- **双入口 + 溯源**：PO `sourceType = REQUISITION | DIRECT`（Direct 显式可审计、不能绕过 PO Approval）；行级 `sourcePurchaseRequisitionLineId`（REQUISITION 必填 + 服务端三条件校验 409 SOURCE_LINE_INVALID；DIRECT 强制禁止 400 SOURCE_LINE_FORBIDDEN）
- **价格双通道（拍板③）**：`SUPPLIER_PRICE_SNAPSHOT`（PartnerPrice 服务端解析，未命中 409 PRICE_NOT_FOUND）｜`MANUAL`（unitPrice + priceReason + priceSetById/At 审计三件套）；税率快照复制；行金额/头金额服务端 Decimal 计算
- **审批复用 Workflow（拍板①）**：ApprovalPolicy module=PURCHASE_REQUISITION / PURCHASE_ORDER 各自独立条件审批；单 WorkflowInstance 多轮重提（REJECTED 后复用同一实例重新 SUBMIT，对齐 SalesOrder/WriteOff 模式）；businessType=purchase-requisition/purchase-order 终态回写（COMPLETED→APPROVED，**永不自动 CONFIRMED**；REJECTED→DRAFT）；不建 Approval 表
- **Submit / Confirm / Cancel（CTO Phase 4B）**：Submit 仅 DRAFT + 校验（≥1 行/qty>0/Supplier 有效/来源一致/金额重算一致），命中策略→PENDING、无策略→直接 APPROVED 投影（仍非 CONFIRMED）；Confirm 事务 FOR UPDATE 行锁 + 状态门禁（仅 APPROVED + approvalStatus=APPROVED）→ CONFIRMED + confirmedAt/ById + CONFIRMED Snapshot + Revision + 事件，**并发第二个 Confirm 稳定 409（幂等）**；Cancel DRAFT/APPROVED 可取消、SUBMITTED 409（先 Withdraw→DRAFT）、CONFIRMED+ 409 禁止（已形成外部承诺）
- **并发/一致性门禁**：PATCH 原子 CAS（updateMany where {id, version, status} count===1 → 409 VERSION_CONFLICT）；Convert 事务 FOR UPDATE 行锁 + 重复转换 409 ALREADY_CONVERTED；revision/snapshot 变更留痕
- **事件**：EVENTS.md v1.14 → v1.17，11 个采购事件全注册（含 PurchaseOrderConfirmed/Cancelled；GR/Supplier Invoice 事件 5B/5C 注册）
- **文档**：OpenAPI +9 端点/+17 schemas（PR/PO 全生命周期 + 错误码；APPROVED≠CONFIRMED / Confirm 并发 / Snapshot 多轮 / 双来源链 / purchaserId/departmentId / 只有 CONFIRMED PO 才是 5B GR 来源 全部写清）；QA/Test Cases（PurchaseRequisition_API.md + PurchaseOrder_API.md）；ADR-0023 → Implemented；ROADMAP Sprint 5 🔄；AGENTS.md Verification Policy（禁止本地高资源验证，CI 为验证事实源）

### 新增（Sprint 4E-3：Credit Note / Debit Note Foundation，PR #18，已合并——CTO Final Review **99/100 APPROVE & MERGE**（Blocking 0），squash `675923c`）

- **发票调整领域（调整事实源）**：CreditDebitNote / CreditDebitNoteLine / InvoiceAdjustment（+3 模型 / +2 枚举，迁移 `0020_credit_debit_note_foundation`，纯增量不改既有；DocumentType 复用 CREDIT_NOTE/DEBIT_NOTE——4D 已建，不重复新增）；**CN/DN = Invoice Adjustment 事实源**；**InvoiceAdjustment = 事实中间层（唯一修改 AR.adjustedAmount 的入口，客户端禁直接创建/编辑，只读）**
- **单票制 + 继承（CTO 拍板①）**：sourceInvoiceId 必填唯一；只接受已 ISSUED 的 Invoice（409 CN_DN_SOURCE_INVOICE_INVALID）；Customer/Currency 从原 Invoice 继承；行只传 sourceInvoiceLineId+quantity（>0），**金额/税率/价格只复制原 InvoiceLine 快照，不调用 Pricing Engine**；编号创建即取号 CN-/DN-2026-xxxx
- **Create 不做事实落账**：不创建 InvoiceAdjustment、不改 AR、不改 Invoice.balanceAmount（事实由 Apply 事务生成）
- **APPROVED ≠ APPLIED（CTO 锁死）**：条件审批复用 ApprovalPolicy(module=CREDIT_DEBIT_NOTE)（不建 Approval 表）；submit 同事务 maybeTriggerCreditDebitNoteApproval（命中策略→PENDING 须 APPROVED 后才能 Apply / 未命中→可直接 Apply；**Workflow 配置异常事务回滚 409 CN_DN_WORKFLOW_FAILED**）；**Apply 是唯一修改 AR.adjustedAmount / balanceAmount 的入口**；重复 Apply 稳定 409 CN_DN_ALREADY_APPLIED（幂等）
- **Apply 事务红线（CTO 98/100 + Apply 专项复核 100/100）**：Lock Note → 状态门禁 → Lock Invoice → Lock InvoiceLines（id ASC FOR UPDATE）→ Lock AR → 校验 customerId/currency（409 CN_DN_SOURCE_NOT_COMPATIBLE）→ **累计防超调锁内重算**（CREDIT：remainingAdjustableQty = 原行数量 - Σ已 APPLIED 未 reversed CREDIT quantity → 409 CN_DN_QUANTITY_EXCEEDED；金额：同类型聚合 abs + 本次 ≤ 原行金额 ceiling → 409 CN_DN_AMOUNT_EXCEEDED，DN 第一版禁超原行金额）→ Create InvoiceAdjustment facts（**signed：CN<0 / DN>0**；部分行按数量比例折算快照金额）→ AR.adjustedAmount += Σ signed → AR.balanceAmount = computeBalance 单入口 → AR status = computeArStatus（**负 AR 不加 CREDIT 状态**）→ **Invoice.balanceAmount = AR newBalance（Invoice 金额事实不动）** → AR Revision + Snapshot(ADJUSTMENT/ADJUSTED) → Note=APPLIED → 事件 InvoiceAdjustmentApplied + AccountsReceivableAdjusted（事务外，失败降级不阻断）
- **负 AR 门禁（CTO 锁死）**：balanceAmount < 0（= Customer Credit，只做读取投影）→ Receipt Allocation 409 RECEIPT_AR_NEGATIVE_BALANCE、WriteOff Apply 409 WRITE_OFF_AR_NEGATIVE_BALANCE（两个既有入口同步加）；DN 可把负余额向 0 拉回；不参与 Aging
- **Workflow 接入**：businessType="credit-debit-note" actions 路由终态回写（COMPLETED→syncCreditDebitNoteApproval(APPROVED) / REJECTED→REJECTED）；**绝不碰 AR**
- **文档**：OpenAPI +4 端点/+13 schemas（174 paths/466 schemas）；QA Sprint4E3_QA.md（T1-T21）；Test Cases CreditDebitNote_API.md（166 用例 A-O 15 组）；ADR-0022 → Accepted + Implemented；EVENTS v1.13；DOMAIN_MODEL v1.15

### 新增（Sprint 4E-2：Receipt & Payment Allocation Foundation，PR #17，已合并）

- **收款领域（收款事实源）**：Receipt / ReceiptAllocation / ReceiptRevision / ReceiptSnapshot + WriteOff / WriteOffAllocation（+6 模型 / +4 枚举，迁移 `0019_receipt_payment_foundation`，仅新增不改既有）；**Receipt = 唯一收款事实源（Payment 不单独建表——CTO 拍板，避免两个重复入账事实）**；Receipt.code / WriteOff.code DocumentSequence **创建即取号**（拍板④：RCT-/WO-2026-xxxx）
- **创建与核销分离（拍板①）**：POST /api/receipts 只记录实际收到的钱（UNALLOCATED，unallocatedAmount=amount，**不核销**）；POST /api/receipts/{id}/allocate 显式核销且**一次请求原子化**（多 AR 批量同事务，任何一步失败整体回滚）
- **核销 M:N + 事务红线（CTO 指定顺序）**：Lock Receipt（FOR UPDATE）→ Lock 全部目标 AR（**id ASC FOR UPDATE**，防死锁锁序）→ 校验同 Customer / 同 Currency（409 RECEIPT_CUSTOMER_MISMATCH / RECEIPT_CURRENCY_MISMATCH——第一版禁止跨币种核销）→ 校验 ≤ Receipt.unallocatedAmount（409 UNALLOCATED_EXCEEDED）→ 校验每笔 ≤ AR.balanceAmount（409 ALLOCATION_EXCEEDED——并发双核销不超余额）→ Create ReceiptAllocation → 回写 AR paidAmount/balanceAmount（computeBalance 单入口）+ status 投影 → 回写 Invoice paidAmount/balanceAmount 投影 → 回写 Receipt allocatedAmount/unallocatedAmount/status 投影 → AR Revision + Snapshot(PAYMENT) → 事件
- **Allocation Reversal（CTO Design Review 新锁定边界）**：解除核销关系并**留痕**（reversedAt/reversedBy/reverseReason 写入原记录，**不删除**——独立逆向事实）；恢复 AR / Invoice / Receipt 三方投影；重复冲销 409 RECEIPT_ALLOCATION_REVERSED；**Reversal ≠ Credit Note**（CN 属 4E-3 发票调整域，不承担收款冲销——银行退票不是 CN）
- **VOID 规则（拍板②）**：仅 UNALLOCATED 可 VOID（→ VOIDED + voidedAt/voidedById）；**已有核销不得直接 VOID**（必须先 Reversal，否则 409 RECEIPT_VOID_FORBIDDEN）；无 CN 语义
- **WriteOff 独立事实（拍板③）**：WriteOff + WriteOffAllocation（**不做三件套**——审批历史由 Workflow、审计由 AuditLog，避免模型膨胀）；创建校验同 Customer / 同 Currency（409 WRITE_OFF_SOURCE_NOT_COMPATIBLE）、每笔 amount>0、头金额 = Σ allocations（服务端计算，禁止直传）；**创建/提交/审批均不修改 AR**
- **APPROVED ≠ APPLIED（CTO 锁死）**：WriteOff 按 ApprovalPolicy(module=WRITE_OFF) 条件触发 Workflow；submit 同事务 maybeTriggerWriteOffApproval（命中策略→PENDING 须 APPROVED 后才能 Apply / 未命中→可直接 Apply）；**Apply 是唯一修改 AR.writeOffAmount / balanceAmount 的入口**；重复 Apply 稳定 409 WRITE_OFF_ALREADY_APPLIED（幂等）
- **WriteOff ≠ Payment（财务红线）**：Apply 同事务 AR.writeOffAmount += allocation / balanceAmount 重算 / **Invoice.balanceAmount 投影同步减少，但 Invoice.paidAmount 绝不因 write-off 增加**（防止报表把坏账核销误认为客户实际付款）→ AR Revision + Snapshot(snapshotSource=WRITE_OFF) → WriteOff=APPLIED+appliedAt/appliedById → 事件 WriteOffApplied + AccountsReceivableWrittenOff
- **Workflow actions 接入**：businessType="write-off" → COMPLETED→syncWriteOffApproval(APPROVED) / REJECTED→REJECTED；保持 APPROVED ≠ APPLIED
- **事件**：EVENTS.md v1.11——4E-2 收款/核销/写销事件 10 个全部实现（ReceiptCreated/ReceiptAllocated/ReceiptFullyAllocated/ReceiptAllocationReversed/ReceiptVoided + WriteOffCreated/WriteOffSubmitted/WriteOffApproved/WriteOffRejected/WriteOffApplied；ReceiptUpdated 无 PATCH 端点保留注册）；AR PartiallyPaid/Paid/WrittenOff/Closed 与 Invoice 投影事件联动发布
- **文档**：OpenAPI +10 端点/+30 schemas（171 paths/453 schemas，5 项财务边界写入描述）、docs/qa/Sprint4E2_QA.md（T1-T18）、docs/test-cases/Receipt_WriteOff_API.md（140+ 用例，A-N 14 组）、DOMAIN_MODEL v1.13（第 24 章）、ADR-0021（Accepted + Implemented，Ready for Final Review）、docs/reviews/Sprint4E2_CTO_Review_Cover.md（待 CTO Final Review）

### 新增（Sprint 4E-1：Accounts Receivable Foundation，PR #16，已合并）

- **应收领域（余额事实源）**：AccountsReceivable / AccountsReceivableRevision / AccountsReceivableSnapshot（+3 模型 / +3 枚举，迁移 `0018_accounts_receivable_foundation`，仅新增不改既有）；Invoice 1:1 AR（invoiceId @unique）；**Invoice = 单据事实源，AR = 余额事实源**（Invoice 上 paidAmount/balanceAmount 仅投影回写）
- **余额唯一口径（CTO 锁定）**：`balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`；服务端唯一计算（computeBalance 单入口），前端禁止 PATCH 金额，由 4E-2 Receipt/4E-3 CN-DN 动作或下游事实表驱动
- **AR 唯一来源 Invoice（拍板①）**：Invoice ISSUED 后同事务自动创建（不延迟，失败整体回滚）；无独立创建端点（无 POST /api/accounts-receivables）
- **OVERDUE 惰性投影（拍板②）**：status ∈ {OPEN, PARTIALLY_PAID} 且 dueDate < now → effectiveStatus = OVERDUE（不落库、不新增 Scheduler，与 Quotation EXPIRED 一致）；API 返回 status/effectiveStatus/isOverdue
- **agingBucket 不存库（必改①）**：effectiveAgingBucket 读取时动态计算（0-30/31-60/61-90/90+，只依赖 today/dueDate/balance，属 Projection，不每天更新数据库）
- **Snapshot 来源枚举（必改②）**：snapshotSource = ISSUE/PAYMENT/WRITE_OFF/ADJUSTMENT/MANUAL，Receipt/CN/DN/WriteOff 全部可复用
- **Invoice 删除保护（必改③）**：Invoice → AR exists → 禁止删除（onDelete: Restrict）；Invoice Cancel 也不删 AR，只能 CLOSED
- **Workflow 边界（必改④）**：AR 不审批；Receipt × ApprovalPolicy、WriteOff × ApprovalPolicy 明确属 Sprint 4E-2，避免后续重复讨论
- **WriteOff/CN-DN 边界（拍板③④）**：本阶段只留 writeOffAmount / adjustedAmount 字段；WriteOff 独立实体（4E-2）、Adjustment 事实（4E-3）后续实现，不直接 UPDATE balance
- **查询 API（只读）**：GET 列表（customerId/status/effectiveStatus/currency/dueDate 过滤 + customer/invoice 摘要 + 惰性投影）、GET /aging（账龄分析 0-30/31-60/61-90/90+ + settled）、GET 详情（一次带出 invoice/customer + 最近 revision/snapshot）、GET revisions/snapshots 只读
- **RBAC**：3 模块×10 动作（accounts-receivable* / accounts-receivable-revision* / accounts-receivable-snapshot*，全部 view 语义）
- **事件**：EVENTS.md v1.9——AR 事件 8 个注册（Created/Updated/Overdue 属 4E-1；PartiallyPaid/Paid/WrittenOff 属 4E-2；Adjusted 属 4E-3；**Closed 为 CTO Review 追加**）
- **文档**：OpenAPI +5 端点/+13 schemas（161 paths/423 schemas）、docs/qa/Sprint4E1_QA.md（T1-T15）、docs/test-cases/AccountsReceivable_API.md（76 用例，A-H 8 组）、DOMAIN_MODEL v1.12（第 23 章）、ADR-0020（Approved with Changes → Accepted + Implemented）、docs/reviews/Sprint4E1_CTO_Review_Cover.md（CTO Final Review APPROVE & MERGE 98/100，0 Blocking）

### 新增（Sprint 4D：Invoice Foundation，PR #15，已合并）

- **Invoice 发票领域（财务事实源）**：Invoice / InvoiceLine / InvoiceRevision / InvoiceSnapshot（+4 模型 / +4 枚举，迁移 `0017_invoice_foundation`，仅新增不改既有）；DeliveryLine +2 开票投影列（invoicedQty / remainingInvoiceQty，remainingInvoiceQty 由迁移初始化为 quantity）；Invoice.code 可空（DRAFT 不占号）
- **唯一创建入口（CTO 锁定①）**：无 Direct Invoice（不开放 `POST /api/invoices`）；`POST /api/deliveries/{id}/invoice`：按 id ASC 锁全部来源 Delivery（primary + deliveryIds[]）→ 校验全部 DELIVERED（仅已确认收货可开票）→ 按 id ASC 锁 DeliveryLine → 防超开票（qty>0 且 ≤ remainingInvoiceQty，否则 409 INVOICE_QUANTITY_EXCEEDED）→ 建头（DRAFT，code=NULL）+ 行 → 回写投影 → Revision + CREATED 快照（含税务/汇率）
- **Partial Billing（CTO 拍板①）**：DeliveryLine 投影 invoicedQty/remainingInvoiceQty 支持一张 Delivery 拆多张发票，累计不超已交付量
- **Consolidated Invoice（CTO 拍板②）**：primaryDeliveryId + deliveryIds[] 合并开票，Customer/Currency/TaxProfile/PaymentTerm 必须一致，否则 409 INVOICE_SOURCE_NOT_COMPATIBLE
- **金额红线（CTO 锁定② + ADR-0019 §4）**：四段溯源链取价（DeliveryLine→sourceSalesOrderLineId→SalesOrderLine→priceSnapshotId→QuotationPriceSnapshot），直接复制价格快照（priceSnapshotId/unitPrice/discountRate/lineAmount/taxAmount/totalAmount），**永不重算、不调用 Pricing Engine**；头金额 Decimal 加总
- **编号延后生成（CTO 必改①）**：DRAFT code=NULL 不占号；issue 事务内 FOR UPDATE 锁 → 校验（DRAFT+有行+total>0+code=null）→ nextInvoiceCode 原子取号 INV-2026-000123 → ISSUED；并发 issue 第二个请求稳定 409 不消耗编号
- **快照税务/汇率（CTO 必改②）**：InvoiceSnapshot 含 taxProfileId/taxRate/sstNo/currencyRate/exchangeRate，多年后 100% 还原；快照节点 CREATED/ISSUED/CANCELLED（ISSUED 快照 snapshotData 记 issuedAt/issuedById）
- **Lifecycle（CTO 拍板③④）**：DRAFT→ISSUED（→PARTIALLY_PAID/PAID 4E 投影）+ DRAFT→CANCELLED；InvoiceLine 系统生成只读（无 lines PATCH）；仅 DRAFT 可取消，ISSUED+ 走 Credit Note（无 VOID）；cancel 按 id ASC 锁 DeliveryLine 回滚投影（invoicedQty -= qty / remainingInvoiceQty += qty）
- **Workflow 集成（CTO 拍板同构）**：ApprovalPolicy(module=INVOICE)→WorkflowDefinition→WorkflowInstance 单实例；终态回写投影（COMPLETED→APPROVED + approvedAt/approvedById；REJECTED→REJECTED）；不建 InvoiceApproval 表、不生成 APPROVED 快照；issue 审批门禁（有实例须 APPROVED）；PATCH 重审（paymentTerm/dueDate 变更→同事务 maybeTriggerInvoiceApproval，无实例创建/RUNNING 保持/终态复用 resubmit；remark 不触发；策略缺失→409 INVOICE_WORKFLOW_FAILED 整体回滚）
- **查询 API（CTO Phase 4 指令）**：GET 列表（分页 + code/customerId/status/approvalStatus/dateFrom/dateTo/dueDateFrom/dueDateTo/currency/salesOrderId/deliveryId 过滤）+ GET 详情一次带出（Invoice/Customer/Workflow/Delivery/SalesOrder 摘要/Lines/Latest Revision/Latest Snapshot）+ lines/revisions/snapshots 只读 + PATCH 头（仅 DRAFT + 乐观锁 + 严格 remark/dueDate/paymentTerm）
- **API**：8 端点（创建 1 + 主档 3 + 行 1 + 历史 2 + 动作 2）；**RBAC**：4 模块×10 动作（invoice* / invoice-line* / invoice-revision* / invoice-snapshot*；create→invoice:create、issue→invoice:approve、cancel→invoice:close）
- **事件**：EVENTS.md v1.8——InvoiceCreated/Issued/Cancelled ✅ 已实现；PartiallyPaid/Paid ⏳ 注册待实现（Sprint 4E）
- **文档**：OpenAPI +8 端点/+19 schemas（156 paths/410 schemas）、docs/qa/Sprint4D_QA.md（T1-T18）、docs/test-cases/Invoice_API.md（137 用例，A-M 13 组）、DOMAIN_MODEL v1.11（第 22 章 Invoice Foundation）、ADR-0019（Accepted+Implemented）、docs/reviews/Sprint4D_CTO_Review_Cover.md（CTO Final Review：APPROVE & MERGE 98/100）

### 新增（Sprint 4C：Delivery Foundation，PR #14）

- **Delivery 交付领域（交付事实源）**：Delivery / DeliveryLine / DeliveryRevision / DeliverySnapshot（+4 模型 / +4 枚举，迁移 `0016_delivery_foundation`，仅新增不改既有）；SalesOrderLine +2 投影列（deliveredQty / remainingQty，remainingQty 由迁移初始化为 quantity）；SalesOrder +deliveredAt
- **唯一创建入口（CTO 锁定①）**：无 Direct Delivery（不开放 `POST /api/deliveries`，salesOrderId NOT NULL）；`POST /api/sales-orders/{id}/deliveries`：FOR UPDATE 锁 SO → 校验 status ∈ {CONFIRMED, PARTIALLY_DELIVERED} → 原子取号 DO-000001 → 建头（DRAFT）→ 显式传入 lines 才建行（分批发货，不默认复制全部）→ Revision + CREATED 快照
- **防超交（CTO 锁定②）**：availableQty = orderedQty - confirmedDeliveredQty - openDeliveryQty 事务内动态计算（不新增 allocatedQty 列）；创建/编辑/READY/confirm 均重新校验；超出 → 409 DELIVERY_QUANTITY_EXCEEDED；PATCH 自身行排除当前行
- **Lifecycle（CTO 锁定⑤⑧⑨）**：DRAFT→READY→DISPATCHED→DELIVERED + DRAFT/READY→CANCELLED；READY 后行彻底冻结（不支持重新 ready，错误→cancel→新建）；confirm-delivery 固定 12 步事务（锁 Delivery→锁 SalesOrder→按 id ASC 锁全部源行防死锁→复查行→重新聚合→DELIVERED+POD 投影→DELIVERED 快照→回写 SO Line→聚合 SO→事件）；COMPLETED 仅枚举不提供 /complete
- **POD（CTO 锁定④）**：File Center 存文件 + Delivery 最小投影（podStatus PENDING/RECEIVED/WAIVED + podReceivedAt + podConfirmedById）；不建 DeliveryPOD 表；confirm-delivery POD 门禁（RECEIVED/WAIVED，否则 409）
- **SalesOrder 聚合**：confirm-delivery 后每行回写 deliveredQty/remainingQty，全部行 remainingQty≤0 → SO=DELIVERED+deliveredAt=now，否则有 confirmed → PARTIALLY_DELIVERED（不因 READY/DISPATCHED 提前标记）
- **API**：10 端点（主档 4 + lines 2 + ready/dispatch/confirm-delivery/cancel 4）
- **RBAC**：4 模块×10 动作（delivery* / delivery-line* / delivery-revision* / delivery-snapshot*；ready/dispatch→edit、confirm-delivery→approve、cancel→close）
- **事件**：EVENTS.md v1.6——Delivery 8 事件全部已发布（Created/Updated/Ready/Dispatched/Confirmed/Cancelled + SalesOrderPartiallyDelivered/SalesOrderDelivered）
- **文档**：OpenAPI +10 端点/+20 schemas（148 paths/391 schemas）、docs/qa/Sprint4C_QA.md（T1-T15）、docs/test-cases/Delivery_API.md（111 用例）、DOMAIN_MODEL v1.10（第 20/21 章）、ADR-0018（Accepted+Implemented）、docs/reviews/Sprint4C_CTO_Review_Cover.md（CTO Final Review：APPROVE & MERGE）

### 新增（Sprint 4B：Sales Order Foundation，PR #13）

- **Sales Order 销售订单领域**：SalesOrder / SalesOrderLine / SalesOrderRevision / SalesOrderSnapshot（+4 模型 / +3 枚举，迁移 `0015_sales_order_foundation`，仅新增不改既有）
- **唯一创建入口（CTO 锁定项①）**：无 Direct SO（不开放 `POST /api/sales-orders`，quotationId 必填）；`POST /api/quotations/{id}/convert` 正式实现（替代 4A 的 501）：FOR UPDATE 真实行锁 + DocumentSequence 原子 increment + 唯一约束冲突→409，复制 Line（继承价格 + priceSnapshotId + sourceQuotationLineId 溯源，不重新定价）+ CREATED 快照 + 回写 Quotation(CONVERTED) + 双事件
- **价格红线（CTO 锁定项②）**：价格继承 Quotation 禁直接改（schema 无 unitPrice）；数量/UOM 商业条件变更重新走 PricingEngine（新建 `SalesOrderPricingService`，只调 resolvePrice()，快照不写 quotationLineId 防污染溯源）+ 新 Revision + Snapshot
- **审批联动（CTO 锁定项③ + 最终复审）**：Confirm 不重复审批（Accepted Quotation 已够）；关键商业字段变更触发重新审批——无实例创建 / RUNNING 保持等待 / **终态复用同一 WorkflowInstance 重新 SUBMIT**（先失效上一轮全部 Approver 再建新 PENDING，清空 approvedAt/approvedById 投影残留）；Confirm 加审批门禁（有实例须 APPROVED 否则 409）
- **状态机**：DRAFT→CONFIRMED→PARTIALLY_DELIVERED→DELIVERED→COMPLETED；DRAFT/CONFIRMED→CANCELLED；PARTIALLY_DELIVERED/DELIVERED 由 Delivery 聚合回写（Sprint 4C，仅投影）
- **API**：8 路由文件 / 10 端点（列表/详情/头更新 + lines + revisions/snapshots + confirm/cancel）
- **RBAC**：8 权限码（sales-order* / sales-order-line* / sales-order-revision* / sales-order-snapshot*，无 create）
- **事件**：EVENTS.md v1.4——7 个 SalesOrder 事件注册，5 个已发布（Created/Updated/Confirmed/Cancelled/ApprovalStarted；总线落地前 AuditLog 留痕）
- **文档**：OpenAPI convert 501→200 + 8 端点 + 16 schemas（139 paths/371 schemas）、docs/qa/Sprint4B_QA.md（T1-T15）、docs/test-cases/SalesOrder_API.md（A-H）、ADR-0017

### 变更（Sprint 4B 质量门禁）

- 2026-08-07：lint 修复（confirm 路由未使用 failServer 导入）→ CI #31158155759 全绿；CTO Final Review 3 阻断项修复（重定价走 SalesOrderPricingService / 终态实例复用重新 SUBMIT / Confirm 审批门禁 + 触发失败显式报错）→ `b68495a` CI #31160760480 全绿；最终复审阻断项修复（重新审批前失效旧 Approver + 清空 approvedAt/approvedById）→ `60a4290` CI #31161908240 全绿

### 新增（Sprint 4A：Quotation Foundation，PR #12）

- **Quotation 报价领域**：Quotation / QuotationLine / QuotationRevision / QuotationSnapshot（+4 模型 / +3 枚举，迁移 `0014_quotation_foundation`，仅新增不改既有）
- **定价红线（ADR-0015）**：行价必须来自 `PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId`，schema 无 unitPrice 字段，禁止前端直接改价；quantity/uomId 变更均触发重新定价
- **审批集成（ADR-0016）**：Workflow 为唯一审批事实源（不建 QuotationApproval）；submit 创建 WorkflowInstance，审批终态事务化回写投影 + 生成 APPROVED 快照
- **API**：12 路由文件 / 18 端点（主档 CRUD + lines/revisions/snapshots + submit/accept/cancel/convert，convert 为 Sprint 4B 预留 501）
- **RBAC**：13 权限码（quotation* / quotation-line* / quotation-revision* / quotation-snapshot*）
- **事件**：EVENTS.md v1.3——11 个 Quotation 事件注册，7 个已发布（总线落地前以 AuditLog 留痕）
- **文档**：OpenAPI +12 路径/+26 schemas、docs/qa/Sprint4A_QA.md、docs/test-cases/Quotation_API.md、DOMAIN_MODEL v1.9（第 19 节）、ADR-0015/0016 状态确认 Implemented

### 变更（Sprint 4A 质量门禁）

- 2026-08-07：lint 修复（`import type` 163 处）→ CI #76 全绿；RequestMeta 类型修复；CTO Final Review 3 阻断项修复（QuotationLine PATCH 原子化 / Workflow 投影事务化 + APPROVED 快照 / Snapshot 金额 Decimal.toString()）→ `03efceb` CI #78 全绿

## [v0.5.0-alpha] - 2026-08-07（Sprint 3C：Business Foundation 完整发布，Sprint 3 全部完成）

### 新增（Sprint 3C：Business Foundation）

#### 3C-1 Customer Foundation（PR #7，已合并）

- **Customer 主档**：Customer / CustomerContact / CustomerAddress / CustomerTag / Industry / Tag / CustomerCredit（+7 模型/+4 枚举）
- **迁移**：0009_customer_foundation（仅新增，不改既有表）
- **RBAC**：+7 模块动作级权限，MANAGER 全量
- **API**：customers 主档 CRUD + contacts/addresses/tags/credit 子资源 + industries/tags 字典
- **文档**：ADR-0009、DOMAIN_MODEL v1.6、OpenAPI 13 端点、Sprint3C1_QA.md、test-cases/Customer_API.md
- **统一规范三件套**（Sprint 3C 起）：API_GUIDELINES.md / ERROR_CODES.md / EVENTS.md

#### 3C-2 Supplier Foundation（PR #8，已合并）

- **BusinessPartner 唯一主体 + 角色化**：BusinessPartnerRole（PartnerRoleType：CUSTOMER/SUPPLIER/BOTH/LOGISTICS/OUTSOURCING，可无限扩展）
- **Partner 级共享五件套**：PartnerContact / PartnerAddress（PartnerAddressType 含 Billing/Shipping/Registered/Warehouse/Factory）/ PartnerTag / PartnerBankAccount / PartnerCredit
- **Supplier 独有仅三项**：SupplierQualification（QualificationType）/ SupplierCertificate / SupplierSettlement
- **Customer 不返工**：ADR-0011 BusinessPartner Consolidation 规划 Sprint 5 统一迁移
- **迁移**：0010_supplier_foundation（10 表 + 4 枚举，仅新增）
- **RBAC**：+10 模块动作级权限（supplier/supplier-qualification/supplier-certificate/supplier-settlement/business-partner-role/partner-contact/partner-address/partner-tag/partner-bank-account/partner-credit）
- **API**：18 路由文件（suppliers 主档 + 三子资源 + 共享视图 + partner roles）
- **seed**：SUP-0001/0002 + 3 条 PartnerRole（幂等 upsert）
- **文档**：ADR-0010、ADR-0011、DOMAIN_MODEL v1.7、OpenAPI 75 paths/203 schemas、Sprint3C2_QA.md、test-cases/Supplier_API.md
- **Sprint 4 预备（仅设计）**：Sprint4_Quote_Domain / Quote_ERD / Quote_API / Quote_Workflow 四份文档

#### 3C-3 Item Foundation（PR #9，已合并）

- **Item Master（ERP 核心主数据）**：ItemType 10 类枚举 + 五级层级（Category→SubCategory→Series→Model→Variant）+ Identification（OEM/Barcode/QRCode/DrawingNo/Revision）+ 多 UOM（Stock/Purchase/Sales + UomConversion）+ isSalable/isPurchasable/isManufacturable
- **SpecificationDefinition（CTO #2138）**：定义/实例分离（code/name/unit/dataType/isRequired），ItemSpecification.definitionId 关联，过滤/排序/范围查询友好
- **ItemCategory 改 CategoryPath（CTO #2138）**：去 parentId 递归 → 001/001.003/001.003.005（unique），子树 startsWith 查询免递归
- **ItemStatus 与 ItemLifecycle 分离（CTO #2138）**：系统状态 ACTIVE/INACTIVE/LOCKED/ARCHIVED vs 产品生命周期 DESIGN/TRIAL/MASS_PRODUCTION/DISCONTINUED/OBSOLETE
- **ItemRevision 独立**：revisionNo/revision/changeSummary/releasedById/releasedAt/status（RELEASED 同步 Item.revision、旧版 SUPERSEDED）
- **SupplierItem**：一个 Item 多供应商（supplierCode/MOQ/LeadTime/Currency/PurchasePrice/isPreferred/Incoterm/PaymentTerm，不建 Item.supplierId 单值字段）
- **ItemCost 只建接口**：costType（STANDARD/LAST_PURCHASE/AVERAGE/CURRENT）+ 时间维度 effectiveFrom/effectiveTo/currency/source
- **AttachmentType 统一放 File Center**（DRAWING/CERTIFICATE/PHOTO/MANUAL/MODEL_3D/VIDEO/INSPECTION_REPORT）
- **迁移**：0011_item_foundation（Item ALTER 加列 + 8 新表，仅新增/加列不改既有列）
- **RBAC**：item 动作级 + 8 子模块（item-category/item-specification/item-uom/item-cost/item-supplier/item-revision/item-tag/item-attachment）
- **API**：18 路由文件（items 主档 + 分类树 + specifications/specification-definitions/uom-conversions/costs/supplier-items/revisions/tags/attachments）
- **文档**：ADR-0012、ADR-0013（Price 设计）、DOMAIN_MODEL v1.8、EVENTS v1.1（ItemCreated 等 5 事件）、Sprint3C3_QA.md、test-cases/Item_API.md、OpenAPI 93 paths/251 schemas
- **Price 前置**：PRICE_STRATEGY.md + MASTER_DATA_DEPENDENCY.md（CTO #2138）

#### 3C-5 Project Foundation（PR #11，已合并）

- **项目领域增强（+1 模型 → 总计 99 模型 / 48 枚举）**：ProjectTag 复用全局 Tag；Project +priority（高/中/低）+ progressPercent（汇总进度）；ProjectProduct +priceSnapshotId（引用 QuotationPriceSnapshot，SetNull）；ProjectOpportunity +convertedAt/convertedBy（唯一转换入口回写）
- **Opportunity → Project 唯一转换入口**：POST /api/project-opportunities/:id/convert 事务（**真实行锁 SELECT ... FOR UPDATE** + DocumentSequence.nextNo **原子 increment** + P2002 兜底 409，并发安全，CTO 架构审核通过）
- **阶段流转集中校验 + 结项规则**：projects transition 集中校验（PATCH 不可改 stage）；结项默认强制阻断 + 双权限（project:close + project:approve）强制结项
- **迁移**：0013_project_foundation（仅新增/加列，不重建既有 14 个 Project 模型）
- **RBAC**：+12 子模块动作级权限（project-stakeholder/member/milestone/task/budget/expense/product/progress/acceptance/closure/tag/attachment）
- **API**：16 路由 / 34 文件（opportunities 主档 + convert；projects 主档 + transition + close；14 个子资源）
- **Domain Events（EVENTS.md 注册）**：ProjectOpportunityConverted / ProjectCreated / ProjectStageChanged / ProjectMemberAssigned / ProjectMilestoneCompleted / ProjectRiskRaised / ProjectRiskClosed / ProjectAccepted / ProjectClosed / ProjectForceClosed
- **文档**：ADR-0014（Accepted）、Sprint3C5_QA.md、test-cases/Project_API.md、OpenAPI 更新

#### 3C-4 Price Foundation（PR #10，已合并）

- **价格领域完整建模（+11 模型 / +9 枚举 → 总计 98 模型 / 49 枚举）**：PricePolicy / PriceRule / PriceListVersion / PartnerPrice / PromotionRule / TaxProfile / TaxRate / TaxProfileRule / ExchangeRate / QuotationPriceSnapshot / PriceAudit
- **PricePolicy 双轨（CTO #2225）**：pricePolicyId FK + policyType 快照（历史价格可解释）；matchStrategy（FIRST_MATCH/BEST_PRICE/LOWEST_PRICE/HIGHEST_PRIORITY/COMBINE）+ stopOnMatch（CTO #2249）
- **PriceRule 独立建模（CTO #2345）**：CUSTOMER_LEVEL/REGION/QUANTITY_BREAK/BRAND/PROJECT_TYPE/CURRENCY/CHANNEL，Pricing Engine 直接执行
- **PartnerPrice 统一**（CTO #2225/#2249/#2345）：partnerRoleType 枚举 + partnerRoleName 快照；priority/approvalRequired（VIP 价可审批）
- **PromotionRule 独立**：PERCENT/AMOUNT + priority/stackable/exclusive（CTO #2225/#2345）
- **TaxProfile 多国复用**：country/region/taxIncluded/rateType（ZERO/SIX/THIRTEEN/EXEMPT/CUSTOM）+ TaxRate 时间维度 + TaxProfileRule 规则（CTO #2249）
- **ExchangeRate 独立维护**（CTO #2249/#2345）：base/quote/rate/effectiveDate 复合唯一 + provider/source/rateType/manualOverride
- **QuotationPriceSnapshot 完整定价链**（CTO #2225/#2249）：Base→Policy→Discount→Promotion→Tax→ExchangeRate→Final + pricingEngineVersion
- **PriceAudit 独立审计**（CTO #2345）：oldPrice/newPrice/reason/approvedBy/workflowInstanceId/effectiveTime
- **PricingEngineService**：resolvePrice() 唯一入口（Policy→Rules→PartnerPrice/PriceList→Promotion→Currency→Tax→Snapshot→Audit），全程 Decimal 禁止 Float，有效期统一 effectiveFrom/effectiveTo
- **迁移**：0012_price_foundation（12 新表 + 92 ALTER，仅新增不改既有表）
- **RBAC**：+10 模块动作级权限（price-policy/price-rule/price-list-version/partner-price/promotion/tax-profile/tax-rate/exchange-rate/pricing-engine/price-audit）
- **API**：10 资源（price-policies/price-rules/price-lists/price-list-versions/partner-prices/promotions/tax-profiles/tax-rates/exchange-rates + **POST /api/pricing/resolve 唯一入口**）
- **Seed（幂等）**：6 策略（STANDARD/VIP/PROJECT/SUPPLIER/PURCHASE/PROMOTION_PRICE）+ 3 规则（Quantity≥100/VIP/华东）+ 3 税档（CN 13%/MY SST/SG GST）+ 6 汇率（PBOC/ECB/Manual）+ Demo Promotion
- **文档**：ADR-0013（Implemented）、OpenAPI 10 资源 + Resolve Price Sequence、Sprint3C4_QA.md（8 关键场景）、test-cases/Price_API.md、ERD 更新

### 已知限制（Known Risks，后续计划）

- Domain Event 目前仅注册，事件总线尚未真正发布（Sprint 4 业务事件驱动前落地）
- File Center 仍只管理元数据，对象存储尚未接入
- Notification 外部渠道（EMAIL/TELEGRAM/WEBHOOK）尚未接入
- Railway 运行级完整回归仍需执行
- BusinessPartner Consolidation（Customer 子模型迁移到 Partner 级共享）仍按 ADR-0011 延后处理（Sprint 5）

## [v0.4.0-alpha] - 2026-08-05

### 新增（Sprint 3B：Platform Capabilities，PR #6，已合并）

- **Audit Center（升级）**：AuditLog +8 字段（beforeData/afterData 快照、requestId/traceId 链路追踪、device/browser、duration、result SUCCESS/FAILURE/PARTIAL）+ AuditResult 枚举；requestMeta() 统一提取；audit-logs API（分页+多维过滤/详情，audit:view 仅 SUPER_ADMIN/ADMIN）
- **Menu Center**：MenuGroup + Menu 树形（RouteMeta 内联：path/icon/sort/hidden/cache/externalLink/permission）；GET /api/menus?tree=true 前端直接读取；递归软删子树
- **Dashboard API**：DashboardWidget / DashboardLayout / DashboardKpi / DashboardChart（4 模型 + 3 枚举），/api/dashboard/widgets|layouts|kpis|charts CRUD；只提供数据 API，页面 Sprint 8 开发
- **File Center**：FileFolder（树）/ File（元数据）/ FileVersion（版本历史）/ FileAttachment（业务附件关联）；files CRUD + versions + preview；file-folders + attachments API；Quotation/Contract/SO/Invoice/Project 统一引用
- **架构冻结**：ARCHITECTURE_BASELINE v1.0（后续调整必须新增 ADR）；docs/test-cases/ 4 份测试用例模板（Audit/Menu/Dashboard/File API）
- **迁移**：0005_audit_upgrade / 0006_menu_center / 0007_dashboard_api / 0008_file_center（+8 模型/+3 枚举）
- **RBAC**：+10 模块（menu/menu-group/dashboard-_/file_/file-folder/file-version/file-attachment）动作级权限，MANAGER 全量
- **文档**：ADR-0005~0008、DOMAIN_MODEL v1.5（按模块拆图 62 模型/29 枚举）、OpenAPI 全端点覆盖（4100+ 行）

### 已知限制（后续计划，非本版本交付）

- File 仅元数据建模（对象存储后续接入）、Preview 白名单判定、Dashboard 无页面（Sprint 8）、承接 3A 未完成项（可视化设计器/真实通知/调度器）、运行级 Railway 验证待执行

## [v0.3.0-alpha] - 2026-08-05

### 新增（Sprint 3A：Workflow Foundation，PR #5，已合并）

- **Workflow Engine（6 模型）**：WorkflowDefinition / WorkflowStep / WorkflowCondition / WorkflowInstance / WorkflowAction / WorkflowHistory（统一动作 SUBMIT/APPROVE/REJECT/RETURN/TRANSFER/DELEGATE/WITHDRAW/TERMINATE/COMMENT；条件结构化 field/operator/value；4 审批模式 SEQUENTIAL/PARALLEL/ANY_ONE/COUNTERSIGN）
- **Approval Engine（7 模型，与 Workflow 解耦）**：Approver / ApproverGroup / ApproverGroupMember / ApprovalDelegate / ApprovalEscalation / ApprovalTimeout / ApprovalReminder
- **Notification（4 模型）**：NotificationTemplate / NotificationMessage / NotificationChannel / NotificationLog（SYSTEM/EMAIL/TELEGRAM/WEBHOOK + WECHAT/DINGTALK 预留）
- **Dictionary（2 模型）**：DictionaryType / DictionaryItem
- **Settings（3 模型）**：SystemSetting / TenantSetting / UserSetting（三层 Key-Value，encrypted 掩码返回）
- **API（12 组端点）**：Workflow Definition 7（list/create/detail/update/delete/publish/archive）+ Workflow Instance 5（list/create/detail/actions/history）+ approver-groups / dictionaries / settings / notification-templates；统一响应/错误格式、Zod 校验、后端权限、AuditLog、乐观锁 version、软删除、Prisma transaction、请求日志
- **迁移**：`0004_workflow_foundation`（22 表 + 11 枚举 + 59 索引 + 13 外键）
- **RBAC**：PERMISSION_MODULES +21 平台模块，动作级权限（view/create/edit/delete/approve/audit/export/import/assign/close），MANAGER 全量
- **Seed 幂等**：SEED_WORKFLOW_DEFINITIONS（QUOTATION_APPROVAL/EXPENSE_APPROVAL）+ SEED_APPROVER_GROUPS（DIRECTORS/FINANCE），稳定 code + upsert
- **文档**：ADR-0004、DOMAIN_MODEL v1.1（模块拆图 + 状态机 + onDelete 策略）、openapi.yaml 全端点覆盖、docs/qa/Sprint3A_QA.md

### 变更

- 新增统一 API 规范层（apps/web/src/lib/api/：errors/response/schemas/logger）+ 工作流引擎纯函数层（lib/workflow/engine.ts）
- 所有新模型带统一审计字段 + 软删除（CTO 规则）

### 已知限制（后续计划，非本版本交付）

- 无可视化流程设计器、无真实外部通知发送、无定时调度器/超时自动升级、Settings 加密为标记+掩码、运行级验证待 Railway 部署

## [v0.2.0-alpha] - 2026-08-05

### 新增（Sprint 2B/2C，PR #4，已合并）

- 中国版主数据：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）
- 项目领域 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- 企业字段补强：BusinessPartner +14、Item +14（品牌/OEM/图号/替代料/MOQ/安全库存等）、PriceList +priceType（9 类价格）、Project +9 财务字段
- DocumentSequence +docType（DocumentType 17 种单据）
- 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close
- 迁移：`0002_master_data_cn` + `0003_project_domain`
- 文档体系：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/（规范目录）

### 变更

- 前端：移除 products/suppliers/materials 占位页，新增 10 个主数据/项目占位页
- 默认税率改为环境变量 `DEFAULT_TAX_RATE`（默认 13，不写死）

## [v0.1.0-alpha] - 2026-08-04

### 新增（Sprint 1，PR #3）

- Monorepo 骨架：pnpm workspace + Turborepo + Next.js 15 App Router
- 认证：JWT（jose HS256）+ bcryptjs，登录/会话接口
- RBAC：User/Department/Role/Permission/UserRole/AuditLog 6 模型
- CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- Railway 部署 + 测试账户

详见 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。
