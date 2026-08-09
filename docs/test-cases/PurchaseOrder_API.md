# Purchase Order API 测试用例（Sprint 5A Purchase Order Foundation）

> 模块：Purchase Order（PO，采购承诺事实源）
> 关联：ADR-0023、Sprint5A_PurchaseRequisition_PO_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md、Migration 0021/0022
> 端点：`GET/POST /api/purchase-orders`、`GET/PATCH /api/purchase-orders/:id`、`POST /api/purchase-orders/:id/submit`、`POST /api/purchase-orders/:id/confirm`、`POST /api/purchase-orders/:id/cancel`；REQUISITION 唯一创建入口为 `POST /api/purchase-requisitions/:id/convert`
> CTO 红线：Direct/Requisition 来源必须显式且可追溯；价格双通道可审计；所有金额服务端 Decimal 计算与聚合；receivedQty/remainingReceiveQty 在 5A 只读预留；APPROVED ≠ CONFIRMED；只有 CONFIRMED（以及 5B 后续 PARTIALLY_RECEIVED）才可成为 Goods Receipt 合法来源；CONFIRMED 后不可直接 Cancel。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/purchase-orders | 401 AUTHENTICATION_ERROR |
| A2 | 无 `purchase-order:view` | GET /api/purchase-orders | 403 FORBIDDEN |
| A3 | 无 `purchase-order:view` | GET /api/purchase-orders/:id | 403 |
| A4 | 无 `purchase-order:create` | POST /api/purchase-orders | 403 |
| A5 | 无 `purchase-order:edit` | PATCH /api/purchase-orders/:id | 403 |
| A6 | 无 `purchase-order:edit` | POST /api/purchase-orders/:id/submit | 403 |
| A7 | 无 `purchase-order:approve` | POST /api/purchase-orders/:id/confirm | 403 |
| A8 | 无 `purchase-order:close` | POST /api/purchase-orders/:id/cancel | 403 |
| A9 | 权限隔离 | view 用户尝试 create/edit/submit/confirm/cancel | 均按动作权限拒绝 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 分页 | GET ?page=1&pageSize=20 | 200 + meta |
| B2 | code 模糊过滤 | GET ?code=PO-2026 | 200 |
| B3 | supplierId | GET ?supplierId=:id | 仅该供应商 |
| B4 | status | GET ?status=CONFIRMED | 仅 CONFIRMED |
| B5 | sourceType | GET ?sourceType=DIRECT / REQUISITION | 正确过滤 |
| B6 | orderDate 区间 | GET ?dateFrom=...&dateTo=... | 按 orderDate 过滤 |
| B7 | 排序 | GET | createdAt desc |
| B8 | 软删除 | GET | deletedAt 非空不返回 |
| B9 | 列表摘要 | GET | supplier/requisition 摘要 + lines count |
| B10 | 详情 | GET /:id | supplier/requisition/workflowInstance/lines(Item/UOM/source PR Line)/latest revision/latest snapshots |
| B11 | 详情不存在 | GET /:id invalid | 404 PURCHASE_ORDER_NOT_FOUND |

## C. Direct Purchase 创建（POST /api/purchase-orders）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常 Direct | supplier + lines | 200；DRAFT；sourceType=DIRECT；requisitionId=null |
| C2 | purchaserId | 指定采购员 | Header.purchaserId 正确 |
| C3 | departmentId | 指定采购部门 | Header.departmentId 正确 |
| C4 | Supplier 无效 | supplierId 不存在/软删 | 400 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| C5 | Item 无效 | 任一 itemId 无效 | 400 PURCHASE_ORDER_ITEM_NOT_FOUND |
| C6 | UOM 无效 | 任一 uomId 无效 | 400 PURCHASE_ORDER_UOM_NOT_FOUND |
| C7 | quantity<=0 | 0/-1 | 400 PURCHASE_ORDER_QUANTITY_INVALID / VALIDATION_ERROR |
| C8 | Direct 来源字段禁止 | line 传 sourcePurchaseRequisitionLineId | 400 PURCHASE_ORDER_SOURCE_LINE_FORBIDDEN |
| C9 | 自动取号 | 连续创建 | PO code 唯一、DocumentSequence 原子递增 |
| C10 | received 初始化 | 创建成功 | receivedQty=0；remainingReceiveQty=quantity |
| C11 | 5A 禁写 received | body 注入 receivedQty/remainingReceiveQty | 不得覆盖服务端初始化值 |

