# Inspection API 测试用例（Sprint 5B Inspection 质检唯一事实）

> 模块：Inspection（质检唯一事实源，PurchaseReceipt → Inspection → WarehouseReceipt 质量链）
> 关联：ADR-0024（D8）、Sprint5B_Field_Matrix.md、EVENTS.md v1.22、API_GUIDELINES.md、ERROR_CODES.md、Migration 0023
> 端点：`GET/POST /api/inspections`、`GET/PATCH /api/inspections/:id`、`POST /api/inspections/:id/complete`
> CTO 红线（#7045 / #7135）：**inspectableQty = quantity - rejectedOnReceiptQty**（最大可检数不再次包含现场拒收）；**一次 Inspection 即最终结果**（一个 PurchaseReceiptLine 只有一个有效 Inspection，DB unique 并发拒绝）；**qualifiedQty + rejectedQty = inspectableQty（=）**；SKIP 免检 = 服务端强制 QUALIFIED + qualifiedQty=inspectableQty + rejectedQty=0（**不绕过 Inspection 记录**）；result 服务端推导（客户端不得传）；来源必须是**已 RECEIVED** 的 PurchaseReceiptLine（CTO #7045）；Inspection **禁写 Stock / InventoryMovement**（6A 唯一事实源）。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/inspections | 401 AUTHENTICATION_ERROR |
| A2 | 无 `inspection:view` | GET /api/inspections | 403 FORBIDDEN |
| A3 | 无 `inspection:view` | GET /api/inspections/:id | 403 |
| A4 | 无 `inspection:create` | POST /api/inspections | 403 |
| A5 | 无 `inspection:edit` | PATCH /api/inspections/:id | 403 |
| A6 | 无 `inspection:edit` | POST /api/inspections/:id/complete | 403 |
| A7 | 权限隔离 | view 用户尝试 create/complete | 均按动作权限拒绝 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 分页 | GET ?page=1&pageSize=20 | 200 + meta |
| B2 | purchaseReceiptLineId 过滤 | GET ?purchaseReceiptLineId=:id | 仅该收货行 |
| B3 | result 过滤 | GET ?result=QUALIFIED | 仅 QUALIFIED |
| B4 | 排序 | GET | createdAt desc |
| B5 | 软删除 | GET | deletedAt 非空不返回 |
| B6 | 详情 | GET /:id | 收货行/检验模式/结论/数量/检验人 |
| B7 | 详情不存在 | GET /:id invalid | 404 INSPECTION_NOT_FOUND |

## C. 创建（POST /api/inspections）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建（SPOT/FULL） | 已 RECEIVED 收货行 + inspectionMode | 201 result=PENDING |
| C2 | 正常创建（SKIP） | 已 RECEIVED 收货行 + SKIP | 201 result=PENDING（complete 时定稿） |
| C3 | 收货行不存在 | purchaseReceiptLineId 无效 | 400 INSPECTION_LINE_NOT_FOUND |
| C4 | 来源未收货 | 收货行 PurchaseReceipt 未 RECEIVED | 409 INSPECTION_LINE_NOT_RECEIVED（CTO #7045） |
| C5 | 重复检验 | 同一收货行已存在有效 Inspection | 409 INSPECTION_ALREADY_EXISTS（一次检验即最终结果，DB unique 兜底） |
| C6 | 模式非法 | inspectionMode 非 SKIP/SPOT/FULL | 400 校验拒绝 |

## D. 更新（PATCH /api/inspections/:id）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 正常更新 | PENDING + version + 改 inspectionMode/remark | 200 + version 递增 |
| D2 | 版本冲突 | version 过期 | 409 VERSION_CONFLICT |
| D3 | 非 PENDING 更新 | 已 COMPLETE 后 PATCH | 409 INSPECTION_INVALID_STATE（数量只在 complete 定稿，PATCH 禁改数量） |
| D4 | 禁改数量 | PATCH 提交 qualifiedQty/rejectedQty | 400 校验拒绝（schema 无数量字段） |

