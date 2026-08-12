# Frontend Action / Form Architecture Matrix（动作与表单架构矩阵）

- 版本：v1.0
- 日期：2026-08-13
- 基线：`main @ 15323139`（Frontend Iteration 1 CLOSED 后）
- 分支：`docs/action-form-architecture`
- Gate：**Action/Form Architecture Gate — DESIGN FIRST**（CTO 2026-08-13）
- 状态：**DESIGN ONLY —— 不实现页面动作按钮 / 不新增表单 / 不改 backend / 不改 Prisma-migration**

> **目的**：把 10 个 Operations 模块的操作面梳理成可审查、可分批实现的动作矩阵；明确哪些属于普通编辑（Tier 1），哪些属于工作流状态转换（Tier 2），哪些属于**不可逆业务事实产生**（Tier 3）。所有字段以 `main @ 15323139` 后端真实 route 为准（CTO 红线：前端只做映射，不发明规则）。

---

## 0. 横切：风险分层与统一 UX / 错误处理规则

### 0.1 Tier 定义

| Tier | 类别 | 动作 | 特征 | 前端 UX 模式 |
| --- | --- | --- | --- | --- |
| **Tier 1** | CRUD-like（可逆编辑） | Create / Edit（PATCH） | 仅 DRAFT 态可改；改完可再改；无不可逆事实副作用；version CAS 乐观锁 | 普通表单 + 保存；行级/单头校验；409 VERSION_CONFLICT → 提示刷新 |
| **Tier 2** | Workflow / 状态转换 | Submit / Approve（Workflow 回调）/ Cancel / Confirm / Convert | 状态推进 + 可能级联单据（Confirm/Convert）；部分不可逆（Confirm 形成外部承诺）；依赖 approvalStatus 投影 | 提交确认对话框 + 状态回显；Confirm/Convert 需**二次确认**；失败回滚 UI |
| **Tier 3** | **Fact-producing（不可逆业务事实）** | Post（WHR）/ Execute（Transfer/Conversion）/ Apply（Adjustment）/ Complete（Inspection/StockCount）/ Receive（Receipt）/ Return（Return） | **产生库存/GRIR/收货/质检事实**；同事务落账；终态不可逆（纠错走 Reversal/Correction/5C-2）；**禁止乐观更新** | **禁止复用普通 form submit**：二次确认 + version freshness + 冲突反馈 + 成功后事实刷新 + 失败回滚 UI（见 0.2） |

### 0.2 Tier 3 统一 UX 规则（CTO 硬性要求）

1. **二次确认**：触发前必须弹确认（展示动作语义 + 目标状态 + 不可逆警告），不得直接提交。
2. **Version freshness**：提交前用列表/详情页最新 `version`；服务端 CAS（`id + version + status=X` 原子条件）失败 → `409 VERSION_CONFLICT` → 前端提示"数据已变化，请刷新"并**重新拉取**，禁止静默重试。
3. **冲突反馈**：`409` 系列必须展示后端 `error.code` + 结构化 message（ApiClientError 契约），不得吞成通用错误。
4. **成功后事实刷新**：成功响应后**重新 GET 详情/列表**（或以响应中的最新事实替换），不得依赖本地乐观状态。
5. **失败不得乐观更新业务事实**：请求失败时 UI 保持原状态（单据不假装成功），展示结构化错误 + 重试入口；**绝不先改本地状态再等后端**。
6. **ALREADY_\* replay 收敛（不得仅凭错误码判成功）**：重复触发返回 `409 ALREADY_*`（ALREADY_POSTED / ALREADY_EXECUTED / ALREADY_APPLIED / ALREADY_RETURNED / ALREADY_CANCELLED）视为 **terminal/replay signal**。**409 code 本身不能证明当前请求对应的事实已正确完成**（对齐 Supplier Invoice POST 收紧口径）；前端必须**强制重新 GET authoritative resource**：仅当服务端事实确认已处于预期 terminal state 时，UI 才按"已完成"收敛并刷新；否则显示 conflict/invariant error（含 code + message），**不做本地乐观成功**。