## D. 价格双通道与金额事实

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| D1 | Supplier Price Snapshot | priceSource=SUPPLIER_PRICE_SNAPSHOT | 服务端从供应商 PartnerPrice 解析 unitPrice/taxRate/sourcePartnerPriceId |
| D2 | Snapshot 无价格 | 无有效价格 | 409 PURCHASE_ORDER_PRICE_NOT_FOUND |
| D3 | Manual 正常 | priceSource=MANUAL + unitPrice + priceReason | 成功；priceSetById=actor；priceSetAt 非空；sourcePartnerPriceId=null |
| D4 | Manual 缺价格 | MANUAL 无 unitPrice | 400 VALIDATION_ERROR |
| D5 | Manual 缺原因 | MANUAL 无 priceReason | 400 VALIDATION_ERROR |
| D6 | 税率快照 | 两通道 | taxRate 固化到 PO Line，后续价表变化不改历史行 |
| D7 | 行金额服务端算 | quantity × unitPrice + tax | lineAmount/taxAmount/totalAmount 与 Decimal 算法一致 |
| D8 | Header 金额聚合 | 多行 | subtotal/taxAmount/totalAmount 为活动行服务端求和 |
| D9 | 禁客户端 Header total | body 注入 subtotal/taxAmount/totalAmount | 不得形成客户端事实 |
| D10 | Decimal 精度 | 小数数量/单价/税率 | 不出现 Float 漂移 |
| D11 | Revision 来源 | Direct 创建 | Revision 使用实际落库行（含真实 snapshot price），非请求 body 占位 |
| D12 | CREATED Snapshot | Direct 创建 | Decimal 金额以字符串写 snapshot JSON |
| D13 | Created Event 金额 | 创建 | PurchaseOrderCreated.totalAmount 为真实落库金额字符串，非 placeholder |

## E. REQUISITION 来源约束（经 PR Convert 创建）

| # | 用例 | 检查 | 预期 |
| --- | --- | --- | --- |
| E1 | Header 来源 | PR Convert | sourceType=REQUISITION + requisitionId 非空 |
| E2 | Line 必带来源 | REQUISITION PO Line | sourcePurchaseRequisitionLineId 非空 |
| E3 | 来源归属正确 | source line | 必须属于 Header.requisitionId |
| E4 | Item 一致 | PATCH REQUISITION PO line 用来源 PR Line 但替换 itemId | 409 PURCHASE_ORDER_SOURCE_LINE_INVALID |
| E5 | 来源不能猜 lineNo | 改 lineNo | 溯源仍以 sourcePurchaseRequisitionLineId 为准 |
| E6 | Direct 来源为空 | Direct PO | Header.requisitionId=null；所有 Line sourcePurchaseRequisitionLineId=null |
| E7 | REQUISITION PATCH 缺 source | 全量替换行时漏 sourcePurchaseRequisitionLineId | 400 PURCHASE_ORDER_SOURCE_LINE_REQUIRED |
| E8 | 跨 PR source | 使用其他 PR Line id | 409 PURCHASE_ORDER_SOURCE_LINE_INVALID |

