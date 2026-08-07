# Delivery API 测试用例（Sprint 4C Delivery Foundation）

> 模块：Delivery Foundation（主档 CRUD + Lines + Lifecycle Actions + SalesOrder Aggregation）
> 关联：docs/qa/Sprint4C_QA.md、ADR-0018、Sprint4C_Delivery_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.5
> 说明：覆盖 10 端点；重点覆盖 CTO Review 锁定项：唯一创建入口（无 POST /api/deliveries）、防超交
> （availableQty 动态计算，不新增 allocatedQty 列）、READY 冻结、POD 门禁（RECEIVED/WAIVED）、
> confirm-delivery 12 步事务 + SO 聚合回写（PARTIALLY_DELIVERED/DELIVERED）、并发锁序（id ASC 防死锁）、
> 快照四件套（READY/DISPATCHED/DELIVERED/CANCELLED）、Decimal 全程无 Float、Snapshot 金额 toString()。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/deliveries | 401 AUTHENTICATION_ERROR |
| A2 | 无 delivery:view | GET /api/deliveries | 403 FORBIDDEN |
| A3 | 无 delivery:view | GET /api/deliveries/:id | 403 |
| A4 | 无 delivery:create | POST /api/sales-orders/:id/deliveries | 403 |
| A5 | 无 delivery:edit | PATCH /api/deliveries/:id | 403 |
| A6 | 无 delivery:edit | POST /api/deliveries/:id/ready | 403 |
| A7 | 无 delivery:edit | POST /api/deliveries/:id/dispatch | 403 |
| A8 | 无 delivery:approve | POST /api/deliveries/:id/confirm-delivery | 403 |
| A9 | 无 delivery:close | POST /api/deliveries/:id/cancel | 403 |
| A10 | 无 delivery-line:view | GET /api/deliveries/:id/lines | 403 |
| A11 | 无 delivery-line:edit | PATCH /api/deliveries/:id/lines/:lineId | 403 |
| A12 | 无 delivery-revision:view | GET /api/deliveries/:id/revisions | 403 |
| A13 | 无 delivery-snapshot:view | GET /api/deliveries/:id/snapshots | 403 |
| A14 | 权限码覆盖 9 个 | delivery* / delivery-line* / delivery-revision* / delivery-snapshot* | 无权限 403 |

## B. 主档 CRUD（/api/deliveries）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 列表分页+过滤 | GET ?page&pageSize&code&salesOrderId&customerId&status&dateFrom&dateTo | 200 分页，软删除过滤 |
| B2 | 列表项摘要 | GET | 每项含 customer/salesOrder 摘要 + lines 计数 |
| B3 | 详情 | GET /:id | 200 含 lines/revisions/snapshots + customer/salesOrder 摘要 |
| B4 | 详情不存在 | GET /:id（无效 id） | 404 DELIVERY_NOT_FOUND |
| B5 | 更新头 | PATCH /:id {deliveryDate, carrier, changeReason, version} | 200 version+1，生成 DeliveryRevision，发布 DeliveryUpdated |
| B6 | 更新 version 冲突 | PATCH /:id（旧 version） | 409 VERSION_CONFLICT |
| B7 | 非 DRAFT 更新头 | PATCH（READY 状态） | 409 DELIVERY_INVALID_STATE（仅 DRAFT；READY 后冻结） |
| B8 | 无 POST 端点 | POST /api/deliveries | 404（路由不存在，Direct Delivery 禁止） |

## C. 创建 Delivery（唯一入口 POST /api/sales-orders/:id/deliveries）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建（带行） | POST /api/sales-orders/:id/deliveries {lines:[{sourceSalesOrderLineId, quantity}]} | 201 DRAFT，code=DO-000001，CREATED 快照 |
| C2 | 正常创建（空头） | POST（无 lines） | 201 DRAFT 空头（不默认复制全部行） |
| C3 | SO 不存在 | POST（无效 salesOrderId） | 404 SALES_ORDER_NOT_FOUND |
| C4 | SO 状态不允许 | POST（SO=DRAFT/CANCELLED/COMPLETED） | 409 SALES_ORDER_NOT_DELIVERABLE |
| C5 | SO=CONFIRMED 允许 | POST | 201 |
| C6 | SO=PARTIALLY_DELIVERED 允许 | POST | 201 |
| C7 | 行来源不属于该 SO | POST {lines:[{sourceSalesOrderLineId:其他SO行}]} | 400 DELIVERY_SOURCE_LINE_INVALID |
| C8 | 行数量非正数 | POST {lines:[{quantity:0}]} | 400 VALIDATION_ERROR（Zod positive） |
| C9 | 行数量超 availableQty | POST {lines:[{quantity:>剩余}]} | 409 DELIVERY_QUANTITY_EXCEEDED |
| C10 | 编码唯一性 | 连续创建 | DO-000001 / DO-000002 递增（DocumentSequence 原子取号） |

