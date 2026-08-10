# Sprint 5B QA — Goods Receipt & Inbound（收货/质检/入库/退货全链）

> Sprint：5B（China ERP Process & Field Gate）| 模块：PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn Foundation（Schema/Migration 0023 + Seed/RBAC + 四模块全链路 API + PO 履约投影 reopen） | PR：#20（feature/sprint5b-gate，Open 待 Final Review 合并）
> 日期：2026-08-10
> 状态：✅ 代码门禁通过（CI 全绿：`6e41d3a` PurchaseReturn API / `37f7d68` TS 修复 / `b4c2170` CTO Re-review 修复——Quality Gates + Build + Secret Scanning 全 success）；**CTO PurchaseReturn API FINAL REVIEW 98/100 APPROVED（#7267→#7303）**；**Sprint 5B 核心事实链 CLOSED**；本 QA 文档为 PR #20 Finalization 收口产物；**Ready for Final Review**（PR #20 合并后改 Completed）
> 关联：ADR-0024（Goods Receipt & Inbound Boundary）、Sprint5B_China_ERP_Process_Field_Gate.md、Sprint5B_Field_Matrix.md、Sprint5B_CTO_Pending_Decisions.md、EVENTS.md v1.22、openapi.yaml（Sprint 5B 段）、docs/test-cases/PurchaseReceipt_API.md + Inspection_API.md + WarehouseReceipt_API.md + PurchaseReturn_API.md
> 5B 核心业务链（CTO 确认 CLOSED）：**PO CONFIRMED → PurchaseReceipt RECEIVED → Inspection Completed → WarehouseReceipt POSTED → PurchaseReturn RETURNED**；全程 **Stock / InventoryMovement = 0 写入**（库存事实源未被采购模块提前污染，6A 唯一事实源）

## 1. 交付范围

### 1.1 API（4 模块，均在 `apps/web/src/app/api/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 收货 | GET/POST `/api/purchase-receipts`、GET/PATCH `/{id}`、POST `/{id}/receive`、POST `/{id}/cancel` | 到货/收货事实（D1 第一层）；只有 CONFIRMED/PARTIALLY_RECEIVED PO 可建（RECEIVED 禁普通新增收货 D9）；receive 事务 FOR UPDATE 锁 PO Line + 投影回写（receivedQty += quantity - rejectedOnReceiptQty）+ PO 聚合状态 |
| 质检 | GET/POST `/api/inspections`、GET/PATCH `/{id}`、POST `/{id}/complete` | 质检唯一事实（D8）；inspectableQty = quantity - rejectedOnReceiptQty；qualifiedQty + rejectedQty = inspectableQty（=）；SKIP 免检服务端强制 QUALIFIED 不绕过 Inspection；一次检验即最终结果（DB unique） |
| 入库 | GET/POST `/api/warehouse-receipts`、GET/PATCH `/{id}`、POST `/{id}/post` | 采购入库事实（D1 第二层 + P6 追溯 capture）；D10 Created ≠ Posted，只有 POSTED 触发 6A InventoryMovement(IN)；组合 FK [inspectionId, purchaseReceiptLineId] 同属；DIRECT_PROJECT 禁入库（P4）；POST 含本单行防并发超入 |
| 退货 | GET/POST `/api/purchase-returns`、GET/PATCH `/{id}`、POST `/{id}/return` | 退货独立事实（P5 非负 GR）；三来源 exactly-one FK；来源可退余额 = rejectedOnReceiptQty / rejectedQty / POSTED 入库行 quantity（CTO Re-review Blocking ① 修正，Create 与 Return Gate 同源）；REPLACE_REQUIRED 同事务真正 reopen PO 履约（Blocking ②：INSPECTION/WAREHOUSE 来源 receivedQty-=qty + remainingReceiveQty 重开，RECEIPT_LINE 不重复 reopen，PO RECEIVED→PARTIALLY_RECEIVED）；Return Gate 锁内重算累计 RETURNED 防并发超退；事件/Audit line-level disposition（Minor） |

### 1.2 RBAC（权限码，动作级，零新造）
- purchase-receipt:view / create / edit（PATCH+receive）/ close（cancel）
- inspection:view / create / edit（PATCH+complete）
- warehouse-receipt:view / create / edit（PATCH+post）
- purchase-return:view / create / edit（PATCH+return）

### 1.3 Domain Events（EVENTS.md v1.21→v1.22）
- `PurchaseReceiptReceived`（receive 事务后发；普通收货不走审批 P1b）
- `InspectionCompleted`（complete 事务后发；SKIP+QUALIFIED 免检也发）
- `WarehouseReceiptPosted`（post 事务后发；D10：只有 Posted 触发 6A IN）
- `PurchaseReturned`（return 事务后发；**line-level disposition**：lines[] + hasReplacementRequired/hasCreditOnly）
- `PurchaseOrderPartiallyReceived / PurchaseOrderReceived`（receive 事务后按 PO 聚合状态发布，PO 投影事件——5B 实现，EVENTS.md 终态 ✅）
- 全部载荷**不含库存余额**（6A 唯一事实源）；DRAFT 创建/编辑不发领域事件（仅 AuditLog）