## F. DRAFT 更新与 Revision（PATCH /api/purchase-orders/:id）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| F1 | Header 可编辑字段 | purchaserId/departmentId/paymentTerm/expectedDeliveryDate/remark + version | 200 version+1 |
| F2 | 行全量替换 | lines + version | 旧活动行软删，新行创建，Header 金额重算 |
| F3 | 非 DRAFT | SUBMITTED/APPROVED/CONFIRMED/PARTIALLY_RECEIVED/RECEIVED/CANCELLED | 409 PURCHASE_ORDER_INVALID_STATE |
| F4 | version 冲突 | 旧 version | 409 VERSION_CONFLICT |
| F5 | CAS 并发 | 两个同 version PATCH | 最多一个成功，另一个 409，无 lost update |
| F6 | 修改必留 Revision | PATCH 成功 | Revision 保存变更前 Header + Lines |
| F7 | 同事务 | Revision 后行重建失败 | Revision/Header/Lines/金额全部回滚 |
| F8 | Supplier 不可改 | body 注入 supplierId | supplierId 不变 |
| F9 | currency 不可改 | body 注入 currency | currency 不变 |
| F10 | sourceType 不可改 | body 注入 sourceType | 不得 DIRECT↔REQUISITION 转换 |
| F11 | requisitionId 不可改 | body 注入 requisitionId | 不变 |
| F12 | received 禁写 | body 注入 receivedQty/remainingReceiveQty | 不得落库 |
| F13 | Snapshot 通道 PATCH | SUPPLIER_PRICE_SNAPSHOT | 重新按当前有效供应商价格解析并记录新的 PO DRAFT 事实 |
| F14 | Manual PATCH | MANUAL + priceReason | price audit 字段完整 |
| F15 | Item/UOM 无效 | 替换行无效引用 | 400 相应 error code |
| F16 | quantity<=0 | 替换行非法数量 | 400 PURCHASE_ORDER_QUANTITY_INVALID |
| F17 | 事件 | PATCH 成功 | PurchaseOrderUpdated |
| F18 | 审计 | PATCH 成功 | AuditLog 记录 fields/linesReplaced/version |

## G. Submit：DRAFT → SUBMITTED / APPROVED（POST /api/purchase-orders/:id/submit）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| G1 | 正常 Submit 命中审批策略 | DRAFT + valid lines/supplier/amount | 200；SUBMITTED；approvalStatus=PENDING；WorkflowInstance RUNNING |
| G2 | 无审批策略 | no-policy | Submit 后直接形成 APPROVED + approvalStatus=APPROVED，但绝不 CONFIRMED |
| G3 | 无规则命中 | no-rule-matched | 与 G2 相同：APPROVED，仍需显式 confirm |
| G4 | 非 DRAFT | SUBMITTED/APPROVED/... | 409 PURCHASE_ORDER_INVALID_STATE |
| G5 | 无行 | DRAFT 空行 | 409 PURCHASE_ORDER_NO_LINES |
| G6 | quantity<=0 | 非法历史数据 | 400 PURCHASE_ORDER_QUANTITY_INVALID |
| G7 | Supplier 失效 | isActive=false | 409 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| G8 | REQUISITION 缺 requisitionId | 数据异常 | 409 来源不一致 |
| G9 | DIRECT 却有 requisitionId | 数据异常 | 409 来源不一致 |
| G10 | 金额不一致 | Header 与 Lines 聚合被人为制造不一致 | 409，禁止 Submit |
| G11 | FOR UPDATE | 同 PO 并发 Submit | 行锁串行化；最多一个按 DRAFT 路径成功 |
| G12 | Workflow 定义失效 | policy/rule 命中但 definition 不存在/未 ACTIVE | 409 PURCHASE_ORDER_WORKFLOW_FAILED |
| G13 | 多轮重提 | Workflow 终态后业务回到可重提 DRAFT | 复用同一 WorkflowInstance；旧 Approver 失效，新轮 PENDING |
| G14 | 重提清审批投影 | 新轮 Submit | approvalStatus=PENDING，清旧 approvedAt/approvedById |
| G15 | Submit 事件 | 成功 | PurchaseOrderSubmitted |
| G16 | ApprovalStarted | 命中审批策略 | PurchaseOrderApprovalStarted（由 workflow sync 逻辑） |
| G17 | Submit≠Confirm | 任意 Submit 成功 | confirmedAt/confirmedById 仍为空，status 不得直接 CONFIRMED |

