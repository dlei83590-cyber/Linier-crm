# Purchase Return API 测试用例（Sprint 5B PurchaseReturn 退货独立事实）

> 模块：Purchase Return（采购退货独立事实源，**非负 GR**——P5）
> 关联：ADR-0024（D5）、Sprint5B_Field_Matrix.md、EVENTS.md v1.22、API_GUIDELINES.md、ERROR_CODES.md、Migration 0023
> 端点：`GET/POST /api/purchase-returns`、`GET/PATCH /api/purchase-returns/:id`、`POST /api/purchase-returns/:id/return`
> CTO 红线（#7219 + Re-review #7267 98/100 FINAL）：**三来源 exactly-one FK + API 强制匹配**（RECEIPT_LINE / INSPECTION = 未入库退货不碰库存；WAREHOUSE_RECEIPT_LINE = 已入库退货，必须来自 **POSTED** 入库事实，但**不得写 InventoryMovement(OUT)**——6A 唯一事实源）；**来源可退余额（Re-review 修正）**：RECEIPT_LINE = `rejectedOnReceiptQty`（现场拒收）/ INSPECTION = `rejectedQty`（质检拒收）/ WAREHOUSE_RECEIPT_LINE = 已 POSTED 入库行 `quantity`（Create 预检查与 Return Gate **同步同源防分叉**）；**Return Gate 锁真实来源 + 锁内重算累计 RETURNED（仅 RETURNED 占额度，DRAFT 不计，防并发超退）**；**REPLACE_REQUIRED 同一事务内真正 reopen PO 履约**（INSPECTION/WAREHOUSE 来源 `receivedQty -= returnQty`、`remainingReceiveQty` 重开；RECEIPT_LINE 收货时未计入 receivedQty 不重复 reopen；PO RECEIVED + 有效 reopen → PARTIALLY_RECEIVED）；**line-level disposition**（事件/Audit 输出 `lines[]` + `hasReplacementRequired/hasCreditOnly`，弃第一行单值冒充整单）；RETURN 事务锁 + CAS/幂等（ALREADY_RETURNED→409）；**5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）；财务冲减/红字发票/AP 属 5C。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/purchase-returns | 401 AUTHENTICATION_ERROR |
| A2 | 无 `purchase-return:view` | GET /api/purchase-returns | 403 FORBIDDEN |
| A3 | 无 `purchase-return:view` | GET /api/purchase-returns/:id | 403 |
| A4 | 无 `purchase-return:create` | POST /api/purchase-returns | 403 |
| A5 | 无 `purchase-return:edit` | PATCH /api/purchase-returns/:id | 403 |
| A6 | 无 `purchase-return:edit` | POST /api/purchase-returns/:id/return | 403 |
| A7 | 权限隔离 | view 用户尝试 create/return | 均按动作权限拒绝 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 分页 | GET ?page=1&pageSize=20 | 200 + meta |
| B2 | code 模糊过滤 | GET ?code=PRT-2026 | 200 |
| B3 | purchaseOrderId 过滤 | GET ?purchaseOrderId=:id | 仅该 PO |
| B4 | supplierId / status / returnType 过滤 | GET 各过滤项 | 正确过滤 |
| B5 | 排序 | GET | createdAt desc |
| B6 | 软删除 | GET | deletedAt 非空不返回 |
| B7 | 详情 | GET /:id | PO/supplier 摘要 + lines（来源/数量/disposition/原因） |
| B8 | 详情不存在 | GET /:id invalid | 404 PURCHASE_RETURN_NOT_FOUND |

