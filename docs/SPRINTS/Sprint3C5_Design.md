# Sprint 3C-5 Project Foundation — 增量设计（Enhancement + CRUD/API Foundation）

> 状态：Design（待 CTO 审核）
> 定位：**Project Foundation Enhancement + CRUD/API Foundation**，不是重新设计 Project Schema。
> Sprint 2C 已建立完整项目双段模型（迁移 0003_project_domain），3C-5 只做：补权限、补 API、评估增量模型、锁定业务规则。
> 关联：ADR-0014、ADR-0003（Project 领域）、ADR-0008（File Center）、ADR-0013（Price Foundation）、ROADMAP.md

---

## 1. 现状盘点（14 模型，迁移 0003_project_domain）

### 1.1 模型清单与标记

| 模型 | 关键字段 / 关系 | 迁移来源 | 现有权限模块 | 标记 |
| --- | --- | --- | --- | --- |
| ProjectOpportunity | code 唯一 / customerId→BusinessPartner / stage(11) / 财务字段(客户投入/预计营收/成本/毛利/费用预算/销售目标/回款状态/竞争对手/成功概率) / ownerId / project 1:0..1 | 0003 | project-opportunity（read/write + 动作级已有） | 可直接复用 + 需要新增 API |
| Project | code 唯一 / opportunityId 唯一(1:1) / customerId / stage / 财务字段(含 expectedContractAmount/expectedProfit/expectedGrossMarginRate/receivedAmount/invoicedAmount/uninvoicedAmount/receivableBalance/projectRating/failureReason) / ownerId / 14 子关系 | 0003 | project（read/write + 动作级已有） | 可直接复用 + 需要新增 API + 需要补字段（见 2.4） |
| ProjectStakeholder | projectId / role(5 类) / name/title/department/phone/email/note | 0003 | 无（仅 project 覆盖） | 需要新增 API + 需要补权限 |
| ProjectMember | projectId / userId(可空) / name / roleInProject / joinedAt/leftAt | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectMilestone | projectId / name / plannedDate/actualDate / status(4) / deliverable / delayReason | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectTask | projectId / milestoneId(可空) / name / assigneeId / dueDate / status(4) / priority | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectBudget | projectId / category / amount / currency | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectExpense | projectId / category / amount / currency / incurredAt | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectProduct | projectId / itemId→Item(Restrict) / quantity / unitPrice / note | 0003 | 无 | 可直接复用 + 需要新增 API + 需要补权限（价格改引用 Price 快照，见 2.3） |
| ProjectRisk | projectId / description / impact / probability / mitigation / ownerId / status(3) / closedAt | 0003 | project-risk（read/write + 动作级已有） | 可直接复用 + 需要新增 API |
| ProjectVisit | projectId / visitType(5) / visitedAt / visitorId / contactName / summary / nextAction / reminderAt | 0003 | project-visit（read/write + 动作级已有） | 可直接复用 + 需要新增 API |
| ProjectProgress | projectId / recordedAt / progressPercent / summary | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectAcceptance | projectId / name / expectedDate/actualDate / result(4) / resultNote | 0003 | 无 | 需要新增 API + 需要补权限 |
| ProjectClosure | projectId 唯一(1:1) / closedAt / reason / summary | 0003 | 无 | 需要新增 API + 需要补权限 |

### 1.2 枚举（已有，直接复用）

- `ProjectStage`（11）：LEAD/QUALIFIED/SOLUTION/QUOTATION/SAMPLING/TESTING/SMALL_BATCH/MASS_SUPPLY/PAUSED/FAILED/CLOSED
- `StakeholderRole`（5）：REQUESTER/TECHNICAL/PURCHASER/DECISION_MAKER/END_USER
- `PaymentStatus`（4）：UNPAID/PARTIAL/PAID/OVERDUE
- `MilestoneStatus`（4）：PLANNED/IN_PROGRESS/COMPLETED/DELAYED
- `TaskStatus`（4）：TODO/IN_PROGRESS/DONE/CANCELLED
- `RiskStatus`（3）：OPEN/MITIGATING/CLOSED
- `VisitType`（5）：VISIT/PHONE/VIDEO/MEETING/OTHER
- `AcceptanceResult`（4）：PASSED/CONDITIONAL_PASS/FAILED/PENDING

