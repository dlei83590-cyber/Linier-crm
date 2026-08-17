# Project Lifecycle Contract Audit — Acceptance / Transition / Close / Attachments

- 模块：`projects` 生命周期能力（F2-4B2 分类 HARD HOLD → 本审计解锁判定）
- 状态：**Audit 完成（FINAL / GAP / HOLD matrix 见下）；审计 FINAL 前不写任何 UI、不开 lifecycle implementation PR**
- 基线：main `dcefea3e`（2026-08-17，含 PR #75 RBAC 修复）
- 关联：docs/frontend/contract-cards/project-subresource-actions.md（F2-4B2 Audit，HARD HOLD 段）、docs/ADR/ADR-0028、docs/qa/B2-2_Runtime_QA.md
- 方法：只读源码审计（真实 route 文件 + permission + EVENTS.md + capabilities 投影），不做 runtime 变更

---

## 1. FINAL / GAP / HOLD matrix

| 能力                          | API 存在性                                                                                                          | Permission                                                                   | Stage machine / CLOSED semantics                                                                                                                   | Version/CAS                                                                                               | Audit / Domain Event                                                                                                                                       | 副作用 / Aggregate projection                                                                                                                                                                                                                                     | **判定** |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Acceptance**（验收项 CRUD） | ✅ GET/POST `/acceptance` + GET/PATCH/DELETE `/acceptance/:aid`                                                     | ✅ `project-acceptance:view/create/edit/delete`（PR #75 已注册）             | ⚠️ **无 CLOSED write gate**（POST/PATCH/DELETE 均无 `assertProjectWritable`；对比 budgets/expenses/progresses/risks/visits/products/tags 均有）    | ✅ PATCH version CAS（stale → 409 VERSION_CONFLICT + increment）；DELETE 无 CAS（软删，与既有子资源一致） | ✅ writeAuditLog；⚠️ `ProjectAccepted` 仅注释未实际发布（EVENTS.md 注册，事件总线落地前 AuditLog 承载——项目既定惯例）                                      | ⚠️ close 的"未验收阻断"读取 acceptance.result=PASSED，但 acceptance 本身在 CLOSED 后仍可写 → 语义不一致                                                                                                                                                           | **GAP**  |
| **Transition**（阶段流转）    | ✅ POST `/transition`（唯一入口，PATCH 不开放 stage）                                                               | ⚠️ `project:edit`（复用 edit 权限，无专用 `project:transition` 权限码）      | ✅ lockProjectHeader FOR UPDATE + CLOSED fail-closed（锁后显式 `stage==="CLOSED"` → 409）+ `isLegalTransition` 集中校验（正向推进/暂停/失败/结项） | ✅ version CAS（锁后权威版本）                                                                            | ✅ writeAuditLog；⚠️ `ProjectStageChanged` 仅注释未发布；**⚠️ 注释声称"每次流转写 WorkflowHistory + AuditLog"，实现只写 AuditLog（WorkflowHistory 未落）** | ✅ 仅 stage + version，无其他副作用                                                                                                                                                                                                                               | **GAP**  |
| **Close**（结项）             | ✅ POST `/close`（唯一入口，非 PATCH 改状态）                                                                       | ✅ `project:close`；force 需叠加 `project:approve`（双权限，禁止 edit 绕过） | ✅ lockProjectHeader + 已结项 409 + 结项检查（未完成任务/未关闭风险/未验收/未回款应收 → 非 force 409）；force 通过后 stage=CLOSED + version+1      | ✅ version CAS（锁后权威版本）                                                                            | ✅ writeAuditLog（project.close / project.force-close）；⚠️ `ProjectClosed/ProjectForceClosed` 仅注释未发布                                                | ⚠️ **force close 直接 `tx.projectProgress.create(progressPercent=100)` 但不同步 `Project.progressPercent`**（绕过 progress route 的 aggregate 维护逻辑）→ CLOSED 项目 header 与明细记录不一致（smoke 实测：force close 后 header=null 但存在 100% progress 记录） | **GAP**  |
| **Closure**（结项详情 1:1）   | ✅ GET `/closure`（1:1）+ DELETE `/closure`                                                                         | ✅ `project-closure:view/delete`（PR #75 已注册）                            | ⚠️ **DELETE 仅软删 closure 记录、不改变项目 stage**（注释明确"不改变项目阶段"）→ 可产生"stage=CLOSED 但无 closure 记录"的不一致状态                | —（DELETE 无 CAS，软删）                                                                                  | ✅ writeAuditLog                                                                                                                                           | ⚠️ 撤销结项语义未闭环（无"恢复 stage"路径）                                                                                                                                                                                                                       | **HOLD** |
| **Attachments**（附件）       | ✅ GET/POST `/attachments` + DELETE `/attachments/:aid`（复用 File Center `FileAttachment` businessType="project"） | ✅ `project-attachment:view/create/delete`（PR #75 已注册）                  | ⚠️ **无 CLOSED write gate**（POST/DELETE 均无 `assertProjectWritable`）                                                                            | —（无 PATCH；[aid] 仅 DELETE，无单条 GET/PATCH）                                                          | ✅ writeAuditLog                                                                                                                                           | ⚠️ **capabilities 投影无 `attachments` 键**（project GET capabilities 缺该键 → 前端无法按权限 gate 附件入口）                                                                                                                                                     | **HOLD** |

