# ADR-0027：Supplier Invoice / Three-Way Match / AP Boundary（供应商发票 → 三单匹配 → 应付账款 边界决策）

- 状态：**Approved with Changes**（CTO 5C Design Review 88/100，#8845 已拍板；4 Blocking + 3 Hardening 已修复）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md（v0.2）/ Sprint5C_Field_Matrix.md（v0.2）/ Sprint5C_CTO_Pending_Decisions.md（v0.2，P1-P12 已拍板）/ EVENTS.md（5C 注册位）
- 上游已 Implemented：ADR-0023（5A PO 承诺）/ ADR-0024（5B 收货入库）/ ADR-0025（6A 库存账）/ ADR-0026（6B Operations）

---

## 背景（CTO #8777）

Sprint 6B CLOSED 后，采购库存链（PO → PurchaseReceipt → Inspection → WarehouseReceipt → InventoryMovement）已完整。**若不继续接 Supplier Invoice / AP，采购库存链没有完成 ERP 的财务闭环**。5C 是当前后端最高优先级，Design First（CTO Gate 批准前禁止写 Schema/Migration/API）。

**关键锁（CTO #8777）**：**Supplier Invoice ≠ Sales Invoice 反向版**——独立模型，可借鉴 4E 模式但方向/溯源/状态机不同。

**业务事实链建议**：`PO Commitment → Receipt Fact → Warehouse/Inventory Fact → Supplier Invoice → 3-Way Match → AP Liability → Payment`。

---

## 核心决策（D1-D12，CTO 5C Design Review #8845 已拍板）

### D1：Supplier Invoice = 独立的供应商开票事实（≠ Sales Invoice 反向版）

- **不是**把 4E Sales Invoice 反向复制：① 方向相反（供应商开给我方 = Expense/AP，我方开给客户 = Revenue/AR）；② 溯源对象不同（5C → PO/WarehouseReceipt，4E → SO/Delivery）；③ 状态机不同（5C 有 3-Way Match / 暂估冲销 / 分批到票，4E 有 Issue/Partial/Consolidated Billing）
- Supplier Invoice 行级溯源：**PO Line（承诺）+ WarehouseReceipt Line（入库事实）**，双溯源（**P4 Final：首版必须 PO Line + 已 POSTED WHR 来源**；Non-PO Expense/Service/纯费用 AP 不进入首版）
- 行金额 = 服务端 Decimal 聚合（禁客户端直传头金额，对齐 5A PO 金额事实模式）

### D2：3-Way Match = 校验事实，不是冲销事实；**匹配历史走 immutable MatchRun（CTO #8845 Blocking ②）**

- 三单匹配（PO / Receipt / Invoice）产出 **MATCHED / VARIANCE** 结果，**不直接产生库存或 AP 变动**
- 匹配维度：**数量**（invoiceQty vs receiptQty vs poQty）、**单价**（invoiceUnitPrice vs PO 快照）、**税额**（invoiceTax vs 服务端计算税）
- 差异处置（接受差异 / 拒绝 / 挂起 / 生成 Supplier CN-DN）后才进入 AP Liability
- 数量差异红线：**invoiceQty > 已收数量部分不可入 AP**（未收货部分不能形成应付）；invoiceQty < 已收数量 → 差异处置
- **Blocking ②**：匹配可能因后续收货 / 分批发票 / snapshot / 差异处置**多次重算**——必须 **SupplierInvoiceMatchRun + MatchLine**（不可变快照，每次匹配一条 Run，**自创建后禁止业务字段 UPDATE/DELETE**）；`SupplierInvoiceLine.currentMatchStatus/currentMatchRunId` 只是**当前投影**；**审批事实引用 immutable matchRunId/revision**（存 `approvedMatchRunId/approvedMatchRevision` 于 Workflow/Invoice approval evidence，**MatchRun 自身无 approvedAt/approvedById——Approval references MatchRun，不 mutates MatchRun**；可靠回答"这张发票当时为什么在 14:03 被批准？"）

### D3：暂估应付（GR/IR）= 过渡投影，不是真实债务；**完整生命周期含 Purchase Return 冲回（CTO #8845 Blocking ①）**

