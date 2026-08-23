# Purchase Requisition API 测试用例（Sprint 5A Purchase Requisition Foundation）

> 模块：Purchase Requisition（PR，采购需求事实源）
> 关联：ADR-0023、Sprint5A_PurchaseRequisition_PO_Design.md、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md
> 端点：`GET/POST /api/purchase-requisitions`、`GET/PATCH /api/purchase-requisitions/:id`、`POST /api/purchase-requisitions/:id/submit`、`POST /api/purchase-requisitions/:id/convert`
> CTO 红线：PR 无金额事实；仅 DRAFT 可编辑；修改必留 Revision；Submit（移除审核 auto-approve：DRAFT→APPROVED 提交即生效）不创建 PO；必须显式 Convert 才创建 PO（门禁 status=APPROVED）；Convert 必须保留 PR Line → PO Line 溯源；同一 PR 并发/重复 Convert 只能成功一次。

## A. 认证与权限（Permission）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问列表 | GET /api/purchase-requisitions | 401 AUTHENTICATION_ERROR |
| A2 | 无 `purchase-requisition:view` | GET /api/purchase-requisitions | 403 FORBIDDEN |
| A3 | 无 `purchase-requisition:view` | GET /api/purchase-requisitions/:id | 403 |
| A4 | 无 `purchase-requisition:create` | POST /api/purchase-requisitions | 403 |
| A5 | 无 `purchase-requisition:edit` | PATCH /api/purchase-requisitions/:id | 403 |
| A6 | 无 `purchase-requisition:edit` | POST /api/purchase-requisitions/:id/submit | 403 |
| A7 | 无 `purchase-requisition:approve` | POST /api/purchase-requisitions/:id/convert | 403 |
| A8 | 权限隔离 | view 用户尝试 create/edit/submit/convert | 均按各自权限返回 403，不因已持有 view 放行 |

## B. 列表与详情

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 列表分页 | GET ?page=1&pageSize=20 | 200，返回分页 meta |
| B2 | code 模糊过滤 | GET ?code=PR-2026 | 200，仅返回 code 包含条件的数据 |
| B3 | status 过滤 | GET ?status=DRAFT | 200，仅 DRAFT |
| B4 | requesterId 过滤 | GET ?requesterId=:userId | 200，仅对应申请人 |
| B5 | departmentId 过滤 | GET ?departmentId=:departmentId | 200，仅对应部门 |
| B6 | dateFrom/dateTo | GET ?dateFrom=...&dateTo=... | 200，按 createdAt 区间过滤 |
| B7 | 排序 | GET 列表 | createdAt desc |
| B8 | 软删除隔离 | GET 列表 | deletedAt 非空 PR 不返回 |
| B9 | 列表摘要 | GET 列表 | 含 requester、department、lines count |
| B10 | 详情 | GET /:id | 200，含 requester/department/workflowInstance/lines(Item/UOM)/latest revision |
| B11 | 详情行排序 | GET /:id | lines 按 lineNo asc |
| B12 | 详情不存在 | GET /:id（无效 id） | 404 PURCHASE_REQUISITION_NOT_FOUND |

