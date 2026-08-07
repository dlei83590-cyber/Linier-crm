# Sprint 4C QA — Delivery Foundation（交付领域：Schema/Migration + Seed/RBAC + CRUD/Lines + Lifecycle Actions + SalesOrder Aggregation）

> Sprint：4C | 模块：Delivery Foundation（已通过代码门禁） | PR：#14（feature/sprint4-sales，待验收合并） | 日期：2026-08-07
> 状态：✅ 代码门禁通过（CI 全绿：Phase 1 #31174585598 / Phase 2 #31175832377 / Phase 3 #31179279069 / Phase 4 #31182288149）；文档收尾后交 CTO Review
> 关联：ADR-0018（Delivery Domain）、Sprint4C_Delivery_Design.md、EVENTS.md v1.5、openapi.yaml（Delivery 10 端点）、ERROR_CODES.md
> 架构原则（CTO Review 94/100 锁定）：
> ① Direct Delivery 禁止——salesOrderId NOT NULL，唯一入口 `POST /api/sales-orders/{id}/deliveries`，不开放 `POST /api/deliveries`；
> ② 超交禁止——availableQty = orderedQty - confirmedDeliveredQty - openDeliveryQty 动态计算（不新增 allocatedQty 列），超出 → 409 DELIVERY_QUANTITY_EXCEEDED（不做固定 +5%）；
> ③ DELIVERED = 客户确认收货（业务确认动作，非物流自动更新）；
> ④ POD = File Center 存文件 + Delivery 最小投影（podStatus PENDING/RECEIVED/WAIVED + podReceivedAt + podConfirmedById；不建 DeliveryPOD 表）；
> ⑤ SalesOrderLine.deliveredQty / remainingQty 投影仅 confirm-delivery 回写（系统维护，禁止手工 PATCH）；
> ⑥ READY 后行彻底冻结（不支持重新 ready，错误 → cancel → 新建）；COMPLETED 仅枚举不提供 /complete；
> ⑦ 并发安全：confirm-delivery 固定 12 步锁顺序（Delivery → SalesOrder → SalesOrderLine 按 id ASC），防多 Delivery 并发死锁；金额全程 Prisma.Decimal，Snapshot JSON 一律 toString() 禁止 toNumber()；
> ⑧ 不开发 Invoice / Payment；POD 文件走 File Center（businessType="delivery"、attachmentType="POD"）。

## 1. 交付范围

### 1.1 API（10 端点，均在 `apps/web/src/app/api/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 主档 | GET `/api/deliveries` | 列表（分页 + code/salesOrderId/customerId/status/dateFrom/dateTo 过滤；**无 POST**——Direct Delivery 禁止） |
| 主档 | POST `/api/sales-orders/{id}/deliveries` | **唯一创建入口**：事务内 FOR UPDATE 锁 SO → 校验 status ∈ {CONFIRMED, PARTIALLY_DELIVERED} → 原子取号 DO-000001 → 建头（DRAFT，customerId 继承）→ 显式 lines 逐行锁源行 + allocation 校验 → 写行 → Revision + CREATED 快照 |
| 主档 | GET `/api/deliveries/{id}` | 详情（含 lines/revisions/snapshots + customer/salesOrder 摘要） |
| 主档 | PATCH `/api/deliveries/{id}` | 头更新（仅 DRAFT，乐观锁 version，变更生成 DeliveryRevision） |
| 行 | GET `/api/deliveries/{id}/lines` | 行列表（含 item/uom/sourceSalesOrderLine 摘要；不开放 POST——行在创建时从 SO Line 选择） |
| 行 | PATCH `/api/deliveries/{id}/lines/{lineId}` | 行更新（仅 DRAFT；事务内锁源行 → confirmed/open/available 动态计算（排除自身行）→ 校验防超交 → 写行 → Revision；溯源永不清除） |
| Action | POST `/api/deliveries/{id}/ready` | DRAFT → READY（校验 ≥1 行 / quantity>0 / 源行有效 / 重新 allocation 校验排除自身 → READY 快照；行冻结） |
| Action | POST `/api/deliveries/{id}/dispatch` | READY → DISPATCHED（可更新 carrier/trackingNo/expectedArrivalDate → DISPATCHED 快照；不增加 deliveredQty） |
| Action | POST `/api/deliveries/{id}/confirm-delivery` | DISPATCHED → DELIVERED（POD 门禁 + 12 步事务 + SO Line 回写 + SO 聚合 + 事件） |
| Action | POST `/api/deliveries/{id}/cancel` | DRAFT/READY → CANCELLED（DISPATCHED+ 禁止；不回滚 deliveredQty；不写 SO 投影） |

