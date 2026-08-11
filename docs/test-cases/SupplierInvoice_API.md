# Supplier Invoice API — Test Cases（Sprint 5C-1A）

> Sprint 5C-1A（CTO #9048 Schema FINAL APPROVED + #9083 API 指令）｜ 分支 feature/sprint5c-supplier-invoice-ap（PR #23）
> 事实链：**SupplierInvoice DRAFT（SINV 创建即取号，P1 Final）→ Create/PATCH 两次 RECEIPT_BASED 三重 Gate → Submit（DRAFT→SUBMITTED，第三次来源链验证；**SUBMITTED ≠ POSTED**，不生成 MatchRun/GRIR/ApLiabilityFact）**
> 三条 API 红线（本阶段）：① Create/PATCH/Submit 三次重新验证 WHR header=POSTED + WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致；② 金额全部服务端 Decimal（不信任客户端头金额/行金额）；③ Submit 只状态迁移，不建 MatchRun/GRIR/ApLiabilityFact、不写 POSTED evidence。
> Migration 0027 = FROZEN BASELINE（禁改）；5C-1B/1C、5C-2、GL、Costing、Inventory 写入全部 HOLD。

## A. 权限（RBAC）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| A1 | supplier-invoice:view | 无权限用户 GET /api/supplier-invoices、GET /:id | 403 |
| A2 | supplier-invoice:create | 无权限用户 POST /api/supplier-invoices | 403 |
| A3 | supplier-invoice:edit | 无权限用户 PATCH /:id、POST /:id/submit | 403 |
| A4 | line 受限权限 | 客户端直接访问 supplier-invoice-line 资源 | 仅 view/edit 存在，无独立业务入口 |

## B. 发票创建（Create — DRAFT，SINV 取号）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建成功 | 合法 supplierId + supplierInvoiceNo + 双溯源行（WHR POSTED、链一致、qty ≤ 已入库） | 201；invoiceNo=SINV000001（P1 创建即取号）；documentStatus=DRAFT；settlementStatus=UNPAID |
| B2 | SINV 序号递增 | 连续创建两张 | SINV000001 → SINV000002（原子取号，无跳号/重复） |
| B3 | 金额服务端计算 | 客户端提交 quantity=10 / unitPrice=100 / taxRate=13（**客户端不传金额**） | 行 netAmount=1000.00、taxAmount=130.00；头 net=1000.00 / tax=130.00 / gross=1130.00（Decimal 服务端聚合） |
| B4 | 客户端伪造金额被忽略 | 客户端 body 带 netAmount/grossAmount（schema strip） | 创建成功但金额 = 服务端计算值（伪造字段被忽略，不落库） |
| B5 | 重复供应商发票号 | 同 supplierId + 同 supplierInvoiceNo 再创建 | 409 SUPPLIER_INVOICE_DUPLICATE_NUMBER（API 预检；DB 组合 UNIQUE 兜底） |
| B6 | 双溯源必填 | 行缺 purchaseOrderLineId 或 warehouseReceiptLineId | 400 VALIDATION_ERROR（zod 必填） |
| B7 | 供应商无效 | supplierId 不存在/停用 | 400 SUPPLIER_INVOICE_SUPPLIER_INVALID |
| B8 | 重复行 | 同一 PO Line + WHR Line 出现两次 | 400 SUPPLIER_INVOICE_DUPLICATE_LINE |