## C. 创建 PR（POST /api/purchase-requisitions）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| C1 | 正常创建 | Header + 1 行有效 Item | 200；status=DRAFT；返回 id/code |
| C2 | 多行创建 | lines ≥ 2 | 单事务成功，所有行归属同一 PR |
| C3 | 默认 requester | 不传 requesterId | requesterId=当前登录用户 |
| C4 | 指定 requester | 传合法 requesterId | 按请求落库（权限边界由当前实现负责） |
| C5 | department 可空 | departmentId 不传 | 创建成功，departmentId=null |
| C6 | needDate/remark | 传 Header/Line needDate、remark | 正确落库 |
| C7 | 自动 lineNo | 行不传 lineNo | 10/20/30... 递增 |
| C8 | 原子取号 | 连续创建两张 PR | code 唯一且按 DocumentSequence 原子递增（格式 PR-2026-xxxx） |
| C9 | 无效 Item | 任一 line.itemId 不存在/软删 | 400 PURCHASE_REQUISITION_ITEM_NOT_FOUND |
| C10 | 无效 UOM | 任一 uomId 不存在/软删 | 400 PURCHASE_REQUISITION_UOM_NOT_FOUND |
| C11 | quantity=0 | line.quantity=0 | 400（schema/业务校验），不得产生 Header/Line 残留 |
| C12 | quantity<0 | line.quantity<0 | 400，事务回滚 |
| C13 | Decimal 数量 | quantity=0.125 | 成功，Decimal 精确保存，不走 Float 计算 |
| C14 | 空 lines | lines=[] | 400 VALIDATION_ERROR（创建 schema 至少一行） |
| C15 | 金额字段注入 | Header/Line 试传 unitPrice/subtotal/taxAmount/totalAmount | 不得形成 PR 金额事实；若 schema strip 则字段不落库，若 strict 则 400；验收以“数据库无金额事实”为准 |
| C16 | 创建失败回滚取号/数据 | 制造事务内数量错误 | Header/Lines 不产生半成品数据 |
| C17 | 事件 | 创建成功 | 发布 PurchaseRequisitionCreated（事件失败不阻断业务成功） |
| C18 | 审计 | 创建成功 | AuditLog action=`purchase-requisition.create` |

## D. DRAFT 更新与 Revision（PATCH /api/purchase-requisitions/:id）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| D1 | 更新 Header | {needDate, remark, version} | 200，version+1 |
| D2 | 行全量替换 | {lines:[...], version} | 旧活动行软删，新行创建 |
| D3 | 仅 DRAFT 可编辑 | SUBMITTED/APPROVED/CONVERTED/CANCELLED | 409 PURCHASE_REQUISITION_INVALID_STATE |
| D4 | version 冲突 | 传旧 version | 409 VERSION_CONFLICT |
| D5 | 数据库级 CAS | 两请求持同 version 并发 PATCH | 最多一个成功；另一个 409，不发生 lost update |
| D6 | 修改必留 Revision | 任一 PATCH 成功 | 新建 PurchaseRequisitionRevision，保存“变更前” Header + Lines |
| D7 | Revision 与更新同事务 | 在行重建阶段制造失败 | Revision/Header/Lines 全部回滚，不留孤立 Revision |
| D8 | 行无效 Item | 替换行包含无效 Item | 400 PURCHASE_REQUISITION_ITEM_NOT_FOUND |
| D9 | 行无效 UOM | 替换行包含无效 UOM | 400 PURCHASE_REQUISITION_UOM_NOT_FOUND |
| D10 | 行 quantity<=0 | 替换行 quantity=0/-1 | 400 PURCHASE_REQUISITION_QUANTITY_INVALID 或 VALIDATION_ERROR |
| D11 | 禁止改 code | body 注入 code | code 不得改变 |
| D12 | 禁止改 status | body 注入 status | status 不得由 PATCH 改变 |
| D13 | 禁止改 requesterId | body 注入 requesterId | requesterId 不得由 PATCH 改变 |
| D14 | 禁止改 departmentId | body 注入 departmentId | departmentId 不得由 PATCH 改变（当前实现只更新 needDate/remark） |
| D15 | 金额字段注入 | body 注入 unitPrice/amount/tax | 不得落库/不得产生金额事实 |
| D16 | 事件 | PATCH 成功 | 发布 PurchaseRequisitionUpdated，含 changeReason |
| D17 | 审计 | PATCH 成功 | AuditLog 记录 fields/linesReplaced/version |

