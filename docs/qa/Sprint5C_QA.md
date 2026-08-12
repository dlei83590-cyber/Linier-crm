# Sprint 5C QA — Supplier Invoice Foundation（5C-1A Vertical Slice）

> Sprint：5C-1A（Supplier Invoice Foundation）| 模块：Supplier Invoice——RECEIPT_BASED 首版（PO Line + POSTED WHR Line 双溯源）+ SINV 创建即取号 + 三次来源链验证 + DRAFT→SUBMITTED | 分支：feature/sprint5c-supplier-invoice-ap（PR #23）
> 日期：2026-08-11
> 状态：⏳ 待 CTO 5C-1A API Review（CTO #9048 Schema FINAL APPROVED + #9083 API 指令授权；5C-1B Match / 5C-1C POST-GRIR-AP 继续 HOLD）
> 关联：ADR-0027（APPROVED）、Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md、Sprint5C_Field_Matrix.md、P1-P12 Final、EVENTS.md v1.31（SupplierInvoiceCreated 注册位保持 ⏳）、docs/test-cases/SupplierInvoice_API.md、openapi.yaml（Sprint 5C-1A 段）
> 5C-1A 事实链：**SupplierInvoice DRAFT（SINV 创建即取号，P1）→ Create/PATCH 两次来源链验证 → Submit（DRAFT→SUBMITTED，第三次来源链验证；**SUBMITTED ≠ POSTED**，不生成 MatchRun/GRIR/ApLiabilityFact）**
> 四条 API 红线（CTO #9048 锁死）：① Create/Match/POST 都必须重新验证 WHR header = POSTED + WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致；② POST 锁内重验 approved MatchRun snapshot（5C-1C）；③ POSTED + GRIR CONSUME + ApLiabilityFact + ApOpenItem 同一事务（5C-1C）；④ 禁止 UPDATE immutable MatchRun/GRIR/ApLiabilityFact（5C-1B/1C）。

## 1. 交付范围

### 1.1 代码（均在 `apps/web/src/**` + seed/constants）

| 分组      | 文件/端点                                                     | 说明                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed/RBAC | `prisma/seed.ts` + `packages/shared/src/constants/index.ts`   | `supplier-invoice` 动作权限（view/create/edit/close）+ `supplier-invoice-line` view/edit 受限权限 + **SINV DocumentSequence**（SUPPLIER_INVOICE，prefix SINV，padLength 6，创建即取号 fail closed）                                                                                                                                                         |
| 领域函数  | `apps/web/src/lib/supplier-invoice/helpers.ts`                | `nextSupplierInvoiceNo`（SINV 原子取号，**Sequence 缺失 fail closed**）+ `verifyReceiptBasedSourceChain`（**RECEIPT_BASED 三重 Gate：WHR POSTED + WHR Line↔PO Line↔Item↔Supplier 来源链一致 + 数量≤已入库**）+ `computeSupplierInvoiceLineAmounts`/`aggregateSupplierInvoiceTotals`（**金额服务端 Decimal，禁客户端直传**）+ `supplierInvoiceLineDedupeKey` |
| API       | `apps/web/src/app/api/supplier-invoices/route.ts`             | GET 列表（分页 + invoiceNo/supplierId/documentStatus/dateFrom/dateTo 过滤）+ POST 创建（DRAFT；SINV 取号；**第一次来源链验证**；重复发票号 API 409 + DB 组合 UNIQUE 双防线）                                                                                                                                                                                |
| API       | `apps/web/src/app/api/supplier-invoices/[id]/route.ts`        | GET 详情 + PATCH 更新（仅 DRAFT；CAS version；**第二次来源链验证 + 行替换同事务**；金额服务端重算；supplierId/supplierInvoiceNo/currency/exchangeRate 不可编辑）                                                                                                                                                                                            |
| API       | `apps/web/src/app/api/supplier-invoices/[id]/submit/route.ts` | DRAFT → SUBMITTED（**第三次来源链验证**，状态迁移前重验；**不创建 MatchRun/GRIR/ApLiabilityFact，不写 POSTED evidence**；仅 AuditLog）                                                                                                                                                                                                                      |
| OpenAPI   | `docs/openapi.yaml`                                           | Sprint 5C-1A 段：/api/supplier-invoices（list/create/get/patch/submit）+ components（SupplierInvoiceCreate/Update/Line/VersionRequest/Response/List）                                                                                                                                                                                                       |

