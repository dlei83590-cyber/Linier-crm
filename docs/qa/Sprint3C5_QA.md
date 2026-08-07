# Sprint 3C-5 QA — Project Foundation（项目领域增强 + CRUD/API Foundation）

> Sprint：3C-5 | 模块：Project Foundation Enhancement | PR：#11（已合并，merge commit 60c785b） | 日期：2026-08-07
> 状态：✅ Completed（v0.5.0-alpha 发布，Sprint 3 全部完成）
> 关联：ADR-0014（Accepted）、Sprint3C5_Design.md、EVENTS.md、API_GUIDELINES.md、ERROR_CODES.md
> 架构原则（CTO 审核锁定，5 项决策）：Project 最小增量 priority+progressPercent；ProjectProduct.priceSnapshotId（SetNull）；
> 结项默认强制阻断 + 带权限强制结项（project:close + project:approve）；ProjectDependency 延期；ProjectTag 复用全局 Tag。

## 1. 交付范围

### 1.1 Schema 增量（+1 模型 → 总计 99 模型 / 48 枚举）
| 类型 | 模型/字段 | 说明 |
| --- | --- | --- |
| 新表 | ProjectTag | 复用全局 Tag 主数据，与 CustomerTag/PartnerTag/ItemTag 同构，@@unique([projectId, tagId]) |
| 补字段 | Project.priority | String?（高/中/低，CTO 决策 1：最小增量，不加 stageChanged*） |
| 补字段 | Project.progressPercent | Decimal?（5,2）汇总进度，明细在 ProjectProgress |
| 补字段 | ProjectProduct.priceSnapshotId | String? 可空 → QuotationPriceSnapshot（SetNull；CTO 决策 2） |
| 补字段 | ProjectOpportunity.convertedAt/convertedBy | 唯一入口 convert 回写 |

不建表项：ProjectDocument（复用 FileAttachment businessType="project"）/ ProjectStatusHistory（复用 WorkflowHistory+AuditLog）/ ProjectPriceReference（复用 resolvePrice+Snapshot）/ ProjectDependency（延期，CTO 决策 4）。

### 1.2 迁移 0013_project_foundation
- ALTER ProjectOpportunity + convertedAt/convertedBy；ALTER Project + priority/progressPercent；ALTER ProjectProduct + priceSnapshotId（FK SetNull）
- CREATE ProjectTag（唯一约束 + 3 索引 + 2 FK）；仅新增/加列，不重建 14 个既有 Project 模型

### 1.3 RBAC（+12 子模块，动作级 view/create/edit/delete/approve/audit/export/import/assign/close）
project-stakeholder / project-member / project-milestone / project-task / project-budget / project-expense / project-product / project-progress / project-acceptance / project-closure / project-tag / project-attachment
（project-opportunity / project / project-visit / project-risk 已有）

### 1.4 API（16 路由 / 34 文件）
- project-opportunities 主档 + [id] + **convert（唯一入口，事务）**
- projects 主档 + [id] + **transition（阶段流转集中校验）** + **close（结项检查+强制结项双权限）**
- 子资源：stakeholders / members / milestones / tasks / budgets / expenses / products（价格快照引用）/ risks / visits / progress（同步汇总）/ acceptance / closure / tags / attachments（复用 File Center）

### 1.5 Domain Events（EVENTS.md 注册）
ProjectOpportunityConverted / ProjectCreated / ProjectStageChanged / ProjectMemberAssigned / ProjectMilestoneCompleted / ProjectRiskRaised / ProjectRiskClosed / ProjectAccepted / ProjectClosed / ProjectForceClosed

## 2. 测试要点（CTO 指定覆盖）

| # | 场景 | 验证方式 |
| --- | --- | --- |
| T1 | Opportunity 重复转换 | convert 二次调用 → 409（convertedAt + Project.opportunityId 唯一双重校验） |
| T2 | 转换事务原子性 | 事务中任一步失败不留下半成品 Project（DocumentSequence/Project/回写同事务） |
| T3 | 非法阶段跳转 | transition 跳级/倒退（除 FAILED/CLOSED）→ 409；PATCH 不开放 stage 字段 |
| T4 | 旧 version 更新冲突 | PATCH/transition/close 带旧 version → 409 VERSION_CONFLICT |
| T5 | 结项-未完成任务 | 存在 TODO/IN_PROGRESS 任务 → 409（非 force） |
| T6 | 结项-开放高风险 | 存在 OPEN/MITIGATING 风险 → 409（非 force） |
| T7 | 结项-未验收 | 无 PASSED 验收项 → 409（非 force） |
| T8 | 结项-应收余额 | paymentStatus≠PAID 或 receivableBalance>0 → 409（非 force） |
| T9 | 无权限强制结项 | 无 project:approve 的 force close → 403 |
| T10 | 有权限强制结项 | project:close+project:approve + force+reason → 200，写 AuditLog+ProjectProgress+Closure |
| T11 | ProjectProduct 价格快照保留 | priceSnapshotId 保存且引用完整定价链；不直接引用 PriceListItem |
| T12 | 重复 ProjectTag | 同 projectId+tagId 二次绑定 → 409 |
| T13 | 结项后关键字段修改禁止 | close 后 PATCH stage/客户/金额/回款 → 409 |