## D. 行管理（/api/deliveries/:id/lines，Allocation 核心）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 行列表 | GET /lines | 200，含 item/uom/sourceSalesOrderLine 摘要 |
| D2 | 行列表 Delivery 不存在 | GET /lines（无效 id） | 404 DELIVERY_NOT_FOUND |
| D3 | 更新行数量（缩小） | PATCH /lines/:lineId {quantity:50, version} | 200，version+1，Revision |
| D4 | 更新行数量（增大合法） | PATCH {quantity:80}（availableQty 足够） | 200 |
| D5 | 更新行数量（超交） | PATCH {quantity:>availableQty} | 409 DELIVERY_QUANTITY_EXCEEDED |
| D6 | 排除自身行计算 | PATCH {quantity:100}（自身旧 100 不计入 open） | 200（若剩余可用 ≥100-旧占用） |
| D7 | 更新描述/uomId/lineNo | PATCH {description, uomId, lineNo, version} | 200，不触发 allocation（quantity 未变） |
| D8 | 行乐观锁冲突 | PATCH（旧 version） | 409 VERSION_CONFLICT |
| D9 | 非 DRAFT 改行 | PATCH（READY 状态） | 409 DELIVERY_INVALID_STATE（READY 后行冻结） |
| D10 | 行不存在 | PATCH /lines/:lineId（无效 lineId） | 404 DELIVERY_LINE_NOT_FOUND |
| D11 | 源行软删后改数量 | PATCH {quantity}（sourceSalesOrderLineId 已 SetNull） | 400 DELIVERY_SOURCE_LINE_INVALID |
| D12 | 数量非正数 | PATCH {quantity:0} | 400 VALIDATION_ERROR |
| D13 | 多行同源行合计校验 | 同 Delivery 两行指向同一 SO Line | 合计不超 availableQty；超 → 409 |

## E. Allocation（多 Delivery 占用，防超交）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 第一张 Delivery 占用 | Delivery A 创建 {quantity:60}（SO Line 100） | 201，openDeliveryQty=60 |
| E2 | 第二张占用剩余 | Delivery B 创建 {quantity:40} | 201（availableQty=40） |
| E3 | 第三张超交 | Delivery C 创建 {quantity:1} | 409 DELIVERY_QUANTITY_EXCEEDED |
| E4 | 边界等于 availableQty | 创建 {quantity:40}（恰好剩余） | 201 |
| E5 | CANCEL 释放占用 | 取消 Delivery B → 新 Delivery {quantity:40} | 201（CANCELLED 不在 open 集合） |
| E6 | 行 PATCH 释放占用 | Delivery A 行 60→30 → Delivery B 可补 30 | 200 / 201 |
| E7 | confirmed 后不再计入 open | Delivery A confirm → 其行计入 confirmedDeliveredQty | availableQty = orderedQty - confirmed - open |
| E8 | 跨单并发分配 | A/B 并发创建同一源行 | FOR UPDATE 串行化，总量不超 orderedQty |

