# Purchase Receipt API 测试用例（Sprint 5B PurchaseReceipt 收货事实）

> 模块：Purchase Receipt（收货事实源，到货/收货层）
> 关联：ADR-0024、Sprint5B_China_ERP_Process_Field_Gate.md、Sprint5B_Field_Matrix.md、EVENTS.md v1.22、API_GUIDELINES.md、ERROR_CODES.md、Migration 0023
> 端点：`GET/POST /api/purchase-receipts`、`GET/PATCH /api/purchase-receipts/:id`、`POST /api/purchase-receipts/:id/receive`、`POST /api/purchase-receipts/:id/cancel`
> CTO 红线：**只有 CONFIRMED / PARTIALLY_RECEIVED PO 可收货（RECEIVED 禁普通新增收货，D9）**；普通收货不走审批（P1b）；**receivedQty += acceptedReceiptQty = quantity - rejectedOnReceiptQty（现场拒收不计入）**；remainingReceiveQty = max(quantity - receivedQty, 0)（服务端唯一计算，tolerance 只用于 receive ceiling 不改变语义）；同一 Receipt 内一个 PO Line 只能出现一次（B②）；**5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）；直送（DIRECT_PROJECT）不入库、不要求 warehouseId（P4）。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/purchase-receipts | 401 AUTHENTICATION_ERROR |
| A2 | 无 `purchase-receipt:view` | GET /api/purchase-receipts | 403 FORBIDDEN |
| A3 | 无 `purchase-receipt:view` | GET /api/purchase-receipts/:id | 403 |
| A4 | 无 `purchase-receipt:create` | POST /api/purchase-receipts | 403 |
| A5 | 无 `purchase-receipt:edit` | PATCH /api/purchase-receipts/:id | 403 |
| A6 | 无 `purchase-receipt:edit` | POST /api/purchase-receipts/:id/receive | 403 |
| A7 | 无 `purchase-receipt:close` | POST /api/purchase-receipts/:id/cancel | 403 |
| A8 | 权限隔离 | view 用户尝试 create/edit/receive/cancel | 均按动作权限拒绝 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 分页 | GET ?page=1&pageSize=20 | 200 + meta |
| B2 | code 模糊过滤 | GET ?code=PRC-2026 | 200 |
| B3 | purchaseOrderId 过滤 | GET ?purchaseOrderId=:id | 仅该 PO |
| B4 | status 过滤 | GET ?status=RECEIVED | 仅 RECEIVED |
| B5 | 排序 | GET | createdAt desc |
| B6 | 软删除 | GET | deletedAt 非空不返回 |
| B7 | 列表摘要 | GET | PO 摘要 + 行数计数 |
| B8 | 详情 | GET /:id | PO/supplier/warehouse 摘要 + lines（PO Line/Item/UOM） |
| B9 | 详情不存在 | GET /:id invalid | 404 PURCHASE_RECEIPT_NOT_FOUND |

## C. 创建（POST /api/purchase-receipts）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建（WAREHOUSE） | CONFIRMED PO + warehouseId + 行（quantity=100, rejectedOnReceiptQty=20） | 201 DRAFT + code PRC- 取号 |
| C2 | 正常创建（DIRECT_PROJECT） | 直送行不要求 warehouseId（P4） | 201 DRAFT |
| C3 | PO 不存在 | purchaseOrderId 无效 | 400 PURCHASE_RECEIPT_PO_NOT_FOUND |
| C4 | PO 状态不允许 | DRAFT/SUBMITTED/APPROVED/CANCELLED/RECEIVED PO | 409 PURCHASE_RECEIPT_PO_STATE_FORBIDDEN（**RECEIVED 禁普通新增收货，D9**） |
| C5 | 供应商停用 | PO 供应商 isActive=false | 400 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| C6 | 重复 PO Line | 同一 PO Line 出现两次 | 400 PURCHASE_RECEIPT_DUPLICATE_PO_LINE（B② 防 receivedQty 少记） |
| C7 | 行不属于该 PO | 混入其他 PO 的行 | 400 PURCHASE_RECEIPT_LINE_PO_MISMATCH |
| C8 | WAREHOUSE 行缺 warehouseId | 有 WAREHOUSE 行但未传 warehouseId | 400 PURCHASE_RECEIPT_WAREHOUSE_REQUIRED |
| C9 | warehouseId 无效/停用 | 不存在或 isActive=false | 400 PURCHASE_RECEIPT_WAREHOUSE_INVALID |
| C10 | 数量非法 | quantity<=0 或 rejectedOnReceiptQty>quantity 或 <0 | 400 PURCHASE_RECEIPT_QUANTITY_INVALID |
| C11 | 无行 | lines 空 | 400 PURCHASE_RECEIPT_NO_LINES |
| C12 | DRAFT 创建不发领域事件 | 创建后查 Audit | 仅 AuditLog（PurchaseReceiptCreated），无 PurchaseReceiptReceived |

## D. 更新（PATCH /api/purchase-receipts/:id）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常更新 DRAFT | version 乐观锁 + 行整体替换 | 200 + version 递增 |
| D2 | 版本冲突 | version 过期 | 409 VERSION_CONFLICT |
| D3 | 非 DRAFT 更新 | RECEIVED/CANCELLED 后 PATCH | 409 PURCHASE_RECEIPT_INVALID_STATE |
| D4 | 行整体替换校验 | 替换行同样过 C 组校验 | 同 C 组预期 |
| D5 | 禁改投影字段 | 客户端提交 receivedQty/remainingReceiveQty | 400 校验拒绝（schema 无此字段） |

