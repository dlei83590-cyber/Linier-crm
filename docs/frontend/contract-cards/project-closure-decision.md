# Project Closure Contract Decision（L1-A，audit only）

- 模块：`projects` Closure（结项事实 1:1）——L0 审计 HOLD 项①
- 状态：**Audit 完成，等待 CTO/owner 裁决**（STOP，不写实现）
- 基线：main `fac2a17`（L0 Backend Integrity FINAL CLOSED 后）
- 关联：docs/frontend/contract-cards/project-lifecycle.md（L0 matrix：Closure=HOLD）、docs/ADR/ADR-0028、EVENTS.md（ProjectClosed/ProjectForceClosed）
- 方法：只读源码审计（route / schema / gate / EVENTS / openapi / 前端消费），不做 runtime 变更

---

## 1. 现状事实（代码证据，main `fac2a17`）

### 1.1 Schema — ProjectClosure 是 1:1 结项事实

```prisma
model ProjectClosure {
  id        String   @id @default(cuid())
  projectId String   @unique          // 1:1
  project   Project  @relation(...)
  closedAt  DateTime @default(now())
  reason    String
  summary   String?
  isActive  Boolean  @default(true)
  version   Int      @default(1)
  deletedAt DateTime?                  // 软删
  approvalStatus ApprovalStatus @default(DRAFT)
  // ...统一审计字段
}
```

### 1.2 Route — 只有 GET + DELETE（无 POST/PATCH）

- `GET /api/projects/:id/closure`（`project-closure:view`，1:1，未结项 404）
- `DELETE /api/projects/:id/closure`（`project-closure:delete`）
  - 注释自述：「撤销结项记录——**仅软删除结项记录，不改变项目阶段**；高级操作」
  - 实现：`projectClosure.update({ deletedAt: new Date(), isActive: false })` + writeAuditLog；**无 version CAS、无 Project header lock、无 stage 联动**

### 1.3 关键审计发现 — DELETE closure 会穿透 CLOSED 保护 gate

`apps/web/src/app/api/projects/[id]/route.ts` 两处 CLOSED gate **依赖 closure 记录存在（且 deletedAt null）**：