### 1.2 RBAC（权限码，动作级，零新造）

- `supplier-invoice:view`（list/get）｜ `supplier-invoice:create`（创建）｜ `supplier-invoice:edit`（PATCH/submit）｜ `supplier-invoice:close`（cancel，5C-1A 未开放取消端点——HOLD）
- `supplier-invoice-line:view / edit`（受限，行由发票驱动）

### 1.3 Domain Events（EVENTS.md v1.31）

- **5C-1A 阶段不发领域事件**：`SupplierInvoiceCreated` 注册位保持 ⏳——严格沿用既有口径（DRAFT 创建/编辑/提交仅 AuditLog，对齐 6B：只有终态动作才发领域事件；5C-1A 只到 SUBMITTED，无终态动作）
- `SupplierInvoiceMatched/Posted/Cancelled` + `GrirAccrued/GrirReversed` 仍 HOLD（5C-1B/1C）；5C-2 事件继续 HOLD

## 2. 边界与红线（5C-1A 锁死）

| #   | 边界                                                                                                                                                                                                                                                                                                                          | 实现                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | **RECEIPT_BASED 三重 Gate（红线 ①）**：Create/PATCH/Submit 三次都重新验证 WHR header=POSTED + WHR Line↔PO Line↔Item↔Supplier 来源链一致；**累计开票守恒（Blocking ① CTO #9161）**：本次数量 + 其他非 CANCELLED/非 deleted 发票行占用 ≤ WHR 已入库（PATCH/Submit 排除自身旧行；helper 内部 FOR UPDATE 锁 WHR Line 防并发双计） | `verifyReceiptBasedSourceChain(tx, { supplierId, excludeInvoiceId?, lines })` 在三路由各调用一次（Create 第一次 / PATCH 第二次 + excludeInvoiceId=id / Submit 第三次 + excludeInvoiceId=id）；累计占用 = SUM 非 CANCELLED 发票行 quantity |
| B1b | **Item 来源链 NULL 穿透锁死（Blocking ② CTO #9161）+ 可用状态真 Gate（Final Hardening CTO #9197）**：PO itemId != null 且 WHR itemId != null 且 PO itemId == WHR itemId；且 **Item.status == 'ACTIVE'**（ACTIVE/INACTIVE/LOCKED/ARCHIVED 语义——未删除但已停用/锁定/归档的 Item 不允许开票，不能只靠 deletedAt:null）          | helper 内：`!poLine.itemId                                                                                                                                                                                                                |     | !whrLine.itemId → ITEM_INVALID`；`poLine.itemId !== whrLine.itemId → SOURCE_CHAIN_MISMATCH`；`item.findFirst({ id: itemId, deletedAt: null, status: 'ACTIVE' })` 不命中 → ITEM_INVALID |
| B1c | **确定性锁序（Final Hardening CTO #9197）**：多行发票先对 warehouseReceiptLineId 唯一化 + 稳定排序（ORDER BY id），再统一 FOR UPDATE 锁，之后逐行业务校验——避免两事务对同一组 WHR Lines 以相反顺序取锁形成死锁风险                                                                                                            | helper 内：`[...new Set(whrLineIds)].sort()` → `SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE` → 逐行校验（锁内，防累计超收双计）                                                                                                   |
| B2  | **金额不可由客户端篡改**：Create/PATCH 都不信客户端头金额/行金额                                                                                                                                                                                                                                                              | schema 不收金额；行 netAmount=quantity×unitPrice（2dp）、taxAmount=netAmount×taxRate/100（2dp）、nonRecoverableTaxAmount=vatRecoverable?0:taxAmount；头 net/tax/gross 服务端聚合（Decimal，禁 number 中间转换）                           |
| B3  | **Submit 只允许 DRAFT→SUBMITTED**                                                                                                                                                                                                                                                                                             | 不得提前创建 MatchRun/GRIR/ApLiabilityFact；不写 postedAt/postedById（POSTED evidence 属 5C-1C）                                                                                                                                          |
| B4  | **重复供应商发票号**：API 稳定 409 + DB 组合 UNIQUE 最终防线                                                                                                                                                                                                                                                                  | 创建前 findFirst 预检 → 409 SUPPLIER_INVOICE_DUPLICATE_NUMBER；P2002 catch → 同 409（@@unique([supplierId, supplierInvoiceNo])）                                                                                                          |
| B5  | **PATCH 仅 DRAFT + CAS**                                                                                                                                                                                                                                                                                                      | id+version+documentStatus=DRAFT 同时命中；supplierId/supplierInvoiceNo/currency/exchangeRate 不可编辑（schema 不收）                                                                                                                      |
| B6  | **SINV Sequence fail closed**                                                                                                                                                                                                                                                                                                 | 缺失 → 500 SUPPLIER_INVOICE_SEQUENCE_MISSING，禁 fallback 临时编号                                                                                                                                                                        |
| B7  | 5C-1A 不触碰 MatchRun/GRIR/ApLiabilityFact/ApOpenItem                                                                                                                                                                                                                                                                         | 全部 5C-1B/1C；不写 InventoryMovement/StockProjection；不建 GL；5C-2/CN-DN/Payment 继续 HOLD                                                                                                                                              |
| B8  | 事件严格沿用既有口径                                                                                                                                                                                                                                                                                                          | 5C-1A DRAFT/SUBMITTED 仅 AuditLog；不造新领域事件                                                                                                                                                                                         |