## 2. 判定说明

### 2.1 Close — 最接近 FINAL，但有一处 aggregate projection 不一致（GAP）

- Backend contract 完整：双权限（close + approve）、锁序、CAS、结项检查、closure 记录、AuditLog——与 B2-0 锁纪律一致，且 Runtime 已验证 force close 200 / CLOSED 后子资源 409。
- **GAP**：force close 分支直接 `tx.projectProgress.create({ progressPercent: 100 })`，**未同步 `Project.progressPercent`**。B2-2B（PR #74）确立的 aggregate 纪律是 progress 记录 create/edit/delete 均维护 header；close 绕过 route 直写记录，破坏该不变量。smoke 实测（`dcefea3e`）：删除全部 progress 后 force close → header=null，但 DB 存在 progressPercent=100 的记录。
- 修复方向（审计建议，不实现）：force close 的 progress 备注要么**同步 header=100**，要么**不写 progressPercent（仅备注，如 null）**，与 aggregate 语义二选一闭环。

### 2.2 Transition — 实现完整，但 doc/code 不一致（GAP）

- Stage machine 集中校验 + 锁 + CAS + CLOSED fail-closed 均到位。
- **GAP**：route 注释声明"每次流转写 WorkflowHistory + AuditLog"，实现只写 AuditLog（grep 无 workflowHistory 写入）。要么补 WorkflowHistory 落库，要么修正注释，避免 contract 文档漂移（与 PR #75 暴露的"文档-实现漂移"同源教训）。
- 权限用 `project:edit`：可接受但需在 UI contract 中明确（无专用 transition 权限码），不构成 Blocking。

### 2.3 Acceptance / Attachments — CLOSED write gate 缺失（GAP/HOLD）

- B2-0（PR #70）已为 budgets/expenses/progresses 补 `assertProjectWritable`，risks/visits/products/tags/members/tasks/milestones/stakeholders 已有；**acceptance / attachments 是仅剩未接入 CLOSED gate 的子资源**。CLOSED 项目仍可增删改验收项与附件。
- Attachments 另缺 capabilities 投影键（前端无法 gate 入口）→ HOLD。
- 修复方向（审计建议，不实现）：acceptance/attachments 写路径补 `assertProjectWritable(tx, id)`（与 B2-0 同一锁纪律）；project GET capabilities 补 `attachments` 键。

### 2.4 Closure — 语义未闭环（HOLD）

- DELETE closure 记录不改变 stage → "CLOSED 但无结项记录" 的不一致态，且无恢复路径。撤销结项是否应恢复 stage（如回到 MASS_SUPPLY/FAILED）需 CTO 拍板语义，当前 contract 不完整 → HOLD。

## 3. 结论

| 结论                                               | 能力                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **FINAL**（可进入 implementation 指令）            | 无（本轮 4 项均未达 FINAL；Close 最接近，待 aggregate 一致化修复后复审）                               |
| **GAP**（backend 补丁后可复审为 FINAL）            | Close（progressPercent 同步）、Transition（WorkflowHistory 落库或注释修正）、Acceptance（CLOSED gate） |
| **HOLD**（语义/契约未闭环，需 CTO 决策或能力补齐） | Closure（撤销结项语义）、Attachments（CLOSED gate + capabilities 键）                                  |

- 按 owner 基线：**本审计输出不触发任何 lifecycle 实现 PR**；GAP 项先走 backend 小补丁（独立 PR）复审，HOLD 项等 CTO 语义决策。
- Governance 备注：`API referenced permission ⊆ ALL_ACTION_PERMISSIONS` CI 静态 Gate 为独立 backlog（ADR-0028），不夹带进 Lifecycle 工作。
