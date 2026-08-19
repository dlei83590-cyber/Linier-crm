# Project Lifecycle Contract Audit — 收口（FINAL / GAP / HOLD matrix）

- 日期：2026-08-19
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ROADMAP（M4.2 / 下一 Governance 项）、PR #77-#83（L0-L2-B1）、ADR-0030、docs/qa/Sprint5C2_QA.md
- 结论：**Contract Audit 收口 —— 无 Blocking GAP；L0-L2-B1 全部 FINAL；GAP/HOLD 见 §3/§4（均非本 Gate 阻塞）**

---

## 1. 审计范围与方法

审计对象：Project Lifecycle 契约面（Acceptance / Transition / Close / Attachments，L0-L2-B1）。
方法：以 main 代码事实为准（git history PR #77-#83 + API 路由存在性 + 前端消费 + CI 状态），非本地运行结果；每项标注证据。

## 2. FINAL / GAP / HOLD Matrix

| # | 契约点 | 实现证据（main） | 状态 | 备注 |
|---|---|---|---|---|
| 1 | **L0 lifecycle contract integrity**：force-close 时 progressPercent 合并进 single Project close mutation（不产生半结项） | projects/[id]/close + projects/[id]/closure route（close mutation 内合并 progress aggregate） | ✅ FINAL | CI 全绿（PR #77） |
| 2 | **stage 为 authoritative**：CLOSED gate 以 Project.stage 为准（不信任前端） | api-helpers.ts assertProjectWritable（lockProjectHeader FOR UPDATE → stage===CLOSED → 409）+ 前端 capability 投影 | ✅ FINAL | 子资源写 Gate 统一（B2-0 先例延续） |
| 3 | **L1-A closure 不可删除**：结项记录为审计事实，禁止 DELETE | projects/[id]/closure route：closure DELETE 已 deprecated（审计只读）；close 为唯一入口 | ✅ FINAL | docs(project) L1-A Closure Contract Decision（a8cb362） |
| 4 | **L1-B attachment contract**：capability 驱动 + CLOSED 写门禁 | projects/[id]/attachments + /[aid] route + assertProjectWritable；前端 capability.attachments | ✅ FINAL | PR #80 |
| 5 | **L2-A Acceptance Tab**：Add/Edit/Delete + changed-only 按提交语义比较（字符串字段不整体覆盖） | projects/[id]/acceptance route + 前端 acceptance Tab（subresource-fields changed-only 比较） | ✅ FINAL | PR #81 + d5810f8 hardening |
| 6 | **L2-B0 Transition Read Contract**：allowedTransitions 由后端权威投影（唯一候选来源） | projects/[id] 详情返回 allowedTransitions: string[]；前端 transition dialog 唯一消费该投影，不复制状态机 | ✅ FINAL | PR #82（2c64252/3e8c881） |
| 7 | **L2-B1 Transition action**：前端命令式触发 + 后端权威校验 | projects/[id]/transition route + 前端 dialog（CLOSED/无候选不显示入口） | ✅ FINAL | PR #83（5f5d1fa） |
| 8 | **Project 子资源写 Gate**（stakeholders/members/milestones/tasks/products/risks/visits/budgets/expenses/progresses） | assertProjectWritable 统一锁序（Project→Child）+ CLOSED 409；B2-1A/B2-1B/B2-2A/B2-2B 全链路 | ✅ FINAL | B2-2 31/31 Runtime Acceptance ACCEPTED |

## 3. GAP（非阻塞，建议纳入 backlog）

| GAP | 说明 | 建议 |
|---|---|---|
| G-1 测试覆盖 | Project Lifecycle 契约（transition 校验/CLOSED gate/closure 不可删）**无自动化单测**（与 5C-2 会计单测前同病） | 对齐 P0-1：为 assertProjectWritable / transition 校验 / closure 语义补 vitest（mock Prisma tx） |
| G-2 closure DELETE 残留 | closure DELETE 仍存在（deprecated）；前端无入口，但 API 面未移除 | 后续 PR 移除 DELETE（保留只读 GET）；本 Gate 不动以避免回归 |
| G-3 审计文档同步 | Project Lifecycle 无独立 QA 文档（B2-2_Runtime_QA 覆盖子资源，未覆盖 L0-L2B1 专项） | 补 ProjectLifecycle_QA.md（runtime 验收清单，待生产部署后执行） |

## 4. HOLD（解除需 CTO 指令或独立 Gate）

| HOLD 项 | 说明 |
|---|---|
| reopen 流程 | L1-A Closure Contract Decision 的设计草案（a8cb362）未批准实现——CLOSED 项目 reopen 属独立 Gate |
| 跨项目 Lifecycle 批量操作/报表 | 无业务需求（BI 域 HOLD，待 20 份报表清单） |
| Lifecycle 事件 Notification 消费 | 事件总线未落地（AuditLog 留痕）；workflow/notification 真实发送后续 |

## 5. 结论

- **L0-L2-B1 契约面 8 项全部 FINAL**（代码事实 + CI 全绿），无 Blocking GAP；**Contract Audit 收口**。
- GAP G-1（lifecycle 单测）为最高优先 backlog（对齐 CTO P0-1 会计单测先例）；G-2/G-3 随后续 PR 处理。
- 本收口与 v0.8.0-alpha 发布同步（ReleaseGate_v0.8.0_Acceptance Gate C 引用）。
- 验收人：CIO 签署；CTO 复核（本文档为审计结论，非运行时验收；Runtime smoke 待生产部署后执行）。