### 1.2 RBAC（权限码，动作级，零新造）
delivery:view / delivery:create / delivery:edit（ready + dispatch 映射）/ delivery:approve（confirm-delivery 映射）/ delivery:close（cancel 映射）
delivery-line:view / delivery-line:edit
delivery-revision:view / delivery-snapshot:view
（seed 中 4 模块 × 10 动作自动生成，SEED_ACTION_MODULES 已注册）

### 1.3 Domain Events（EVENTS.md v1.5 注册 8 个，本阶段已发布 7 个）
已发布：DeliveryCreated / DeliveryUpdated / DeliveryReady / DeliveryDispatched / DeliveryConfirmed / DeliveryCancelled + SalesOrderPartiallyDelivered / SalesOrderDelivered（SO 聚合联动）
注册待后续：DeliveryCompleted（COMPLETED 仅枚举，不提供 /complete action，Sprint 4D 再评估）

## 2. 测试要点（CTO 锁定项覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 唯一创建入口 | `POST /api/deliveries` 不存在（404/405）；Delivery 只能经 `POST /api/sales-orders/{id}/deliveries` 创建 | 路由结构（无 POST）+ sales-orders/[id]/deliveries/route.ts |
| T2 | 创建前置校验 | 来源 SO 必须 status ∈ {CONFIRMED, PARTIALLY_DELIVERED}；DRAFT/CANCELLED/COMPLETED → 409 SALES_ORDER_NOT_DELIVERABLE | POST 创建路由 |
| T3 | 创建行选择 | 请求显式传 lines（sourceSalesOrderLineId + quantity）才建行；不传只建空头（不默认复制全部剩余行，适合分批发货） | deliveryCreateSchema + POST 路由 |
| T4 | 创建防超交 | 创建时行数量 > availableQty → 409 DELIVERY_QUANTITY_EXCEEDED（事务内锁源行 FOR UPDATE） | POST 创建路由 |
| T5 | 行更新排除自身 | PATCH 行改 quantity 时 openDeliveryQty 排除当前 lineId（避免旧 quantity 重复计入） | lines/[lineId]/route.ts + computeDeliveryAllocation(excludeDeliveryLineId) |
| T6 | ready 重新校验 | DRAFT 编辑期间其他 Delivery 抢占后，ready 时重新 allocation 校验（排除本单自身 excludeDeliveryId）→ 超量 409 | ready/route.ts + computeDeliveryAllocation(excludeDeliveryId) |
| T7 | READY 冻结 | READY 后 PATCH 头/行 → 409 DELIVERY_INVALID_STATE（仅 DRAFT 可编辑） | PATCH 路由 EDITABLE_STATUSES |
| T8 | dispatch 不增 deliveredQty | DISPATCHED 后 SalesOrderLine.deliveredQty 仍为 0（发运 ≠ 收货） | dispatch/route.ts（无投影写入） |
| T9 | POD 门禁 | confirm-delivery 时 podStatus=PENDING → 409；RECEIVED/WAIVED → 放行 | confirm-delivery/route.ts POD_ALLOWED_STATUSES |
| T10 | confirm 12 步事务 | 锁 Delivery → 锁 SalesOrder → 按 id ASC 锁全部源行 → 复查行 → 重新聚合 → DELIVERED + POD 投影 → DELIVERED 快照 → 回写 SO Line → 聚合 SO → 事件 | confirm-delivery/route.ts |
| T11 | SO 聚合规则 | 全部行 remainingQty<=0 → SO=DELIVERED + deliveredAt=now；否则有 confirmed → PARTIALLY_DELIVERED；不因 READY/DISPATCHED 提前标记 | lib/sales-order/delivery-aggregation.ts |
| T12 | cancel 限制与释放 | DRAFT/READY → CANCELLED；DISPATCHED/DELIVERED/COMPLETED → 409；取消后其他 Delivery allocation 动态释放（CANCELLED 不在 open 集合） | cancel/route.ts |
| T13 | Decimal 全程无 Float | 数量/聚合/快照全部 Prisma.Decimal；Snapshot JSON 金额/数量 toString() 落库，禁止 toNumber() | helpers.ts + 各路由 |
| T14 | 快照四件套 | READY/DISPATCHED/DELIVERED/CANCELLED 四种 DeliverySnapshot 按节点生成（@@unique([deliveryId, snapshotType])） | createDeliverySnapshot |
| T15 | 权限不足正确拒绝 | 无对应权限码调用 → 403 FORBIDDEN（delivery:view/create/edit/approve/close + delivery-line:view/edit 全覆盖） | 各路由 requirePermission |