## E. Submit：DRAFT → APPROVED（auto-approve：移除审核，提交即生效——POST /api/purchase-requisitions/:id/submit）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| E1 | 正常提交 | DRAFT + 有行 | 200；status=APPROVED + approvalStatus=APPROVED + approvedAt/approvedById=提交人；workflowSkipped='no-policy' |
| E2 | 非 DRAFT 提交 | SUBMITTED/APPROVED/CONVERTED/CANCELLED | 409 PURCHASE_REQUISITION_INVALID_STATE |
| E3 | 无行提交 | DRAFT 但活动行=0 | 409 PURCHASE_REQUISITION_NO_LINES |
| E4 | 无审批策略不再阻断 | module=PURCHASE_REQUISITION 未配置 | 200（auto-approve；不再报 PURCHASE_REQUISITION_APPROVAL_POLICY_NOT_FOUND） |
| E5 | 不创建 WorkflowInstance | Submit 后查询 WorkflowInstance | 无 purchase-requisition 实例创建（workflowSkipped='no-policy'） |
| E11 | PR 无 Snapshot | Submit 前后 | 不创建 PR Snapshot；PR 仅 Revision 模型 |
| E12 | Submit 不创建 PO | Submit 成功后查询 PurchaseOrder | 不出现由 Submit 自动创建的 PO（Convert 门禁 status=APPROVED 已满足，显式 convert 才建 PO） |
| E13 | Submit 事件 | 成功 | PurchaseRequisitionSubmitted（workflowInstanceId=null） |
| E14 | Submit 审计 | 成功 | action=`purchase-requisition.submit`；afterData.status=APPROVED |

## F. Workflow 审批投影（通过通用 Workflow Action API 验收）

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| F1 | 审批通过 | 对 PR WorkflowInstance 执行 APPROVE 至完成 | PR.status=APPROVED；approvalStatus=APPROVED；批准人/时间投影正确 |
| F2 | 审批驳回 | 执行 REJECT | PR 进入项目定义的驳回投影，可回到 DRAFT 后重提；不得自动创建 PO |
| F3 | 多步审批 | 多 Step Definition | 只有最终完成才形成 PR APPROVED 投影 |
| F4 | 非当前 Approver | 非授权用户 APPROVE/REJECT | 403/409（按 Workflow API 统一规则），PR 不变化 |
| F5 | 审批事实独立 | approvalStatus 变化 | PR 数量、Item、需求事实不被 Workflow 修改 |