## E. 收货（POST /api/purchase-receipts/:id/receive —— 真 Gate）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 正常收货 | DRAFT → RECEIVED；receivedQty += accepted（quantity - rejectedOnReceiptQty） | 200 status=RECEIVED + receivedAt/ById |
| E2 | 重复收货 | 已 RECEIVED 再 Receive | 409 PURCHASE_RECEIPT_ALREADY_RECEIVED（幂等） |
| E3 | 非 DRAFT 状态 | CANCELLED 后 Receive | 409 PURCHASE_RECEIPT_INVALID_STATE |
| E4 | 无行 | lines 空 | 400 PURCHASE_RECEIPT_NO_LINES |
| E5 | 行不属于 PO | 行 PO Line 不属于 Receipt 的 PO | 409 PURCHASE_RECEIPT_LINE_PO_MISMATCH |
| E6 | 数量公式 | quantity=100 / rejected=20 | accepted=80；receivedQty 只 +80（**现场拒收不计入**，P7） |
| E7 | 超收 ceiling | 累计 receivedQty 超 PO Line quantity × (1+tolerance)（System Default 0%） | 409 PURCHASE_RECEIPT_OVER_RECEIPT |
| E8 | 行锁并发 | 两个 Receive 同时抢同一 PO Line | FOR UPDATE 串行；第二个按新投影校验（防并发超收） |
| E9 | 版本冲突 | CAS 未命中 | 409 VERSION_CONFLICT |
| E10 | PO 聚合状态 | 全部行 receivedQty>=quantity → PO=RECEIVED；否则 PARTIALLY_RECEIVED | PO status 正确回写 |
| E11 | 事件 | 收货成功后 | PurchaseReceiptReceived + PO 投影事件（PurchaseOrderPartiallyReceived / PurchaseOrderReceived）事务后发布 |
| E12 | 投影写回 | 收货后查 PO Line | receivedQty/remainingReceiveQty 服务端回写、version 递增 |
| E13 | 5B 边界 | 收货全流程 | **无 Stock / InventoryMovement 写入**（6A 唯一事实源） |

## F. 取消（POST /api/purchase-receipts/:id/cancel）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | 正常取消 DRAFT | version 乐观锁 | 200 status=CANCELLED |
| F2 | 已 RECEIVED 取消 | RECEIVED 收货事实 | 409 PURCHASE_RECEIPT_CANCEL_FORBIDDEN（CTO #6944：收货事实不得经 cancel 撤销） |
| F3 | 非 DRAFT 取消 | CANCELLED 再 Cancel | 409 PURCHASE_RECEIPT_INVALID_STATE |
| F4 | 版本冲突 | CAS 未命中 | 409 VERSION_CONFLICT |

## G. 事件（EVENTS.md v1.22 终态）

- `PurchaseReceiptReceived`：**只有 receive 事务成功后发布**；载荷 `{ purchaseReceiptId, purchaseReceiptCode, purchaseOrderId, supplierId, warehouseId, receivedById, receivedAt }`，**不含库存余额**
- `PurchaseOrderPartiallyReceived / PurchaseOrderReceived`：receive 事务成功后按 PO 聚合状态发布（投影事件，5B GR 聚合回写）
- DRAFT 创建/编辑不发领域事件（仅 AuditLog）

## H. 边界红线（5B 锁死）

1. 只有 CONFIRMED / PARTIALLY_RECEIVED PO 可收货；RECEIVED 禁普通新增收货（D9：走 Reopen / Amendment / Over-Receipt Exception）；
2. `receivedQty += quantity - rejectedOnReceiptQty`（现场拒收不计入；禁 receivedQty += quantity）；
3. `remainingReceiveQty = max(quantity - receivedQty, 0)` 服务端唯一计算；tolerance 只用于 receive ceiling；
4. 5B 任何 API 不得写 Stock / InventoryMovement / 库存余额（6A 唯一事实源）；
5. 普通收货不走审批（P1b）；超收/异常才走 Workflow。

## P. Real Business Acceptance（Sprint 5B PurchaseReceipt Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| P1 | 常规到货 | PO CONFIRMED → 收货单 → Receive → PO 投影更新 |
| P2 | 现场拒收 | 到货 100 现场拒 20 → receivedQty 只 +80，PO 不视为 RECEIVED |
| P3 | 部分收货 | 多次收货各自 ceiling，PO 保持 PARTIALLY_RECEIVED |
| P4 | 全部收完 | 全行 receivedQty>=quantity → PO=RECEIVED（终止普通新增收货 Gate） |
| P5 | 直送 | DIRECT_PROJECT 行不入库、不要求 warehouseId |
| P6 | 收货后取消尝试 | RECEIVED 事实不可经 cancel 撤销 |

## Q. Release Gate

Sprint 5B PurchaseReceipt API 进入 CTO Final Review 前必须满足：

1. A-F 全部核验，无 Blocking；
2. CONFIRMED/PARTIALLY_RECEIVED 状态门禁与 RECEIVED 禁收（D9）通过；
3. quantity - rejectedOnReceiptQty 投影公式与 tolerance ceiling 独立验证通过；
4. FOR UPDATE 行锁并发超收测试通过（E8）；
5. PO 聚合状态（RECEIVED/PARTIALLY_RECEIVED）与投影事件发布通过；
6. 5B 无任何 API 可写 Stock / InventoryMovement；
7. CI Quality Gates 全绿后进入 OpenAPI + Final Docs。