## 3. 测试清单（按模块）

### 3.1 认证与权限
- [ ] A1 未认证访问 GET /api/deliveries → 401
- [ ] A2 无 delivery:view → GET /api/deliveries、GET /:id → 403
- [ ] A3 无 delivery:create → POST /api/sales-orders/{id}/deliveries → 403
- [ ] A4 无 delivery:edit → PATCH /:id、POST /:id/ready、POST /:id/dispatch → 403
- [ ] A5 无 delivery:approve → POST /:id/confirm-delivery → 403
- [ ] A6 无 delivery:close → POST /:id/cancel → 403
- [ ] A7 无 delivery-line:view → GET /:id/lines → 403
- [ ] A8 无 delivery-line:edit → PATCH /:id/lines/:lineId → 403
- [ ] A9 权限码覆盖 8 个（delivery*/delivery-line*/revision*/snapshot*）→ 无权限 403

### 3.2 Allocation（防超交）
- [ ] B1 正常创建 Delivery（SO=CONFIRMED，1 行 quantity=50/100）→ 201，DRAFT
- [ ] B2 第二张 Delivery 占用剩余数量（quantity=50/100）→ 201（availableQty 扣减）
- [ ] B3 超交 409：第三张 Delivery quantity=1/100 → 409 DELIVERY_QUANTITY_EXCEEDED
- [ ] B4 创建时行数量 = 剩余可用量边界 → 201（等于 availableQty 允许）
- [ ] B5 PATCH 行增大数量超出 → 409 DELIVERY_QUANTITY_EXCEEDED
- [ ] B6 PATCH 行减小数量 → 200（释放占用）
- [ ] B7 PATCH 行排除自身：100 改 120（剩余 50 可用）→ 409；100 改 60（自身 100 不计入 open）→ 200
- [ ] B8 ready 时重新校验：两 DRAFT Delivery 抢同一源行 → 后者 ready → 409
- [ ] B9 CANCEL 后 allocation 自动释放：取消 Delivery A → 新 Delivery 可用量恢复
- [ ] B10 源行软删后 PATCH 行数量 → 400 DELIVERY_SOURCE_LINE_INVALID

### 3.3 Lifecycle（状态机）
- [ ] C1 DRAFT → READY（≥1 行 + quantity>0）→ 200 + READY 快照
- [ ] C2 READY → DISPATCHED → 200 + DISPATCHED 快照（deliveredQty 不变）
- [ ] C3 DISPATCHED → DELIVERED（POD=RECEIVED）→ 200 + DELIVERED 快照
- [ ] C4 DISPATCHED → DELIVERED（POD=WAIVED）→ 200（豁免可确认）
- [ ] C5 DISPATCHED → DELIVERED（POD=PENDING）→ 409（POD 门禁）
- [ ] C6 DRAFT → READY → READY（重复 ready）→ 409 DELIVERY_INVALID_STATE
- [ ] C7 READY → DISPATCHED → DISPATCHED（重复 dispatch）→ 409
- [ ] C8 DELIVERED → confirm（重复确认）→ 409
- [ ] C9 DRAFT/READY → CANCELLED → 200 + CANCELLED 快照
- [ ] C10 DISPATCHED/DELIVERED → cancel → 409（禁止）
- [ ] C11 无行 Delivery ready → 409（至少 1 条有效行）

### 3.4 POD
- [ ] D1 confirm-delivery body 传 podStatus=RECEIVED → podReceivedAt/podConfirmedById 回填
- [ ] D2 confirm-delivery body 传 podStatus=WAIVED → podStatus=WAIVED（无签收投影）
- [ ] D3 confirm-delivery 不带 podStatus（Delivery 当前 PENDING）→ 409
- [ ] D4 POD 文件走 File Center（businessType=delivery，attachmentType=POD）→ 不建 DeliveryPOD 表