- 已收未票（WarehouseReceipt Posted 但无发票）：按 PO 快照单价 × 已入库数量**暂估应付**（**P8 Final：自动暂估**，WHR Posted 时生成）
- 暂估**不生成真实 AP Open Item**，是过渡投影（到票冲销）
- **Blocking ① 完整生命周期**：
  ① `WarehouseReceiptPosted` → **GRIR Accrual**（WHR Line → accrual identity）；
  ② `WarehouseReceipt-based PurchaseReturned` → **GRIR Reversal/Reduction**（**只有来自已 POSTED WarehouseReceiptLine 的退货才冲减 GR/IR**——未入库拒收/退货不产生 reversal，继承 5B 区分；Return Line → reversal identity）；
  ③ `SupplierInvoice POSTED` → **consume/reverse remaining GRIR + create actual AP Liability**（Invoice Line → consume identity）
- **源幂等身份**：三个 identity 各自唯一，**防重复冲回**（对齐 6A 五元幂等纪律）
- **到票冲暂估**：发票匹配通过后冲销暂估投影 → 按发票实际金额生成 AP Liability；暂估与实票差异走差异处置（P6 tolerance）

### D4：AP Liability = 应付债务事实；**Fact vs Projection 分层（CTO #8845 Blocking ③）**

- 三单匹配通过（或差异被批准）→ **POSTED** → 生成 **AP Liability Fact**（含税金额 / 到期日 / 币种 / 发票溯源；**不可变**）
- **Blocking ③ 分层**（对齐 6A 库存事实/投影纪律）：`SupplierInvoice POSTED` / `Supplier CN-DN APPLIED` = **AP Liability Facts**；`PaymentAllocation` = **Settlement Fact**；**AP Open Item = materialized projection / read model**（openAmount **不是**新的财务事实源）
- **Reconciliation**：`openAmount = Liability + CN/DN - Allocations`（服务端计算，不手改）；Allocation 纠错 → **追加 reversal/correction allocation**
- **状态机两维（P3 Final）**：`documentStatus`（DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED / CANCELLED）+ `settlementStatus`（UNPAID / PARTIALLY_PAID / PAID）——**付款核销不反向改变 documentStatus**

### D5：进项税（Input VAT）= 财务事实，快照计算；**canonical basis 锁死（CTO #8845 Blocking ④，P9 Final）**

- **价税分离（P9 Final）**：SupplierInvoiceLine 存 `netAmount`（不含税）+ `taxRate`（快照）+ `taxAmount`；税基 = 匹配后的净额
- **GR/IR baseAmount = 不含税暂估净额**：PO 含税价如何 normalize 成暂估净额（税率快照自 PO/税务配置）——**进项税只在合规发票事实进入时确认，暂估阶段不隐式确认 Input VAT**
- **VAT recoverable 标记** + `Invoice POSTED` 拆分 **net liability / input VAT / total AP**；**不可抵扣税（P9 Final，CTO #8901 拍板）**：recoverable=true → 税额进 **Input VAT component**；recoverable=false → 税额进 **nonRecoverableTaxAmount（expense-or-capitalizable component）财务事实**——5C 只保存/发布该金额事实，**不写 InventoryMovement/StockProjection/库存成本层**（不把不可抵扣税资本化进 Inventory Cost），未来 Costing/GL 决定最终资本化或费用化；**AP 总债务 = net + total tax，不因 recoverability 改变应付总额**
- 税额差异（invoiceTax ≠ 服务端计算税）→ 差异处置（税务快照/税率配置）

### D6：Supplier CN / DN = 供应商调整事实（方向与 4E 相反；**P7 Final：独立事实**）

- **Supplier Credit Note（冲减 AP）/ Supplier Debit Note（增加 AP）**——供应商开给我方的调整单据
- 4E-3 的 CN/DN 是**我方**开给客户（AR 侧）；5C Supplier CN/DN 是**供应商**开给我方（AP 侧）——**模型独立，可借鉴 signed adjustment（CN<0/DN>0）+ 累计防超调锁内重算**（4E-3 模式，方向相反）
- **P7 Final：独立事实，不能修改已 POSTED Invoice**；APPLIED 时调整 AP Liability Fact（signed）
- 触发：发票差异处置 / 退货（5B PurchaseReturn CREDIT_ONLY 处置关联）

### D7：Payment Allocation = 付款核销 AP（方向与 4E-2 相反；**Settlement Fact，P10/P12 Final**）

