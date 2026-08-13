# Tier 1 Scale-Out Readiness Review（DESIGN / RECON ONLY）

- 基线：`main @ 5b677a2d`（Batch 1 = FINAL/CLOSED：PR #27 + PR #28 已合并）
- 分支：`docs/tier1-scaleout-readiness-review`
- 范围：剩余 8 个 Operations 模块的 **Create/DRAFT Edit 就绪度审查**（不写实现）
- 每模块核验 6 类事实：Create/PATCH/GET contract、permission registry + seed 一致性、required selectors、FINAL read API 可用性、version/CAS、lines 语义
- 结论口径：`READY` / `READY WITH UX GAP` / `BLOCKED — RBAC` / `BLOCKED — SELECTOR CONTRACT` / `BLOCKED — API CONTRACT`

---

## 0. 横切事实：RBAC consistency matrix（模块 registry 对照）

| 模块                 | API route 强制权限码（POST/PATCH/GET）          | shared `PERMISSION_MODULES` 已注册 | seed `SEED_ACTION_MODULES` 已注册 | 可授予性                        |
| -------------------- | ----------------------------------------------- | ---------------------------------- | --------------------------------- | ------------------------------- |
| Purchase Order       | purchase-order:create/edit/view                 | ❌ 未注册                          | ✅ 已注册                         | **RBAC 黑洞**（同 PR #27 问题） |
| Purchase Receipt     | purchase-receipt:create/edit/view               | ❌ 未注册                          | ✅ 已注册                         | **RBAC 黑洞**                   |
| Inspection           | inspection:create/edit/view                     | ❌ 未注册                          | ✅ 已注册                         | **RBAC 黑洞**                   |
| Warehouse Receipt    | warehouse-receipt:create/edit/view              | ❌ 未注册                          | ✅ 已注册                         | **RBAC 黑洞**                   |
| Purchase Return      | purchase-return:create/edit/view                | ❌ 未注册                          | ✅ 已注册                         | **RBAC 黑洞**                   |
| Stock Count          | stock-count:create/edit/view（lines 复用 edit） | ✅ 已注册                          | ✅ 已注册                         | ✅ SUPER_ADMIN/ADMIN 可授予     |
| Inventory Adjustment | inventory-adjustment:create/edit/view           | ✅ 已注册                          | ✅ 已注册                         | ✅ SUPER_ADMIN/ADMIN 可授予     |
| Inventory Conversion | inventory-conversion:create/edit/view           | ✅ 已注册                          | ✅ 已注册                         | ✅ SUPER_ADMIN/ADMIN 可授予     |

> **共性缺口 #1（RBAC）**：`purchase-order / purchase-receipt / inspection / warehouse-receipt / purchase-return` 5 个模块与 Batch 1 PR 完全同型 —— API contract 强制 create/edit/view，shared `PERMISSION_MODULES` 未注册 → `ALL_ACTION_PERMISSIONS` 缺这些模块的动作码 → 静态 RBAC 对任何角色都无法授予 → **Create/Edit API 全角色 403**。seed 侧已注册（DB 权限行存在），缺口只在 shared registry。
> 建议：**独立 RBAC Registry Gate**（与 PR #28 同型最小修复：shared `PERMISSION_MODULES` 注册 5 模块 + seed 对齐核验），不混入前端实现 PR。

## 0.5 横切事实：Selector readiness matrix

| selector                          | FINAL read API                         | 状态             |
| --------------------------------- | -------------------------------------- | ---------------- |
| Item                              | ✅ GET /api/items                      | FINAL READ API   |
| Supplier                          | ✅ GET /api/suppliers                  | FINAL READ API   |
| Purchase Order（header）          | ✅ GET /api/purchase-orders            | FINAL READ API   |
| Purchase Receipt / 行             | ✅ GET /api/purchase-receipts + /{id}  | FINAL READ API   |
| Inspection                        | ✅ GET /api/inspections + /{id}        | FINAL READ API   |
| Warehouse Receipt / 行            | ✅ GET /api/warehouse-receipts + /{id} | FINAL READ API   |
| Purchase Return / 行              | ✅ GET /api/purchase-returns + /{id}   | FINAL READ API   |
| Stock Count / 行                  | ✅ GET /api/stock-counts + /{id}       | FINAL READ API   |
| Dictionary（reasonCode 等）       | ✅ GET /api/dictionaries               | FINAL READ API   |
| **Warehouse**                     | ❌ 无 /api/warehouses                  | **CONTRACT GAP** |
| **Warehouse Location**            | ❌ 无 /api/warehouse-locations         | **CONTRACT GAP** |
| **UOM**                           | ❌ 无 /api/unit-of-measures            | **CONTRACT GAP** |
| **User（purchaser/approver 等）** | ❌ 无 /api/users                       | **CONTRACT GAP** |
| **Department**                    | ❌ 无 /api/departments                 | **CONTRACT GAP** |

