# Sprint 4A QA — Quotation Foundation（报价领域：CRUD + 定价红线 + 审批集成 + 过期/快照/修订）

> Sprint：4A | 模块：Quotation Foundation（Phase 3 已通过代码门禁） | PR：#12（feature/sprint4-sales，待验收合并） | 日期：2026-08-07
> 状态：✅ Phase 3 Code Gate 通过（CI #76 Quality Gates / Build / Secret Scanning 全绿）；文档收尾后交 CTO Review
> 关联：ADR-0015（Quotation must consume Pricing Engine）、ADR-0016（Quotation Domain）、Sprint4_Quote_* 设计文档、EVENTS.md v1.2、API_GUIDELINES.md、ERROR_CODES.md
> 架构原则（CTO 审核锁定）：价格红线（行价必须来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId，禁止前端 unitPrice）；
> Workflow 为唯一审批事实源（ADR-0016，不建 QuotationApproval 表）；EXPIRED 惰性判定（不落库、不增调度器）；
> Revision 只能系统生成（不开放自由编辑）；Snapshot 仅在固化节点生成（SUBMITTED/APPROVED/SENT/ACCEPTED/CONVERTED）。

## 1. 交付范围

### 1.1 API（12 路由文件 / 18 端点，均在 `apps/web/src/app/api/quotations/**`）
| 分组 | 端点 | 说明 |
| --- | --- | --- |
| 主档 | GET/POST `/api/quotations` | 列表（分页 + code/customerId/status/dateFrom/dateTo 过滤）；创建草稿（Header+Lines 事务 + 事务外定价回写） |
| 主档 | GET/PATCH/DELETE `/api/quotations/{id}` | 详情（含 lines/revisions/snapshots/customer + 惰性过期投影）；更新（仅 DRAFT/REJECTED，乐观锁 version）；软删除（仅 DRAFT，级联软删） |
| 行 | GET/POST `/api/quotations/{id}/lines` | 行列表（含 item + priceSnapshot）；新增行（定价红线：必须走 Pricing Engine） |
| 行 | PATCH/DELETE `/api/quotations/{id}/lines/{lineId}` | 更新行（禁止 unitPrice；数量变更重新定价）；软删行（重算头合计） |
| 修订 | GET/POST `/api/quotations/{id}/revisions` | 修订历史（revisionNo desc）；系统生成修订（body 仅 changeReason） |
| 修订 | GET `/api/quotations/{id}/revisions/{revisionId}` | 修订详情（只读） |
| 快照 | GET `/api/quotations/{id}/snapshots` | 快照列表（generatedAt desc，只读） |
| 快照 | GET `/api/quotations/{id}/snapshots/{snapshotId}` | 快照详情（只读，禁止写） |
| Action | POST `/api/quotations/{id}/submit` | 提交审批（DRAFT → ApprovalPolicy 匹配 → WorkflowInstance → SUBMITTED） |
| Action | POST `/api/quotations/{id}/accept` | 客户接受（仅 APPROVED/SENT，EXPIRED 禁止） |
| Action | POST `/api/quotations/{id}/cancel` | 取消（DRAFT/SUBMITTED/APPROVED/SENT；ACCEPTED/CONVERTED 禁止） |
| Action | POST `/api/quotations/{id}/convert` | 转 Sales Order（Sprint 4A 预留，返回 501，4B 实现） |

### 1.2 RBAC（13 权限码，动作级）
quotation:view / quotation:create / quotation:edit / quotation:delete / quotation:close / quotation:approve
quotation-line:view / quotation-line:create / quotation-line:edit / quotation-line:delete
quotation-revision:view / quotation-revision:create
quotation-snapshot:view

### 1.3 Domain Events（EVENTS.md v1.2 注册 11 个，本阶段已发布 7 个）
已发布：QuotationCreated / QuotationUpdated / QuotationSubmitted / QuotationApproved / QuotationRejected / QuotationAccepted / QuotationCancelled
注册待后续：QuotationRevisionCreated / QuotationSent / QuotationExpired / QuotationConverted（见 §4 差异说明）

## 2. 测试要点（CTO 指定覆盖）