- 付款单 + M:N 核销 AP Open Item；**防超核销**（累计 allocation ≤ openAmount，锁内重算）
- 同供应商同币种（对齐 4E-2 模式，方向相反）
- Payment 是独立事实（Created ≠ Applied，Apply 唯一回写 Settlement Fact 入口——对齐 4E-2 WriteOff 模式）；**P12 Final maker-checker（Creator ≠ Approver/Poster；Payment 同样执行）**
- **纠错 → 追加 reversal/correction allocation，不手改 openAmount**（Blocking ③ 纪律延续）

### D8：与 General Ledger 的边界（P11 Final）

- 本阶段**不建 GL 总账**（P11 Final）；5C 产出"财务事实"（AP Liability Fact / GRIR / CN-DN / Payment Settlement），**只发布稳定会计事件/接口**，GL 过账留给未来 Finance 阶段消费（对齐 4E 不写 GL 先例）
- 5C 只产出可被 GL 消费的**事实 + 事件**，不做过账

### D9：明确排除（CTO #8777 HOLD 延续）

- **Costing / FIFO / Moving Average / Cost Layer / Valuation / Landed Cost**：发票金额是财务事实，不是成本事实；成本在采购+库存+AP 链闭合后再排优先级
- **Reservation / ReservedQty / AvailableQty**：继续 HOLD
- **Manufacturing / MRP**：继续 HOLD
- **不触碰 InventoryMovement / StockProjection**（6A SSOT 红线继承；5C 只读库存事实做数量匹配）

### D10：两维状态（P3 Final）

- `documentStatus`（DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED / CANCELLED，截止 POSTED/CANCELLED）+ `settlementStatus`（UNPAID / PARTIALLY_PAID / PAID，独立维度，由 Payment Allocation 驱动）
- **付款核销不反向改变 documentStatus**（CTO #8845 Hardening 1）

### D11：首版 Scope（P4 Final + Hardening 2）

- **PO + WarehouseReceipt-based stock procurement invoice**（必须 PO Line + 已 POSTED WHR 来源）
- **Non-PO Expense Invoice / Service Invoice / 纯费用 AP 不进入首版**（后续独立阶段）

### D12：实现切片（CTO #8845 Hardening 3）

- **5C-1**：Supplier Invoice + 3-Way Match（MatchRun）+ GRIR（Accrual/Reversal/consume）+ AP Open Item（projection）——一个 Migration + 一个 API PR
- **5C-2**：Supplier CN/DN + Payment Allocation（Settlement Fact）——独立 Migration + 独立 API PR（5C-1 完成后独立 Gate）
- 避免一个 PR 变整个 Finance 子系统

---

## 变更记录

| 版本 | 日期       | 状态                      | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ---------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1 | 2026-08-11 | **Proposed**              | 5C Design Gate 首版（D1-D9，P1-P12 待拍板）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v0.2 | 2026-08-11 | **Approved with Changes** | CTO 5C Design Review 88/100 #8845——4 Blocking + 3 Hardening 全部修复：① GRIR 完整生命周期含 Purchase Return 冲回（WHR-based 才冲减 + 源幂等身份）② Match 改 immutable MatchRun/MatchSnapshot + current projection ③ AP Liability Fact vs OpenItem Projection 分层（openAmount = Liability + CN/DN - Allocations reconciliation）④ GR/IR net/tax canonical basis + Input VAT 识别时点锁死（价税分离，GRIR baseAmount=不含税净额）；3 Hardening：documentStatus/settlementStatus 两维、首版 RECEIPT_BASED scope、5C-1/5C-2 切片；P1-P12 按 CTO 表转 Final（P3/P5/P8/P9 修改后固化） |

> 批准后：更新为 Approved（CTO Re-review 通过）→ 追加 Implementation Status（对齐 ADR-0025/0026 模式）。

## Implementation Note（5C-1C0，CTO #9477 —— GRIR Producer Foundation + AP correction pending 边界）

### 背景

正式实现 Supplier Invoice POST（GRIR CONSUME + AP Liability）之前，必须先补齐 GRIR Producer：

- **WHR POST → GRIR ACCRUAL**（每 WHR Line 一条；与 WarehouseReceipt POSTED + Inventory Outbox IN 同事务）；
- **WHR-based PurchaseReturn RETURN → GRIR REVERSAL**（只冲 remaining unconsumed GRIR；与 RETURNED + Outbox OUT 同事务）。
  否则 Invoice POST 的 CONSUME 会面临"无暂估事实可消费"的假闭环。

### 关键实现（5C-1C0-A/B/C）

