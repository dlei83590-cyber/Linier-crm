# ADR-0014：Project Foundation Enhancement（项目领域增强）

- 状态：**Proposed**（Sprint 3C-5 设计文档，待 CTO 审核后进入实现）
- 日期：2026-08-06
- 关联：ADR-0003（Project 领域，Sprint 2C 双段模型）、ADR-0008（File Center）、ADR-0013（Price Foundation）、Sprint3C5_Design.md、ROADMAP.md
- 背景：Sprint 3C-4 Price Foundation 验收通过（PR #10 合并，v0.5.0-alpha 发布）。Sprint 3C 剩余最后一个子阶段 3C-5 Project Foundation，定位为 **Enhancement + CRUD/API Foundation**——Sprint 2C 已建完整双段模型（迁移 0003_project_domain），本轮**不重建 Project Schema**。

## 决策

### 1. 复用已有 14 模型（不重建、不删改）

ProjectOpportunity / Project / ProjectStakeholder / ProjectMember / ProjectMilestone / ProjectTask / ProjectBudget / ProjectExpense / ProjectProduct / ProjectRisk / ProjectVisit / ProjectProgress / ProjectAcceptance / ProjectClosure —— 全部保留，仅补 API/RBAC/业务规则。

### 2. 增量建表：仅 ProjectTag 一张

- 复用 `Tag` 主数据 + 与 `ItemTag`（3054 行）同构的 ProjectTag Relation（`@@unique([projectId, tagId])`）。
- 依据：CTO #2075 注释已预留 "PartnerTag/ItemTag/ProjectTag 三张 Relation"。

### 3. 不建表项（复用基础，不重复建设）

| 建议项 | 结论 | 依据 |
| --- | --- | --- |
| ProjectDocument | 不建表 | FileAttachment（File Center）businessType="project" 已支持（ADR-0008） |
| ProjectStatusHistory | 不建表 | WorkflowInstance(businessType="project") + WorkflowHistory(beforeStatus/afterStatus) + AuditLog |
| ProjectPriceReference | 不建表 | PricingEngineService.resolvePrice() + QuotationPriceSnapshot（ADR-0013 红线：禁止业务模块自行计算） |
| ProjectDependency | 暂不建表 | 3C-5 无依赖编排需求，Sprint 4 按需评估 |

### 4. Project 补字段（最小增量，默认建议）

- `priority String?`（高/中/低）—— 当前缺失
- `progressPercent Decimal?`（5,2）—— 汇总进度（明细在 ProjectProgress）
- ~~stageChangedById/stageChangedAt~~ —— 默认不加（WorkflowHistory 已足够；待 CTO 确认）

### 5. ProjectProduct 价格改造

- 保留 itemId→Item（Restrict）、quantity、note（不复制 Item 主数据）
- `unitPrice` 保留为历史快照兼容字段；**新增行为**：写操作走 resolvePrice()，禁止手工填价
- 可选：`priceSnapshotId String?` → QuotationPriceSnapshot（待 CTO 确认）

### 6. API：16 路由（子资源挂 /api/projects/{id}/...）

opportunities 主档 + convert（唯一转换入口，事务）；projects 主档 + stakeholders/members/milestones/tasks/budgets/expenses/products/risks/visits/progress/acceptance/closure/tags/attachments。
统一：分页/搜索/筛选/排序、乐观锁 version、软删除、审计、Workflow 接入点、阶段流转校验。

### 7. RBAC：+12 动作级模块（沿用现有机制，不新建权限体系）

project-stakeholder / project-member / project-milestone / project-task / project-budget / project-expense / project-product / project-progress / project-acceptance / project-closure / project-tag / project-attachment
（project-opportunity / project / project-visit / project-risk 已存在）
动作统一：view/create/edit/delete/approve/audit/export/import/assign/close。

### 8. 核心业务规则（CTO 定稿）

1. Opportunity 只能转换一次（Project.opportunityId 唯一约束），转换后保留来源 Opportunity；
2. 转换在事务内完成（复制主数据 + 回写阶段 + 审计 + Workflow）；
3. 已验收项目才能正常结项（Acceptance PASSED，否则 409）；
4. 结项前检查未完成任务/未关闭风险/未回款（强制 409 或警告放行——配置开关，待 CTO 确认）；
5. 结项后禁止修改关键字段（stage/客户/金额/回款/失败原因）；
6. 成员（内部）与关系人（客户）语义隔离，API/权限分开；
7. 阶段流转按 ProjectStage 合法顺序，跳转/倒退 400；流转写 WorkflowHistory + AuditLog；
8. ProjectProduct 只存引用/数量/技术需求，价格一律 resolvePrice()；
9. 附件一律 File Center；状态变化一律 Workflow/Audit；金额一律 Decimal。

## 影响

- Schema：+1 表（ProjectTag）+ Project 2 字段（priority/progressPercent，待确认）→ 预计 99 模型 / 49 枚举
- 迁移：`0013_project_enhancement`（仅新增/加列，不改既有表）
- Seed：SEED_ACTION_MODULES +12 模块；ProjectTag 示例
- API：16 路由（约 33 文件）
- 文档：OpenAPI / Sprint3C5_QA.md / test-cases/Project_API.md / CHANGELOG / RELEASE_NOTES / ROADMAP

## 权衡

- 不建 ProjectDocument/StatusHistory/PriceReference 表 → 复用 File Center / Workflow / Price Snapshot，避免数据孤岛与重复建设（CTO 明确要求）
- ProjectTag 建表 → Tag 统一主数据，三张 Relation 同构，避免项目私有标签字典碎片化
- 补字段最小化（2 个）→ 避免对既有 0003 迁移数据的破坏性变更

## 待确认（CTO 决策项）

1. Project 补字段：仅 priority+progressPercent（默认）还是含 stageChangedById/At？
2. ProjectProduct 是否补 priceSnapshotId（推荐）？
3. 结项检查（未完成任务/风险）强制 409 还是警告放行（配置开关）？
4. ProjectDependency 是否 Sprint 4 再评估（默认）？
5. ProjectTag 复用 Tag 主数据（推荐）还是项目私有字典？

> 审核通过后实现节奏：Schema 增量 → 迁移 0013 → Seed → API（逐个提交）→ OpenAPI/QA/Test Cases/ADR → CI 全绿 → CTO 复审。全程"只写代码，不验证"。
