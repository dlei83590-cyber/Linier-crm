# Quotation API 测试用例（Sprint 4A Quotation Foundation）

> 模块：Quotation Foundation（主档 CRUD + lines/revisions/snapshots + submit/accept/cancel/convert）
> 关联：docs/qa/Sprint4A_QA.md、ADR-0015、ADR-0016、API_GUIDELINES.md、ERROR_CODES.md、EVENTS.md v1.2
> 说明：覆盖 18 路由（16 文件）；重点覆盖 CTO 指定场景：定价红线（resolvePrice/priceSnapshotId/禁止 unitPrice）、
> Revision 系统生成、submit 创建 WorkflowInstance、审批状态投影、EXPIRED 惰性判定、accept 快照、cancel 状态限制、
> convert 4A 预留、乐观锁 409、软删除审计、权限拒绝。

## A. 认证与权限

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| A1 | 未认证访问 | GET /api/quotations | 401 AUTHENTICATION_ERROR |
| A2 | MEMBER 无 quotation:create | POST /api/quotations | 403 FORBIDDEN |
| A3 | 无 quotation-line:create | POST /api/quotations/:id/lines | 403 |
| A4 | 无 quotation-revision:view | GET /api/quotations/:id/revisions | 403 |
| A5 | 无 quotation-snapshot:view | GET /api/quotations/:id/snapshots | 403 |
| A6 | 无 quotation:close | POST /api/quotations/:id/cancel | 403 |
| A7 | 无 quotation:approve | POST /api/quotations/:id/accept、/convert | 403 |
| A8 | 无 quotation:edit | PATCH /api/quotations/:id、POST /submit | 403 |
| A9 | 无 quotation:delete | DELETE /api/quotations/:id | 403 |
| A10 | 权限码覆盖 13 个 | quotation* / quotation-line* / quotation-revision* / quotation-snapshot* | 无权限 403 |

## B. 主档 CRUD（/api/quotations）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| B1 | 创建报价（customerId + 1 行） | POST | 201，status=DRAFT，code=QT 前缀 6 位（DocumentSequence） |
| B2 | 创建无行 | POST {customerId, lines:[]} | 400（Zod min 1） |
| B3 | 创建时行价来自 Pricing Engine | 创建后查行 | unitPrice≠0、priceSnapshotId 非空、与 resolvePrice 一致 |
| B4 | 创建后 Revision | 查 revisions | revisionNo=1，changeReason=创建报价单 |
| B5 | 创建时提交 unitPrice | POST lines 带 unitPrice | 字段被 schema 忽略，行价仍由引擎决定 |
| B6 | 列表分页+过滤 | GET ?page&pageSize&code&customerId&status&dateFrom&dateTo | 200 分页，软删除过滤 |
| B7 | 列表含有效状态投影 | GET | 每项含 effectiveStatus/isExpired |
| B8 | 详情 | GET /:id | 200 含 customer/lines/revisions/snapshots |
| B9 | 详情不存在 | GET /:id（无效 id） | 404 QUOTATION_NOT_FOUND |
| B10 | 更新头（validUntil+changeReason+version） | PATCH /:id | 200 version+1，生成 Revision |
| B11 | 更新 version 冲突 | PATCH /:id（旧 version） | 409 VERSION_CONFLICT |
| B12 | 非 DRAFT/REJECTED 更新 | PATCH（SUBMITTED 状态） | 409 QUOTATION_NOT_EDITABLE |
| B13 | 更新提交 unitPrice | PATCH /:id 带 unitPrice | 无该字段，被忽略 |
| B14 | 软删除（DRAFT） | DELETE /:id | 200 {deleted:true}，级联软删 lines/revisions/snapshots |
| B15 | 非 DRAFT 删除 | DELETE（SUBMITTED） | 409 QUOTATION_NOT_EDITABLE |
| B16 | 删除不存在 | DELETE /:id（无效 id） | 404 |