| 项                      | 决策                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match tax basis（C0-A） | `expectedTax = matchedQty × poUnitPrice × poLine.taxRate / 100`（PO Line 税率快照，不是 SupplierInvoiceLine.taxRate）；`taxVariance = invoiceTaxAmount - expectedTax`。不改 Migration 0027 / MatchLine schema。                                                                                                                                                                        |
| GRIR ACCRUAL（C0-B）    | quantity = WHR Line.quantity；unitPrice/taxRate = PO Line 快照（WHR Line → PurchaseReceiptLine → PurchaseOrderLine 溯源）；baseAmount = quantity × unitPrice（**未税暂估净额，不得确认 Input VAT**）；sourceKey = `ACCRUAL:WAREHOUSE_RECEIPT_LINE:{whrLineId}`；幂等 = DB partial UNIQUE(warehouseReceiptLineId WHERE grirType='ACCRUAL') + sourceKey UNIQUE。                         |
| GRIR REVERSAL（C0-C）   | **只对 sourceRefType=WAREHOUSE_RECEIPT_LINE 产生**（RECEIPT_LINE/INSPECTION 从未形成已入库暂估事实 → 0 GRIR）；remaining unconsumed = ΣACCRUAL - ΣREVERSAL - ΣCONSUME（同 WHR Line）；`reversibleQty = min(returnQty, remaining)`，**仅 > 0 创建**；sourceKey = `REVERSAL:PURCHASE_RETURN_LINE:{prLineId}`；幂等 = DB partial UNIQUE(purchaseReturnLineId WHERE grirType='REVERSAL')。 |
| 财务边界                | **5C-1 不得制造负 GRIR**：退货超 remaining 部分 → 不创建 REVERSAL；以 `pendingQty`（返回载荷 + Audit）留痕 **"AP correction pending / requires Supplier CN-DN"**；PurchaseReturn 业务仍成功（不因 Finance 未实现阻塞物理退货）。                                                                                                                                                       |

### 边界场景（CTO #9477 锁定）

- WHR 100 → ACCRUAL 100 → Invoice POSTED 100（CONSUME 100）→ 后续 Purchase Return 20：
  该 20 已是"已形成 AP 后的供应商贷/借项调整"，**不是已收未票暂估问题** → 进入 **5C-2 Supplier CN/DN**；
  5C-1 阶段 REVERSAL 只冲 remaining unconsumed，超限部分 pending 留痕，**本轮不实现 CN/DN**。

### 不可变纪律

GrirRecord / ApLiabilityFact 均为 immutable facts——只 create，绝不 UPDATE/DELETE；纠错只能追加事实（对齐 6A 库存事实/投影纪律）。

## Implementation Note 2（5C-1C0 Review，CTO #9547 —— 0028 Historical GRIR Backfill + 锁序契约）

### 背景（Blocking）

C0-B/C producer 只覆盖"此后发生"的 WHR POST / Return RETURN。5B 早于 5C，Migration 0027 部署时
数据库可能已有 POSTED WHR / RETURNED Return 历史事实，不会重新调用新 route → 5C-1C POST 引用旧 WHR
时 GrirRecord 无 ACCRUAL 可 consume（假闭环）。CTO #9547 拍板：**新增 0028 数据补偿 migration，
不重写 frozen 0027**。

### 0028 范围（不新增业务模型）

- **ACCRUAL backfill**：POSTED WarehouseReceiptLine 缺 ACCRUAL → 从 WHR Line→PurchaseReceiptLine→
  PurchaseOrderLine 生成（quantity=WHR qty、unitPrice/taxRate=PO 快照、baseAmount=qty×unitPrice 未税、
  sourceKey=`ACCRUAL:WAREHOUSE_RECEIPT_LINE:{id}`、createdAt=WHR.postedAt、remark='historical backfill'）。
- **REVERSAL backfill**：RETURNED PurchaseReturnLine（WAREHOUSE_RECEIPT_LINE）缺 REVERSAL → 生成历史
  reversal（reversibleQty=min(returnQty, ΣACCRUAL-Σ已REVERSAL-同WHR先前分配)；**不得使 GRIR 为负**；
  createdAt=PR.returnedAt、remark='historical backfill'）。
- **幂等**：INSERT...SELECT...WHERE NOT EXISTS + ON CONFLICT(sourceKey) DO NOTHING（partial UNIQUE +
  sourceKey UNIQUE 双防线）；审计时间线不失真（createdAt 用源事实时间）。

### 1C1/1C2 Blocking Gate（CTO #9547 锁序契约，本轮不改 C0）