## C. 创建（POST /api/purchase-returns）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建（RECEIPT_LINE） | 来源收货行 + 数量 ≤ rejectedOnReceiptQty + disposition | 201 DRAFT + code PRT- 取号 |
| C2 | 正常创建（INSPECTION） | 来源 Inspection（result≠PENDING）+ 数量 ≤ rejectedQty | 201 DRAFT |
| C3 | 正常创建（WAREHOUSE_RECEIPT_LINE） | 来源 POSTED 入库行 + 数量 ≤ quantity | 201 DRAFT |
| C4 | PO 不存在 | purchaseOrderId 无效 | 400 PURCHASE_ORDER_NOT_FOUND |
| C5 | 重复来源 | 同一来源出现两次（同单防并发超退） | 400 PURCHASE_RETURN_DUPLICATE_LINE |
| C6 | 来源不存在/已删除 | FK 无效 | 400 PURCHASE_RETURN_SOURCE_INVALID |
| C7 | 来源不属于该 PO | 混入其他 PO 的来源 | 409 PURCHASE_RETURN_SOURCE_MISMATCH |
| C8 | WAREHOUSE 来源未 POSTED | DRAFT 入库事实不可退 | 409 PURCHASE_RETURN_SOURCE_NOT_RETURNABLE（CTO #7219） |
| C9 | INSPECTION 未完成 | result=PENDING | 409 PURCHASE_RETURN_SOURCE_NOT_RETURNABLE |
| C10 | 超来源可退余额 | RECEIPT_LINE 数量 > rejectedOnReceiptQty | 409 PURCHASE_RETURN_OVER_SOURCE_BALANCE |
| C11 | 超来源可退余额 | INSPECTION 数量 > rejectedQty | 409 PURCHASE_RETURN_OVER_SOURCE_BALANCE（**不再是 qualifiedQty**——Re-review Blocking ①） |
| C12 | 数量非法 | quantity <= 0 | 400 PURCHASE_RETURN_QUANTITY_INVALID |
| C13 | disposition 缺失 | 未传 REPLACE_REQUIRED/CREDIT_ONLY | 400 校验拒绝（必填，P5） |
| C14 | returnReason 缺失 | 空原因 | 400 校验拒绝（必填） |
| C15 | sourceRefType 与 FK 不匹配 | RECEIPT_LINE 却传 sourceInspectionId | 400 校验拒绝（exactly-one） |
| C16 | 无行 | lines 空 | 400 PURCHASE_RETURN_NO_LINES |
| C17 | DRAFT 创建不发领域事件 | 创建后查 Audit | 仅 AuditLog（PurchaseReturnCreated），无 PurchaseReturned |

## D. 更新（PATCH /api/purchase-returns/:id）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常更新 DRAFT | version 乐观锁 + 行整体替换 | 200 + version 递增 |
| D2 | 版本冲突 | version 过期 | 409 VERSION_CONFLICT |
| D3 | 非 DRAFT 更新 | RETURNED/CANCELLED 后 PATCH | 409 PURCHASE_RETURN_INVALID_STATE |
| D4 | 行整体替换校验 | 替换行同样过 C 组校验 | 同 C 组预期 |

## E. 退货（POST /api/purchase-returns/:id/return —— 真 Gate）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 正常退货（INSPECTION + REPLACE_REQUIRED） | DRAFT → RETURNED | 200 status=RETURNED + returnedAt/ById；PO Line `receivedQty -= qty`、`remainingReceiveQty` 重开（**同事务真正 reopen**——Re-review Blocking ②） |
| E2 | 正常退货（WAREHOUSE_RECEIPT_LINE + REPLACE_REQUIRED） | 已入库退货 | 200 RETURNED + PO reopen 同上 |
| E3 | 正常退货（RECEIPT_LINE + REPLACE_REQUIRED） | 现场拒收退货 | 200 RETURNED + **不重复 reopen**（收货时未计入 receivedQty，供应商本就欠货） |
| E4 | 重复退货 | 已 RETURNED 再 Return | 409 PURCHASE_RETURN_ALREADY_RETURNED（幂等） |
| E5 | 非 DRAFT 退货 | CANCELLED 后 Return | 409 PURCHASE_RETURN_INVALID_STATE |
| E6 | 无行 | lines 空 | 400 PURCHASE_RETURN_NO_LINES |
| E7 | 超来源可退余额 | 锁内重算累计 RETURNED 后超限 | 409 PURCHASE_RETURN_OVER_SOURCE_BALANCE（防并发超退） |
| E8 | 并发超退 | 两张退货单同来源同时 Return | FOR UPDATE 串行；第二单按最新累计校验拒绝 |
| E9 | 版本冲突 | CAS 未命中 | 409 VERSION_CONFLICT |
| E10 | PO 状态重聚 | PO 原 RECEIVED + 有效 reopen | PO → PARTIALLY_RECEIVED（防 RECEIVED + remainingReceiveQty>0 自相矛盾） |
| E11 | 事件 line-level | 退货成功后 | PurchaseReturned 载荷含 `lines[]`（lineId/sourceRefType/sourceId/quantity/disposition）+ `hasReplacementRequired/hasCreditOnly`（Minor 修正） |
| E12 | Audit line-level | 退货成功后 | afterData 同样 line-level（不拿第一行冒充整单） |
| E13 | 5B 边界 | 退货全流程（含已入库） | **无 InventoryMovement(OUT) / Stock 写入**（6A 唯一事实源）；财务冲减/红字发票/AP 属 5C |

