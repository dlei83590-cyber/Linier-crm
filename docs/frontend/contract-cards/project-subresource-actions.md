# F2-4B2 Contract Audit — Project Subresource Write Operations

- 模块：`projects` 子资源写操作（F2-4B2，CTO #12171）
- 状态：**Audit 完成，等 CTO B2 Audit Review；未写任何 UI**
- 纪律：子资源写操作留在 Project Workspace Tab 内（Tab → Add/Edit Drawer / inline form）；不建 Sidebar 平级模块；不用 `project:edit` 代替细粒度子资源权限

## 分类结论

| 批次 | 子资源 | 判定 |
|------|--------|------|
| **第一批：普通 CRUD / 低风险协作事实** | Stakeholders / Members / Milestones / Tasks / Risks / Visits / Products / Tags | **可开发（8 项）** |
| **第二批：财务/进度类** | Budgets / Expenses / Progresses | **单独核后开放**（金额/进度事实） |
| **HARD HOLD** | Acceptance / Closure / Close / Transition | **不进入 B2 普通 CRUD**（lifecycle / Tier 3 fact actions） |
| 单独核 | Attachments | 上传/下载 contract 单独审计，不混普通表单 |

## 第一批：普通 CRUD（8 子资源）契约事实

全部具备：POST/PATCH（除 Tags）/DELETE 独立路由；`*:view/create/edit/delete` 四权限码（除 Tags 无 edit）；**PATCH 使用 version CAS（VERSION_CONFLICT + version increment）；DELETE 当前不使用 CAS，按资源 id + permission 软删除（deletedAt: new Date()）**；**writeAuditLog** 审计。

| 子资源 | POST 必填 | PATCH 权限 | DELETE 权限 | PATCH CAS | 软删除 | side effect |
|--------|-----------|-----------|-------------|-------------|--------|-------------|
| Stakeholders | role（枚举）+ name | `project-stakeholder:edit` | `project-stakeholder:delete` | ✅ | ✅ | audit log |
| Members | name（userId 可空） | `project-member:edit` | `project-member:delete` | ✅ | ✅ | audit log |
| Milestones | name（status 枚举） | `project-milestone:edit` | `project-milestone:delete` | ✅ | ✅ | audit log |
| Tasks | name（status 枚举） | `project-task:edit` | `project-task:delete` | ✅ | ✅ | audit log |
| Risks | description（status 枚举） | `project-risk:edit` | `project-risk:delete` | ✅ | ✅ | **Domain Event ProjectRiskClosed**（status→CLOSED 时写 closedAt + 触发事件） |
| Visits | summary（visitType 枚举） | `project-visit:edit` | `project-visit:delete` | ✅ | ✅ | audit log |
| Products | itemId | `project-product:edit` | `project-product:delete` | ✅ | ✅ | audit log |
| Tags | tagId | **无 PATCH（无 edit 权限码）** | `project-tag:delete` | — | ✅ | audit log |

**第一批 UI 边界建议**：Stakeholders/Members/Milestones/Tasks/Risks/Visits/Products → Add/Edit/Delete；**Tags → 仅 Add/Delete（backend 无 PATCH/edit）**。

## 第二批：财务/进度类（3 子资源）契约事实

| 子资源 | POST schema | 权限 | PATCH CAS | 说明 |
|--------|-------------|------|-------------|------|
| Budgets | category 必填 + amount 非负必填 + currency/note 可选 | `project-budget:*` | ✅ | 金额事实，字段口径简单 |
| Expenses | category 必填 + amount 非负必填 + currency/incurredAt/note 可选 | `project-expense:*` | ✅ | 金额事实 |
| Progresses | progressPercent 0-100 必填 + summary 必填 + recordedAt 可选 | `project-progress:*` | ✅ | 进度事实；**前端不得自行计算汇总进度，只消费 backend 权威值** |

**第二批 UI 边界建议**：单独做表单（金额/进度字段独立校验），不与第一批机械生成。

## HARD HOLD（lifecycle / Tier 3 fact actions）

- **Acceptance**：`project-acceptance:*` 存在完整 CRUD，但属验收生命周期 → **不进入 B2 普通 CRUD**
- **Closure / Close**：`POST /api/projects/:id/close`（`project:close` + `project:approve`，stage→CLOSED 唯一入口，非 PATCH 改状态）→ **HOLD**
- **Transition**：`POST /api/projects/:id/transition`（`project:edit`，集中校验合法阶段流转，禁止 PATCH 改 stage）→ **HOLD**
- **Attachments**：`project-attachment:view/create/delete`（File Center FileAttachment businessType="project"，POST 关联附件实体 + DELETE 解绑软删）→ **单独核上传/下载 contract**

## 全局发现（B2 开发注意）

- **子资源写路径无显式项目 CLOSED 禁写**：POST/PATCH route 内均查 `project.findFirst`（存在性）但未见 `stage === "CLOSED"` / `projectClosure` 检查（Task 等即使在 CLOSED Project 也可被 API 客户端直接修改/删除）→ **B2 UI 前置 Blocking：必须先完成 backend CLOSED write gate**（B2-0 Backend Integrity PR，CLOSED Project 所有子资源 mutation fail-closed），前端按钮再以 `detail.stage !== "CLOSED"` 为项目状态 Gate（defense-in-depth，非二选一）
- **权限模型**：子资源写操作必须同时满足 `detail.capabilities[resource]`（read capability）+ 对应 `actionPermission("project-<resource>", "create|edit|delete")` + 项目状态；禁止退化为 `project:edit` 单一判断

## 当前状态

STOP — 提交 **CTO F2-4B2 Audit Review**；通过后按批次实施（第一批 → 第二批），HARD HOLD 不启动。
