# Warehouse Receipt API 测试用例（Sprint 5B WarehouseReceipt 采购入库事实）

> 模块：Warehouse Receipt（采购入库事实，**库存追溯信息 canonical capture point**——P6）
> 关联：ADR-0024（D3/D10）、Sprint5B_Field_Matrix.md、EVENTS.md v1.22、API_GUIDELINES.md、ERROR_CODES.md、Migration 0023
> 端点：`GET/POST /api/warehouse-receipts`、`GET/PATCH /api/warehouse-receipts/:id`、`POST /api/warehouse-receipts/:id/post`
> CTO 红线（#7135 98/100 FINAL）：**D10：Created ≠ Posted——只有 POSTED 才触发 6A InventoryMovement(IN)**；来源收货单必须已 RECEIVED；入库行只能消费**已完成且 qualifiedQty > 0** 的 Inspection（组合 FK [inspectionId, purchaseReceiptLineId] 保证同属同一收货行）；quantity ≤ 可入库余额（qualifiedQty - 已占用，POST 时含本单行防并发超入）；**DIRECT_PROJECT（直送）禁入库（P4）**；Warehouse-Location 必须同属；POST 事务锁 + CAS/幂等（ALREADY_POSTED→409）；**5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）；批次/序列号/效期在入库层采集（P6）。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/warehouse-receipts | 401 AUTHENTICATION_ERROR |
| A2 | 无 `warehouse-receipt:view` | GET /api/warehouse-receipts | 403 FORBIDDEN |
| A3 | 无 `warehouse-receipt:view` | GET /api/warehouse-receipts/:id | 403 |
| A4 | 无 `warehouse-receipt:create` | POST /api/warehouse-receipts | 403 |
| A5 | 无 `warehouse-receipt:edit` | PATCH /api/warehouse-receipts/:id | 403 |
| A6 | 无 `warehouse-receipt:edit` | POST /api/warehouse-receipts/:id/post | 403 |
| A7 | 权限隔离 | view 用户尝试 create/edit/post | 均按动作权限拒绝 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 分页 | GET ?page=1&pageSize=20 | 200 + meta |
| B2 | purchaseReceiptId 过滤 | GET ?purchaseReceiptId=:id | 仅该收货单 |
| B3 | status 过滤 | GET ?status=POSTED | 仅 POSTED |
| B4 | 排序 | GET | createdAt desc |
| B5 | 软删除 | GET | deletedAt 非空不返回 |
| B6 | 详情 | GET /:id | 来源收货/仓库/库位/行（收货行/Inspection/数量/批次/序列号/效期） |
| B7 | 详情不存在 | GET /:id invalid | 404 WAREHOUSE_RECEIPT_NOT_FOUND |

## C. 创建（POST /api/warehouse-receipts）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建 | 已 RECEIVED 收货单 + 仓库 + 已完成 Inspection 行 | 201 DRAFT |
| C2 | 来源收货单未 RECEIVED | PurchaseReceipt 状态非 RECEIVED | 409 WAREHOUSE_RECEIPT_PURCHASE_RECEIPT_NOT_RECEIVED |
| C3 | 收货单不存在 | purchaseReceiptId 无效 | 400 WAREHOUSE_RECEIPT_NOT_FOUND |
| C4 | 重复行 | 同一收货行出现两次 | 400 WAREHOUSE_RECEIPT_DUPLICATE_LINE |
| C5 | 行不属于收货单 | 混入其他收货单的行 | 409 WAREHOUSE_RECEIPT_LINE_MISMATCH |
| C6 | Inspection 不存在 | inspectionId 无效 | 400 WAREHOUSE_RECEIPT_INSPECTION_NOT_FOUND |
| C7 | Inspection 未完成 | result=PENDING | 409 WAREHOUSE_RECEIPT_INSPECTION_NOT_COMPLETED |
| C8 | Inspection 无合格量 | qualifiedQty <= 0 | 409 WAREHOUSE_RECEIPT_INSPECTION_NO_QUALIFIED |
| C9 | Inspection 不属于该行 | 组合 FK 不一致 | 409 WAREHOUSE_RECEIPT_INSPECTION_MISMATCH |
| C10 | 直送禁入库 | 行来源 PO Line 为 DIRECT_PROJECT | 409 WAREHOUSE_RECEIPT_DIRECT_PROJECT_FORBIDDEN（P4） |
| C11 | 仓库无效/停用 | warehouseId 不存在或 isActive=false | 400 WAREHOUSE_RECEIPT_WAREHOUSE_INVALID |
| C12 | 库位无效/不属于仓库 | locationId 无效或非该仓库 | 400 WAREHOUSE_RECEIPT_LOCATION_INVALID |
| C13 | 数量非法 | quantity <= 0 | 400 WAREHOUSE_RECEIPT_QUANTITY_INVALID |
| C14 | 无行 | lines 空 | 400 WAREHOUSE_RECEIPT_NO_LINES |
| C15 | DRAFT 创建不发领域事件 | 创建后查 Audit | 仅 AuditLog，无 WarehouseReceiptPosted |
| C16 | 入库数量默认上级合规数量（用户指令 2026-08-21） | 行选择质检结论（qualifiedQty=80） | 前端入库数量自动填 80（已手填则保留）；唯一质检结论自动选中并带出 |