## C. 行管理（/api/quotations/:id/lines）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| C1 | 行列表 | GET /lines | 200，含 item + priceSnapshot |
| C2 | 新增行（定价走引擎） | POST /lines {itemId,quantity} | 201，priceSnapshotId/unitPrice 回写 |
| C3 | 新增行直接提交 unitPrice | POST /lines 带 unitPrice | 忽略，价格来自引擎 |
| C4 | 新增行定价失败 | POST /lines（无价格配置物料） | 400 QUOTATION_PRICE_FAILED，占位行清理 |
| C5 | 新增行非 DRAFT/REJECTED | POST /lines（SUBMITTED） | 409 QUOTATION_NOT_EDITABLE |
| C6 | 更新行数量（重新定价） | PATCH /lines/:lineId {quantity,version} | 200，新 priceSnapshotId，头合计重算，生成 Revision |
| C7 | 更新行描述（不重新定价） | PATCH /lines/:lineId {description,version} | 200，priceSnapshotId 不变 |
| C8 | 更新行 unitPrice | PATCH /lines/:lineId 带 unitPrice | 无该字段，被忽略 |
| C9 | 更新行 version 冲突 | PATCH /lines/:lineId（旧 version） | 409 VERSION_CONFLICT |
| C10 | 行不存在 | PATCH /lines/:lineId（无效 lineId） | 404 QUOTATION_LINE_NOT_FOUND |
| C11 | 软删行 | DELETE /lines/:lineId | 200 {deleted:true}，头合计重算，生成 Revision |
| C12 | 软删行非 DRAFT/REJECTED | DELETE /lines/:lineId（SUBMITTED） | 409 |

## D. 修订（/api/quotations/:id/revisions）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| D1 | 修订历史列表 | GET /revisions | 200，revisionNo desc |
| D2 | 系统生成修订 | POST /revisions {changeReason} | 201，revisionNo+1，snapshotData 由系统生成 |
| D3 | 生成修订缺 changeReason | POST /revisions {} | 400 |
| D4 | 非 DRAFT/REJECTED 生成修订 | POST /revisions（SUBMITTED） | 409 QUOTATION_NOT_EDITABLE |
| D5 | 修订详情 | GET /revisions/:revisionId | 200 只读 |
| D6 | 修订详情不存在 | GET /revisions/:revisionId（无效） | 404 |

## E. 快照（/api/quotations/:id/snapshots）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| E1 | 快照列表 | GET /snapshots | 200，generatedAt desc，只读 |
| E2 | 快照详情 | GET /snapshots/:snapshotId | 200 只读 |
| E3 | 快照详情不存在 | GET /snapshots/:snapshotId（无效） | 404 |
| E4 | 快照禁止写 | POST/PATCH/DELETE /snapshots* | 无端点 → 404（仅 GET） |

## F. Action API（submit / accept / cancel / convert）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| F1 | submit 成功（auto-approve） | POST /:id/submit | 200 {status:APPROVED, approvalStatus:APPROVED, workflowSkipped:'no-policy'} |
| F2 | submit 不创建 WorkflowInstance | 查 workflow 实例 | 无 quotation 实例（移除审核，跳过 ApprovalPolicy 匹配） |
| F3 | submit 生成 APPROVED 快照 | 查 snapshots | snapshotType=APPROVED（提交即生效） |
| F4 | submit 发布事件 | 查 AuditLog | action=QuotationSubmitted（workflowInstanceId=null） |
| F5 | submit 无 ApprovalPolicy 不阻断 | 无策略配置 | 200（不再报 QUOTATION_APPROVAL_POLICY_NOT_FOUND） |
| F6 | submit 重复 | 二次 submit | 409 QUOTATION_INVALID_STATE（仅 DRAFT 可提交） |
| F7 | submit 无行 | 空行报价 submit | 409 QUOTATION_NO_LINES |
| F8 | submit 非 DRAFT | APPROVED/SUBMITTED 状态 submit | 409 QUOTATION_INVALID_STATE |
| F9 | submit 过期 | 过期报价 submit | 409 QUOTATION_EXPIRED |
| F10 | 提交后 accept 直接可用 | POST /:id/accept（APPROVED） | 200 {status:ACCEPTED} + ACCEPTED 快照 + QuotationAccepted（accept 门禁 status=APPROVED/SENT 已满足） |
| F11 | convert 前置 | accept 后 convert | 创建 SO（status=DRAFT）+ CONVERTED 快照（convert 门禁 status=ACCEPTED） |
| F13 | accept 过期 | POST /:id/accept（EXPIRED） | 409 QUOTATION_EXPIRED |
| F14 | accept 非 APPROVED/SENT | POST /:id/accept（DRAFT） | 409 QUOTATION_INVALID_STATE |
| F15 | cancel 成功 | POST /:id/cancel（DRAFT） | 200 {status:CANCELLED} + QuotationCancelled |
| F16 | cancel ACCEPTED | POST /:id/cancel（ACCEPTED） | 409 QUOTATION_INVALID_STATE |
| F17 | cancel CONVERTED | POST /:id/cancel（CONVERTED） | 409 QUOTATION_INVALID_STATE |
| F18 | convert 预留 | POST /:id/convert（ACCEPTED 未转换） | 501（Sprint 4B 实现） |
| F19 | convert 非 ACCEPTED | POST /:id/convert（APPROVED） | 409 QUOTATION_INVALID_STATE |
| F20 | convert 已转换 | POST /:id/convert（convertedAt 非空） | 409 QUOTATION_ALREADY_CONVERTED |