> **共性缺口 #2（Selector）**：Warehouse / Location / UOM / User / Department 无 FINAL read API。Batch 1 已接受 ID 输入 + 页面标注作为 Reference/engineering fallback；**Tier 1 产品化前需独立 Master-Data Read API Gate**，评估哪些 selector 为产品必需（Warehouse/Location/UOM 至少需要），再决定是否新增 FINAL read endpoint（backend gate，独立于前端）。

---

## 1. Purchase Order

**Contract**

- POST /api/purchase-orders（`purchase-order:create`）：supplierId 必填；purchaserId/departmentId/currency/paymentTerm/expectedDeliveryDate/remark 可选；lines min 1：itemId 必填、quantity>0、uomId 可选、priceSource（SUPPLIER_PRICE_SNAPSHOT 默认 / MANUAL）、MANUAL 时 unitPrice+priceReason 必填、taxRate 可选、sourcePurchaseRequisitionLineId（REQUISITION 场景 PATCH 时必填且服务端验证属主+itemId 一致）
- PATCH /api/purchase-orders/{id}（`purchase-order:edit`）：仅 DRAFT；version 必填；lines **全量替换**（软删旧行+重建，lineNo 服务端默认 (idx+1)*10）；金额事实服务端 Decimal 聚合（禁客户端直传头金额）；changeReason 可选
- GET /api/purchase-orders/{id}（`purchase-order:view`）：include supplier/requisition/workflowInstance/lines(item+uom+sourcePurchaseRequisitionLine)；标量含 version

**version/CAS**：✅ 预检查 + 事务内 `updateMany where {id, version, status:'DRAFT'}` count===1，失败 409 VERSION_CONFLICT

**lines 语义**：全量替换（soft-delete + recreate）

**Selectors**：supplierId（✅）、itemId（✅）、uomId（❌）、purchaserId（❌ users）、departmentId（❌ departments）、sourcePurchaseRequisitionLineId（✅ 经 PR 详情）

**结论：`BLOCKED — RBAC`**（shared registry 未注册 purchase-order；另有 selector UX gap：UOM/User/Department）

## 2. Purchase Receipt

**Contract**

- POST /api/purchase-receipts（`purchase-receipt:create`）：purchaseOrderId 必填；warehouseId 可选（仅 WAREHOUSE 场景）；remark 可选；lines min 1：purchaseOrderLineId 必填（溯源 PO Line，服务端校验属主）、quantity=物理到货毛数量>0、visibleDamageQty/rejectedOnReceiptQty 默认 0（rejected ≤ quantity）、直送补充字段可选
- PATCH /api/purchase-receipts/{id}（`purchase-receipt:edit`）：仅 DRAFT；version；lines **全量替换**（软删+重建）；receivedQty/remainingReceiveQty 禁客户端提交（服务端唯一回写）
- GET /api/purchase-receipts/{id}：include purchaseOrder/supplier/warehouse/receivedBy/lines(item+uom)；标量含 version

**version/CAS**：✅ 同上（updateMany where {id, version, status:'DRAFT'}）

**lines 语义**：全量替换

**Selectors**：purchaseOrderId（✅）、purchaseOrderLineId（✅ 经 PO 详情）、warehouseId（❌）

**结论：`BLOCKED — RBAC`**（shared registry 未注册 purchase-receipt；另有 warehouse selector gap）

## 3. Inspection

**Contract**

- POST /api/inspections（`inspection:create`）：purchaseReceiptLineId 必填（绑定已 RECEIVED 收货行）；inspectionMode SKIP/SPOT/FULL 必填；remark 可选；**无 lines**（单行绑定）
- PATCH /api/inspections/{id}（`inspection:edit`）：仅 PENDING；version；只允许改 inspectionMode/remark（数量在 complete 时定稿）
- GET /api/inspections/{id}：include purchaseReceiptLine(purchaseReceipt) + 相关；含 version（grep version:true = 2 处）

**version/CAS**：✅ updateMany where {id, version, result:'PENDING'}