### 0.3 统一错误契约（复用 Frontend Error Contract，`apps/web/src/lib/api-client.ts`）

- 所有写操作走 `apiFetch<T>()`：`ApiClientError { status, code?, message }`；HTTP 分类 401/403/404/409/422/500；后端 `error.code` 原样保留。
- 分页/列表复用 `useListQuery`（CONTRACT_GAP 标记已内置）。

### 0.4 Version / CAS 通则

- 所有 PATCH 与 Tier 2/3 动作均要求请求体携带 `version`（乐观锁）；服务端 CAS 条件一般为 `id + version + status=<当前允许源状态>` 原子命中 + `version: { increment: 1 }`。
- Cancel 类动作普遍要求 `version`（缺失 → 400，冲突 → 409 VERSION_CONFLICT）。

### 0.5 Maker-checker 通则

- **Create/Edit**：`{module}:create` / `{module}:edit`（操作人 = 单据 creator/editor）。
- **Submit**：`{module}:edit`（提交人可为 creator）→ 触发 Workflow（命中策略 → PENDING；未命中 → 直接 APPROVED 投影）。
- **Approve**：Workflow 回调（后端 `workflow-sync`，非前端直接调；`approvalStatus` 投影回写）。
- **Confirm/Convert**：`{module}:approve`（与 edit 分离的审批权限）。
- **Cancel**：`{module}:close`（独立关闭权限）。
- **Apply（Adjustment）**：`inventory-adjustment:apply`（独立落账权限）。
- **Tier 3 其余**：`{module}:edit`（与 create/edit 同权限，但 UX 按 Tier 3 处理）。

---

## 1. Purchasing 6 模块

### 1.1 Purchase Requisition（采购申请）— 状态机：DRAFT → SUBMITTED → APPROVED → CONVERTED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/purchase-requisitions` | `purchase-requisition:create` | — → DRAFT | 无（新建取号） | — | 新建即取号 | 无 | `PurchaseRequisitionCreated` | VALIDATION / NO_LINES |
| Edit | `PATCH /api/purchase-requisitions/{id}` | `purchase-requisition:edit` | DRAFT → DRAFT | version CAS | — | — | 无（仅非金额字段 + 行整体替换 + Revision） | `PurchaseRequisitionUpdated` | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| Submit | `POST /api/purchase-requisitions/{id}/submit` | `purchase-requisition:edit` | DRAFT → SUBMITTED | version CAS（`id+version+status=DRAFT`） | 触发 Workflow（命中策略 → PENDING；未命中直接 APPROVED 投影） | 重复 submit → 409 INVALID_STATE | 无事实副作用（审批中） | `PurchaseRequisitionSubmitted` | 409 INVALID_STATE / NO_LINES / APPROVAL_POLICY_NOT_FOUND / WORKFLOW_FAILED |
| Approve / Reject | Workflow 回调（非前端） | —（服务端 Workflow） | SUBMITTED → APPROVED / → DRAFT（驳回） | Workflow 内部 | 审批人 ≠ 提交人（Workflow SSOT） | — | 无 | `PurchaseRequisitionApproved` / `Rejected` | WORKFLOW_ACTION_* |
| **Convert** | `POST /api/purchase-requisitions/{id}/convert` | `purchase-requisition:approve` | APPROVED → CONVERTED | version CAS + 审批快照校验 | approve 权限 | 重复 convert → 409 ALREADY_CONVERTED | **级联创建 PO（新单据事实）；PR 转单后不可回退**（纠错走取消 PO） | `PurchaseRequisitionConverted` | 409 REQUISITION_NOT_APPROVED / ALREADY_CONVERTED / NO_LINES / SUPPLIER_NOT_FOUND / ITEM_NOT_FOUND / PRICE_NOT_FOUND |
| Cancel | **CONTRACT GAP / IMPLEMENTATION HOLD**：main @ 15323139 不存在 PR cancel endpoint；前端**不展示 Cancel、不推断状态转换、不注册/消费假事件**（`PurchaseRequisitionCancelled` 未实现，不声明） | — | — | — | — | — | — | — | — |