## H. Workflow 审批投影

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| H1 | 审批通过 | Workflow 最终 APPROVE | PO.status=APPROVED；approvalStatus=APPROVED；approvedAt/approvedById 正确 |
| H2 | 审批驳回 | REJECT | 不得 CONFIRMED；可按统一 workflow sync 回到重提路径 |
| H3 | 审批中 | Workflow RUNNING | status=SUBMITTED；禁止 Confirm |
| H4 | 多步骤 | 最终步骤前 | 不提前投影 APPROVED |
| H5 | 审批仅决定批准 | APPROVED 时 | 不产生 confirmedAt，不代表已正式向供应商下单 |

## I. Confirm：APPROVED → CONFIRMED（POST /api/purchase-orders/:id/confirm）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| I1 | 正常 Confirm | status=APPROVED + approvalStatus=APPROVED | 200；status=CONFIRMED；confirmedAt/confirmedById 写入 |
| I2 | DRAFT Confirm | 未 Submit | 409 PURCHASE_ORDER_INVALID_STATE |
| I3 | SUBMITTED Confirm | 审批中 | 409 PURCHASE_ORDER_INVALID_STATE |
| I4 | APPROVED 但 approvalStatus 非 APPROVED | 投影异常/审批未完成 | 409 PURCHASE_ORDER_APPROVAL_REQUIRED |
| I5 | 已 CONFIRMED 再 Confirm | 重复调用 | 409 PURCHASE_ORDER_INVALID_STATE，不生成第二次商业确认 |
| I6 | Supplier 失效 | Confirm 前失效 | 409 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| I7 | 无行 | 异常 PO | 409 PURCHASE_ORDER_NO_LINES |
| I8 | 非法数量 | 异常历史行 | 409 PURCHASE_ORDER_QUANTITY_INVALID |
| I9 | 金额不一致 | Header 与 Lines 聚合不同 | 409，禁止正式下单 |
| I10 | FOR UPDATE 并发 Confirm | 两个 Confirm 同时到达 | 行锁串行化；仅首个成功，后一个因状态已 CONFIRMED 返回 409 |
| I11 | 幂等业务结果 | 网络超时重试 Confirm | 不重复推进状态、不重复形成第二个 CONFIRMED 业务动作 |
| I12 | confirmed Snapshot | 成功 | 生成 CONFIRMED Snapshot，含 lines/金额/actor/time |
| I13 | Snapshot Decimal | 成功 | quantity/unitPrice/taxRate/amount 均为字符串 |
| I14 | Confirm Revision | 成功 | Revision 记录 APPROVED→CONFIRMED 商业动作 |
| I15 | Confirm Event | 成功 | PurchaseOrderConfirmed |
| I16 | Confirm Audit | 成功 | action=`purchase-order.confirm`，记录 status/confirmedAt/totalAmount |
| I17 | APPROVED≠CONFIRMED | Confirm 前后 | Confirm 前不得被 5B GR 接受；Confirm 后才满足来源状态门禁 |

## J. 多轮 Snapshot / Revision

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| J1 | CREATED | Direct/Convert 创建 | 生成 CREATED Snapshot |
| J2 | 多 Revision | DRAFT 多次 PATCH | RevisionNo 递增，每轮保存变更前事实 |
| J3 | Confirm | APPROVED→CONFIRMED | 生成 CONFIRMED Snapshot + Revision |
| J4 | Cancel | DRAFT/APPROVED→CANCELLED | 生成 CANCELLED Snapshot + Revision |
| J5 | Migration 0022 约束 | 同 snapshotType 在不同 revisionNo 场景 | 唯一性按 `[purchaseOrderId, snapshotType, revisionNo]`，不再错误限制为一生只能一条同类型 |
| J6 | Snapshot 不可当实时表改 | 后续 Header 变化 | 历史 JSON 不回写 |
| J7 | 详情读取 | GET /:id | 返回最近 5 个 snapshots，generatedAt desc |

