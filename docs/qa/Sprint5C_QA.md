# Sprint 5C QA — Supplier Invoice Foundation（5C-1A Vertical Slice）

> Sprint：5C-1A（Supplier Invoice Foundation）| 模块：Supplier Invoice——RECEIPT_BASED 首版（PO Line + POSTED WHR Line 双溯源）+ SINV 创建即取号 + 三次来源链验证 + DRAFT→SUBMITTED | 分支：feature/sprint5c-supplier-invoice-ap（PR #23）
> 日期：2026-08-11
> 状态：⏳ 待 CTO 5C-1A API Review（CTO #9048 Schema FINAL APPROVED + #9083 API 指令授权；5C-1B Match / 5C-1C POST-GRIR-AP 继续 HOLD）
> 关联：ADR-0027（APPROVED）、Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md、Sprint5C_Field_Matrix.md、P1-P12 Final、EVENTS.md v1.31（SupplierInvoiceCreated 注册位保持 ⏳）、docs/test-cases/SupplierInvoice_API.md、openapi.yaml（Sprint 5C-1A 段）
> 5C-1A 事实链：**SupplierInvoice DRAFT（SINV 创建即取号，P1）→ Create/PATCH 两次来源链验证 → Submit（DRAFT→SUBMITTED，第三次来源链验证；**SUBMITTED ≠ POSTED**，不生成 MatchRun/GRIR/ApLiabilityFact）**
> 四条 API 红线（CTO #9048 锁死）：① Create/Match/POST 都必须重新验证 WHR header = POSTED + WHR Line ↔ PO Line ↔ Item ↔ Supplier 来源链一致；② POST 锁内重验 approved MatchRun snapshot（5C-1C）；③ POSTED + GRIR CONSUME + ApLiabilityFact + ApOpenItem 同一事务（5C-1C）；④ 禁止 UPDATE immutable MatchRun/GRIR/ApLiabilityFact（5C-1B/1C）。

## 1. 交付范围

### 1.1 代码（均在 `apps/web/src/**` + seed/constants）
| 分组 | 文件/端点 | 说明 |
| --- | --- | --- |
| Seed/RBAC | `prisma/seed.ts` + `packages/shared/src/constants/index.ts` | `supplier-invoice` 动作权限（view/create/edit/close）+ `supplier-invoice-line` view/edit 受限权限 + **SINV DocumentSequence**（SUPPLIER_INVOICE，prefix SINV，padLength 6，创建即取号 fail closed） |
| 领域函数 | `apps/web/src/lib/supplier-invoice/helpers.ts` | `nextSupplierInvoiceNo`（SINV 原子取号，**Sequence 缺失 fail closed**）+ `verifyReceiptBasedSourceChain`（**RECEIPT_BASED 三重 Gate：WHR POSTED + WHR Line↔PO Line↔Item↔Supplier 来源链一致 + 数量≤已入库**）+ `computeSupplierInvoiceLineAmounts`/`aggregateSupplierInvoiceTotals`（**金额服务端 Decimal，禁客户端直传**）+ `supplierInvoiceLineDedupeKey` |
| API | `apps/web/src/app/api/supplier-invoices/route.ts` | GET 列表（分页 + invoiceNo/supplierId/documentStatus/dateFrom/dateTo 过滤）+ POST 创建（DRAFT；SINV 取号；**第一次来源链验证**；重复发票号 API 409 + DB 组合 UNIQUE 双防线） |
| API | `apps/web/src/app/api/supplier-invoices/[id]/route.ts` | GET 详情 + PATCH 更新（仅 DRAFT；CAS version；**第二次来源链验证 + 行替换同事务**；金额服务端重算；supplierId/supplierInvoiceNo/currency/exchangeRate 不可编辑） |
| API | `apps/web/src/app/api/supplier-invoices/[id]/submit/route.ts` | DRAFT → SUBMITTED（**第三次来源链验证**，状态迁移前重验；**不创建 MatchRun/GRIR/ApLiabilityFact，不写 POSTED evidence**；仅 AuditLog） |
| OpenAPI | `docs/openapi.yaml` | Sprint 5C-1A 段：/api/supplier-invoices（list/create/get/patch/submit）+ components（SupplierInvoiceCreate/Update/Line/VersionRequest/Response/List） |

### 1.2 RBAC（权限码，动作级，零新造）
- `supplier-invoice:view`（list/get）｜ `supplier-invoice:create`（创建）｜ `supplier-invoice:edit`（PATCH/submit）｜ `supplier-invoice:close`（cancel，5C-1A 未开放取消端点——HOLD）
- `supplier-invoice-line:view / edit`（受限，行由发票驱动）

### 1.3 Domain Events（EVENTS.md v1.31）
- **5C-1A 阶段不发领域事件**：`SupplierInvoiceCreated` 注册位保持 ⏳——严格沿用既有口径（DRAFT 创建/编辑/提交仅 AuditLog，对齐 6B：只有终态动作才发领域事件；5C-1A 只到 SUBMITTED，无终态动作）
- `SupplierInvoiceMatched/Posted/Cancelled` + `GrirAccrued/GrirReversed` 仍 HOLD（5C-1B/1C）；5C-2 事件继续 HOLD