## F. Lifecycle Actions（Status 状态机）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | DRAFT→READY（合法） | POST /:id/ready | 200，READY 快照 |
| F2 | 无行 ready | POST /:id/ready（空头） | 409 DELIVERY_INVALID_STATE（至少 1 条有效行） |
| F3 | 行数量≤0 ready | POST /:id/ready | 409 DELIVERY_INVALID_STATE |
| F4 | 源行失效 ready | POST /:id/ready（源行已删） | 400 DELIVERY_SOURCE_LINE_INVALID |
| F5 | ready 重新校验超交 | DRAFT 期间其他单抢占 → ready | 409 DELIVERY_QUANTITY_EXCEEDED |
| F6 | 重复 ready | POST /:id/ready（READY 状态） | 409 DELIVERY_INVALID_STATE（仅 DRAFT；不支持重新 ready） |
| F7 | READY→DISPATCHED | POST /:id/dispatch | 200，DISPATCHED 快照 |
| F8 | dispatch 带物流信息 | POST /:id/dispatch {carrier, trackingNo, expectedArrivalDate} | 200，字段落库 |
| F9 | 重复 dispatch | POST /:id/dispatch（DISPATCHED 状态） | 409 |
| F10 | dispatch 不增 deliveredQty | dispatch 后查 SO Line | deliveredQty 仍为 0（发运≠收货） |
| F11 | DISPATCHED→DELIVERED | POST /:id/confirm-delivery（POD=RECEIVED） | 200，DELIVERED 快照 |
| F12 | DRAFT→confirm | POST /:id/confirm-delivery（DRAFT 状态） | 409 DELIVERY_INVALID_STATE |
| F13 | READY→confirm | POST /:id/confirm-delivery（READY 状态） | 409 |
| F14 | DELIVERED 重复 confirm | POST /:id/confirm-delivery | 409 |
| F15 | CANCELLED 后任何动作 | ready/dispatch/confirm | 409 |
| F16 | DRAFT/READY→CANCELLED | POST /:id/cancel | 200，CANCELLED 快照 |
| F17 | DISPATCHED→cancel | POST /:id/cancel | 409（已进入物流环节禁止取消） |
| F18 | DELIVERED→cancel | POST /:id/cancel | 409 |
| F19 | 状态机全路径 | DRAFT→READY→DISPATCHED→DELIVERED | 每步快照正确生成 |

## G. POD 门禁（confirm-delivery）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | PENDING 禁止 confirm | confirm-delivery（podStatus 未设置） | 409（POD 未确认） |
| G2 | RECEIVED 允许 confirm | body {podStatus:RECEIVED} | 200，podReceivedAt/podConfirmedById 回填 |
| G3 | WAIVED 允许 confirm | body {podStatus:WAIVED} | 200，podStatus=WAIVED（无签收投影） |
| G4 | podReceivedAt 自定义 | body {podStatus:RECEIVED, podReceivedAt} | 200，按传入时间回填 |
| G5 | 无效 podStatus | body {podStatus:PENDING} | 400 VALIDATION_ERROR（enum 限定 RECEIVED/WAIVED） |
| G6 | POD 文件走 File Center | 附件上传 businessType=delivery attachmentType=POD | 元数据落 FileAttachment，不建 DeliveryPOD 表 |

## H. Aggregation（SalesOrder 回写，confirm-delivery 12 步事务）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 部分交付聚合 | Delivery A（60/100）confirm | SO=PARTIALLY_DELIVERED，deliveredAt 为空 |
| H2 | 全部完成聚合 | Delivery B（40/100）confirm | SO=DELIVERED，deliveredAt=now |
| H3 | SO Line 回写 | confirm 后查 SalesOrderLine | deliveredQty=100，remainingQty=0（Decimal 精确） |
| H4 | 多行部分完成 | 行1 满 / 行2 未满 | SO=PARTIALLY_DELIVERED |
| H5 | 全部行 remainingQty≤0 | 所有行 deliveredQty=quantity | SO=DELIVERED |
| H6 | 不提前标记 | Delivery=READY/DISPATCHED 时 | SO 保持 CONFIRMED（不因未确认交付提前标 PARTIALLY_DELIVERED） |
| H7 | 锁序防死锁 | 多 Delivery 并发 confirm 同 SO | 按 id ASC 锁 SalesOrderLine，无死锁，聚合一致 |
| H8 | 12 步事务完整性 | confirm 成功后 | Delivery=DELIVERED + POD 投影 + DELIVERED 快照 + SO Line 回写 + SO 聚合 + 事件 |