## G. 过期惰性判定（ADR-0016 决策②）

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| G1 | SENT + validUntil<now | GET /:id | effectiveStatus=EXPIRED, isExpired=true |
| G2 | APPROVED + validUntil<now | GET /:id | effectiveStatus=EXPIRED, isExpired=true |
| G3 | DRAFT + validUntil<now | GET /:id | 不投影 EXPIRED（仅 SENT/APPROVED） |
| G4 | 未过期 APPROVED | GET /:id | effectiveStatus=APPROVED |
| G5 | 数据库状态不变 | 过期后查库 | status 仍为 SENT/APPROVED（惰性，不落库） |

## H. 审计与一致性

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| H1 | 每次写操作审计 | 查 AuditLog | quotation.create/update/delete/line.create/line.update/line.delete/revision.create/submit/accept/cancel/convert |
| H2 | 软删除后列表不可见 | 删除后 GET 列表 | 不含已删记录 |
| H3 | 软删除后详情 404 | 删除后 GET /:id | 404 |
| H4 | 事件以 AuditLog 留痕 | 查 AuditLog | action=Quotation*（总线落地前） |
| H5 | 乐观锁跨行生效 | 并行 PATCH 头+行 | 任一旧 version → 409 |

## I. 边界与回归

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| I1 | 动态路由 force-dynamic | 全部路由 | export dynamic=force-dynamic（避免缓存） |
| I2 | 分页上限 | GET ?pageSize=1000 | 钳制到 100（parsePagination） |
| I3 | 无效 JSON body | POST 非法 JSON | 400（safeParse catch null） |
| I4 | 不启动 Sales Order 代码 | 全仓 | 无 sales-order 新增文件（CTO 指示） |

## J. CC-05 报价打印视图（打印只读投影）

> 范围：新增 /sales/quotations/[id]/print 独立 Print View + GET /api/quotations/:id 打印只读投影
> （additive include：客户联系/地址 + 当前销售负责人（CustomerOwnership SSOT）+ 行单位/规格）。
> 禁止：PDF/Word 引擎、模板拖拽器、富文本模板平台；零 Schema；浏览器打印（window.print + A4 print CSS）。

| # | 用例 | 方法/路径 | 预期 |
| --- | --- | --- | --- |
| J1 | 详情携带客户联系/地址 | GET /api/quotations/:id | customer 含 fullName/contactPerson/phone/email/address |
| J2 | 详情携带销售负责人 | GET /api/quotations/:id | customer.customerOwnerships[0].owner = 客户当前 active ownership（releasedAt=null），无归属时为 null |
| J3 | 详情携带行单位/规格 | GET /api/quotations/:id | lines[].uom {id,code,name,symbol}；item.spec 随行返回 |
| J4 | 打印视图渲染 | /sales/quotations/[id]/print | 报价单号/日期/有效期/客户/报价行（序号/编码/名称/规格/数量/单位/单价/金额）/汇总（小计/税额/总金额）/条款/备注/销售负责人 |
| J5 | 金额格式化 | 打印视图 | 千分位 + 2 位小数（formatMoneyValue），右对齐 |
| J6 | 无明细空态 | 空 lines 打印视图 | 「暂无明细行」，汇总按 0.00 展示 |
| J7 | 打印按钮 | 打印视图工具栏 | window.print()；工具栏 print 时隐藏（无按钮进入纸张内容） |
| J8 | 权限 | 无 quotation:view | 403（PermissionGuard + API requirePermission 双门禁） |
| J9 | 入口 | 报价详情「打印」 | 跳转 /sales/quotations/[id]/print（不再直接 window.print 详情页） |