## 3. QA 测试段（详见 docs/test-cases/SupplierInvoice_API.md）

| 段            | 覆盖                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| A 权限        | supplier-invoice:view/create/edit 403 + line 受限权限                               |
| B 创建        | SINV 取号 / DRAFT 状态 / 金额服务端 / 重复发票号 409 / 双溯源必填                   |
| C 来源链 Gate | WHR 非 POSTED 400 / PO-WHR-Item-Supplier 链不一致 400 / 数量超已入库 400            |
| D 更新        | 仅 DRAFT / CAS 版本冲突 / 行替换第二次 Gate / 金额重算 / 不可编辑字段               |
| E 提交        | DRAFT→SUBMITTED / 第三次 Gate / SUBMITTED≠POSTED（无 AP/GRIR/MatchRun）             |
| F 失败路径    | Sequence 缺失 500 / P2002 兜底 409                                                  |
| G 静态核验    | 0 直写 InventoryMovement/StockProjection / 三次来源链 / 金额服务端 / submit 不建 AP |

## 4. 后续阶段（HOLD）

- 5C-1B：Immutable 3-Way Match（MatchRun 创建 / revision 并发 / current projection / Workflow approval 引用 immutable matchRunId/revision）
- 5C-1C：POST 最终 Gate / consume GRIR / ApLiabilityFact / ApOpenItem 初始 Projection / maker-checker（红线 ②③④ 在此落地）
- 5C-2：Supplier CN/DN + Payment Allocation（独立 Gate）；GL / Costing / Reservation 继续 HOLD

## 5. 5C-1B QA 段（Immutable 3-Way Match——CTO #9238/#9247）

### 5.1 交付范围（新增）

| 分组          | 文件                                            | 说明                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match Engine  | `lib/supplier-invoice/match-helpers.ts`         | `runMatch(tx, {invoiceId, version, actorId})`——FOR UPDATE 锁 header（唯一串行点）→ 状态门禁（SUBMITTED/MATCHED 可进，APPROVED/POSTED/CANCELLED 禁）→ CAS → 锁内 next revision（max+1）→ 来源链重验（复用 verifyReceiptBasedSourceChain）→ 服务端 snapshot → 创建 Run+Lines → current projection → MATCHED（同一事务） |
| Match API     | `api/supplier-invoices/[id]/match/route.ts`     | POST /:id/match（只推进 MATCHED；**不写 approved\***；成功后 maybeTrigger 审批绑定 run identity + 发 SupplierInvoiceMatched）                                                                                                                                                                                         |
| Workflow sync | `lib/supplier-invoice/workflow-sync.ts`         | `maybeTriggerSupplierInvoiceApproval`（grossAmount 金额区间；SUBMIT comment 携带 {matchRunId, revision}——#9247 细节③）+ `syncSupplierInvoiceApproval`（COMPLETED → stale 校验 == current + status==MATCHED → 固化 approved\* + APPROVED；REJECTED → 保持 MATCHED 可重 Match；**绝不 UPDATE MatchRun**）               |
| 分发          | `api/workflows/instances/[id]/actions/route.ts` | businessType === 'supplier-invoice' → syncSupplierInvoiceApproval                                                                                                                                                                                                                                                     |
| 事件          | `lib/supplier-invoice/events.ts` + EVENTS v1.32 | `SupplierInvoiceMatched` ⏳→✅（引用 immutable matchRunId + revision；不含投影余额）                                                                                                                                                                                                                                  |
| 文档          | openapi.yaml 5C-1B 段 + test-cases H 段         | match 端点 + MatchRun/MatchLine components + H1-H14                                                                                                                                                                                                                                                                   |