### 1.2 Purchase Order（采购订单）— 状态机：DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED/RECEIVED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/purchase-orders` | `purchase-order:create` | — → DRAFT | 无（新建取号） | — | 新建即取号 | 无 | `PurchaseOrderCreated` | VALIDATION |
| Edit | `PATCH /api/purchase-orders/{id}` | `purchase-order:edit` | DRAFT → DRAFT | version CAS | — | — | 无（非金额字段 + 行整体替换 + Revision；金额服务端重算） | `PurchaseOrderUpdated` | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| Submit | `POST /api/purchase-orders/{id}/submit` | `purchase-order:edit` | DRAFT → SUBMITTED | version CAS（`id+version+status=DRAFT`） | 触发 Workflow（命中策略 → PENDING；未命中直接 APPROVED 投影） | 重复 submit → 409 INVALID_STATE | 无 | `PurchaseOrderSubmitted` | 409 INVALID_STATE / NO_LINES / QUANTITY_INVALID / SUPPLIER_NOT_FOUND / SOURCE_LINE_INVALID / 金额聚合不一致 |
| Approve / Reject | Workflow 回调（非前端） | —（服务端 Workflow） | SUBMITTED → APPROVED / → DRAFT | Workflow 内部 | 审批人 ≠ 提交人 | — | 无（APPROVED ≠ CONFIRMED） | `PurchaseOrderApproved` / `Rejected` | WORKFLOW_ACTION_* |
| **Confirm** | `POST /api/purchase-orders/{id}/confirm` | `purchase-order:approve` | APPROVED → CONFIRMED（需 approvalStatus=APPROVED） | version CAS + approval gate | approve 权限 | 重复 confirm → 409 INVALID_STATE | **形成外部采购承诺（正式下单）；只有 Confirmed PO 才是 5B GR 来源** | `PurchaseOrderConfirmed` | 409 APPROVAL_REQUIRED / INVALID_STATE / SUPPLIER_NOT_FOUND / NO_LINES / QUANTITY_INVALID |
| Cancel | `POST /api/purchase-orders/{id}/cancel` | `purchase-order:close` | DRAFT/APPROVED → CANCELLED（SUBMITTED 409 走 Withdraw→DRAFT→Cancel；CONFIRMED+ 禁止） | version CAS | close 权限 | 重复 cancel → 409 ALREADY_CANCELLED | 无（未形成承诺前可取消） | `PurchaseOrderCancelled` | 409 SUBMITTED_FORBIDDEN / CANCEL_FORBIDDEN / ALREADY_CANCELLED / INVALID_STATE |
| （投影） | 5B GR 聚合回写（服务端） | — | CONFIRMED → PARTIALLY_RECEIVED / RECEIVED | 服务端投影 | — | — | 仅投影 | `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived` | — |