## C. RECEIPT_BASED 三重 Gate（红线 ①——Create 第一次 / PATCH 第二次 / Submit 第三次）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| C1 | WHR 非 POSTED | 行指向 DRAFT/CANCELLED WHR 的 Line | 400 SUPPLIER_INVOICE_WHR_NOT_POSTED（只有 POSTED 才是已入库事实） |
| C2 | WHR Line ↔ PO Line 不一致 | warehouseReceiptLineId 溯源收货行的 purchaseOrderLineId ≠ 行提交的 purchaseOrderLineId | 400 SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH |
| C3 | Item 链不一致 | WHR Line.itemId ≠ PO Line.itemId（两端均有值） | 400 SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH |
| C4 | Supplier 链不一致 | WHR → PurchaseReceipt.supplierId ≠ 发票 supplierId | 400 SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH |
| C5 | 数量超已入库 | 开票数量 > WHR Line.quantity | 400 SUPPLIER_INVOICE_QUANTITY_INVALID |
| C7 | **累计超收（Blocking ① CTO #9161）** | WHR 已入库 100；发票 A 开 60，发票 B 再开 60（B 本次 60 ≤ 100 但 60+60 > 100） | 400 SUPPLIER_INVOICE_CUMULATIVE_QTY_EXCEEDED（helper 累计占用 SUM 非 CANCELLED 发票行） |
| C8 | **PATCH 自身排除（Blocking ①）** | 发票 A（DRAFT）行 60；PATCH 行替换改 80（WHR=100）——自身旧行 60 不得计入累计占用 | 200 成功（60 排除后 80 ≤ 100）；若把自身计入会误报 400 |
| C9 | **并发抢同一 WHR Line（Blocking ①）** | WHR 已入库 100；两个请求同时 Create 各 60 | FOR UPDATE 锁 WHR Line 串行化——第二个请求 400 CUMULATIVE_QTY_EXCEEDED（不会双读到 available=100） |
| C6 | 三次验证时机 | Create 成功 → 之后 WHR 状态/来源被改 → Submit | Submit 时第三次重验 → 400（失效来源不带入 Match 阶段） |
| C10 | **PO item null（Blocking ②）** | PO Line.itemId 为空 | 400 SUPPLIER_INVOICE_ITEM_INVALID（NULL 穿透拒绝） |
| C11 | **WHR item null（Blocking ②）** | WHR Line.itemId 为空 | 400 SUPPLIER_INVOICE_ITEM_INVALID（NULL 穿透拒绝） |
| C12 | **item mismatch（Blocking ②）** | PO Line.itemId ≠ WHR Line.itemId（均非空） | 400 SUPPLIER_INVOICE_SOURCE_CHAIN_MISMATCH |
| C13 | **正常 item PASS（Blocking ②）** | PO itemId != null 且 WHR itemId != null 且相等且 Item 有效 | 通过；SupplierInvoiceLine.itemId 服务端写非空值（不再写 null） |
| C14 | **Item 非 ACTIVE 拒绝（Final Hardening CTO #9197）** | PO/WHR itemId 相等但 Item.status = INACTIVE/LOCKED/ARCHIVED（未删除但不可用） | 400 SUPPLIER_INVOICE_ITEM_INVALID（按 Item 真实状态字段 status='ACTIVE' 校验，不能只靠 deletedAt:null） |
| C15 | **确定性锁序（Final Hardening CTO #9197）** | 多行发票涉及多个 WHR Lines；两个事务以相反行顺序请求同一组 WHR Lines | helper 先对 warehouseReceiptLineId 唯一化 + 稳定排序（ORDER BY id）再统一 FOR UPDATE——锁序确定，不会死锁；业务校验仍在锁内 |

## D. 发票更新（PATCH — 仅 DRAFT + CAS）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | PATCH 成功 | DRAFT + 正确 version + 行替换（来源链仍一致） | 200；version+1；行整体替换；金额服务端重算 |
| D2 | 非 DRAFT 拒绝 | SUBMITTED 发票 PATCH | 409 SUPPLIER_INVOICE_INVALID_STATE |
| D3 | 版本冲突 | version 不匹配 | 409 VERSION_CONFLICT |
| D4 | 不可编辑字段 | 尝试改 supplierId/supplierInvoiceNo/currency/exchangeRate（schema 不收） | 字段被忽略（创建时锁定，P2 FX 快照） |
| D5 | 行替换第二次 Gate | PATCH 换行 → 新行 WHR 非 POSTED / 链不一致 | 400 WHR_NOT_POSTED / SOURCE_CHAIN_MISMATCH（同 C 段） |

## E. 发票提交（Submit — DRAFT → SUBMITTED）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | Submit 成功 | DRAFT + 正确 version + 第三次 Gate 通过 | 200；documentStatus=SUBMITTED；version+1 |
| E2 | SUBMITTED ≠ POSTED | Submit 后检查 | postedAt/postedById 为 NULL；**无 MatchRun / GRIR / ApLiabilityFact 行**（5C-1B/1C 才建） |
| E3 | 重复提交 | 已 SUBMITTED 再 submit | 409 SUPPLIER_INVOICE_INVALID_STATE |
| E4 | 无行提交 | 空行发票 submit | 400 SUPPLIER_INVOICE_NO_LINES |
| E5 | 版本冲突 | version 不匹配 | 409 VERSION_CONFLICT |
| E6 | 事件口径 | Submit 后检查 AuditLog | 仅 AuditLog（supplier-invoice:submit）；**不发 SupplierInvoiceCreated 领域事件**（注册位保持 ⏳——EVENTS v1.31） |

## F. 失败路径（fail closed）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | SINV Sequence 缺失 | DocumentSequence docType=SUPPLIER_INVOICE 未 seed | 500 SUPPLIER_INVOICE_SEQUENCE_MISSING（禁 fallback 临时编号） |
| F2 | DB 组合 UNIQUE 兜底 | 并发创建同 supplierId+supplierInvoiceNo（预检未命中） | catch P2002 → 409 SUPPLIER_INVOICE_DUPLICATE_NUMBER |

## G. 静态核验（红线 grep）

| # | 检查 | 预期 |
| --- | --- | --- |
| G1 | 0 直写 | supplier-invoices 路由 0 处 InventoryMovement/StockProjection 写入（红线） |
| G2 | 三次来源链 | verifyReceiptBasedSourceChain 在 create/patch/submit 三路由各调用 1 次 |
| G3 | 金额服务端 | schema 不收金额；helpers.computeSupplierInvoiceLineAmounts 唯一金额入口 |
| G4 | Submit 不建 AP | submit 路由 0 处 supplierInvoiceMatchRun/grirRecord/apLiabilityFact create（5C-1B/1C） |
| G5 | Migration 0027 未动 | git diff 不含 prisma/migrations/0027_*（FROZEN BASELINE） |