| # | 场景 | 验证方式 | 实现位置 |
| --- | --- | --- | --- |
| T1 | 行价必须通过 resolvePrice() | 创建报价/新增行后，QuotationLine.unitPrice/lineAmount/taxAmount/totalAmount 与 PricingEngine 结果一致 | quotations/route.ts POST、lines/route.ts POST |
| T2 | 前端直接提交 unitPrice 不得绕过 Pricing Engine | quotationCreateSchema / quotationLineCreateSchema 均无 unitPrice 字段 → 提交 unitPrice 被 Zod 剔除（忽略） | schemas.ts（无该字段） |
| T3 | priceSnapshotId 正确保存 | 定价回写后 line.priceSnapshotId 非空，且 FK → QuotationPriceSnapshot 完整定价链 | lines 回写逻辑 |
| T4 | 修改商业字段生成 Revision | PATCH 头/行后 revisions 新增一条（revisionNo+1，changeReason 记录） | [id]/route.ts PATCH、lines PATCH/DELETE |
| T5 | submit 创建 WorkflowInstance | submit 后 status=SUBMITTED、workflowInstanceId 非空、生成 SUBMITTED 快照、发布 QuotationSubmitted | submit/route.ts |
| T6 | 审批状态投影正确 | Workflow 终态 COMPLETED → quotation.status=APPROVED + approvalStatus/approvedAt/approvedById；REJECTED → REJECTED | workflow-sync.ts |
| T7 | 过期报价 effectiveStatus=EXPIRED | SENT/APPROVED 且 validUntil < now → 响应含 effectiveStatus=EXPIRED, isExpired=true（惰性判定，不落库） | helpers.ts effectiveStatusOf |
| T8 | EXPIRED 禁止 accept | 过期报价 POST accept → 409 QUOTATION_EXPIRED | accept/route.ts |
| T9 | accept 生成 Snapshot | accept 成功 → status=ACCEPTED + QuotationSnapshot(ACCEPTED) | accept/route.ts |
| T10 | cancel 状态限制正确 | ACCEPTED/CONVERTED 取消 → 409 QUOTATION_INVALID_STATE；DRAFT/SENT/SUBMITTED/APPROVED 可取消 | cancel/route.ts |
| T11 | convert 4A 阶段返回预留结果 | ACCEPTED 未转换报价 POST convert → 501（Sprint 4B 实现）；非 ACCEPTED → 409；已转换 → 409 QUOTATION_ALREADY_CONVERTED | convert/route.ts |
| T12 | 乐观锁冲突返回 409 | PATCH 带旧 version → 409 VERSION_CONFLICT | [id]/route.ts、lines/[lineId]/route.ts |
| T13 | 软删除与审计正确 | DELETE → deletedAt 置位 + isActive=false + 级联软删；每次写操作产生 AuditLog（action 含 quotation.*） | 各路由 + api-helpers |
| T14 | 权限不足正确拒绝 | 无对应权限码调用 → 403 FORBIDDEN（13 个权限码全覆盖） | 各路由 requirePermission |

## 3. 测试清单（按模块）

### 3.1 认证与权限
- [ ] A1 未认证访问 GET /api/quotations → 401
- [ ] A2 MEMBER 无 quotation:create → POST → 403
- [ ] A3 无 quotation-line:create → POST lines → 403
- [ ] A4 无 quotation-revision:view → GET revisions → 403
- [ ] A5 无 quotation-snapshot:view → GET snapshots → 403
- [ ] A6 无 quotation:close → cancel → 403
- [ ] A7 无 quotation:approve → accept/convert → 403

### 3.2 主档 CRUD
- [ ] B1 创建（customerId + lines≥1）→ 201，status=DRAFT，code 由 DocumentSequence 生成（QT 前缀，6 位）
- [ ] B2 创建时 lines 价格来自 Pricing Engine（unitPrice ≠ 0，priceSnapshotId 非空）
- [ ] B3 创建后自动生成 Revision（revisionNo=1，changeReason=创建报价单）
- [ ] B4 列表过滤 code/customerId/status/dateFrom/dateTo → 200 分页
- [ ] B5 详情含 customer/lines/revisions/snapshots + effectiveStatus 投影
- [ ] B6 PATCH 头（validUntil/remark/changeReason+version）→ 200，version+1，生成 Revision，发布 QuotationUpdated
- [ ] B7 PATCH 旧 version → 409 VERSION_CONFLICT
- [ ] B8 非 DRAFT/REJECTED 状态 PATCH → 409 QUOTATION_NOT_EDITABLE
- [ ] B9 DELETE 仅 DRAFT 允许 → 200 {deleted:true}，级联软删 lines/revisions/snapshots
- [ ] B10 非 DRAFT 删除 → 409
- [ ] B11 不存在的 id → 404 QUOTATION_NOT_FOUND

### 3.3 行管理（定价红线）
- [ ] C1 新增行 → 201，unitPrice/priceSnapshotId 由 Pricing Engine 回写
- [ ] C2 提交 unitPrice 字段 → 被 schema 忽略（无该字段），不生效
- [ ] C3 数量变更 → 重新定价（新 priceSnapshotId），409 变 200
- [ ] C4 行 PATCH 旧 version → 409
- [ ] C5 软删行 → 200，头合计重算，生成 Revision
- [ ] C6 定价失败（PRICE_NOT_FOUND）→ 400 QUOTATION_PRICE_FAILED，占位行清理

### 3.4 修订（Revision）
- [ ] D1 修订历史列表 revisionNo desc
- [ ] D2 POST /revisions（仅 changeReason）→ 201，revisionNo+1
- [ ] D3 非 DRAFT/REJECTED 生成修订 → 409
- [ ] D4 修订详情只读，无 PATCH/DELETE 端点