**lines 语义**：N/A（无 lines；单行实体）

**Selectors**：purchaseReceiptLineId（✅ 经 receipt 详情）、inspectionMode（枚举，无 selector 需求）

**结论：`BLOCKED — RBAC`**（shared registry 未注册 inspection；selector 无 UX gap）

## 4. Warehouse Receipt

**Contract**

- POST /api/warehouse-receipts（`warehouse-receipt:create`）：purchaseReceiptId 必填；warehouseId 必填；locationId 可选（组合 FK 同属）；remark 可选；lines min 1：purchaseReceiptLineId + inspectionId 必填（组合 FK 保证 Inspection 属于同一收货行；必须已完成且 qualifiedQty>0）、quantity>0（≤可入库余额，服务端校验）、batchNo/serialNos/mfgDate/expDate 采集、remark
- PATCH /api/warehouse-receipts/{id}（`warehouse-receipt:edit`）：仅 DRAFT；version；warehouseId 不可置 null、locationId 可空；lines **全量替换**；POST 幂等（ALREADY_POSTED→409）为 Tier 2
- GET /api/warehouse-receipts/{id}：include purchaseReceipt/warehouse/location/postedBy/lines(item+uom+purchaseReceiptLine)；含 version

**version/CAS**：✅ updateMany where {id, version, status:'DRAFT'}

**lines 语义**：全量替换

**Selectors**：purchaseReceiptId（✅）、purchaseReceiptLineId（✅）、inspectionId（✅）、warehouseId（❌）、locationId（❌）

**结论：`BLOCKED — RBAC`**（shared registry 未注册 warehouse-receipt；另有 warehouse/location selector gap）

## 5. Purchase Return

**Contract**

- POST /api/purchase-returns（`purchase-return:create`）：purchaseOrderId 必填；returnType REJECTED_ON_RECEIPT/RETURN_AFTER_STOCK_IN/QUALITY_ISSUE；remark；lines min 1：sourceRefType（RECEIPT_LINE/WAREHOUSE_RECEIPT_LINE/INSPECTION exactly-one FK）+ 对应 sourceId 必填、quantity>0（≤来源可退余额，服务端 Gate 锁内重算）、disposition REPLACE_REQUIRED/CREDIT_ONLY 必填、returnReason 必填、batchNo/serialNos 可选
- PATCH /api/purchase-returns/{id}（`purchase-return:edit`）：仅 DRAFT；version；returnType/remark/lines **全量替换**；RETURNED（Tier 2）幂等 ALREADY_RETURNED
- GET /api/purchase-returns/{id}：include purchaseOrder/supplier/returnedBy/lines（三来源 include）；含 version

**version/CAS**：✅ updateMany where {id, version, status:'DRAFT'}

**lines 语义**：全量替换

**Selectors**：purchaseOrderId（✅）、source 三选一（✅ 均经详情行）、disposition/returnType/sourceRefType（枚举）

**结论：`BLOCKED — RBAC`**（shared registry 未注册 purchase-return；selector 无 UX gap）

## 6. Stock Count

**Contract**

- POST /api/stock-counts（`stock-count:create`）：仅 remark 可选（header 极简；创建即取号 CNT）
- PATCH /api/stock-counts/{id}（`stock-count:edit`）：仅 DRAFT；version；只改 remark（header）
- **行录入独立端点**：POST /api/stock-counts/:id/lines（`stock-count:edit`）—— lines 数组：warehouseId/itemId 必填、locationId/batchNo/serialNo 可空（五维唯一）、countedQty>=0；per-line atomic snapshot（bookQtyAtCount/ledgerWatermark 服务端）
- GET /api/stock-counts/{id}：include countedBy/lines(warehouse+location+item)；含 version

**version/CAS**：✅ header updateMany where {id, version, status:'DRAFT'}

**lines 语义**：独立 lines 端点（非 PATCH 内替换）—— 表单模式与其它模块不同（需单独 reference）

**Selectors**：warehouseId（❌）、locationId（❌）、itemId（✅）

**结论：`READY WITH UX GAP`**（RBAC OK；warehouse/location selector gap；lines 端点模式需独立 reference）

## 7. Inventory Adjustment

**Contract**