## 2. 业务事实边界核验（CTO Field Gate）

| # | 边界 | 实现 | 核验 |
| --- | --- | --- | --- |
| B1 | 收货/入库拆两层事实（D1） | PurchaseReceipt（到货）+ WarehouseReceipt（入库）独立模型 | ✅ |
| B2 | 只有 CONFIRMED PO 才是收货来源（D2/5A） | receive 门禁 + PO 状态机（CONFIRMED/PARTIALLY_RECEIVED 可收；RECEIVED 禁普通新增 D9） | ✅ |
| B3 | 库存唯一事实源 = InventoryMovement（D3/6A） | 5B 全程 0 写 Stock/InventoryMovement | ✅ |
| B4 | 直送不入库（D4/P4） | DIRECT_PROJECT 行禁 WarehouseReceipt | ✅ |
| B5 | 退货 = 独立 PurchaseReturn（D5/P5） | 非负 GR + 三来源 + disposition | ✅ |
| B6 | PO 投影定义（D6/P7） | receivedQty += accepted（quantity - rejectedOnReceiptQty）；reopen 同事务 | ✅ |
| B7 | 超收容差（D7/P2） | System Default 0%；tolerance 只用于 receive ceiling，不改 remainingReceiveQty 语义 | ✅ |
| B8 | 质检独立事实（D8/P3） | Inspection 唯一事实；SKIP 免检不绕过 | ✅ |
| B9 | Created ≠ Posted（D10） | 只有 POSTED 触发 6A InventoryMovement(IN) | ✅ |
| B10 | 事件语义（D11/P10） | 业务动作事件（Received/Completed/Posted/Returned），不以 DRAFT Created 为完成事实 | ✅ |
| B11 | 5B 边界红线（D12） | 无越界实现；5C（Supplier Invoice/AP）未开始 | ✅ |

## 3. 核心 Gate 验证记录

### 3.1 PurchaseReceipt receive Gate（CTO #7045 97/100 APPROVED）
- 状态门禁：仅 CONFIRMED/PARTIALLY_RECEIVED PO；RECEIVED 禁普通新增收货（D9）→ 409
- 数量公式：receivedQty_new = receivedQty_old + (quantity - rejectedOnReceiptQty)；禁 receivedQty += quantity
- tolerance 只用于 receive ceiling（System Default 0%）：newReceivedQty > PO quantity × (1+rate) → 409 OVER_RECEIPT
- 行锁：事务内 FOR UPDATE（排序锁行防死锁）+ B② 同一 Receipt 一个 PO Line 一次
- 投影回写：receivedQty/remainingReceiveQty = max(quantity - receivedQty, 0) 服务端唯一计算 + version 递增
- PO 聚合：全部行 receivedQty >= quantity → RECEIVED；否则 PARTIALLY_RECEIVED
- 事件：PurchaseReceiptReceived + PO 投影事件（PartiallyReceived/Received）事务后发布

### 3.2 Inspection complete Gate（CTO #7135 98/100 FINAL）
- inspectableQty = quantity - rejectedOnReceiptQty（最大可检数不包含现场拒收）
- qualifiedQty + rejectedQty = inspectableQty（= 强制，客户端数量不符 → 409）
- SKIP 免检：服务端强制 QUALIFIED + qualifiedQty=inspectableQty + rejectedQty=0（不绕过 Inspection 记录）
- result 服务端推导（QUALIFIED/PARTIAL/REJECTED），客户端不得传
- 一次 Inspection 即最终结果：同一 PurchaseReceiptLine 唯一有效 Inspection（DB unique 并发拒绝）
- 来源必须已 RECEIVED 收货行（CTO #7045）
- 事件：InspectionCompleted 事务后发布

### 3.3 WarehouseReceipt post Gate（CTO #7135 98/100 FINAL）
- D10：Created ≠ Posted；只有 POSTED 触发 6A InventoryMovement(IN)
- 来源：已 RECEIVED PurchaseReceipt + 已完成且 qualifiedQty > 0 的 Inspection（组合 FK [inspectionId, purchaseReceiptLineId] 同属）
- 可入库余额：累计入库（POST 含本单行）≤ qualifiedQty → 防并发超入（OVER_INSPECTION_BALANCE → 409）
- DIRECT_PROJECT 禁入库（P4）；Warehouse-Location 同属
- POST 事务锁 + CAS/幂等（ALREADY_POSTED → 409）
- 事件：WarehouseReceiptPosted 事务后发布（D10：6A 消费 Posted 事件生成 IN）