## 2. 边界与红线（5C-1A 锁死）

| # | 边界 | 实现 |
| --- | --- | --- |
| B1 | **RECEIPT_BASED 三重 Gate（红线 ①）**：Create/PATCH/Submit 三次都重新验证 WHR header=POSTED + WHR Line↔PO Line↔Item↔Supplier 来源链一致；**累计开票守恒（Blocking ① CTO #9161）**：本次数量 + 其他非 CANCELLED/非 deleted 发票行占用 ≤ WHR 已入库（PATCH/Submit 排除自身旧行；helper 内部 FOR UPDATE 锁 WHR Line 防并发双计） | `verifyReceiptBasedSourceChain(tx, { supplierId, excludeInvoiceId?, lines })` 在三路由各调用一次（Create 第一次 / PATCH 第二次 + excludeInvoiceId=id / Submit 第三次 + excludeInvoiceId=id）；累计占用 = SUM 非 CANCELLED 发票行 quantity |
| B1b | **Item 来源链 NULL 穿透锁死（Blocking ② CTO #9161）+ 可用状态真 Gate（Final Hardening CTO #9197）**：PO itemId != null 且 WHR itemId != null 且 PO itemId == WHR itemId；且 **Item.status == 'ACTIVE'**（ACTIVE/INACTIVE/LOCKED/ARCHIVED 语义——未删除但已停用/锁定/归档的 Item 不允许开票，不能只靠 deletedAt:null） | helper 内：`!poLine.itemId || !whrLine.itemId → ITEM_INVALID`；`poLine.itemId !== whrLine.itemId → SOURCE_CHAIN_MISMATCH`；`item.findFirst({ id: itemId, deletedAt: null, status: 'ACTIVE' })` 不命中 → ITEM_INVALID |
| B1c | **确定性锁序（Final Hardening CTO #9197）**：多行发票先对 warehouseReceiptLineId 唯一化 + 稳定排序（ORDER BY id），再统一 FOR UPDATE 锁，之后逐行业务校验——避免两事务对同一组 WHR Lines 以相反顺序取锁形成死锁风险 | helper 内：`[...new Set(whrLineIds)].sort()` → `SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE` → 逐行校验（锁内，防累计超收双计） |
| B2 | **金额不可由客户端篡改**：Create/PATCH 都不信客户端头金额/行金额 | schema 不收金额；行 netAmount=quantity×unitPrice（2dp）、taxAmount=netAmount×taxRate/100（2dp）、nonRecoverableTaxAmount=vatRecoverable?0:taxAmount；头 net/tax/gross 服务端聚合（Decimal，禁 number 中间转换） |
| B3 | **Submit 只允许 DRAFT→SUBMITTED** | 不得提前创建 MatchRun/GRIR/ApLiabilityFact；不写 postedAt/postedById（POSTED evidence 属 5C-1C） |
| B4 | **重复供应商发票号**：API 稳定 409 + DB 组合 UNIQUE 最终防线 | 创建前 findFirst 预检 → 409 SUPPLIER_INVOICE_DUPLICATE_NUMBER；P2002 catch → 同 409（@@unique([supplierId, supplierInvoiceNo])） |
| B5 | **PATCH 仅 DRAFT + CAS** | id+version+documentStatus=DRAFT 同时命中；supplierId/supplierInvoiceNo/currency/exchangeRate 不可编辑（schema 不收） |
| B6 | **SINV Sequence fail closed** | 缺失 → 500 SUPPLIER_INVOICE_SEQUENCE_MISSING，禁 fallback 临时编号 |
| B7 | 5C-1A 不触碰 MatchRun/GRIR/ApLiabilityFact/ApOpenItem | 全部 5C-1B/1C；不写 InventoryMovement/StockProjection；不建 GL；5C-2/CN-DN/Payment 继续 HOLD |
| B8 | 事件严格沿用既有口径 | 5C-1A DRAFT/SUBMITTED 仅 AuditLog；不造新领域事件 |

## 3. QA 测试段（详见 docs/test-cases/SupplierInvoice_API.md）

| 段 | 覆盖 |
| --- | --- |
| A 权限 | supplier-invoice:view/create/edit 403 + line 受限权限 |
| B 创建 | SINV 取号 / DRAFT 状态 / 金额服务端 / 重复发票号 409 / 双溯源必填 |
| C 来源链 Gate | WHR 非 POSTED 400 / PO-WHR-Item-Supplier 链不一致 400 / 数量超已入库 400 |
| D 更新 | 仅 DRAFT / CAS 版本冲突 / 行替换第二次 Gate / 金额重算 / 不可编辑字段 |
| E 提交 | DRAFT→SUBMITTED / 第三次 Gate / SUBMITTED≠POSTED（无 AP/GRIR/MatchRun） |
| F 失败路径 | Sequence 缺失 500 / P2002 兜底 409 |
| G 静态核验 | 0 直写 InventoryMovement/StockProjection / 三次来源链 / 金额服务端 / submit 不建 AP |