## F. 事件（EVENTS.md v1.22 终态）

- `PurchaseReturned`：**只有 return 事务成功后发布**；载荷 `{ purchaseReturnId, purchaseReturnCode, purchaseOrderId, supplierId, returnType, lines:[{lineId,sourceRefType,sourceId,quantity,disposition}], hasReplacementRequired, hasCreditOnly, returnedById, returnedAt }`，**不含库存余额**
- DRAFT 创建/编辑不发领域事件（仅 AuditLog）

## G. 边界红线（5B 锁死）

1. 三来源 exactly-one FK + API 强制匹配；已入库退货必须来自 POSTED 入库事实；
2. 来源可退余额统一：`rejectedOnReceiptQty` / `rejectedQty` / POSTED 入库行 `quantity`（Create 预检查与 Return Gate 同源）；
3. REPLACE_REQUIRED = 供应商仍欠货 → 同一事务内真正 reopen PO 履约（INSPECTION/WAREHOUSE 来源；RECEIPT_LINE 不重复 reopen）；PO 状态正确重聚；
4. 退货数量 ≤ 来源可退余额（Return Gate 锁内重算累计 RETURNED，防多单并发超退）；
5. **5B 永不写 InventoryMovement(OUT) / Stock / 库存余额**（6A 唯一事实源）；财务冲减/红字发票/AP 属 5C。

## H. Real Business Acceptance（Sprint 5B PurchaseReturn Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| H1 | 现场拒收退货 | RECEIPT_LINE（rejectedOnReceiptQty）退货，不重复 reopen |
| H2 | 质检拒收退货 | INSPECTION（rejectedQty）退货；REPLACE_REQUIRED → PO 重开待交 |
| H3 | 入库后退货 | WAREHOUSE_RECEIPT_LINE（POSTED）退货；REPLACE_REQUIRED → PO 重开待交 |
| H4 | 数量不补 | CREDIT_ONLY → 不重开待交，财务后续冲减（5C） |
| H5 | 并发防超退 | 多单同来源并发 Return，第二单稳定 409 |
| H6 | 物理不重复退 | 同一批合格货不能在 INSPECTION 与 WAREHOUSE 两套来源各退一次（Re-review Blocking ①） |

## I. Release Gate

Sprint 5B PurchaseReturn API 进入 CTO Final Review 前必须满足：

1. A-H 全部核验，无 Blocking；
2. 三来源可退余额口径（rejectedOnReceiptQty / rejectedQty / POSTED quantity）Create 与 Return 同源验证通过；
3. REPLACE_REQUIRED 同事务 reopen + PO status 重聚（RECEIVED → PARTIALLY_RECEIVED）通过；
4. 并发防超退（锁内重算累计 RETURNED）测试通过；RETURNED 幂等 409 通过；
5. 事件/Audit line-level disposition（lines[] + 聚合标志）通过；
6. 5B 无任何 API 可写 Stock / InventoryMovement（含已入库退货不写 OUT）；
7. CI Quality Gates 全绿后进入 OpenAPI + Final Docs。