## 3. 测试清单（按模块）

### 3.1 Project Opportunities
- [ ] O1 创建（code 唯一，重复 → 409）
- [ ] O2 列表过滤 code/name/stage/customerId/ownerId
- [ ] O3 PATCH 乐观锁；已转换（convertedAt）后禁止改关键字段 → 409
- [ ] O4 软删除；已转换禁止删除 → 409

### 3.2 Convert（唯一入口）
- [ ] C1 转换成功：创建 Project（code 由 DocumentSequence 生成）、复制客户/财务/负责人、回写 convertedAt/convertedBy、写 AuditLog
- [ ] C2 重复转换 → 409
- [ ] C3 机会不存在 → 404
- [ ] C4 禁止通过 POST /projects 模拟转换（不设置 opportunityId 关联）

### 3.3 Projects 主档
- [ ] P1 创建（code 唯一）
- [ ] P2 列表过滤 stage/priority/customerId/ownerId + 子资源计数
- [ ] P3 详情含全部子资源 + tags + closure
- [ ] P4 PATCH 不允许 stage（走 transition）；结项后禁改 → 409
- [ ] P5 软删除；已结项禁止删除 → 409

### 3.4 Transition（阶段流转集中校验）
- [ ] S1 正向推进：QUOTATION→SAMPLING → 200
- [ ] S2 任意阶段→PAUSED/FAILED → 200
- [ ] S3 MASS_SUPPLY/FAILED/PAUSED→CLOSED → 200
- [ ] S4 跳级（LEAD→SAMPLING）→ 409
- [ ] S5 倒退（MASS_SUPPLY→SAMPLING）→ 409
- [ ] S6 流转写 AuditLog（beforeStage/afterStage）

### 3.5 Close（结项）
- [ ] K1 正常结项（任务完成/风险关闭/已验收/回款完成）→ 200
- [ ] K2 未完成任务 → 409
- [ ] K3 未关闭风险 → 409
- [ ] K4 未验收 → 409
- [ ] K5 有应收余额 → 409
- [ ] K6 force=true 无 project:approve → 403
- [ ] K7 force=true 双权限+reason → 200，Closure+Progress+Audit 落库
- [ ] K8 force=true 无 reason → 400

### 3.6 子资源（stakeholders/members/milestones/tasks/budgets/expenses/products/risks/visits/progress/acceptance/closure/tags/attachments）
- [ ] R1 各自 CRUD + 乐观锁 + 软删除
- [ ] R2 members 与 stakeholders 语义隔离（独立 API/权限）
- [ ] R3 products 价格走 priceSnapshotId（resolvePrice 生成），不手工填价
- [ ] R4 progress 写入同步 Project.progressPercent
- [ ] R5 tags 复用全局 Tag；attachments 复用 File Center（businessType="project"）

### 3.7 RBAC
- [ ] A1 未认证 → 401
- [ ] A2 无模块权限 → 403（如 MEMBER 调 project-stakeholder:create）
- [ ] A3 MANAGER 动作级全量

## 4. 边界与异常
| 场景 | 预期 |
| --- | --- |
| 软删除后按 id 查询 | 404 NOT_FOUND |
| 结项检查 4 项未通过 + force | 需双权限+原因，否则 409/403 |
| 阶段流转非法 | 409（不破坏乐观锁语义） |
| ProjectProduct 引用已软删快照 | SetNull 不阻断项目读取 |

## 5. 验收标准
1. 增量：不重建 14 个既有 Project 模型；仅 +1 表（ProjectTag）+ 4 字段
2. 复用：附件走 File Center、标签走全局 Tag、价格走 resolvePrice+Snapshot、状态历史走 Workflow/Audit
3. 转换唯一入口：convert 事务，Opportunity 只能转一次
4. 结项规则：默认阻断 + 双权限强制结项，均留痕
5. 阶段流转集中校验：PATCH 不可改 stage
6. CI 全绿：Lint / Type Check / Unit Test / Build / Secret Scan