## G. PR → PO Convert（POST /api/purchase-requisitions/:id/convert）

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| G1 | 正常转换 | PR=APPROVED + supplierId + 可解析价格 | 200；创建 DRAFT PO；sourceType=REQUISITION；requisitionId=PR.id |
| G2 | 非 APPROVED | DRAFT/SUBMITTED/CANCELLED | 409 PURCHASE_ORDER_REQUISITION_NOT_APPROVED |
| G3 | 已 CONVERTED | 重复 Convert | 409 PURCHASE_ORDER_REQUISITION_ALREADY_CONVERTED |
| G4 | 已存在关联 PO | PR 状态异常但已有 active PO | 409，禁止第二张由同 PR 完整重复转换 |
| G5 | PR 无行 | APPROVED 但活动行=0 | 409 PURCHASE_ORDER_NO_LINES |
| G6 | Supplier 不存在 | supplierId 无效/软删 | 400 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| G7 | purchaserId 落地 | convert body 指定 purchaserId | PO Header.purchaserId 正确 |
| G8 | departmentId 落地 | convert body 指定 departmentId | PO Header.departmentId 正确；不指定时按实现默认/空值验收 |
| G9 | Header 来源 | Convert 成功 | sourceType=REQUISITION；requisitionId 非空 |
| G10 | Line 溯源 | Convert 成功 | 每一 PO Line.sourcePurchaseRequisitionLineId 指向对应 PR Line |
| G11 | PR 数量事实不变 | Convert 前后 | PR Line.quantity 不被 PO 创建修改 |
| G12 | received 投影初始化 | Convert 成功 | PO Line.receivedQty=0；remainingReceiveQty=quantity |
| G13 | Supplier Price Snapshot | 默认/指定 SUPPLIER_PRICE_SNAPSHOT | 从 PartnerPrice 服务端解析 unitPrice/taxRate/sourcePartnerPriceId |
| G14 | 找不到 Supplier Price | Snapshot 模式无价格 | 409 PURCHASE_ORDER_PRICE_NOT_FOUND |
| G15 | PR Line 缺 Item + Snapshot | itemId 缺失 | 400 PURCHASE_ORDER_ITEM_NOT_FOUND；提示改 MANUAL |
| G16 | MANUAL 价格 | override 指定 MANUAL + unitPrice + priceReason | 成功；priceSetById=actor；priceSetAt 非空 |
| G17 | 税率快照 | 两价格通道 | taxRate 固化进 PO Line，不依赖后续 PartnerPrice 变化 |
| G18 | 服务端金额 | Convert 成功 | lineAmount/taxAmount/totalAmount 由 Decimal 计算；Header 服务端聚合 |
| G19 | Created Revision | Convert 成功 | PO Revision 记录真实落库行金额，Decimal JSON 为字符串 |
| G20 | CREATED Snapshot | Convert 成功 | PO Snapshot(type=CREATED) 包含 sourceType/requisitionId/金额字符串 |
| G21 | PR 回写 | Convert 成功 | PR.status=CONVERTED；仅状态投影变化 |
| G22 | 双事件 | Convert 成功 | PurchaseOrderCreated + PurchaseRequisitionConverted |
| G23 | 审计 | Convert 成功 | PR convert AuditLog 含 purchaseOrderId/code |
| G24 | MANUAL 逃生路径 | Snapshot 无价 + 前端已解析建议 | 对话框行强制 MANUAL，录入 unitPrice+priceReason 后转单成功（priceSetById=actor） |
| G25 | 无 itemId 行 | PR 行缺 Item | 建议端点 snapshot=null；转单 MANUAL 通道仍可成功 |

## G.6 价格通道建议（GET /api/purchase-requisitions/:id/price-suggestions?supplierId=）

> 服务端权威解析（与 convert/PO PATCH 同语义，复用 `resolveSupplierPriceSnapshot`）：`partnerId + itemId + priceSource=SUPPLIER + isActive + deletedAt=null`，`priority asc`。
> 权限：`purchase-requisition:approve`（与 convert 一致）。只读、无副作用。

| # | 用例 | 请求/场景 | 预期 |
| --- | --- | --- | --- |
| S1 | 正常解析 | APPROVED PR + 有效 supplier + 行有快照 | 200；每行 snapshot={partnerPriceId, unitPrice, taxRate}（Decimal 字符串） |
| S2 | 无快照 | supplier 未配置该物料 SUPPLIER 价 | snapshot=null；前端引导 MANUAL 通道（修复 409 死胡同） |
| S3 | 无 itemId 行 | PR 行缺 Item | snapshot 恒为 null（MANUAL 仍可转单） |
| S4 | supplier 无 partnerId | 供应商未关联 BusinessPartner | 所有行 snapshot=null（转单走 MANUAL） |
| S5 | 缺 supplierId | 未传参数 | 400 VALIDATION_ERROR |
| S6 | supplier 无效 | supplierId 不存在/软删 | 400 PURCHASE_ORDER_SUPPLIER_NOT_FOUND |
| S7 | PR 不存在 | id 无效/软删 | 404 PURCHASE_REQUISITION_NOT_FOUND |
| S8 | 权限 | 非 approve 用户 | 403（与 convert 对齐） |
| S9 | 行序 | PR 行 lineNo 升序 | 返回顺序与 PR Line 一致（前端按序回传 override） |
| S10 | 一致性 | 建议命中快照后直接 convert | convert 用同一解析语义，不再 409 PRICE_NOT_FOUND |
| S11 | 商品优选供应商行 | 商品配置 SupplierItem（用户指令 2026-08-21） | 每行返回 itemSupplierId/itemPurchasePrice/itemPaymentTerm（优选行 take 1） |
| S12 | 无快照预填商品采购价 | snapshot=null + itemPurchasePrice | 前端 MANUAL 预填 unitPrice + priceReason="商品默认采购价" |
| S13 | 默认供应商预选 | 对话框未选供应商 + itemSupplierId | 自动预选对应 Supplier（BP→Supplier.partner 映射） |
| S14 | 付款条款带出 | 对话框未设置 + itemPaymentTerm | 付款条件下拉自动带出商业条款 code |