- **Invoice POST CONSUME 必须与 Return REVERSAL 使用同一 WHR Line 锁顺序**：收集 invoice 涉及 WHR Line
  ids → 去重 + 稳定排序 → `ORDER BY id FOR UPDATE` → 才允许计算 remaining GRIR / 创建 CONSUME；
- 否则并发（Return 读 remaining=100 / POST 也读 100 → reversal 80 + consume 80）会超 accrual →
  超 consume / 负 GRIR；1C1/1C2 实现必须遵守（grir-helpers 复用同一 remaining 计算口径）。

## Implementation Note 3（5C-1C，CTO #9678 —— Supplier Invoice POST / GRIR CONSUME / AP Liability-OpenItem）

### 6 条实现不变量（全部锁死）

| #   | 不变量                                                                                                                                                          | 实现落点                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | **批准快照精确一致**：approvedMatchRunId + approvedMatchRevision 必须真实存在、属于本 invoice、与审批 immutable snapshot 一致；POST 不得仅看 currentMatchStatus | post-helpers.ts `postSupplierInvoice` 显式重验三列 FK 命中 SupplierInvoiceMatchRun(id, supplierInvoiceId, revision)；缺失/不一致 → 409 SUPPLIER_INVOICE_APPROVAL_SNAPSHOT_INVALID                   |
| ②   | **WHR Line 锁序与 Return 共用**：invoice 涉及 WHR ids 去重排序 → `ORDER BY id FOR UPDATE` → 锁内重算 remaining GRIR                                             | 复用 `verifyReceiptBasedSourceChain`（helpers.ts 内已实现 collect ids → sort → FOR UPDATE）；CONSUME 与 C0-C REVERSAL 串行竞争同一 remaining                                                        |
| ③   | **全额满足，禁止 partial POST**：每行 remaining ≥ approved invoice qty；不足 409 fail closed 整事务回滚                                                         | postSupplierInvoice 逐行 remaining 校验（ΣACCRUAL - ΣREVERSAL - ΣCONSUME）；不足 → GRIR_INSUFFICIENT + details，Invoice 保持 APPROVED                                                               |
| ④   | **CONSUME 金额 GRIR/PO snapshot basis**：unitPrice/taxRate 取 ACCRUAL snapshot；baseAmount = quantity × accrual unitPrice                                       | CONSUME 创建时 findFirst 该 WHR Line 的 ACCRUAL 记录取快照；发票价格差异属已审批采购价格差异，不改写 GRIR basis                                                                                     |
| ⑤   | **AP Liability 发票事实金额**：一票一个 immutable ApLiabilityFact；ApOpenItem 只读投影                                                                          | createApLiabilityAndOpenItem：gross/net 取发票服务端聚合；inputVat=Σ行 recoverable=true taxAmount；nonRecoverable=Σ行 nonRecoverableTaxAmount；openAmount 初始=grossAmount、settlementStatus=UNPAID |
| ⑥   | **POST 原子性**：POSTED + 全部 CONSUME + Liability + OpenItem 同事务全有或全无                                                                                  | post/route.ts `prisma.$transaction` → postSupplierInvoice；任一异常 → 回滚保持 APPROVED；CAS version+1                                                                                              |

### maker-checker（服务层强制）

- Poster ≠ Creator（硬性）；Approval actor 可解析（WorkflowInstance APPROVE action / Approver(APPROVED)）
  则双重校验（Poster ≠ Approval actor）——route 层无绕过。
- POST 成功一次后重复调用 → 409 SUPPLIER_INVOICE_ALREADY_POSTED（幂等）；DB partial UNIQUE +
  sourceKey UNIQUE + ApLiabilityFact.supplierInvoiceId UNIQUE 最终防线。

### 边界

- 历史退货已降低 remaining GRIR 导致无法完整 consume → POST 拒绝（GRIR_INSUFFICIENT 409）；
  **不制造负 GRIR，不在 5C-1C 偷做 CN/DN**；差额留 5C-2（Supplier CN/DN）。
- 事件：POST 事务提交后 best-effort 发布 `SupplierInvoicePosted` + `GrirConsumed`（EVENTS v1.33，
  不含 projection 余额）；`GrirAccrued/GrirReversed` 仍 HOLD（C0 producer 事件未单独实现）。
- 红线延续：5C-2 CN/DN/Payment、GL、Costing、Reservation、InventoryMovement/StockProjection 零写入；
  Migration 0027/0028 均不得再改。