## D. 更新（PATCH /api/warehouse-receipts/:id）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常更新 DRAFT | version 乐观锁 + 行整体替换 | 200 + version 递增 |
| D2 | 版本冲突 | version 过期 | 409 VERSION_CONFLICT |
| D3 | 非 DRAFT 更新 | POSTED/CANCELLED 后 PATCH | 409 WAREHOUSE_RECEIPT_INVALID_STATE |
| D4 | warehouseId 置 null | schema 禁止清空（模型必填） | 400 校验拒绝 |

## E. 过账（POST /api/warehouse-receipts/:id/post —— 真 Gate）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 正常过账 | DRAFT → POSTED | 200 status=POSTED + postedAt/ById + version 递增 |
| E2 | 重复过账 | 已 POSTED 再 Post | 409 WAREHOUSE_RECEIPT_ALREADY_POSTED（幂等） |
| E3 | 非 DRAFT 过账 | CANCELLED 后 Post | 409 WAREHOUSE_RECEIPT_INVALID_STATE |
| E4 | 无行 | lines 空 | 400 WAREHOUSE_RECEIPT_NO_LINES |
| E5 | 超可入库余额 | 累计入库（含本单）> qualifiedQty | 409 WAREHOUSE_RECEIPT_OVER_INSPECTION_BALANCE（POST 时含本单行，防并发超入） |
| E6 | 组合 FK 同属 | Inspection 与收货行不匹配 | 409 WAREHOUSE_RECEIPT_INSPECTION_MISMATCH |
| E7 | 版本冲突 | CAS 未命中 | 409 VERSION_CONFLICT |
| E8 | 事件 | 过账成功后 | WarehouseReceiptPosted 事务后发布（载荷含入库单/来源收货/仓库库位/操作人/时间，**不含库存余额**） |
| E9 | 5B 边界 | 过账全流程 | **无 Stock / InventoryMovement 写入**（D10：只有 6A 消费 Posted 事件生成 IN） |

## F. 事件（EVENTS.md v1.22 终态）

- `WarehouseReceiptPosted`：**只有 POST 事务成功后发布**；载荷 `{ warehouseReceiptId, warehouseReceiptCode, purchaseReceiptId, warehouseId, locationId, postedById, postedAt }`，**不含库存余额**
- D10：Created ≠ Posted，只有 Posted 才触发 6A InventoryMovement(IN)（6A 消费 Posted 事件）
- DRAFT 创建/编辑不发领域事件（仅 AuditLog）

## G. 边界红线（5B 锁死）

1. 只有 POSTED 才触发 6A InventoryMovement(IN)（D10）；5B 永不直接写库存余额；
2. 入库行只能消费已完成且 qualifiedQty > 0 的 Inspection（组合 FK 同属）；
3. 累计入库 ≤ Inspection 可入库余额（qualifiedQty - 已占用；POST 含本单行，防并发超入）；
4. DIRECT_PROJECT（直送）禁入库（P4）；Warehouse-Location 必须同属；
5. 批次/序列号/效期 canonical capture point = 入库层（P6）。

## H. Real Business Acceptance（Sprint 5B WarehouseReceipt Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| H1 | 常规入库 | 收货 → 质检合格 → 建入库单 → 过账 POSTED |
| H2 | 分批入库 | 多次入库各自 ceiling，累计不超 qualifiedQty |
| H3 | 待检拦截 | Inspection 未完成时无法入库 |
| H4 | 直送不入库 | DIRECT_PROJECT 行禁入库（P4） |
| H5 | 过账即库存生效点 | Created 无库存动作；Posted 后 6A 才生成 InventoryMovement(IN)（D10） |
| H6 | 追溯信息 | 批次/序列号/效期随入库采集（P6） |

## I. Release Gate

Sprint 5B WarehouseReceipt API 进入 CTO Final Review 前必须满足：

1. A-H 全部核验，无 Blocking；
2. D10（Created ≠ Posted；只有 Posted 触发 6A IN）独立验证通过；
3. 可入库余额（含本单行防并发超入）测试通过；
4. 组合 FK 同属 + DIRECT_PROJECT 禁入库通过；
5. 5B 无任何 API 可写 Stock / InventoryMovement；
6. CI Quality Gates 全绿后进入 OpenAPI + Final Docs。