### 1.3 复用基础（不重复建设）

| 能力 | 复用对象 | 说明 |
| --- | --- | --- |
| 附件 | `FileAttachment`（File Center，businessType/businessId 通用，已支持 project） | **ProjectDocument 不建表**，直接挂 FileAttachment（businessType="project"） |
| 标签 | `Tag` 主数据 + `ItemTag` 同构 | **ProjectTag 复用 Tag 主数据**，新增 ProjectTag Relation（与 ItemTag/PartnerTag/CustomerTag 同构，@@unique([projectId, tagId])） |
| 状态历史 | `WorkflowHistory` / `WorkflowInstance` / `AuditLog` | **ProjectStatusHistory 不建表**：阶段流转走 WorkflowInstance（businessType="project"）+ WorkflowHistory 记录前后状态；普通变更走 AuditLog |
| 项目价格 | `PricingEngineService.resolvePrice()` + `QuotationPriceSnapshot` | **ProjectPriceReference 不复制价格字段**：ProjectProduct 只保存 quantity/note，价格通过 resolvePrice() 计算并落 QuotationPriceSnapshot；如需项目级约定价，用 partnerPrice（BusinessPartner 级）或快照引用 |
| 项目编号 | `DocumentSequence`（docType="PROJECT" 已有） | code 生成复用 |

---

## 2. 增量模型建议

### 2.1 新增 ProjectTag（唯一建议新增的表）

```prisma
model ProjectTag {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tagId     String
  tag       Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  // 统一审计字段（isActive/createdById/updatedById/approvedById/approvalStatus/version/deletedAt/createdAt/updatedAt）
  @@unique([projectId, tagId])
  @@index([projectId])
  @@index([tagId])
  @@index([deletedAt])
}
```
- 与 `ItemTag`（3054 行）同构；CTO #2075 注释已预留 "PartnerTag/ItemTag/ProjectTag 三张 Relation"

### 2.2 不建表项（复用结论）

| 建议项 | 结论 | 依据 |
| --- | --- | --- |
| ProjectDocument | **不建表** | FileAttachment 已支持 businessType="project" + businessId，File Center 统一存储（ADR-0008） |
| ProjectStatusHistory | **不建表** | WorkflowInstance(businessType="project") + WorkflowHistory(beforeStatus/afterStatus) 覆盖阶段流转；AuditLog 覆盖普通变更 |
| ProjectPriceReference | **不建表** | resolvePrice() 统一入口 + QuotationPriceSnapshot 固化定价链；禁止项目模块自行计算（CTO 红线） |
| ProjectDependency | **暂不建表** | 3C-5 无项目依赖编排需求；若 Sprint 4 Quotation 需要任务依赖，届时按需评估（本轮不改） |

### 2.3 ProjectProduct 价格改造（补字段，不改主数据）

- 保留：`itemId→Item`（Restrict）、`quantity`、`note`（不复制 Item 主数据）
- **unitPrice 保留为历史快照兼容字段**（现有数据可读），新增行为约定：写操作走 `POST /api/pricing/resolve` 返回快照，ProjectProduct 不再手工填价
- 可选补字段（待 CTO 确认）：`priceSnapshotId String?` → QuotationPriceSnapshot（引用完整定价链），不复制价格明细

### 2.4 Project 补字段建议（待 CTO 确认，最小增量）

| 字段 | 类型 | 理由 |
| --- | --- | --- |
| `priority String?` | 高/中/低 | 项目优先级（当前缺失） |
| `progressPercent Decimal?` | 5,2 | 汇总进度（当前只存 ProjectProgress 明细，无汇总字段） |
| `stageChangedById String?` / `stageChangedAt DateTime?` | 审计 | 阶段流转留痕（配合 WorkflowHistory） |

> 若 CTO 认为 WorkflowHistory 已足够，stageChanged* 可不加。**默认建议只加 priority + progressPercent**。

---

## 3. API 规划（16 路由）