### 1.3 Purchase Receipt（到货收货）— 状态机：DRAFT → RECEIVED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/purchase-receipts` | `purchase-receipt:create` | — → DRAFT | 无 | — | 新建即取号 | 无 | —（创建不发领域事件） | VALIDATION |
| Edit | `PATCH /api/purchase-receipts/{id}` | `purchase-receipt:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| **Receive（Tier 3）** | `POST /api/purchase-receipts/{id}/receive` | `purchase-receipt:edit` | DRAFT → RECEIVED | version CAS（`id+version+status=DRAFT`）+ PO 行投影 CAS 递增 | 普通收货不审批（P1b） | 重复 receive → 409 INVALID_STATE | **收货完成事实**；回写 PO Line receivedQty/remainingReceiveQty + PO status 投影；行级溯源 | `PurchaseReceiptReceived` + `PurchaseOrderPartiallyReceived/Received` | 409 VERSION_CONFLICT / INVALID_STATE / PO_NOT_FOUND / PO_STATE_FORBIDDEN / LINE_PO_MISMATCH / WAREHOUSE_REQUIRED |
| Cancel | `POST /api/purchase-receipts/{id}/cancel` | `purchase-receipt:close` | DRAFT → CANCELLED | version CAS（缺失 → 400） | close 权限 | 重复 cancel → 409 | 无（未收货前可取消） | — | 400 缺 version / 409 CANCEL_FORBIDDEN / INVALID_STATE / VERSION_CONFLICT |

### 1.4 Inspection（质检记录）— 结果机：PENDING → QUALIFIED / PARTIAL / REJECTED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/inspections` | `inspection:create` | — → PENDING | 无 | 同一 ReceiptLine 至多一个有效 Inspection（DB unique） | 重复 create → 409 INSPECTION_ALREADY_EXISTS | 无（创建不发领域事件） | — | 409 INSPECTION_LINE_NOT_RECEIVED / ALREADY_EXISTS / NO_INSPECTABLE_QTY |
| Edit | `PATCH /api/inspections/{id}` | `inspection:edit` | PENDING → PENDING | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT |
| **Complete（Tier 3）** | `POST /api/inspections/{id}/complete` | `inspection:edit` | PENDING → QUALIFIED / PARTIAL / REJECTED | version CAS（`id+version+result=PENDING`） | 免检 SKIP+QUALIFIED 不绕过 | 重复 complete → 409 INVALID_STATE | **质检结论事实（合格/拒收数量）**；后续入库/退货以此为源 | `InspectionCompleted` | 409 VERSION_CONFLICT / INSPECTION_LINE_NOT_RECEIVED / QUANTITY_INVALID / INVALID_STATE |
| Cancel | **CONTRACT GAP / IMPLEMENTATION HOLD**：main @ 15323139 不存在 Inspection cancel endpoint；前端**不展示 Cancel、不推断状态转换、不注册/消费假事件** | — | — | — | — | — | — | — | — |