## E. 完成（POST /api/inspections/:id/complete —— 真 Gate）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | SPOT/FULL 正常完成 | qualifiedQty=80 + rejectedQty=20（inspectableQty=100） | 200 result=PARTIAL + 数量落定 |
| E2 | 数量恒等式 | qualifiedQty + rejectedQty ≠ inspectableQty | 409 INSPECTION_QUANTITY_INVALID（= 强制） |
| E3 | 负数数量 | qualifiedQty < 0 或 rejectedQty < 0 | 409 INSPECTION_QUANTITY_INVALID |
| E4 | 免检 SKIP | SKIP 模式 complete 不传数量 | 200 result=QUALIFIED + qualifiedQty=inspectableQty + rejectedQty=0（服务端强制） |
| E5 | SKIP 传数量 | SKIP 提交数量 | 忽略/服务端强制覆盖（免检不绕过 Inspection 记录） |
| E6 | result 推导 | 服务端按 qualifiedQty/inspectableQty 推导 QUALIFIED/PARTIAL/REJECTED | 客户端传 result 无效 |
| E7 | 无对象可检 | inspectableQty = quantity - rejectedOnReceiptQty <= 0 | 409 INSPECTION_NO_INSPECTABLE_QTY |
| E8 | 幂等 | 已 complete 再 complete | 409 INSPECTION_INVALID_STATE |
| E9 | 版本冲突 | CAS 未命中 | 409 VERSION_CONFLICT |
| E10 | 事件 | complete 成功后 | InspectionCompleted 事务后发布（载荷含检验行/模式/结论/数量/操作人，**不含库存余额**） |
| E11 | 5B 边界 | complete 全流程 | **无 Stock / InventoryMovement 写入**（6A 唯一事实源） |
| E12 | 默认全合格（用户指令 2026-08-21） | SPOT/FULL 打开完成对话框（inspectableQty=100） | 前端合格数量默认 100、拒收默认 0（质检数量/合规数量默认采购数量，可改） |

## F. 事件（EVENTS.md v1.22 终态）

- `InspectionCompleted`：**只有 complete 事务成功后发布**；载荷 `{ inspectionId, purchaseReceiptLineId, inspectionMode, result, qualifiedQty, rejectedQty, inspectedById, inspectedAt }`，**不含库存余额**
- PENDING 创建/编辑不发领域事件（仅 AuditLog）

## G. 边界红线（5B 锁死）

1. 一个 PurchaseReceiptLine 只有一个最终 Inspection（业务不变量落数据库，并发 Create 由 DB unique 拒绝）；
2. `qualifiedQty + rejectedQty === inspectableQty`（=）；inspectableQty = quantity - rejectedOnReceiptQty（不含现场拒收）；
3. 免检 SKIP 必须生成 Inspection 记录（SKIP + QUALIFIED），**不绕过 Inspection 直接让 Receipt 成为质量事实**（D8）；
4. result 服务端推导，客户端不得传；
5. 5B 任何 API 不得写 Stock / InventoryMovement / 库存余额（6A 唯一事实源）。

## H. Real Business Acceptance（Sprint 5B Inspection Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| H1 | 到货质检 | 收货完成 → 建检验 → SPOT/FULL 定数量 → 结论落定 |
| H2 | 免检物资 | SKIP → 系统生成 QUALIFIED（合格数量 = inspectableQty），有记录可查 |
| H3 | 质检拒收 | rejectedQty 成为 PurchaseReturn（INSPECTION 来源）可退数量 |
| H4 | 待检不入库 | result=PENDING 时 WarehouseReceipt 无法引用（未获入库资格） |

## I. Release Gate

Sprint 5B Inspection API 进入 CTO Final Review 前必须满足：

1. A-H 全部核验，无 Blocking；
2. 数量恒等式（qualifiedQty + rejectedQty = inspectableQty）独立验证通过；
3. SKIP 免检服务端强制与"不绕过 Inspection 记录"通过；
4. 唯一检验（ALREADY_EXISTS + DB unique 并发）通过；
5. 来源必须已 RECEIVED（LINE_NOT_RECEIVED）通过；
6. 5B 无任何 API 可写 Stock / InventoryMovement；
7. CI Quality Gates 全绿后进入 OpenAPI + Final Docs。