| # | 路由 | 权限 | 说明 |
| --- | --- | --- | --- |
| 1 | GET/POST `/api/project-opportunities` | project-opportunity:view/create | 分页/搜索/code/name/stage/customerId/ownerId |
| 2 | GET/PATCH/DELETE `/api/project-opportunities/{id}` | view/edit/delete | 乐观锁 + 软删除 |
| 3 | POST `/api/project-opportunities/{id}/convert` | project-opportunity:create + project:create | **Opportunity→Project 转换（事务）** |
| 4 | GET/POST `/api/projects` | project:view/create | 分页/搜索/code/name/stage/customerId/ownerId/status |
| 5 | GET/PATCH/DELETE `/api/projects/{id}` | view/edit/delete | 乐观锁 + 软删除；结项后禁改关键字段 |
| 6 | GET/POST `/api/projects/{id}/stakeholders` + `/{sid}` | project-stakeholder:view/create/edit/delete | 客户关系人（与成员分开） |
| 7 | GET/POST `/api/projects/{id}/members` + `/{mid}` | project-member:* | 内部成员（userId 可空） |
| 8 | GET/POST `/api/projects/{id}/milestones` + `/{mid}` | project-milestone:* | 里程碑 + 交付成果 |
| 9 | GET/POST `/api/projects/{id}/tasks` + `/{tid}` | project-task:* | 任务（可挂里程碑） |
| 10 | GET/POST `/api/projects/{id}/budgets` + `/{bid}` | project-budget:* | 预算 |
| 11 | GET/POST `/api/projects/{id}/expenses` + `/{eid}` | project-expense:* | 费用 |
| 12 | GET/POST `/api/projects/{id}/products` + `/{pid}` | project-product:* | 项目产品（价格走 resolvePrice） |
| 13 | GET/POST `/api/projects/{id}/risks` + `/{rid}` | project-risk:*（已有） | 风险 |
| 14 | GET/POST `/api/projects/{id}/visits` + `/{vid}` | project-visit:*（已有） | 走访/沟通 |
| 15 | GET/POST `/api/projects/{id}/progress` + `/{prid}` | project-progress:* | 进展（写时同步 Project.progressPercent） |
| 16 | GET/POST `/api/projects/{id}/acceptance` + `/{aid}`、`/closure` + `/{cid}`、`/tags`、`/attachments` | project-acceptance/closure/tag/attachment:* | 验收/结项/标签/附件（附件复用 File Center） |

**统一约定**（沿用 API_GUIDELINES.md）：
- 分页：`page/pageSize`（≤100）；搜索：`code/name contains`；筛选：枚举精确匹配；排序：`sortBy/sortOrder`
- 乐观锁：PATCH 必带 `version`，冲突 409 VERSION_CONFLICT
- 软删除：DELETE 置 deletedAt + isActive=false；查询过滤 deletedAt=null
- 审计：writeAuditLog 全量；阶段流转额外写 WorkflowHistory
- Workflow 接入点：Project 提交/阶段流转/结项可触发 `workflow-instance`（businessType="project"），审批通过回调更新 approvalStatus/status
- 项目阶段流转：`PATCH /api/projects/{id}` 仅允许按 ProjectStage 合法顺序迁移（见 5.4），非法跳转 400/409
- Opportunity→Project 转换：**事务内**（见 5.1）

---

## 4. RBAC 规划（+12 模块，动作级统一）

现有：`project-opportunity / project / project-visit / project-risk`（read/write + 动作级已有）
新增 12 个动作级模块（view/create/edit/delete/approve/audit/export/import/assign/close）：

```
project-stakeholder
project-member
project-milestone
project-task
project-budget
project-expense
project-product
project-progress
project-acceptance
project-closure
project-tag
project-attachment
```

- 不新建大而散的权限体系，沿用现有 `SEED_ACTION_MODULES` 机制追加字符串即可
- SUPER_ADMIN/ADMIN 全量；MANAGER project 主档 + 子资源读写；MEMBER 只读 + view

---

## 5. 核心业务规则（CTO 定稿，实现必须遵守）

### 5.1 Opportunity → Project 转换（唯一入口，事务）