### 1.5 Warehouse Receipt（仓库收货/入库）— 状态机：DRAFT → POSTED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/warehouse-receipts` | `warehouse-receipt:create` | — → DRAFT | 无 | — | 新建即取号 | 无 | — | VALIDATION |
| Edit | `PATCH /api/warehouse-receipts/{id}` | `warehouse-receipt:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| **Post（Tier 3）** | `POST /api/warehouse-receipts/{id}/post` | `warehouse-receipt:edit` | DRAFT → POSTED | version CAS（`id+version+status=DRAFT`） | — | 重复 post → 409 ALREADY_POSTED | **触发 6A InventoryMovement(IN) + 5C-1 GRIR ACCRUAL 同事务；Created ≠ Posted** | `WarehouseReceiptPosted` + `GrirAccrued`（5C-1） | 409 ALREADY_POSTED / INVALID_STATE / NO_LINES / INSPECTION_NOT_FOUND / INSPECTION_NOT_COMPLETED / INVENTORY_DIMENSION_INCOMPLETE |
| Cancel | **CONTRACT GAP / IMPLEMENTATION HOLD**：main @ 15323139 不存在 Warehouse Receipt cancel endpoint；前端**不展示 Cancel、不推断状态转换、不注册/消费假事件** | — | — | — | — | — | — | — | — |

### 1.6 Purchase Return（采购退货）— 状态机：DRAFT → RETURNED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/purchase-returns` | `purchase-return:create` | — → DRAFT | 无 | 必须有真实来源（RECEIPT_LINE / INSPECTION / WAREHOUSE_RECEIPT_LINE exactly-one） | 新建即取号 | 无（创建不发领域事件） | — | VALIDATION / SOURCE_INVALID |
| Edit | `PATCH /api/purchase-returns/{id}` | `purchase-return:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| **Return（Tier 3）** | `POST /api/purchase-returns/{id}/return` | `purchase-return:edit` | DRAFT → RETURNED | version CAS（`id+version+status=DRAFT`） | 普通退货不审批；特殊退货走 Workflow | 重复 return → 409 ALREADY_RETURNED | **退货完成事实**；WHR-based 触发 5C-1 GRIR REVERSAL（reversibleQty=min(returnQty, remaining)）；不制造负 GRIR；超限留 AP correction pending | `PurchaseReturned` + `GrirReversed`（5C-1） | 409 ALREADY_RETURNED / INVALID_STATE / SOURCE_NOT_POSTED（WHR 未过账）/ INVENTORY_DIMENSION_INCOMPLETE / INVENTORY_SERIAL_* |
| Cancel | **CONTRACT GAP / IMPLEMENTATION HOLD**：main @ 15323139 不存在 Purchase Return cancel endpoint；前端**不展示 Cancel、不推断状态转换、不注册/消费假事件** | — | — | — | — | — | — | — | — |

---

## 2. Inventory Operations 4 模块

### 2.1 Inventory Transfer（库存调拨）— 状态机：DRAFT → SUBMITTED → APPROVED → EXECUTED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/inventory-transfers` | `inventory-transfer:create` | — → DRAFT | 无 | — | 新建即取号 | 无 | — | VALIDATION |
| Edit | `PATCH /api/inventory-transfers/{id}` | `inventory-transfer:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| Submit | `POST /api/inventory-transfers/{id}/submit` | `inventory-transfer:edit` | DRAFT → SUBMITTED | version CAS（`id+version+status=DRAFT`） | 触发 Workflow（命中策略 → PENDING；未命中直接 APPROVED 投影） | 重复 submit → 409 INVALID_STATE | 无（APPROVED ≠ EXECUTED） | `InventoryTransferSubmitted/Approved`（6B） | 409 VERSION_CONFLICT / INVALID_STATE / NO_LINES / QUANTITY_INVALID / WAREHOUSE_INVALID |
| Approve / Reject | Workflow 回调（非前端） | — | SUBMITTED → APPROVED / → DRAFT | Workflow 内部 | 审批人 ≠ 提交人 | — | 无 | `InventoryTransferApproved/Rejected` | WORKFLOW_ACTION_* |
| **Execute（Tier 3）** | `POST /api/inventory-transfers/{id}/execute` | `inventory-transfer:edit` | APPROVED → EXECUTED | version CAS（`id+version+status=APPROVED`） | — | 重复 execute → 409 ALREADY_EXECUTED | **双边 SOURCE_OUT + DESTINATION_IN Movement 同事务落账**；生成并冻结 movementGroupId | `InventoryTransferExecuted` | 409 ALREADY_EXECUTED / INVALID_STATE（仅 APPROVED）/ INVENTORY_INSUFFICIENT_STOCK / VERSION_CONFLICT |
| Cancel | `POST /api/inventory-transfers/{id}/cancel` | `inventory-transfer:close` | DRAFT/SUBMITTED/APPROVED → CANCELLED | version CAS | close 权限 | 重复 cancel → 409 INVALID_STATE | 无（EXECUTED 后不可取消） | `InventoryTransferCancelled` | 409 VERSION_CONFLICT / INVALID_STATE / ALREADY_CANCELLED |

### 2.2 Stock Count（库存盘点）— 状态机：DRAFT → COUNTING → COMPLETED → ADJUSTED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/stock-counts` | `stock-count:create` | — → DRAFT | 无 | — | 新建即取号 | 无 | — | VALIDATION |
| Edit | `PATCH /api/stock-counts/{id}` | `stock-count:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| **AddLine（Tier 2/3 边界，事实录入）** | `POST /api/stock-counts/{id}/lines` | `stock-count:edit` | DRAFT/COUNTING → COUNTING（首行自动 COUNTING） | version CAS + 五维去重 | — | 同五维重复 → 400 DUPLICATE_LINE | 盘点行事实（countedQty/bookQtyAtCount/variance 服务端计算） | — | 400 STOCK_COUNT_DUPLICATE_LINE / WAREHOUSE_INVALID；409 INVALID_STATE（仅 DRAFT/COUNTING）/ VERSION_CONFLICT |
| **Complete（Tier 3）** | `POST /api/stock-counts/{id}/complete` | `stock-count:edit` | COUNTING → COMPLETED | version CAS | — | 重复 complete → 409 INVALID_STATE | **完成盘点事实**；差异自动生成 InventoryAdjustment（服务端）；触发 InventoryCountCompleted | `InventoryCountCompleted` | 409 STOCK_COUNT_INVALID_STATE / VERSION_CONFLICT / NO_LINES；500 SEQUENCE_MISSING（DocumentSequence 缺失） |
| Cancel | `POST /api/stock-counts/{id}/cancel` | `stock-count:close` | DRAFT/COUNTING → CANCELLED | version CAS | close 权限 | 重复 cancel → 409 | 无（已锁定盘点事实不可取消） | `StockCountCancelled` | 409 INVALID_STATE（仅 DRAFT/COUNTING）/ VERSION_CONFLICT |

### 2.3 Inventory Adjustment（库存调整）— 状态机：DRAFT → SUBMITTED → APPROVED → APPLIED / CANCELLED

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/inventory-adjustments` | `inventory-adjustment:create` | — → DRAFT | 无 | createdById NOT NULL（maker-checker 闭环） | 新建即取号 | 无 | — | VALIDATION |
| Edit | `PATCH /api/inventory-adjustments/{id}` | `inventory-adjustment:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| Submit | `POST /api/inventory-adjustments/{id}/submit` | `inventory-adjustment:edit` | DRAFT → SUBMITTED | version CAS（`id+version+status=DRAFT`） | 触发 Workflow（未命中直接 APPROVED 投影） | 重复 submit → 409 INVALID_STATE | 无（APPROVED ≠ APPLIED） | `InventoryAdjustmentSubmitted/Approved` | 409 VERSION_CONFLICT / INVALID_STATE / NO_LINES / QUANTITY_INVALID / WAREHOUSE_INVALID |
| Approve / Reject | Workflow 回调（非前端） | — | SUBMITTED → APPROVED / → DRAFT | Workflow 内部 | 审批人 ≠ 提交人 | — | 无 | `InventoryAdjustmentApproved/Rejected` | WORKFLOW_ACTION_* |
| **Apply（Tier 3）** | `POST /api/inventory-adjustments/{id}/apply` | **`inventory-adjustment:apply`（独立权限）** | APPROVED → APPLIED | version CAS（`id+version+status=APPROVED`） | apply 独立权限（非 edit） | 重复 apply → 409 ALREADY_APPLIED | **InventoryMovement IN/OUT 同事务落账**；APPLIED 后纠错走 Reversal/Correction | `InventoryAdjustmentApplied` | 409 ALREADY_APPLIED / INVALID_STATE（仅 APPROVED）/ INVENTORY_INSUFFICIENT_STOCK / VERSION_CONFLICT |
| Cancel | `POST /api/inventory-adjustments/{id}/cancel` | `inventory-adjustment:close` | DRAFT/SUBMITTED/APPROVED → CANCELLED | version CAS | close 权限 | 重复 cancel → 409 | 无（APPLIED 禁取消） | `InventoryAdjustmentCancelled` | 409 APPLIED_FORBIDDEN / INVALID_STATE / VERSION_CONFLICT |

### 2.4 Inventory Conversion（库存转换）— 状态机：DRAFT → SUBMITTED → EXECUTED / CANCELLED（无审批流）

| 动作 | endpoint / method | permission | 源状态 → 目标状态 | version/CAS | maker-checker | 幂等/replay | irreversible side effects | domain events | 主要 409/validation/invariant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create | `POST /api/inventory-conversions` | `inventory-conversion:create` | — → DRAFT | 无 | — | 新建即取号 | 无 | — | VALIDATION |
| Edit | `PATCH /api/inventory-conversions/{id}` | `inventory-conversion:edit` | DRAFT → DRAFT | version CAS | — | — | 无 | — | 409 VERSION_CONFLICT；非 DRAFT 禁改 |
| Submit | `POST /api/inventory-conversions/{id}/submit` | `inventory-conversion:edit` | DRAFT → SUBMITTED | version CAS（`id+version+status=DRAFT`） | **Conversion 无审批状态机**（submit 仅为提交确认，不发明审批流） | 重复 submit → 409 INVALID_STATE | 无（SUBMITTED ≠ EXECUTED） | `InventoryConversionSubmitted` | 409 VERSION_CONFLICT / INVALID_STATE / NO_LINES（必须恰好 1 CONSUME + 1 PRODUCE）/ LINE_ROLE_REQUIRED |
| **Execute（Tier 3）** | `POST /api/inventory-conversions/{id}/execute` | `inventory-conversion:edit` | SUBMITTED → EXECUTED | version CAS（`id+version+status=SUBMITTED`） | — | 重复 execute → 409 ALREADY_EXECUTED | **CONSUME + PRODUCE Movement 同事务落账**（行级 baseQuantity canonical）；生成并冻结 movementGroupId；SUBMITTED ≠ EXECUTED | `InventoryConversionExecuted` | 409 ALREADY_EXECUTED / INVALID_STATE（仅 SUBMITTED）/ INVENTORY_INSUFFICIENT_STOCK / VERSION_CONFLICT |
| Cancel | `POST /api/inventory-conversions/{id}/cancel` | `inventory-conversion:close` | DRAFT/SUBMITTED → CANCELLED | version CAS | close 权限 | 重复 cancel → 409 | 无（EXECUTED 禁取消） | `InventoryConversionCancelled` | 409 EXECUTED_FORBIDDEN / INVALID_STATE / VERSION_CONFLICT |

---

## 3. 实施分批建议（Design Review PASS 后）

| 批次 | 内容 | 主要 Tier | 理由 |
| --- | --- | --- | --- |
| Batch 1 | Create/Edit 表单（10 模块，先 2 个 reference：PR + Transfer） | Tier 1 | 纯 CRUD、可逆、风险最低；建立表单横切（字段校验 / version 携带 / 409 冲突提示） |
| Batch 2 | Submit / Cancel（PR/PO/Transfer/Adjustment/Conversion + Cancel 全模块） | Tier 2 | 状态转换 + Workflow 触发；建立"提交确认 + 状态回显"UX |
| Batch 3 | Confirm（PO）/ Convert（PR） | Tier 2（级联单据） | 二次确认 + 级联副作用处理 |
| Batch 4 | Tier 3 事实型动作：Receive / Inspection Complete / WHR Post / Return / Transfer Execute / Adjustment Apply / Conversion Execute / StockCount Complete | Tier 3 | 每动作独立 Gate：二次确认 + version freshness + 冲突反馈 + 事实刷新 + 失败回滚（0.2 规则） |

---

## 4. HOLD（保持不变）

- Stock Projection / Inventory Ledger：无 FINAL Read API，UI 保持 Placeholder。
- Inventory Read Model：DESIGN ONLY。
- Supplier Invoice UI：DEFERRED（5C-1 后端 FINAL，UI 待 P2P / Finance Frontend Gate）。
- 5C-2 / Payment / AP Allocation / GL / Reservation / Costing / BI / OA / Mobile：HOLD。

---

## 5. 边界与红线

- 本 Gate 只产出本矩阵 + 设计结论；**不新增页面动作按钮、不新增表单、不改 backend、不改 Prisma/migration**。
- 所有字段以 `main @ 15323139` 后端真实 route 为准；若后续后端 route 变化，本矩阵需同步修订（版本号递增）。
- Tier 3 动作**禁止乐观更新业务事实**；失败必须回滚 UI 并展示结构化错误（ApiClientError status/code/message）。
- CI-First：本矩阵文档 commit 后走 GitHub CI 验证；不以本地验证代替。