### 3.4 PurchaseReturn return Gate（CTO Re-review 98/100 FINAL #7267→#7303）
- 独立退货事实（P5 非负 GR）；三来源 exactly-one FK + API 强制匹配
- 来源可退余额（Re-review Blocking ① 修正，Create 预检查与 Return Gate 同源防分叉）：
  - RECEIPT_LINE → PurchaseReceiptLine.rejectedOnReceiptQty（现场拒收）
  - INSPECTION → Inspection.rejectedQty（质检拒收）
  - WAREHOUSE_RECEIPT_LINE → 已 POSTED 入库行 quantity
  - 物理数量重复退货漏洞（合格 80 可退 80 + 入库再退 80）已封死
- 防并发超退：Return Gate FOR UPDATE 锁真实来源 + 锁内重算累计 RETURNED（仅 RETURNED 占额度，DRAFT 不计，不双计）
- REPLACE_REQUIRED 真正 reopen PO 履约（Re-review Blocking ②，同一事务）：
  - INSPECTION / WAREHOUSE_RECEIPT_LINE 来源：receivedQty -= returnQty；remainingReceiveQty 重开待交（max(quantity - receivedQty, 0)，与 receive canonical helper 一致）
  - RECEIPT_LINE(rejectedOnReceiptQty)：收货时未计入 receivedQty，供应商本就欠货 → 不重复 reopen
  - 原始 PurchaseReceipt / Inspection / WarehouseReceipt 事实不倒改，只调 PO 履约投影
  - PO 原状态 RECEIVED + 有效 reopen → 重聚回 PARTIALLY_RECEIVED（防 RECEIVED + remainingReceiveQty>0 自相矛盾）
- RETURNED 幂等/CAS：ALREADY_RETURNED → 409；version 冲突 → 409
- line-level disposition（Re-review Minor）：事件/Audit 输出 lines[]（lineId/sourceRefType/sourceId/quantity/disposition）+ hasReplacementRequired/hasCreditOnly（弃第一行单值冒充整单）
- 事件：PurchaseReturned 事务后发布（不含库存余额）

## 4. 回归与并发专项

| # | 场景 | 预期 |
| --- | --- | --- |
| R1 | receive 并发抢同一 PO Line | FOR UPDATE 串行；第二个按最新投影校验（防并发超收） |
| R2 | 两退货单同来源并发 Return | 锁内重算累计 RETURNED；第二单稳定 409（防并发超退） |
| R3 | 收货 + 退货并发 | 均锁 PO Line/来源行，串行化，无脏投影 |
| R4 | 重复 Receive / Post / Return | 幂等 409（ALREADY_RECEIVED / ALREADY_POSTED / ALREADY_RETURNED） |
| R5 | CAS 版本冲突 | 409 VERSION_CONFLICT |
| R6 | 5B 全程库存写入 | **Stock / InventoryMovement 写入 = 0**（grep 代码审计 + CI 无相关变更） |

## 5. 已知限制（Known Limitations）

1. 事件总线未落地（Transactional Outbox 债务 CTO #7045）：发布失败不阻断业务事实（事务已提交），生产前升级；
2. 6A Inventory Ledger 未开工（CTO 决策：PR #20 收口后新建 feature/sprint6a-inventory-ledger，先过 6A Inventory Ledger Gate 再 Schema）；5B 只定义"应产生库存动作"的事实，不写库存；
3. 5C（Supplier Invoice / 三单匹配 / AP）未开始；
4. ADR-0024 早期文字残留（状态行"Schema/Migration 0023 待实现"、D3 `WarehouseReceiptCreated` 示例）→ **本次 Final Docs 已统一更新**（v1.23 变更记录）。

## 6. Release Gate

Sprint 5B 进入 CTO Final Review 前必须满足：

1. 四模块 A-I（test-cases）全部核验，无 Blocking；
2. 5B 核心链 PO CONFIRMED → PurchaseReceipt RECEIVED → Inspection Completed → WarehouseReceipt POSTED → PurchaseReturn RETURNED 全链通过；
3. CTO PurchaseReturn API FINAL REVIEW 98/100 APPROVED 已通过（Blocking 0）；
4. 5B 全程 Stock / InventoryMovement 写入 = 0（6A 边界未污染）；
5. CI Quality Gates + Build 全绿（@ b4c2170，run #190）；
6. OpenAPI 5B 段（四模块端点 + schemas）已补齐；
7. ADR-0024 / ROADMAP / CHANGELOG / RELEASE_NOTES / EVENTS v1.23 终态已更新；
8. PR #20 Description Scope 已更新（设计文档 → Sprint 5B 完整实现收口）；
9. 合并后新建 feature/sprint6a-inventory-ledger（6A Gate 先行，不直接 Schema）。