## H. Convert 并发与幂等

| # | 用例 | 场景 | 预期 |
| --- | --- | --- | --- |
| H1 | 同 PR 双请求并发 Convert | 两请求同时执行 | `SELECT ... FOR UPDATE` 串行化；只有一个创建 PO 成功 |
| H2 | 并发第二请求 | 第一请求已提交 | 第二请求 409 ALREADY_CONVERTED |
| H3 | 重试 | 客户端因网络超时重发同 Convert | 不创建第二张 PO；返回冲突而非重复业务事实 |
| H4 | 事务中断 | PO Lines/价格解析阶段失败 | PO Header/Lines/PR CONVERTED 回写整体回滚 |
| H5 | 唯一业务事实 | 并发后统计 | 该 PR active关联 PO 数=1 |

## I. 事实源与不可变性红线

| # | 用例 | 检查 | 预期 |
| --- | --- | --- | --- |
| I1 | PR 无金额 | DB/API/Revision | PR Header/Line 不存在 unitPrice/subtotal/tax/total 业务事实 |
| I2 | Approval ≠ Convert | PR APPROVED 后 | 未显式 Convert 前 PurchaseOrder 数量不增加 |
| I3 | Convert 不改需求事实 | Convert 后 | PR Item/quantity/uom/needDate 不被 PO 覆盖 |
| I4 | PO 是独立承诺事实 | Convert 后修改 PO DRAFT | 不回写 PR Line 数量/金额 |
| I5 | PR 只有 Revision | 创建/更新/审批 | 不出现 PurchaseRequisitionSnapshot |
| I6 | 软删除过滤 | 所有读取 | deletedAt 非空实体不参与当前事实 |

## J. Real Business Acceptance（Sprint 5A PR Gate）

| # | 真实业务场景 | 验收标准 |
| --- | --- | --- |
| J1 | 部门提出采购需求 | 申请人创建 PR，只录 Item/数量/UOM/需求日期，不要求先知道采购价 |
| J2 | 修改需求 | DRAFT 可调整数量/交期并有 Revision；提交后不能偷偷改 |
| J3 | 审批驳回再提交 | 保留同一业务 PR + Workflow 审计链，不制造第二张 PR |
| J4 | 审批通过后采购执行 | APPROVED 仍不自动下采购单；采购人员显式 Convert |
| J5 | PR→PO 追溯 | 从 PO Line 可回查原 PR Line；从 PR 可确认已 CONVERTED |
| J6 | 并发操作 | 双击 Convert/网络重试不产生双 PO |

## K. Release Gate

Sprint 5A PR API 在进入 CTO Final Review 前必须满足：

1. A-I 全部自动/手工核验，无 Blocking；
2. PR 无金额事实扫描通过；
3. DRAFT PATCH CAS 并发测试通过；
4. REJECTED 后重提 Workflow 单实例测试通过；
5. Submit 不创建 PO；Convert 才创建 PO；
6. Convert 并发测试证明同一 PR 最多一张 active 关联 PO；
7. PR→PO Line 溯源、价格来源与 Decimal 金额快照可审计；
8. CI Quality Gates 全绿后再进入 OpenAPI/Final Docs。