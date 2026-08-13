# Batch 1 Tier 1 Reference — Contract Reconnaissance（最小开发笔记）

- 基线：`main @ ada95718`（PR #26 合并后）
- 分支：`feature/frontend-tier1-reference`（新建，从 origin/main 创建；未复用已合并分支）
- 范围：Purchase Requisition + Inventory Transfer — Create + DRAFT Edit（Tier 1 Reference only）
- 红线：零 backend / Prisma / migration 改动；未实现 Submit/Approve/Confirm/Convert/Execute/Cancel/Apply/Return/Post

---

## 1. POST /api/purchase-requisitions（PR Create）

**真实 endpoint 权限**：`purchase-requisition:create`（route.ts `requirePermission`）

**Zod schema（lib/api/schemas.ts → purchaseRequisitionCreateSchema）**：

```
{
  requesterId?: string|null    // 省略 → 服务端默认当前用户
  departmentId?: string|null   // 可选
  needDate?: string(datetime)|null   // ISO 8601 datetime
  remark?: string(≤1000)|null
  lines: Array<{               // min 1
    itemId: string(必填)
    description?: string(≤500)
    quantity: number(>0, coerce)   // 服务端 Decimal 精确校验
    uomId?: string
    lineNo?: number(>0)            // 省略 → 服务端按 (idx+1)*10
    needDate?: string(datetime)|null
    remark?: string(≤500)|null
  }>
}
```

**客户端必须提供**：`lines[].itemId`、`lines[].quantity`（+ 至少一行）
**服务端生成（客户端禁传/禁算）**：`code`（DocumentSequence 原子取号）、`status=DRAFT`、`createdById/updatedById`、行 `lineNo` 默认值
**服务端验证**：Item 引用存在（400 `PURCHASE_REQUISITION_ITEM_NOT_FOUND`）、UOM 引用存在（400 `PURCHASE_REQUISITION_UOM_NOT_FOUND`）、quantity > 0（400 `PURCHASE_REQUISITION_QUANTITY_INVALID`）
**成功响应**：`ok(created)` → `{ success:true, data:{ id, code } }`
**禁止**：客户端生成单据号；客户端提交 status/code/金额；Submit/Convert 按钮

## 2. PATCH /api/purchase-requisitions/{id}（PR Edit）

**真实 endpoint 权限**：`purchase-requisition:edit`

**Zod schema（purchaseRequisitionUpdateSchema）**：

```
{
  needDate?: string(datetime)|null
  remark?: string(≤1000)|null
  lines?: Array<LineCreateSchema>   // 可选；提供 = 行全量替换（软删旧行+重建）
  changeReason?: string(≤500)       // 可选；写入 Revision 快照
  version: number(int>0)            // 必填；乐观锁 CAS
}
.refine(v => Object.keys(v).length > 1)   // 至少一个更新字段
```

**DRAFT 可改字段**：`needDate`、`remark`、`lines`（全量替换）、`changeReason`。**不可改**：`code/status/requesterId/departmentId`（服务端红线）
**CAS 语义**：请求体字段名 = `version`；服务端预检查 `existing.version !== version` → 409 `VERSION_CONFLICT`；事务内原子 `updateMany where {id, version, status:'DRAFT'}` count===1 否则 409 `VERSION_CONFLICT`（数据库级，防 lost update）
**状态 Gate**：仅 `DRAFT` → 否则 409 `PURCHASE_REQUISITION_INVALID_STATE`
**成功响应**：`ok(updated)` → 完整记录（含 lines/requester/department/workflowInstance/revisions）

## 3. POST /api/inventory-transfers（Transfer Create）

**真实 endpoint 权限**：`inventory-transfer:create`

**Zod schema（inventoryTransferCreateSchema）**：

```
{
  sourceWarehouseId: string(必填)
  sourceLocationId?: string          // 若提供必须属于 sourceWarehouse
  destinationWarehouseId: string(必填)
  destinationLocationId?: string     // 若提供必须属于 destinationWarehouse
  remark?: string(≤500)
  lines: Array<{                     // min 1
    itemId: string(必填)
    uomId?: string
    quantity: number(>0)             // serial-managed 时须整数且 = serialNos.length
    batchNo?: string(≤100)
    serialNos: string[](≤100 each, 默认 [])
    mfgDate?: string(≤50)            // ISO 日期字符串
    expDate?: string(≤50)
    remark?: string(≤500)
  }>
}
```