### 5.2 关键不变量（CTO #9238/#9247）

| #   | 不变量                                                                                         | 实现                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | **每次 Match 创建新 revision**（禁止 UPDATE/DELETE 历史 Run/Line）                             | runMatch 内 revision=max+1；MatchRun/MatchLine immutable trigger（trg_supplier_invoice_match_run/line_immutable）                                                                         |
| M2  | **revision 并发以 header lock 为唯一串行点**（禁裸 MAX+1 无锁路径）                            | runMatch 先 FOR UPDATE 锁 SupplierInvoice 再 aggregate max(revision)                                                                                                                      |
| M3  | **re-match 门禁**：SUBMITTED/MATCHED 可进；APPROVED 禁直接 re-match                            | 状态门禁 → 409 MATCH_NOT_MATCHABLE                                                                                                                                                        |
| M4  | **Match 时重新执行来源事实 Gate**（WHR POSTED + 链一致 + Item ACTIVE + 累计守恒 + 确定性锁序） | verifyReceiptBasedSourceChain 复用（含 FOR UPDATE + ORDER BY id + status='ACTIVE'；**excludeInvoiceId=invoiceId 排除自身旧行——re-match 时自身行已在 DB，不得计入累计占用（CTO #9342）**） |
| M5  | **snapshot 全服务端**（客户端不得上传计算结果）                                                | supplierInvoiceMatchSchema 只收 version；poQty/receiptQty/invoiceQty/poUnitPrice/invoiceUnitPrice/variance/result/disposition 全服务端生成                                                |
| M6  | **current projection 与 immutable history 分离**                                               | Match 成功后才更新 header.currentMatchRunId + lines currentMatchRunId/currentMatchStatus/matchedQty/variance*（投影可更新）                                                               |
| M7  | **Match API 不写 approved\***                                                                  | match/route.ts 0 处 approvedMatchRunId/approvedMatchRevision update                                                                                                                       |
| M8  | **Approval references MatchRun（不 mutates）**                                                 | syncSupplierInvoiceApproval 只固化 approved\* 到 SupplierInvoice；MatchRun 自身无 approvedAt/approvedById                                                                                 |
| M9  | **stale approval fail closed**（旧审批不得批准新 revision）                                    | sync 校验 workflow 绑定 run == invoice.currentMatchRun 且 documentStatus==MATCHED，不一致抛 SUPPLIER_INVOICE_MATCH_STALE_APPROVAL                                                         |
| M10 | **1B 零 GRIR/AP/POSTED 越界**                                                                  | match-helpers 0 处 grirRecord/apLiabilityFact/apOpenItem/postedAt create/update；5C-1C 才实现                                                                                             |

### 5.3 Release Gate（10 项重点测试 + 2 项回归用例，详见 test-cases H1-H16）

首次 Match revision=1 / 重复 Match 追加 revision / 并发不重号 / 历史不可改 / 来源链失效 fail closed / 客户端不可伪造 variance / current 指向最新 Run / 旧审批遇 re-match 拒绝 / 引用正确 run+revision / 不产生 GRIR-AP-POSTED evidence / **re-match 自身排除（数量不变不得因把自身计入累计量而失败，H15）/ re-match 累计边界（他票占 60 自身 40 通过、改 41 拒绝，H16）**。

## 6. 5C-1C0 QA 段（Accounting Readiness Hardening——CTO #9477，Match tax basis + GRIR Producer Foundation）