## 4. 后续阶段（HOLD）
- 5C-1B：Immutable 3-Way Match（MatchRun 创建 / revision 并发 / current projection / Workflow approval 引用 immutable matchRunId/revision）
- 5C-1C：POST 最终 Gate / consume GRIR / ApLiabilityFact / ApOpenItem 初始 Projection / maker-checker（红线 ②③④ 在此落地）
- 5C-2：Supplier CN/DN + Payment Allocation（独立 Gate）；GL / Costing / Reservation 继续 HOLD

## 5. 5C-1B QA 段（Immutable 3-Way Match——CTO #9238/#9247）

### 5.1 交付范围（新增）
| 分组 | 文件 | 说明 |
| --- | --- | --- |
| Match Engine | `lib/supplier-invoice/match-helpers.ts` | `runMatch(tx, {invoiceId, version, actorId})`——FOR UPDATE 锁 header（唯一串行点）→ 状态门禁（SUBMITTED/MATCHED 可进，APPROVED/POSTED/CANCELLED 禁）→ CAS → 锁内 next revision（max+1）→ 来源链重验（复用 verifyReceiptBasedSourceChain）→ 服务端 snapshot → 创建 Run+Lines → current projection → MATCHED（同一事务） |
| Match API | `api/supplier-invoices/[id]/match/route.ts` | POST /:id/match（只推进 MATCHED；**不写 approved\***；成功后 maybeTrigger 审批绑定 run identity + 发 SupplierInvoiceMatched） |
| Workflow sync | `lib/supplier-invoice/workflow-sync.ts` | `maybeTriggerSupplierInvoiceApproval`（grossAmount 金额区间；SUBMIT comment 携带 {matchRunId, revision}——#9247 细节③）+ `syncSupplierInvoiceApproval`（COMPLETED → stale 校验 == current + status==MATCHED → 固化 approved\* + APPROVED；REJECTED → 保持 MATCHED 可重 Match；**绝不 UPDATE MatchRun**） |
| 分发 | `api/workflows/instances/[id]/actions/route.ts` | businessType === 'supplier-invoice' → syncSupplierInvoiceApproval |
| 事件 | `lib/supplier-invoice/events.ts` + EVENTS v1.32 | `SupplierInvoiceMatched` ⏳→✅（引用 immutable matchRunId + revision；不含投影余额） |
| 文档 | openapi.yaml 5C-1B 段 + test-cases H 段 | match 端点 + MatchRun/MatchLine components + H1-H14 |

### 5.2 关键不变量（CTO #9238/#9247）
| # | 不变量 | 实现 |
| --- | --- | --- |
| M1 | **每次 Match 创建新 revision**（禁止 UPDATE/DELETE 历史 Run/Line） | runMatch 内 revision=max+1；MatchRun/MatchLine immutable trigger（trg_supplier_invoice_match_run/line_immutable） |
| M2 | **revision 并发以 header lock 为唯一串行点**（禁裸 MAX+1 无锁路径） | runMatch 先 FOR UPDATE 锁 SupplierInvoice 再 aggregate max(revision) |
| M3 | **re-match 门禁**：SUBMITTED/MATCHED 可进；APPROVED 禁直接 re-match | 状态门禁 → 409 MATCH_NOT_MATCHABLE |
| M4 | **Match 时重新执行来源事实 Gate**（WHR POSTED + 链一致 + Item ACTIVE + 累计守恒 + 确定性锁序） | verifyReceiptBasedSourceChain 复用（含 FOR UPDATE + ORDER BY id + status='ACTIVE'） |
| M5 | **snapshot 全服务端**（客户端不得上传计算结果） | supplierInvoiceMatchSchema 只收 version；poQty/receiptQty/invoiceQty/poUnitPrice/invoiceUnitPrice/variance/result/disposition 全服务端生成 |
| M6 | **current projection 与 immutable history 分离** | Match 成功后才更新 header.currentMatchRunId + lines currentMatchRunId/currentMatchStatus/matchedQty/variance*（投影可更新） |
| M7 | **Match API 不写 approved\*** | match/route.ts 0 处 approvedMatchRunId/approvedMatchRevision update |
| M8 | **Approval references MatchRun（不 mutates）** | syncSupplierInvoiceApproval 只固化 approved\* 到 SupplierInvoice；MatchRun 自身无 approvedAt/approvedById |
| M9 | **stale approval fail closed**（旧审批不得批准新 revision） | sync 校验 workflow 绑定 run == invoice.currentMatchRun 且 documentStatus==MATCHED，不一致抛 SUPPLIER_INVOICE_MATCH_STALE_APPROVAL |
| M10 | **1B 零 GRIR/AP/POSTED 越界** | match-helpers 0 处 grirRecord/apLiabilityFact/apOpenItem/postedAt create/update；5C-1C 才实现 |

### 5.3 Release Gate（10 项重点测试，详见 test-cases H1-H14）
首次 Match revision=1 / 重复 Match 追加 revision / 并发不重号 / 历史不可改 / 来源链失效 fail closed / 客户端不可伪造 variance / current 指向最新 Run / 旧审批遇 re-match 拒绝 / 引用正确 run+revision / 不产生 GRIR-AP-POSTED evidence。
