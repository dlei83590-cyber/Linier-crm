# Phase 2 Batch 1 — Quotation 链纵向深审（Deep Business Semantics）

> 依据：docs/BUSINESS_UX_RATIONALIZATION_PHASE2.md（Phase 2 主提示词）
> 范围：1 个业务流程（Quotation 链：列表/新建/详情/编辑 + 9 个 API routes + schemas + PricingService + workflow-sync）
> 分支：feat/ux-phase2-batch1-quotation

## Business Context

- 真实角色：销售代表（建报价/改报价/提交审批/发送客户/记录客户接受）、销售主管（审批）、销售经理（转销售订单）
- 任务：向客户报出可追踪价格的报价 → 走审批 → 发送 → 客户接受 → 转销售订单（O2C 起点）
- 业务事实链：Quotation（价格快照、审批、过期）→ SalesOrder（继承价格，不重新定价）→ Delivery → Invoice → AR

## Current Contract（当前事实）

### 状态机（QuotationStatus）
DRAFT → SUBMITTED → APPROVED → SENT → ACCEPTED → CONVERTED
DRAFT/SUBMITTED/APPROVED/SENT → CANCELLED
APPROVED/SENT + 过期 → EXPIRED（惰性判定，不落库）
REJECTED（workflow 驳回，声明可编辑后重新提交）

### 动作 API
| API | 前置状态 | 权限 | 事实 |
|---|---|---|---|
| POST /api/quotations | — | quotation:create | 取号+Header+Lines 事务 → 事务外定价 → 回写+Revision+事件 |
| PATCH /:id | DRAFT/REJECTED | quotation:edit | CAS；validFrom/validUntil/taxProfileId/remark 可改；customer/currency/status/金额不可改 |
| DELETE /:id | DRAFT | quotation:delete | 软删级联 |
| POST /:id/submit | DRAFT | quotation:edit | 匹配 ApprovalPolicy → WorkflowInstance → 快照(SUBMITTED) |
| POST /:id/accept | APPROVED/SENT 且未过期 | quotation:approve | 快照(ACCEPTED) |
| POST /:id/cancel | DRAFT/SUBMITTED/APPROVED/SENT | quotation:close | status=CANCELLED |
| POST /:id/convert | ACCEPTED 且未过期未转换 | quotation:approve | FOR UPDATE 行锁；创建 SO DRAFT；继承价格+priceSnapshotId；回写 CONVERTED |
| POST /:id/lines | DRAFT/REJECTED | quotation-line:create | 占位行 → 定价 → 回写+重算+Revision |
| PATCH /:id/lines/:lineId | DRAFT/REJECTED | quotation-line:edit | CAS；quantity/uomId 变更触发重新定价 |
| DELETE /:id/lines/:lineId | DRAFT/REJECTED | quotation-line:delete | 软删+重算+Revision |

### 价格红线（ADR-0015/0016）
unitPrice 只能来自 PricingEngine.resolvePrice() → QuotationPriceSnapshot → priceSnapshotId；前端禁止直接填价（schema 不含 unitPrice 字段）。

## Field Decision Matrix（Quotation Header）

| 字段 | 中文 | 来源 | 行为 | 编辑权限 |
|---|---|---|---|---|
| code | 单号 | 系统取号 | 只读 | 永不可改 |
| customerId | 客户 | 用户输入（客户主数据） | 创建必填 | 不可改（编辑页只读） |
| opportunityId/projectId | 商机/项目 | 用户输入 | 可选 | 不可改 |
| status | 状态 | 系统状态机 | 只读 | 动作 API 驱动 |
| quoteDate | 报价日期 | 系统（默认 now） | 只读 | 不可改 |
| validFrom/validUntil | 有效期起/至 | 用户输入 | 可选 | DRAFT/REJECTED 可改；EXPIRED 判定依据 |
| currency | 币种 | 用户输入（默认 CNY） | 创建必填 | 不可改 |
| exchangeRateSnapshot | 汇率快照 | 后端派生 | 只读 | 不可改 |
| taxProfileId/taxSnapshot | 税率档案/快照 | 用户输入/后端 | 可选 | DRAFT/REJECTED 可改 |
| subtotal/taxAmount/totalAmount | 未税/税额/含税 | 系统计算（recalcQuotationTotals） | 计算字段 | 只读 |
| discountRate | 折扣率 | 定价引擎 | 计算字段 | 只读 |
| remark | 备注 | 用户输入 | 可选 | DRAFT/REJECTED 可改 |
| workflowInstanceId | 审批实例 | 系统（submit） | 只读投影 | 不可改 |
| approvedAt/approvedById | 批准时间/人 | workflow-sync | 只读投影 | 不可改 |
| convertedAt/convertedById/salesOrderId | 转换投影 | convert | 只读投影 | 不可改 |
| approvalStatus | 审批状态投影 | workflow-sync | 只读 | 不可改 |
| version | 版本 | CAS | 只读 | 乐观锁 |

