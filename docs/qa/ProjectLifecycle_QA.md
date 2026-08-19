# Project Lifecycle — QA 专项验收文档（L0-L2-B1）

- 日期：2026-08-19
- 关联：docs/reviews/ProjectLifecycle_Contract_Audit.md（收口）、PR #77-#83、ADR-0030
- 状态：**CI 验证通过（契约单测 `1f21fc9`/`5d8a9b6` + G-2 `bce595d` 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）**

## 1. 范围

Project Lifecycle 契约面（Acceptance / Transition / Close / Attachments）L0-L2-B1 的验收记录，与 Contract Audit 收口同步。

## 2. 静态验收（本地已核）

- [x] **L0 lifecycle contract integrity**：force-close 时 progressPercent 合并进 single Project close mutation（无半结项）
- [x] **stage authoritative**：CLOSED gate 以 Project.stage 为准；assertProjectWritable 锁序 Project→Child（B2-0 延续）
- [x] **L1-A closure 不可删除**：closure DELETE 已移除（G-2，`bce595d`）→ DELETE 返回 405；恢复走正式 reopen 流程（DESIGN HOLD）
- [x] **L1-B attachment contract**：capability 驱动 + CLOSED 写门禁
- [x] **L2-A Acceptance**：Add/Edit/Delete + changed-only 按提交语义比较
- [x] **L2-B0 allowedTransitions Read Contract**：后端权威投影（唯一候选来源，前端不复制状态机）
- [x] **L2-B1 Transition action**：前端命令式触发 + 后端权威校验（锁后 version CAS + CLOSED 封死 + isLegalTransition）

## 3. 单测证据（CI Unit tests 已通过）

- `project-transition.test.ts`：isLegalTransition 全路径（正向/倒退/跳级/PAUSED 恢复/FAILED/CLOSED）+ getAllowedProjectTransitions 候选投影
- `api-helpers.test.ts`：assertProjectWritable（NOT_FOUND→409 code=NOT_FOUND / CLOSED→409 fail-closed / 可写 ok:true 携带 locked project）

## 4. 需在生产 Runtime 验收（部署后执行）

- [ ] 项目详情：Acceptance Tab 增删改（changed-only 语义）、附件上传/删除（capability 显隐）
- [ ] 阶段流转：allowedTransitions 候选展示正确；Transition 后 stage/version 更新；非法流转 409；CLOSED 项目无流转入口
- [ ] 结项：close 后 closure 展示、CLOSED gate 全子资源写 409；closure DELETE → 405
- [ ] force-close：progressPercent 合并正确（无半结项）
- [ ] 并发：stale version → 409 + 重新加载（前端 stale panel）

## 5. 已知限制 / 边界

- reopen 流程为 DESIGN HOLD（恢复项目需正式 reopen Gate）
- 事件总线未落地（lifecycle 审计事件经 AuditLog 留痕）
- 本 QA 为静态 + 单测证据；Runtime Acceptance 待生产部署后由 CIO/CTO 执行（如实声明未执行）

## 6. 验收人

- CI 验证：GitHub Actions（Quality Gates / Build / Secret Scanning）
- Runtime Acceptance：待生产部署后执行