**服务端生成（客户端禁传/禁算）**：`transferNo`（TRF 取号）、`status=DRAFT`、**`transferType`（服务端推导：同仓 INTRA_WAREHOUSE / 跨仓 INTER_WAREHOUSE — 客户端绝不提交/推导）**
**服务端验证**：行去重（itemId+batchNo+serialNos 组合，400 `INVENTORY_TRANSFER_DUPLICATE_LINE`）、warehouse 存在且 isActive（400 `INVENTORY_TRANSFER_WAREHOUSE_INVALID`）、location 属于对应 warehouse（400 `INVENTORY_TRANSFER_LOCATION_INVALID`）、自调拨防护（同仓同库位，409 `INVENTORY_TRANSFER_SELF_TRANSFER`）、item 存在（400 `INVENTORY_TRANSFER_ITEM_INVALID`）、serial 守恒（quantity==serialNos.length 且整数，400 `SERIAL_QTY_MISMATCH`）、serial 去重（400 `SERIAL_DUPLICATE`）
**成功响应**：201 `ok({ transfer }, undefined, 201)` → **`data.transfer`（嵌套，非裸记录）**
**红线**：DRAFT 不落账（不写 InventoryMovement / StockProjection）

## 4. PATCH /api/inventory-transfers/{id}（Transfer Edit）

**真实 endpoint 权限**：`inventory-transfer:edit`

**Zod schema（inventoryTransferUpdateSchema）**：

```
{
  version: number(int>0)             // 必填；CAS
  sourceWarehouseId?: string
  sourceLocationId?: string|null
  destinationWarehouseId?: string
  destinationLocationId?: string|null
  remark?: string(≤500)|null
  lines?: Array<LineCreateSchema>    // min 1；提供 = 行全量替换（deleteMany + createMany）
}
```

**注意**：Transfer PATCH **没有 changeReason 字段**（与 PR 不同）
**CAS 语义**：请求体字段名 = `version`；预检查 + 事务内 `FOR UPDATE` 锁 + `updateMany where {id, version, status:'DRAFT'}` count===1，失败统一 409 `VERSION_CONFLICT`
**状态 Gate**：仅 `DRAFT` → 409 `INVENTORY_TRANSFER_INVALID_STATE`
**服务端重校验**：warehouse/location 组合 FK、自调拨、行去重、item、serial 守恒；`transferType` 由服务端按最新源/目标重新推导
**成功响应**：`ok({ transfer })` → `data.transfer`

---

## 4.5 GET 详情实勘（Edit 回填 + version 源）

**GET /api/purchase-requisitions/{id}**（permission: `purchase-requisition:view`）→ `ok(pr)`，结构：

- header: id / code / status / version / needDate / remark / requesterId / departmentId / approvalStatus / createdAt …
- requester: { id, email, name }（select）
- department: { id, code, name }（select）
- workflowInstance: { id, status, currentStepNo, startedAt, completedAt }（select）
- lines: 软删过滤 + orderBy lineNo asc，每行含 item{id,code,name,model} + uom{id,code,name,symbol}
- revisions: 软删过滤 + orderBy revisionNo desc take 1（最新 Revision）

**GET /api/inventory-transfers/{id}**（permission: `inventory-transfer:view`）→ `ok(transfer)`，结构：

- header: id / transferNo / status / transferType / version / remark / sourceWarehouseId / sourceLocationId / destinationWarehouseId / destinationLocationId / createdById …
- sourceWarehouse / destinationWarehouse: { id, code, name }（select）
- sourceLocation / destinationLocation: { id, code, name }（select）
- approvedBy / executedBy: { id, name, email }（select）
- lines: 软删过滤 + orderBy createdAt asc，每行含 item{id,code,name,model} + uom{id,code,symbol} + quantity / batchNo / serialNos / mfgDate / expDate / remark

> Edit 表单的 `version` 必须取自该 GET 的最新返回，PATCH 原样回传。

---

## 5. Line model（真实字段汇总）

| 模块          | 行字段                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| PR Line       | itemId, description, quantity, uomId, lineNo, needDate, remark          |
| Transfer Line | itemId, uomId, quantity, batchNo, serialNos[], mfgDate, expDate, remark |

## 6. Server canonical facts（前端绝不计算/提交）

- `code` / `transferNo`（DocumentSequence 原子取号）
- `status`（状态机服务端唯一推进）
- `transferType`（服务端按 warehouse 关系推导）
- 行 `lineNo` 默认值、Revision 快照、AuditLog、领域事件
- 库存可用性（StockProjection / AvailableQty）：**禁止**前端自行读取判定或客户端禁提交（无 FINAL contract 前）

## 7. Permission Gate 实勘（P0 发现）

**真实 endpoint 权限（route.ts 强制执行）**：