## I. Snapshot（四件套 + Decimal 字符串）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | CREATED 快照 | 创建 Delivery | snapshotType=CREATED（revisionNo=1） |
| I2 | READY 快照 | ready | snapshotType=READY，行冻结内容 |
| I3 | DISPATCHED 快照 | dispatch | snapshotType=DISPATCHED，含物流信息 |
| I4 | DELIVERED 快照 | confirm | snapshotType=DELIVERED，含 POD/行投影 |
| I5 | CANCELLED 快照 | cancel | snapshotType=CANCELLED |
| I6 | 金额/数量字符串 | 读 snapshotData | quantity/orderedQty/deliveredQty 均为字符串（toString，非 number） |
| I7 | 每类型唯一 | 同一 Delivery 重复动作 | @@unique([deliveryId, snapshotType]) 约束（状态机保证只生成一次） |

## J. Concurrency / 并发安全

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 同单并发 ready | 两请求同时 ready | 行锁串行化，单胜出 200，另一 409 |
| J2 | 同 SO 并发创建 | 两请求同时 POST deliveries | FOR UPDATE 锁 SO，串行创建 |
| J3 | 同源行并发分配 | A/B 同时 PATCH 行 | id ASC 锁序，总量不超 orderedQty |
| J4 | 同源行并发 confirm | A/B 同时 confirm | 稳定锁序无死锁，deliveredQty 累计正确 |
| J5 | 乐观锁冲突 | 并发 PATCH 旧 version | 后到者 409 VERSION_CONFLICT |

## K. Audit / 审计留痕

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| K1 | 创建审计 | 创建 Delivery | AuditLog action=delivery.create |
| K2 | 头/行更新审计 | PATCH 头/行 | delivery.update / delivery-line.update |
| K3 | 动作审计 | ready/dispatch/confirm/cancel | delivery.ready / delivery.dispatch / delivery.confirm-delivery / delivery.cancel |
| K4 | 事件留痕 | confirm 后 | DeliveryConfirmed + SalesOrderPartiallyDelivered/SalesOrderDelivered |
| K5 | 事件失败不阻断 | 事件发布抛错 | 主流程完成（try/catch 降级） |

## L. Boundary / 边界

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| L1 | 数量 Decimal 精度 | quantity=0.0001 步进 | Decimal(18,4) 精确无浮点误差 |
| L2 | 大数量 | quantity=999999.9999 | 不溢出，Decimal 全程 |
| L3 | 分页上限 | pageSize=1000 | 钳制到 100 |
| L4 | 软删除过滤 | 删除后列表/详情 | 不返回 deletedAt 非空记录 |
| L5 | 非法 status 过滤值 | GET ?status=XXX | 空结果（枚举过滤） |
| L6 | 无 Invoice/Payment | 尝试访问 | 路由不存在（本阶段禁止） |
| L7 | 无 /complete | 尝试 POST /complete | 路由不存在（COMPLETED 仅枚举） |
| L8 | POD 表不存在 | 查询 DeliveryPOD | 无该模型/表（最小投影方案） |

## M. 错误码映射（ERROR_CODES.md 对齐）

| 错误码 | 场景 | HTTP |
| --- | --- | --- |
| DELIVERY_NOT_FOUND | 交付单不存在 | 404 |
| DELIVERY_INVALID_STATE | 状态机不允许（ready/dispatch/confirm/cancel；含 POD 未确认） | 409 |
| DELIVERY_LINE_NOT_FOUND | 交付行不存在/不属于该单 | 404 |
| DELIVERY_QUANTITY_EXCEEDED | 超交（请求 > availableQty） | 409 |
| DELIVERY_SOURCE_LINE_INVALID | 交付行来源 SO Line 无效/已删/不属于该 SO | 400 |
| SALES_ORDER_NOT_DELIVERABLE | 来源 SO 状态不允许创建交付 | 409 |
| SALES_ORDER_NOT_FOUND | 来源 SO 不存在 | 404 |
| VERSION_CONFLICT | 乐观锁冲突 | 409 |
| VALIDATION_ERROR | Zod 校验失败 | 400 |
| FORBIDDEN / AUTHENTICATION_ERROR | RBAC / 未认证 | 403 / 401 |

> 合计：A(14) + B(8) + C(10) + D(13) + E(8) + F(19) + G(6) + H(8) + I(7) + J(5) + K(5) + L(8) + M(错误码映射) = **111 个测试用例**（不含错误码映射段）。