## K. Cancel（POST /api/purchase-orders/:id/cancel）

| # | 用例 | 状态 | 预期 |
| --- | --- | --- | --- |
| K1 | DRAFT Cancel | DRAFT | 200 → CANCELLED |
| K2 | APPROVED Cancel | APPROVED 且尚未 Confirm | 200 → CANCELLED |
| K3 | SUBMITTED Cancel | SUBMITTED | 409 PURCHASE_ORDER_INVALID_STATE；必须先 Withdraw→DRAFT 再 Cancel |
| K4 | CONFIRMED Cancel | CONFIRMED | 409 PURCHASE_ORDER_CANCEL_FORBIDDEN |
| K5 | PARTIALLY_RECEIVED Cancel | PARTIALLY_RECEIVED | 409 PURCHASE_ORDER_CANCEL_FORBIDDEN |
| K6 | RECEIVED Cancel | RECEIVED | 409 PURCHASE_ORDER_CANCEL_FORBIDDEN |
| K7 | 重复 Cancel | CANCELLED | 409 PURCHASE_ORDER_INVALID_STATE |
| K8 | 并发 Cancel | 两请求同时 Cancel DRAFT/APPROVED | FOR UPDATE 串行；仅一个成功 |
| K9 | CANCELLED Snapshot | 成功 | 金额/来源/actor/time 留痕 |
| K10 | Cancel Revision | 成功 | 记录取消前状态与金额 |
| K11 | Cancel Event | 成功 | PurchaseOrderCancelled |
| K12 | Cancel Audit | 成功 | action=`purchase-order.cancel` |

## L. 5B Goods Receipt 前置 Gate（5A 只定义、不实现 GR Schema/API）

| # | 用例 | PO 状态 | 5B 预期 |
| --- | --- | --- | --- |
| L1 | DRAFT | DRAFT | 禁止创建 GR |
| L2 | SUBMITTED | SUBMITTED | 禁止创建 GR |
| L3 | APPROVED | APPROVED | **禁止创建 GR：APPROVED ≠ CONFIRMED** |
| L4 | CONFIRMED | CONFIRMED | 允许成为 GR 合法来源 |
| L5 | PARTIALLY_RECEIVED | PARTIALLY_RECEIVED | 允许继续收剩余数量 |
| L6 | RECEIVED | RECEIVED | 不得再收货（remaining=0） |
| L7 | CANCELLED | CANCELLED | 禁止 GR |
| L8 | receivedQty 写方 | 任意 5A API | 5A API 不得修改；5B Goods Receipt 为唯一回写方 |
| L9 | remainingReceiveQty ceiling | 5B 设计验收 | GR 累计数量不得超过 PO Line.quantity |

## M. Direct + Requisition 全链路验收

| # | 场景 | 验收标准 |
| --- | --- | --- |
| M1 | Direct Purchase | 直接创建 DRAFT PO；来源显式 DIRECT；无 PR 伪造；仍必须 Submit/Approval/Confirm |
| M2 | PR Convert | 只有 APPROVED PR 可转；PO sourceType=REQUISITION；行级 sourcePurchaseRequisitionLineId 全链可追 |
| M3 | 两路径审批一致 | Direct 与 Requisition PO | 都不能绕过 PO Approval Gate |
| M4 | 两路径 Confirm 一致 | APPROVED PO | 都必须显式 Confirm 才形成外部采购承诺 |
| M5 | 两路径价格可审计 | Snapshot/Manual | 能回答“价格从哪里来、谁人工改、为什么改” |
| M6 | 两路径金额可信 | 所有 PO | Header 金额只能来自服务端 Lines Decimal 聚合 |