### 3.5 快照（Snapshot）
- [ ] E1 快照列表只读（GET）
- [ ] E2 快照详情只读（GET），禁止 POST/PATCH/DELETE
- [ ] E3 submit 生成 SUBMITTED 快照；accept 生成 ACCEPTED 快照

### 3.6 Action API
- [ ] F1 submit 成功 → 200 {status:SUBMITTED, workflowInstanceId}，创建 WorkflowInstance（RUNNING + SUBMIT action/history + 首步审批人）
- [ ] F2 submit 无 ApprovalPolicy 匹配 → 409 QUOTATION_APPROVAL_POLICY_NOT_FOUND
- [ ] F3 submit 重复（已存在实例）→ 409 WORKFLOW_INSTANCE_EXISTS
- [ ] F4 submit 无行 → 409 QUOTATION_NO_LINES
- [ ] F5 submit 非 DRAFT → 409 QUOTATION_INVALID_STATE
- [ ] F6 submit 过期 → 409 QUOTATION_EXPIRED
- [ ] F7 审批通过（Workflow COMPLETED）→ quotation 投影 APPROVED + QuotationApproved 事件
- [ ] F8 审批驳回（Workflow REJECTED）→ quotation 投影 REJECTED + QuotationRejected 事件
- [ ] F9 accept 成功（APPROVED/SENT）→ 200 {status:ACCEPTED} + ACCEPTED 快照 + QuotationAccepted
- [ ] F10 accept 过期 → 409 QUOTATION_EXPIRED
- [ ] F11 accept 非 APPROVED/SENT → 409 QUOTATION_INVALID_STATE
- [ ] F12 cancel 成功（DRAFT）→ 200 {status:CANCELLED} + QuotationCancelled
- [ ] F13 cancel ACCEPTED → 409 QUOTATION_INVALID_STATE
- [ ] F14 convert（ACCEPTED 未转换）→ 501（Sprint 4B 预留）
- [ ] F15 convert 非 ACCEPTED → 409 QUOTATION_INVALID_STATE
- [ ] F16 convert 已转换 → 409 QUOTATION_ALREADY_CONVERTED

### 3.7 过期（EXPIRED 惰性判定，ADR-0016 决策②）
- [ ] G1 SENT/APPROVED + validUntil < now → 响应 effectiveStatus=EXPIRED, isExpired=true
- [ ] G2 DRAFT 过期 → 不投影 EXPIRED（仅 SENT/APPROVED 可过期）
- [ ] G3 过期禁止 accept（409 QUOTATION_EXPIRED）
- [ ] G4 过期禁止 submit（409 QUOTATION_EXPIRED）
- [ ] G5 数据库状态不写 EXPIRED（惰性，不落库）

## 4. EVENTS 实现差异说明（EVENTS.md v1.2 对齐）

| 事件 | 状态 | 说明 |
| --- | --- | --- |
| QuotationCreated / QuotationUpdated / QuotationSubmitted / QuotationApproved / QuotationRejected / QuotationAccepted / QuotationCancelled | ✅ 已发布 | 事件总线未落地（Known Risk），当前以 AuditLog 留痕（action=eventType），总线落地后替换 |
| QuotationRevisionCreated | ⏳ 注册待实现 | Revision 生成时发布 QuotationUpdated（业务内容变更语义），独立事件待事件总线阶段 |
| QuotationSent | ⏳ 注册待实现 | SENT 状态为下游预留，无独立 send API（Sprint 4A 未实现发送动作） |
| QuotationExpired | ⏳ 注册待实现 | 惰性判定不落库，无定时发布；读取/操作发现过期时返回投影 |
| QuotationConverted | ⏳ 注册待实现 | 依赖 Sprint 4B Sales Order Foundation（convert 当前 501） |

## 5. 已知风险与边界

- 事件总线未落地：事件以 AuditLog 留痕，总线落地后需替换 publishQuotationEvent 实现（EVENTS.md §4 要求）
- convert 为 Sprint 4A 预留接口（501），转换逻辑 4B 落地
- SENT 无独立发送动作；SENT 状态由后续阶段提供（4A 只读状态）
- 乐观锁 version 覆盖头与行（PATCH 必带）；DELETE 无版本校验（仅状态校验）
- 本阶段未启动 Sales Order 代码（按 CTO 指示）

## 6. 验收标准（对照 ACCEPTANCE_STANDARD.md）

- [ ] 全部 Action API 不 PATCH status（submit/accept/cancel/convert 独立端点）
- [ ] 价格红线成立：任何入口无法直接写入 unitPrice（schema 层禁止 + Pricing Engine 回写）
- [ ] Workflow 为唯一审批事实源（无 QuotationApproval 表）
- [ ] Revision 全部系统生成（无自由编辑端点）
- [ ] Snapshot 仅固化节点生成（只读端点）
- [ ] 软删除 + 审计贯穿所有写操作
- [ ] 错误码符合 ERROR_CODES.md（409 语义：状态/版本/策略冲突）