### 3.5 Aggregation（SalesOrder 回写）
- [ ] E1 第一张 Delivery confirm（部分数量）→ SO=PARTIALLY_DELIVERED（deliveredAt 为空）
- [ ] E2 全部行完成 → SO=DELIVERED + deliveredAt 回填
- [ ] E3 SalesOrderLine.deliveredQty = 所有 DELIVERED/COMPLETED DeliveryLine 合计（Decimal 精确）
- [ ] E4 SalesOrderLine.remainingQty = quantity - deliveredQty
- [ ] E5 多 Delivery 并发 confirm 同一 SO → 稳定锁顺序（id ASC）无死锁，最终聚合正确
- [ ] E6 READY/DISPATCHED 的 Delivery 不提前把 SO 标成 PARTIALLY_DELIVERED

### 3.6 Snapshot
- [ ] F1 CREATED 快照（创建时固化）
- [ ] F2 READY 快照（ready 时固化，行冻结内容）
- [ ] F3 DISPATCHED 快照（dispatch 时固化，含物流信息）
- [ ] F4 DELIVERED 快照（confirm 时固化，含 POD/行投影）
- [ ] F5 CANCELLED 快照（cancel 时固化）
- [ ] F6 快照 snapshotData 中数量/金额为字符串（toString，非 number）
- [ ] F7 每类型快照仅一个（@@unique([deliveryId, snapshotType])）

### 3.7 事件（AuditLog 留痕）
- [ ] G1 DeliveryCreated / DeliveryUpdated（Phase 3）
- [ ] G2 DeliveryReady / DeliveryDispatched / DeliveryConfirmed / DeliveryCancelled（Phase 4）
- [ ] G3 SalesOrderPartiallyDelivered / SalesOrderDelivered（confirm 聚合联动）
- [ ] G4 事件失败不阻断主流程（try/catch 降级）

### 3.8 并发与边界
- [ ] H1 同一 Delivery 并发 ready → 单胜出，另一 409（行锁）
- [ ] H2 同一 SO 并发创建 Delivery → FOR UPDATE 串行化
- [ ] H3 同一 SalesOrderLine 多 Delivery 并发 confirm → id ASC 锁序无死锁
- [ ] H4 version 乐观锁：旧 version PATCH → 409 VERSION_CONFLICT
- [ ] H5 软删除 Delivery/Line 过滤（deletedAt null）
- [ ] H6 数量 Decimal 精度（0.0001 步进不丢失）
- [ ] H7 无 Invoice/Payment 端点（本阶段禁止）
- [ ] H8 无 /complete 端点（COMPLETED 仅枚举）

## 4. EVENTS 实现差异说明（EVENTS.md v1.5 对齐）
- DeliveryCreated / DeliveryUpdated：Phase 3 已实现（创建/头/行变更发布）
- DeliveryReady / DeliveryDispatched / DeliveryConfirmed / DeliveryCancelled：Phase 4 ready/dispatch/confirm/cancel 发布
- SalesOrderPartiallyDelivered / SalesOrderDelivered：confirm-delivery 聚合后按 SO 状态发布（一次只发一个）
- DeliveryCompleted：注册未实现（COMPLETED 仅枚举，Sprint 4D 评估 /complete）

## 5. 已知风险与边界
- 事件总线未落地（Known Risk）：当前事件以 AuditLog 留痕，总线落地后替换为 publish（与 4A/4B 一致）
- POD 原始文件：File Center 元数据管理 + Delivery 最小投影，独立文件流待 File Center API 完善后联调
- 分批发货：创建时不自动复制全部剩余行，需前端显式选择行（符合现实场景，但依赖 UI 配合）
- 并发压测：真实行锁顺序（Delivery→SalesOrder→SalesOrderLine id ASC）已按 CTO 指示实现，高并发场景建议集成环境回归

## 6. 验收标准（对照 ACCEPTANCE_STANDARD.md）
- [x] Schema/Migration 通过远程 Prisma/Type/Build 门禁（CI #31174585598）
- [x] Seed + RBAC 幂等、零新造动作（CI #31175832377）
- [x] CRUD/Lines 6 端点 + allocation 动态校验（CI #31179279069）
- [x] Lifecycle 4 动作 + SO 聚合回写（CI #31182288149）
- [x] 红线全守：无 Direct Delivery / Over-delivery / DeliveryPOD 表 / Invoice / Payment / /complete
- [ ] CTO Final Review（文档收尾后提交）