## N. 并发 / 事务 / 一致性

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| N1 | PATCH CAS | 同 version 双 PATCH | 单胜出，另一 409 |
| N2 | Submit 并发 | DRAFT 双 Submit | FOR UPDATE 串行，最多一次有效状态推进 |
| N3 | Confirm 并发 | APPROVED 双 Confirm | FOR UPDATE 串行，最多一次 CONFIRMED |
| N4 | Cancel 并发 | DRAFT 双 Cancel | FOR UPDATE 串行，最多一次 CANCELLED |
| N5 | Submit vs Cancel | DRAFT 同时 Submit/Cancel | 行锁决定唯一顺序；最终状态必须符合状态机，不出现 SUBMITTED+CANCELLED 双事实 |
| N6 | Confirm vs Cancel | APPROVED 同时 Confirm/Cancel | 串行后只能 CONFIRMED 或 CANCELLED 之一；若 Confirm 先成功，Cancel 必须被禁止 |
| N7 | 事务失败 | Confirm Snapshot/Revision 生成阶段异常 | status/confirmedAt/Snapshot/Revision 同事务回滚 |
| N8 | 事件降级 | Event 发布失败 | 已提交数据库业务事务不回滚；有 Audit 可追踪 |

## O. 状态机总验收

```text
DRAFT
  ├─ submit + workflow → SUBMITTED → APPROVED → confirm → CONFIRMED
  ├─ submit no-policy/no-rule → APPROVED → confirm → CONFIRMED
  └─ cancel → CANCELLED

SUBMITTED
  └─ 不能直接 cancel；先走 Workflow Withdraw → DRAFT，再 cancel

APPROVED
  ├─ confirm → CONFIRMED
  └─ cancel → CANCELLED

CONFIRMED
  └─ Sprint 5B: PARTIALLY_RECEIVED → RECEIVED
```

必须验证：

1. 不存在 SUBMITTED→CONFIRMED 直跳；
2. 不存在 APPROVED 自动当作已正式下单；
3. 不存在 CONFIRMED→CANCELLED 直取消；
4. 5A 任意 API 不得把 status 写成 PARTIALLY_RECEIVED/RECEIVED；
5. 5A 任意 API 不得写 receivedQty/remainingReceiveQty。

## P. Real Business Acceptance（Sprint 5A PO Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| P1 | 常规计划采购 | PR 审批→Convert→PO 审批→Confirm，全链可追 |
| P2 | 临时直采 | Direct PO 不制造虚假 PR，但保留同等审批/确认纪律 |
| P3 | 供应商协议价 | PO 自动取 Supplier Price Snapshot，可追源到 PartnerPrice |
| P4 | 临时报价/议价 | Manual Price 必须有原因、操作者、时间 |
| P5 | 审批通过但尚未下单 | PO=APPROVED，不允许仓库收货 |
| P6 | 正式发单 | 显式 Confirm 后 PO=CONFIRMED，作为 5B 唯一合法采购来源 |
| P7 | 下单前取消 | DRAFT/APPROVED 可 Cancel |
| P8 | 已下单取消需求 | CONFIRMED 禁止直接 Cancel，未来走采购变更/取消/供应商沟通流程 |

## Q. Release Gate

Sprint 5A PO API 进入 CTO Final Review 前必须满足：

1. A-P 全部核验，无 Blocking；
2. Direct/Requisition 两条路径均通过来源一致性与行级溯源测试；
3. Supplier Snapshot + Manual 两价格通道及审计字段通过；
4. Header/Line 金额 Decimal 服务端重算测试通过，客户端金额注入无效；
5. DRAFT PATCH 原子 CAS 并发测试通过；
6. Submit/Confirm/Cancel FOR UPDATE 并发互斥通过；
7. **APPROVED ≠ CONFIRMED** 状态机测试必须独立标为 Release Blocking；
8. Confirm 多轮 Snapshot/Revision 与 Migration 0022 唯一约束核验通过；
9. 5A 无任何 API 可写 receivedQty/remainingReceiveQty；
10. 5B Gate 明确只允许 CONFIRMED/PARTIALLY_RECEIVED 作为收货来源；
11. CI Quality Gates 全绿后进入 OpenAPI + ADR/ROADMAP/CHANGELOG/Release Notes Final Docs。