| Gate                       | 判定条件                                                                                          | closure 被软删后                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PATCH /api/projects/:id`  | `closure = findFirst({ projectId, deletedAt: null })`；存在 → 409「项目已结项，禁止修改关键字段」 | **gate 失效**：closure 软删后查不到 → CLOSED 项目可 PATCH 关键字段（stage 除外，PATCH schema 不开放 stage） |
| `DELETE /api/projects/:id` | 同上 → 409「项目已结项，禁止删除」                                                                | **gate 失效**：CLOSED 项目可被 DELETE                                                                       |

即：**先 `DELETE /closure`（软删）→ 再 PATCH/DELETE project，CLOSED 保护被绕过**——这不是纯语义问题，是真实 contract 漏洞。

### 1.4 其他事实

- close（`POST /close`）在**同一事务**内 create Closure + stage=CLOSED + version+1（+ force 时 progressPercent=100 + ProjectProgress fact）——closure 与 stage 强一致创建。
- transition 不依赖 closure（只依赖 stage，CLOSED fail-closed 在 transition/close 内独立生效）。
- EVENTS：`ProjectClosed` / `ProjectForceClosed` 已注册（事件总线前 AuditLog 承载）；**无 ProjectReopened 事件**。
- openapi：**closure 路径未注册**（仅 `/close` 有文档）；前端无 closure DELETE UI（仅消费 closure 展示 reason/closedAt）。
- 仓库无 reopen 相关代码（purchase-returns 的 reopen 是 PO 履约语义，与 project 无关）。
- permission：`project-closure` 模块已注册（constants + seed）；capabilities.closure 已投影。

---

## 2. 裁决点 1：当前 `DELETE /closure` 是否应 deprecated/disabled？

**审计建议：是——立即 deprecated/disabled，且补一道防线。**

理由：

1. **制造不一致态**：stage=CLOSED 但无 closure 记录（「已结项但无结项事实」）。
2. **穿透 CLOSED 保护 gate**（1.3）：closure 软删后 project PATCH/DELETE 的已结项 gate 失效——CLOSED 项目可被改关键字段、可被删。
3. **无 CAS / 无锁 / 无 stage 联动**：与 B2-0/L0 确立的 lifecycle 锁纪律（header FOR UPDATE + CAS + 同事务）完全脱节。

处置建议（二选一，需裁决）：

- **A（推荐）**：`DELETE /closure` 直接返回 409（或移除），closure 视为**不可撤销结项事实**；若业务允许撤销，走正式 reopen command（见裁决点 2/3），**绝不把现有 DELETE 改造成 reopen**。
- **B（过渡）**：`DELETE /closure` 加 stage gate——仅当 `stage !== "CLOSED"` 时允许软删（修复 1.3 的 gate 穿透），且文档标记 legacy/unsafe，待 reopen 裁决后决定去留。

---

## 3. 裁决点 2：是否需要正式 reopen command？

**审计建议：需要先回答业务问题——「系统是否允许撤销结项？」**

- **若不允许**：closure = 不可逆事实，DELETE 直接废弃（裁决点 1 方案 A），无需 reopen。
- **若允许**（如：误结项/结项后追加工作）：必须设计正式 `reopen` command，满足 L0 同等级锁纪律。**不允许用 PATCH stage 或 DELETE closure 模拟 reopen。**

---

## 4. 裁决点 3（若需要 reopen）：完整设计草案

> 供裁决参考；裁决后才进入 Contract Design 细化与实现。

### 4.1 Endpoint / Permission

- `POST /api/projects/:id/reopen`
- 权限：建议独立权限码（如 `project:reopen`，与 `project:close` 对仗）或复用 `project:approve`——**需裁决**（倾向独立权限码，避免 close/reopen 共用普通 edit）。

### 4.2 State / CAS / 锁（对齐 L0 锁纪律）

- `lockProjectHeader` FOR UPDATE（同一事务）
- version CAS（锁后权威版本，stale → 409 VERSION_CONFLICT）
- 前置条件：`stage === "CLOSED"` 且存在有效 closure 记录（deletedAt null）——非 CLOSED → 409
- 同一事务内：stage 回退到目标 stage + version+1

### 4.3 目标 stage 规则（需裁决）

- 选项 ①：reopen 请求显式 `targetStage`，仅允许 CLOSED → `MASS_SUPPLY | FAILED`（对应 close 的合法前置），集中校验非法目标
- 选项 ②：固定回退到 `MASS_SUPPLY`（close 的常规前置）
- 建议 ①（显式 + 集中校验，与 transition 同风格），不自动猜测

### 4.4 Aggregate 副作用（需裁决，核心语义）

| 事实                         | 裁决问题                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ProjectClosure`             | reopen 后保留（历史事实，软删或保留）还是删除？建议**保留并标记 reopened**（closure 是历史事实，不改写）          |
| `Project.progressPercent`    | force close 写了 100%——reopen 是否回退到 close 前值？建议：**回退**（记录 reopen 前值，restore）或置 null？需裁决 |
| `ProjectProgress(100%) fact` | 保留（历史事实）还是软删？建议保留                                                                                |
| payment / acceptance         | 已 PASSED 验收项是否保留？建议保留（历史事实）；reopen 后允许新增/修改（CLOSED gate 解除）                        |
| 子资源可写性                 | reopen 后 stage ≠ CLOSED → 所有子资源 write gate 自然恢复可写                                                     |

### 4.5 Audit / Domain Event

- writeAuditLog（action `project.reopen`，before/after stage，operator，reason）
- EVENTS.md 注册 `ProjectReopened`（`{ projectId, fromStage: CLOSED, toStage, reason, reopenedBy }`）——事件总线前 AuditLog 承载（与既有约定一致）

### 4.6 Invariant 汇总

- reopen 前置：`stage === CLOSED` ∧ closure 有效 ∧ version CAS 通过
- reopen 后：`stage === targetStage ∈ {MASS_SUPPLY, FAILED}`（或裁决值）∧ version+1 ∧ 同事务
- CLOSED 保护 gate（PATCH/DELETE project）随 closure 语义恢复一致
- 不绕过：PATCH stage / DELETE closure 均不得作为 reopen 路径

---

## 5. 结论（audit only，不实现）

| 裁决点                  | 审计建议                                                              | 状态   |
| ----------------------- | --------------------------------------------------------------------- | ------ |
| 1. DELETE /closure 处置 | **deprecated/disabled**（方案 A 或过渡 B：补 stage gate 堵 1.3 穿透） | 待裁决 |
| 2. 是否需要 reopen      | 由业务裁决；若允许，走正式 reopen command，不模拟                     | 待裁决 |
| 3. reopen 设计          | 草案见 §4（endpoint/permission/CAS/stage/aggregate/event/invariant）  | 待裁决 |

**STOP — 等 CTO/owner 对 Closure 裁决**（DELETE 去留 + 是否 reopen + 若 reopen 的目标 stage/aggregate 语义）。裁决前不写任何 Closure 实现；Lifecycle UI、Attachments、Governance CI Gate 继续 HOLD。