## Action / State Matrix（前端动作入口现状）

| 状态 | 编辑 | submit | accept | cancel | convert | 前端入口现状 |
|---|---|---|---|---|---|---|
| DRAFT | ✅ | ✅ | ❌ | ✅ | ❌ | 编辑✅ 转换❌ **submit/cancel 缺失** |
| SUBMITTED | ❌ | ❌ | ❌ | ✅ | ❌ | **cancel 缺失** |
| APPROVED | ❌ | ❌ | ✅ | ✅ | ❌ | **accept/cancel 缺失** |
| SENT | ❌ | ❌ | ✅ | ✅ | ❌ | **accept/cancel 缺失** |
| ACCEPTED | ❌ | ❌ | ❌ | ❌ | ✅ | 转换✅ |
| REJECTED | ✅ | ❌（死锁） | ❌ | ❌ | ❌ | 编辑✅ |
| CANCELLED/CONVERTED/EXPIRED | ❌ | ❌ | ❌ | ❌ | ❌ | — |

## Problems Found

- **P1-1（业务流程错误）**：详情页缺失 submit / accept / cancel 核心动作入口——API 允许但 UI 无入口（违反 Phase 2「API 允许但 UI 完全没有业务入口的核心动作」）。DRAFT 报价无法提交审批、APPROVED/SENT 无法记录客户接受、中间态无法取消。
- **P1-2（契约冲突，不实施）**：REJECTED 声明「可编辑后重新提交」（enums 注释 + PATCH 允许编辑），但 submit 仅接受 DRAFT 且 workflowInstance 去重阻断（WORKFLOW_INSTANCE_EXISTS）→ 被驳回报价无法重新提交审批。标记 **CONTRACT ISSUE**（需 Workflow 实例复用设计 + ADR）。
- **P1-3（契约缺口，不实施）**：状态机有 SENT（accept 也接受 SENT），但无任何 send action API → SENT 状态不可达。标记 **CONTRACT ISSUE**。
- **P2-1（跨字段约束缺失）**：新建/编辑页 validUntil < validFrom 无前端校验，后端 schema 也无 refine（Phase 2「日期：validFrom/validUntil 关系」未落地）。
- **P2-2（字段行为错误）**：新建页 currency 是自由文本输入，应为受控选择（系统单币种 CNY 为主）。
- **P2-3（契约缺口，前端提示）**：编辑页改 taxProfileId 不触发行重新定价（税额口径不一致风险）。标记 **CONTRACT ISSUE**（后端需 PricingEngine 重算，另议），前端加变更提示。
- **P3（可用性）**：详情页 summary 混入「创建时间」审计字段（应放审计信息区）。

## Proposed Changes（本轮实施）

**Frontend（3 页面，纯前端）**
1. 详情页：补全动作按钮矩阵——提交审批（DRAFT，quotation:edit）、客户接受（APPROVED/SENT，quotation:approve）、取消（DRAFT/SUBMITTED/APPROVED/SENT，quotation:close），动作成功后 re-GET；创建时间移入审计信息区。
2. 新建页：currency 改下拉（CNY 默认 + 常用币种）；validUntil >= validFrom 前端校验。
3. 编辑页：validUntil >= validFrom 前端校验；税档变更提示「保存后税额口径需确认」。

**Backend（仅校验增强，零 Migration/零表变更）**
4. schemas.ts：quotationCreateSchema / quotationUpdateSchema 增加 validUntil >= validFrom refine（后端 authoritative validation）。

**Backend Contract Preserved**（价格红线/CAS/RBAC/状态机/事件/快照全部不变）

**CONTRACT ISSUE 标记（本轮不实施，记录待 ADR）**
- C-1：REJECTED 重新提交死锁（submit 仅 DRAFT + workflowInstance 去重）
- C-2：SENT 状态无 send action API
- C-3：taxProfileId 变更不重算行税额

## Runtime Acceptance（设计）

1. 销售代表：新建报价（草稿）→ 详情页点「提交审批」→ 审批通过（APPROVED）→ 点「客户接受」→ ACCEPTED → 点「转为销售订单」→ 跳转 SO 详情。
2. 取消路径：DRAFT/SUBMITTED/APPROVED/SENT 可取消；ACCEPTED/CONVERTED 无取消按钮（与后端一致）。
3. 非法路径验证：validUntil < validFrom 前端即时阻止 + 后端 400；EXPIRED 报价无 submit/accept 按钮。
4. 无权限：无 quotation:edit/approve/close 角色看不到对应按钮（PermissionGuard 同层）。

## Validation
- lint / type-check / unit / build → GitHub CI（CI-First，本地不跑构建）