- POST /api/inventory-adjustments（`inventory-adjustment:create`）：reasonCode 必填（系统保留码 + 字典，不写死 enum）；sourceStockCountId 可选（Manual 无来源）；remark；lines min 1：warehouseId/itemId 必填、locationId/batchNo/serialNo 可空（五维）、direction IN/OUT、quantity>0、uomId 可选、sourceStockCountLineId 可选（UNIQUE 防双重入账）
- PATCH /api/inventory-adjustments/{id}（`inventory-adjustment:edit`）：仅 DRAFT；version；reasonCode/remark/lines **全量替换**；Apply（Tier 2）maker-checker 服务端
- GET /api/inventory-adjustments/{id}：include sourceStockCount/approvedBy/appliedBy/lines(warehouse+location+item+uom)；含 version

**version/CAS**：✅ FOR UPDATE 锁 + CAS

**lines 语义**：全量替换（deleteMany + createMany）

**Selectors**：reasonCode（✅ dictionaries / 文本）、sourceStockCountId（✅）、warehouseId（❌）、locationId（❌）、itemId（✅）、uomId（❌）

**结论：`READY WITH UX GAP`**（RBAC OK；warehouse/location/uom selector gap）

## 8. Inventory Conversion

**Contract**

- POST /api/inventory-conversions（`inventory-conversion:create`）：itemId 必填、baseUomId 必填（服务端验证 == Item.stockUomId）；remark；lines **恰好 2 条**：1 CONSUME + 1 PRODUCE（lineRole、quantity>0、uomId 必填、uomToBaseRate>0、warehouseId 必填、locationId/batchNo 可空）；baseQuantity 服务端计算（禁客户端提交）
- PATCH /api/inventory-conversions/{id}（`inventory-conversion:edit`）：仅 DRAFT；version；remark/lines(恰好2条) 全量替换；Execute（Tier 2）CONSUME/PRODUCE 同 movementGroupId 原子
- GET /api/inventory-conversions/{id}：include item/baseUom/executedBy/lines(uom+warehouse+location)；含 version

**version/CAS**：✅ FOR UPDATE 锁 + CAS

**lines 语义**：全量替换（固定 2 行，lineRole 结构特殊）

**Selectors**：itemId（✅）、baseUomId（❌ UOM）、uomId（❌）、warehouseId（❌）、locationId（❌）

**结论：`READY WITH UX GAP`**（RBAC OK；UOM/warehouse/location selector gap；2 行结构需专用 LineEditor）

---

## 汇总与 Gate 建议

| 模块                 | 结论                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| Purchase Order       | **BLOCKED — RBAC**                                                     |
| Purchase Receipt     | **BLOCKED — RBAC**                                                     |
| Inspection           | **BLOCKED — RBAC**                                                     |
| Warehouse Receipt    | **BLOCKED — RBAC**                                                     |
| Purchase Return      | **BLOCKED — RBAC**                                                     |
| Stock Count          | READY WITH UX GAP（selector: warehouse/location）                      |
| Inventory Adjustment | READY WITH UX GAP（selector: warehouse/location/uom）                  |
| Inventory Conversion | READY WITH UX GAP（selector: uom/warehouse/location；2 行 LineEditor） |

**共性缺口 → 独立 Gate（不在前端实现 PR 内混修）**

1. **RBAC Registry Gate（P0）**：shared `PERMISSION_MODULES` 注册 `purchase-order / purchase-receipt / inspection / warehouse-receipt / purchase-return`（与 seed `SEED_ACTION_MODULES` 对齐）—— 与 PR #28 同型最小修复；5 模块解 BLOCKED。
2. **Master-Data Read API Gate（P0 评估）**：Warehouse / Warehouse-Location / UOM（可能 + User/Department）FINAL read API —— 决定 Tier 1 产品化 selector 是否具备；Batch 1 的 ID 输入 + 标注 fallback 仅限 Reference。

**Scale-Out 批次建议（RBAC Gate 落 main 后）**

- Batch 2（RBAC 已解、selector gap 最小）：Inspection → Purchase Return（无 selector UX gap）
- Batch 3：Purchase Order / Purchase Receipt / Warehouse Receipt（需 Warehouse/Location/UOM read API 决策）
- Batch 4：Stock Count / Inventory Adjustment / Inventory Conversion（独立 lines 端点 / 2 行结构 / 字典 reasonCode，需各自 reference 模式）

**HOLD 不变**：Tier 2/3 动作（Submit/Approve/Confirm/Receive/Complete/Post/Execute/Apply/Return/Cancel）、Inventory Read Model implementation、Stock Projection/Ledger real UI、5C-2、Payment、GL、Reservation、Costing、BI/OA/Mobile。