- PR: create=`purchase-requisition:create`、edit=`purchase-requisition:edit`、view=`purchase-requisition:view`
- Transfer: create=`inventory-transfer:create`、edit=`inventory-transfer:edit`、view=`inventory-transfer:view`

**静态 RBAC 实证（tsx 运行时验证）**：

- `hasPermission(['SUPER_ADMIN'], 'purchase-requisition:create')` = **false**
- `hasPermission(['SUPER_ADMIN'], 'purchase-requisition:edit')` = **false**
- `hasPermission(['SUPER_ADMIN'], PERMISSIONS.PURCHASE_REQUISITION_WRITE)` = true
- `hasPermission(['SUPER_ADMIN'], 'inventory-transfer:create')` = true
- `hasPermission(['SUPER_ADMIN'], 'inventory-transfer:edit')` = true

**根因**：`packages/shared/src/constants/index.ts` 的 `PERMISSION_MODULES` **未注册 `purchase-requisition` 模块**（只有 view/write 常量，无 create/edit 动作码）→ `ALL_ACTION_PERMISSIONS` 不含 purchase-requisition:* → 静态 RBAC 对任何角色都不授予 create/edit → **PR Create/Edit API 当前对所有角色 403**（前端 PermissionGuard 与后端 requirePermission 同源，行为一致）。

- Transfer 模块已注册 → SUPER_ADMIN/ADMIN 有 create/edit，Transfer Reference 可用。

**前端处置（本 Batch 1 落地方式）**：

- Create 页 / 列表"新建"入口 → guard 用 `purchase-requisition:create`（字面量，本地 const）
- Edit 页 / 详情"编辑"入口（仅 DRAFT）→ guard 用 `purchase-requisition:edit`
- Transfer Create/Edit → `inventory-transfer:create` / `inventory-transfer:edit`（已注册，SUPER_ADMIN/ADMIN 可用）
- 效果：PR Create/Edit 在当前静态 RBAC 下对任何角色均 403/Forbidden（与后端行为一致、诚实）；修复方向（shared `PERMISSION_MODULES` 注册 purchase-requisition 模块 + seed 同步）属 backend/shared 改动 → **HOLD，列入 PR body 供 CTO 决策**。

## 8. CONTRACT GAP（master-data selector）

| selector            | FINAL read API                                        | 处置                                                  |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| items               | ✅ GET /api/items（item:view，含 code/name/stockUom） | 下拉                                                  |
| uom                 | ❌ 无列表 API                                         | 行内 ID 输入 / 由 item.stockUom 带出，不硬编码 option |
| warehouses          | ❌ 无列表 API（api/ 目录无 warehouses）               | ID 文本输入 + 标注                                    |
| warehouse-locations | ❌ 无列表 API                                         | ID 文本输入 + 标注                                    |
| departments         | ❌ 无列表 API                                         | 留空（可选字段）                                      |
| users/requesters    | ❌ 无列表 API                                         | 省略（服务端默认当前用户）                            |

## 9. Dirty State / Validation / 409 UX（Blocking 要求）

- **Dirty State Gate**：初始 load clean → 用户改动 dirty → 保存成功 clean；`beforeunload` + 返回链接 confirm；**VERSION_CONFLICT 重新载入前必须明确告知未保存内容可能丢失**（reload 按钮 + confirm，不自动 reload）
- **Validation 三层**：Client UX（必填/quantity>0）→ Backend（显示真实 message+code，ApiClientError）→ Invariant（supplier/item/location/state/version 只信后端）；前端验证不成为第二套领域 SSOT
- **409 VERSION_CONFLICT UX**：不覆盖本地事实、不自动 retry、明确提示"数据已被修改"、提供重新载入、reload 后用户重新确认修改

## 10. Error Codes（相关）

- `VERSION_CONFLICT`（409）、`VALIDATION_ERROR`（400, Zod flatten details）
- PR: `PURCHASE_REQUISITION_NOT_FOUND`(404) / `INVALID_STATE`(409) / `ITEM_NOT_FOUND`(400) / `UOM_NOT_FOUND`(400) / `QUANTITY_INVALID`(400)
- Transfer: `INVENTORY_TRANSFER_NOT_FOUND`(404) / `INVALID_STATE`(409) / `DUPLICATE_LINE`(400) / `WAREHOUSE_INVALID`(400) / `LOCATION_INVALID`(400) / `SELF_TRANSFER`(409) / `ITEM_INVALID`(400) / `SERIAL_QTY_MISMATCH`(400) / `SERIAL_DUPLICATE`(400) / `SEQUENCE_MISSING`(500)