### 6.1 交付范围

| 分组           | 文件                                        | 说明                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match tax 修正 | `lib/supplier-invoice/match-helpers.ts`     | **expectedTax basis 改为 PO Line.taxRate 快照**（C0-A）：`expectedTax = matchedQty × poUnitPrice × poTaxRate / 100`；`taxVariance = invoiceTaxAmount - expectedTax`；poLine select 增加 taxRate。**不改 Migration 0027 / MatchLine schema**（现有 MatchLine 只有 taxVariance，本轮只修计算逻辑）                                                                                                |
| GRIR Producer  | `lib/supplier-invoice/grir-helpers.ts`      | `createGrirAccrualsForWhrPost`（C0-B：WHR POSTED + Outbox IN + ACCRUAL 同事务，每 WHR Line 一条，quantity=WHR qty、unitPrice/taxRate=PO 快照、baseAmount=quantity×unitPrice 未税）+ `createGrirReversalsForReturn`（C0-C：仅 WAREHOUSE_RECEIPT_LINE 来源；remaining unconsumed = ΣACCRUAL-ΣREVERSAL-ΣCONSUME；reversibleQty=min(returnQty, remaining)；仅 >0 创建 REVERSAL；**不制造负 GRIR**） |
| WHR POST 接入  | `api/warehouse-receipts/[id]/post/route.ts` | 事务内（CAS POSTED + Outbox IN 之后）调用 ACCRUAL producer——全有或全无                                                                                                                                                                                                                                                                                                                          |
| Return 接入    | `api/purchase-returns/[id]/return/route.ts` | 事务内（CAS RETURNED + Outbox OUT + PO reopen 之后）调用 REVERSAL producer；返回 `grirReversals[].pendingQty` 留痕（AP correction pending / requires Supplier CN-DN，5C-2 处理）                                                                                                                                                                                                                |

### 6.2 关键不变量（CTO #9477）

| #     | 不变量                                                                                                                                                                                                   | 实现                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C0-M1 | **Match expectedTax 用 PO 税率快照**（PO 13%/Invoice 6%/qty-price 一致 → taxVariance ≠ 0 → VARIANCE/HOLD；错误税率不得带进 AP）                                                                          | match-helpers.ts expectedTax = matchedQty×poUnitPrice×poLine.taxRate/100；taxVariance = invoiceTaxAmount - expectedTax |
| C0-M2 | **GRIR ACCRUAL 与 WHR POSTED 同事务**（POSTED + Outbox IN + ACCRUAL 全有或全无）                                                                                                                         | createGrirAccrualsForWhrPost 在 WHR post prisma.$transaction 内调用                                                    |
| C0-M3 | **ACCRUAL 金额口径锁死**：quantity=WHR qty；unitPrice/taxRate=PO Line 快照（WHR Line→PurchaseReceiptLine→PurchaseOrderLine 溯源）；baseAmount=quantity×unitPrice（**未税暂估净额，不得确认 Input VAT**） | grir-helpers.ts createGrirAccrualsForWhrPost                                                                           |
| C0-M4 | **ACCRUAL 幂等**：每 WHR Line 一条；DB partial UNIQUE(warehouseReceiptLineId WHERE grirType='ACCRUAL') + sourceKey UNIQUE 兜底                                                                           | 既有 Migration 0027 约束（未改）                                                                                       |
| C0-M5 | **REVERSAL 只冲 remaining unconsumed GRIR**：`reversibleQty = min(returnQty, remainingUnconsumedGrirQty)`；仅 >0 创建；**5C-1 不得制造负 GRIR**                                                          | grir-helpers.ts createGrirReversalsForReturn（remaining 为负归零）                                                     |
| C0-M6 | **REVERSAL 只对 WAREHOUSE_RECEIPT_LINE 来源**（RECEIPT_LINE/INSPECTION 从未形成已入库暂估事实 → 0 GRIR）                                                                                                 | sourceRefType !== 'WAREHOUSE_RECEIPT_LINE' → skip                                                                      |
| C0-M7 | **REVERSAL 幂等**：purchaseReturnLineId 绑定；DB partial UNIQUE(purchaseReturnLineId WHERE grirType='REVERSAL') + sourceKey 兜底                                                                         | 既有 Migration 0027 约束（未改）                                                                                       |
| C0-M8 | **超 remaining 部分 = AP correction pending**：退货业务仍成功（不因 Finance 未实现阻塞物理退货）；pendingQty>0 留痕（返回载荷 + Audit + QA/ADR note），**5C-2 Supplier CN/DN 处理，本轮不实现 CN/DN**    | PurchaseReturn 返回 `grirReversals[].pendingQty`；ADR-0027 note 锁定                                                   |

