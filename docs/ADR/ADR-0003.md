# ADR-0003: 项目领域模型（Opportunity → Project 全生命周期）

- 状态：已接受
- 日期：2026-08-05
- 决策者：CIO（依据中国工业企业实际业务资料设计）+ CTO 审核

## 背景

主数据（Item/BusinessPartner/PriceList/TechnicalStandard，见 ADR-0002）就绪后，
按中国工业企业（直线导轨制造与贸易）实际项目型销售业务补充项目领域模型。

本项目型销售特点：

- 长周期、多阶段：线索 → 准入 → 方案 → 报价 → 试样 → 测试 → 小批量 → 批量供货，
  另有暂停/失败/结项终态
- 多角色关系人：需求人 / 技术人 / 采购人 / 决策人 / 使用人
- 强过程管理：里程碑、任务、走访沟通、风险、验收、结项
- 财务预测先行：客户投入、预计营收/成本/毛利、费用预算、销售目标、回款状态、成功概率

## 决策

### 1. 双段模型：ProjectOpportunity（机会）+ Project（项目）

阶段语义不同、数据关注点不同，拆为两表：

| 维度 | ProjectOpportunity | Project |
| --- | --- | --- |
| 阶段 | LEAD/QUALIFIED/SOLUTION/QUOTATION（售前） | SAMPLING/TESTING/SMALL_BATCH/MASS_SUPPLY/PAUSED/FAILED/CLOSED（售后实施） |
| 关系 | 1 机会 → 0..1 项目（`Project.opportunityId` 唯一，1:1） | 可无机会直接建档 |
| 子模型 | 无 | 12 类子模型（见下） |

`ProjectStage` 枚举共 11 态，覆盖全部阶段，两表共用。

### 2. 财务字段内联

客户投入、预计营收、预计成本、毛利、费用预算、销售目标、回款状态（PaymentStatus：
UNPAID/PARTIAL/PAID/OVERDUE）、竞争对手（Json）、成功概率（DECIMAL(5,2) %）
直接内联在 Opportunity 与 Project 上，避免过度拆分，便于售前漏斗与项目看板统计。

### 3. 项目子模型（全部级联删除，带审计字段）

| 模型 | 职责 | 关键字段 |
| --- | --- | --- |
| ProjectStakeholder | 客户关系人 | role（5 角色枚举）、name/title/department/phone/email |
| ProjectMember | 内部成员 | userId（可空，允许未建账号）、roleInProject、joinedAt/leftAt |
| ProjectMilestone | 里程碑 | plannedDate/actualDate、status（PLANNED/IN_PROGRESS/COMPLETED/DELAYED）、deliverable（交付成果）、delayReason（延期原因） |
| ProjectTask | 任务 | milestoneId（可空）、assigneeId、dueDate、status、priority |
| ProjectBudget | 预算（按科目） | category、amount、currency（默认 CNY） |
| ProjectExpense | 实际费用 | category、amount、currency、incurredAt |
| ProjectProduct | 项目物料 | itemId → Item（Restrict）、quantity、unitPrice |
| ProjectRisk | 风险 | description/impact/probability、mitigation（应对方案）、ownerId（责任人）、status（OPEN/MITIGATING/CLOSED）、closedAt |
| ProjectVisit | 走访/沟通 | visitType（VISIT/PHONE/VIDEO/MEETING/OTHER）、visitedAt、visitorId、contactName、summary、nextAction（下次行动）、reminderAt（提醒） |
| ProjectProgress | 进展 | recordedAt、progressPercent、summary |
| ProjectAcceptance | 验收 | name、expectedDate/actualDate、result（PASSED/CONDITIONAL_PASS/FAILED/PENDING）、resultNote |
| ProjectClosure | 结项（1:1） | closedAt、reason、summary |

### 4. 通用审计与软删除

与主数据一致：createdById/updatedById/approvedById、approvalStatus（默认 DRAFT）、
version、deletedAt、isActive、createdAt/updatedAt（Timestamptz(3)）。

### 5. 外键策略

- 子模型 → Project：`ON DELETE CASCADE`
- Project/Opportunity → BusinessPartner：`ON DELETE RESTRICT`（往来单位不可删）
- ProjectProduct → Item：`ON DELETE RESTRICT`
- Project.opportunityId：`ON DELETE SET NULL` + `@unique`（1:1 可断开）

### 6. 权限

新增 4 模块 8 权限：project-opportunity / project / project-visit / project-risk
各 read/write。SUPER_ADMIN 与 ADMIN 全继承，MANAGER 读写，MEMBER 只读。

## 影响

- 新增迁移 `0003_project_domain`（14 表 + 8 枚举 + 索引 + 外键）
- 前端新增占位页：/project-opportunities /projects /project-visits /project-risks
- 编号复用 DocumentSequence（机会编号/项目编号）

## 后续

销售订单、采购、库存、财务（Sprint 3+）将引用 Project/Item/BusinessPartner，
禁止直接引用字符串编码。本次仅交付数据架构与字段标准，不提前开发业务功能。