- 转换入口：`POST /api/project-opportunities/{id}/convert`
- **Opportunity 只能转换一次**：Project.opportunityId 唯一约束天然保证；重复转换 → 409
- 转换后**保留来源 Opportunity**（不删除、不归档字段；Project.opportunityId 保留引用）
- 事务内容：创建 Project（复制客户/财务字段/ownerId/description）→ 回写 Opportunity 状态（QUOTATION→SAMPLING 联动）→ 写 AuditLog → 触发 WorkflowInstance（如金额审批）
- 转换后 Opportunity 关键字段锁定（stage 不再推进，仅可读+审计）

### 5.2 结项规则

- **已验收项目才能正常结项**：至少一条 ProjectAcceptance.result=PASSED（或有条件通过且已闭环），否则 409
- **结项前检查**：未完成任务（ProjectTask.status != DONE/CANCELLED）→ 警告或 409（配置化）；未关闭风险（ProjectRisk.status != CLOSED）→ 警告或 409；回款状态（PaymentStatus=PAID 或 receivableBalance=0）→ 未回款不允许正常结项（允许 FAILED 结项例外）
- 结项后（ProjectClosure 存在）**禁止修改关键字段**：stage/customerId/expectedContractAmount/expectedProfit/receivedAmount/invoicedAmount/receivableBalance/failureReason；子资源仍可追加进展/走访（审计）

### 5.3 成员与关系人分开

- `ProjectMember`（内部团队，userId 可空）与 `ProjectStakeholder`（客户关系人，5 类角色）**语义隔离**，API/权限/UI 均分开
- 不合并、不互转

### 5.4 项目阶段流转

- 合法顺序：LEAD→QUALIFIED→SOLUTION→QUOTATION→SAMPLING→TESTING→SMALL_BATCH→MASS_SUPPLY；任意阶段→PAUSED/FAILED；MASS_SUPPLY/FAILED/PAUSED→CLOSED
- 跳过/倒退（除 FAILED/CLOSED）→ 400；每次流转写 WorkflowHistory（beforeStatus/afterStatus）+ AuditLog
- PAUSED 仅允许恢复原阶段或 FAILED/CLOSED

### 5.5 其他红线

- ProjectProduct 只保存项目引用、数量、技术需求（note），**不复制 Item 主数据**；价格必须调用 `resolvePrice()`，禁止项目模块自行计算
- 附件必须走 File Center（FileAttachment businessType="project"），**不增加项目专属附件存储**
- 状态变化必须写 Workflow/Audit；金额一律 Decimal
- 不提前开发 Quotation；不开发前端业务页面

---

## 6. 迁移 / Seed / 文档交付（本轮仅设计）

| 交付物 | 内容 | 状态 |
| --- | --- | --- |
| Schema 增量（待审核后） | ProjectTag 新表 + Project 补字段（priority/progressPercent） | 待 CTO 审核 |
| 迁移（待审核后） | 0013_project_enhancement（仅新增/加列） | 待 CTO 审核 |
| Seed | SEED_ACTION_MODULES +12 模块；ProjectTag 示例 | 待 CTO 审核 |
| API | 16 路由（33 文件左右，逐个提交） | 待 CTO 审核 |
| OpenAPI / QA / Test Cases / ADR-0014 | 同 Price Foundation 节奏 | 待 CTO 审核 |

---

## 7. 待 CTO 决策项

1. Project 补字段：仅 `priority + progressPercent`（默认建议），还是连 `stageChangedById/stageChangedAt` 一起加？
2. ProjectProduct 是否补 `priceSnapshotId` 引用 QuotationPriceSnapshot（推荐）？
3. 结项检查（未完成任务/未关闭风险）是**强制 409** 还是**警告放行**（配置开关）？
4. ProjectDependency 是否 Sprint 4 再评估（默认）？
5. ProjectTag 命名空间：直接复用 Tag 主数据（推荐），还是项目私有标签字典？

> 审核通过后按"只写代码，不验证"节奏实现：Schema 增量 → 迁移 0013 → Seed → API（逐个提交）→ OpenAPI/QA/ADR → CI 全绿 → CTO 复审。