### 6.3 财务边界（CTO #9477 锁定，ADP note 入 ADR-0027）

- 场景：WHR 100 → ACCRUAL 100 → Invoice POSTED 100 → CONSUME 100 → 后续 Purchase Return 20
- **不得盲目 REVERSAL 20**（GRIR balance 会变负）；该 20 已是"已形成 AP 后的供应商贷/借项调整" → 5C-2 Supplier CN/DN
- 5C-1 阶段：REVERSAL 仅冲 remaining unconsumed；超限部分以 pendingQty 标志 + Audit 留痕，5C-2 处理

## 7. 0028 Historical GRIR Backfill QA 段（CTO #9547 Required Readiness Fix）

### 7.1 背景

C0-B/C producer 只覆盖"此后发生"的 WHR POST / PurchaseReturn RETURN。5B 早于 5C 上线，
Migration 0027 部署时数据库可能已有 `WarehouseReceipt.status=POSTED` / `PurchaseReturn.status=RETURNED`
历史事实，不会重新调用新 route → 5C-1C POST 引用"旧 WHR"时 GrirRecord 无 ACCRUAL 可 consume（假闭环）。

### 7.2 交付（数据补偿 migration，不新增业务模型、不触碰 frozen 0027）

| 分组     | 文件                                                                 | 说明                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backfill | `prisma/migrations/0028_grir_historical_fact_backfill/migration.sql` | ① POSTED WHR Line 缺 ACCRUAL → 生成（quantity=WHR qty、unitPrice/taxRate=PO 快照、baseAmount=qty×unitPrice 未税、sourceKey=canonical identity、createdAt=WHR.postedAt、remark='historical backfill'）；② RETURNED PR Line（WAREHOUSE_RECEIPT_LINE）缺 REVERSAL → 生成历史 reversal（reversibleQty=min(returnQty, ΣACCRUAL-Σ已REVERSAL-同WHR先前分配)；**不得使 GRIR 为负**；createdAt=PR.returnedAt） |

### 7.3 关键不变量（CTO #9547）

| #    | 不变量                           | 实现                                                                                                               |
| ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| B-M1 | **幂等**：重复部署零副作用       | INSERT...SELECT...WHERE NOT EXISTS + ON CONFLICT(sourceKey) DO NOTHING（partial UNIQUE + sourceKey UNIQUE 双防线） |
| B-M2 | **createdAt 不失真**             | 取源业务事实 postedAt/returnedAt（非 migration 执行时间）；remark='historical backfill'                            |
| B-M3 | **不制造负 GRIR**                | 同 WHR Line 多退货线按 returnedAt 顺序窗口累计分配 remaining（GREATEST(...,0) 归零）                               |
| B-M4 | **ACCRUAL 缺 PO 快照 fail-safe** | 溯源链断的行跳过（JOIN 不命中），不阻塞 migration、不伪造事实                                                      |
| B-M5 | **sourceKey 与 C0 同构**         | 与 grir-helpers.ts 完全一致（ACCRUAL/REVERSAL canonical identity）                                                 |

### 7.4 1C1/1C2 Blocking Gate（CTO #9547 锁序契约固化，本轮不改 C0）

- **Invoice POST CONSUME 必须与 Return REVERSAL 使用同一 WHR Line 锁顺序**：
  收集 invoice 涉及 WHR Line ids → **去重 + 稳定排序 → `ORDER BY id FOR UPDATE`** → 才允许计算
  remaining GRIR / 创建 CONSUME（grir-helpers 复用同一 remaining 计算口径）；
- 否则并发时 Return 读 remaining=100 / Invoice POST 也读 remaining=100 → reversal 80 + consume 80
  → 累计超过 accrual（超 consume / 负 GRIR）——1C1/1C2 实现必须遵守此锁序。
