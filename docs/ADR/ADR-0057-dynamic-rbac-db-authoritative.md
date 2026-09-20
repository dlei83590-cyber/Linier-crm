# ADR-0057：动态 RBAC（DB 权限集为鉴权权威）— Design/Scope Gate

- 状态：**Proposed（提案，待 CTO 裁决；未批准前不得进入实现）**
- 日期：2026-09-20
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0028（静态 RBAC 目录一致性 Gate）、ADR-0029 附录 A（权限树 + 角色权限分配落地及生效边界）、ADR-0045（httpOnly 会话 cookie）、PR #293（权限树/分配）、PR #294（目录零缺口补齐）、AGENTS.md §3/§5

---

## 1. 背景与问题（事实基线，均来自当前 main 实测）

当前访问控制的唯一事实来源是 **静态代码表**：`packages/shared/src/rbac/index.ts` 的 `ROLE_PERMISSIONS`（role **code** → 权限码数组），由 `permissionsForRole` / `hasPermission` 消费。

| 事实 | 实测值 |
|---|---|
| API 判定入口 | `apps/web/src/lib/api-helpers.ts` `requirePermission(user, code)` → `hasPermission(user.roles, code)`；被 **662** 处 `requirePermission(` 引用（**666** 调用点） |
| 前端判定调用点 | `hasPermission(` **245** 处（`.tsx` 228 / `.ts` 17）；其中 `state.user.roles` **80** 处 |
| 会话载荷 | `authenticate()` 只取 `UserRole.role.code`（`SessionUser.roles: string[]`）；`GET /api/auth/me` 返回同一结构 |
| DB 侧 | `Role` / `Permission` / `RolePermissions`(隐式 m2m) / `UserRole` 均已存在；权限目录 seed 注册 **1538** 个 code，且静态 `ALL_ACTION_PERMISSIONS`（1480）⊆ DB 目录（PR #294 后缺口 = 0） |
| DB 权限集的运行时消费者 | **无**。`Role.permissions` 仅被 `/api/roles` CRUD 读写；seed 从不建立 Role↔Permission 关联 |

**后果（今日可复现）**

1. 通过 `POST /api/roles` 新建的自定义角色（role code ∉ 5 个内置 code）→ `permissionsForRole` 返回 `[]` → 任何 `requirePermission` 均 403：**角色可建、权限可存、运行时恒无权限**。
2. PR #293 交付的权限树/分配是「可查、可选、可存、可审计」，但**不改变任何实际访问控制**（已在 ADR-0029 附录 A、CHANGELOG、QA、契约卡中如实声明）。
3. 权限调整必须发版改代码（运营侧无法自助授权/回收）。

本 ADR 要裁决的只有一件事：**DB 角色权限集是否成为运行时鉴权权威**。

---

## 2. 候选方案与取舍

### 方案 A（推荐）：DB 权限集权威，静态表降级为 seed 基线
- seed 为 5 个内置角色回填 `RolePermissions`，取值 = 当前静态 `permissionsForRole(code)` 的等价集合 → **切换前后行为等价**（可验证的 non-regression 基线）。
- `authenticate` 解析有效权限集（`UserRole → Role → Permission.code`）→ `SessionUser.permissions`。
- `requirePermission` 以 `user.permissions` 判定，**fail-closed**（集合为空即拒绝，**不回退静态表**）。
- 静态表仅保留两种用途：seed 基线、迁移期对照物；**不再是运行时判定来源**。
- 代价：每请求多一次关联查询；前端 245 处判定需迁移（可分域分批）。

### 方案 B（不推荐）：静态 ∪ DB（并集）
静态集合对内置角色恒为超集 → **回收权限永远无效**；且两处真相并存，违反「禁止平行业务真相」。仅当业务只需要「加权限」时才成立，与本需求（可授权也可回收）矛盾。

### 方案 C（否决本需求）：维持静态
必须在 UI/API 契约中把 `permissionCodes` 明确标注为「仅目录登记，不影响访问控制」，并放弃运营侧自助授权。**若 CTO 选择 C，本 ADR 转为记录「权限树为治理台账，非访问控制」的结论**，同时应撤销权限树中「分配」的语义暗示。

---

## 3. 方案 A 的关键设计

### 3.1 有效权限集解析
- 位置：`api-helpers.authenticate()`（已有 `user.findUnique` 调用，扩展 `include: { roles: { include: { role: { include: { permissions: true } } } } }`）。
- 载荷：`SessionUser` 增加 `permissions: string[]`（**去重**；current `roles: string[]` 保留，供展示与审计，不再用于判定）。
- 判定纯函数：`hasEffectivePermission(permissions: readonly string[], required: string): boolean`（shared，单测覆盖）。
- **fail-closed 契约**：无 token → 401；token 有效但用户禁用 → 401；权限集为空 → 403。**任何情况下不得回退静态表**（禁止 silent degradation）。
- `SUPER_ADMIN` 不设代码级旁路（其最大权限来自 seed 回填的全集数据），保证 DB 是唯一真相。

### 3.2 迁移与等价性
- **回填策略（需裁决）**：seed 仅对「当前没有任何 RolePermission 关联」的角色执行一次回填（幂等、不覆盖运营侧调整），还是每次 seed 都强制对齐静态表（会覆盖运营调整）。建议前者 + 一次性迁移记录。
- 回填前必须校验 `permissionsForRole(code) ⊆ DB 目录`：**当前已满足（缺口 0，见 PR #294）**，任何缺口必须在 seed 中 fail loud（禁止静默跳过）。
- **等价性验收证据**：对 5 个内置角色 × 目录全量 code（1538）生成权限判定矩阵，切换前后 diff 必须为空；矩阵脚本与输出纳入 PR 证据。

### 3.3 前端契约
- `GET /api/auth/me` 响应增加 `permissions: string[]`（`SessionProvider` 持有）。
- 新增会话级判定 `can(code)`（`session-context`）：`PermissionGuard`、`lib/frontend/shell.ts`（导航）、`modules.ts`（模块可见性）、页面内按钮显隐统一改用它。
- 迁移 245 处调用点**按域分批**（系统 → 主数据 → 销售 → 采购 → 库存 → 财务 → 报表），每批独立 PR + CI，批内不改业务语义、不顺手重构。
- 生效时机：**下一次请求/刷新**（不做实时推送、不做会话内热更新）。

### 3.4 性能与缓存
- 每请求 1 次关联读取（Permission ≈ 1538 行，Role↔Permission 关联行 ≈ 5×~1000）→ 可接受；**不建议引入进程内缓存**（多实例失效不一致，且权限回收必须即时生效）。
- 若后续确有性能需要：必须带显式失效（`role.create/update` 触发）+ 短 TTL + 默认关闭，并单独裁决。

### 3.5 安全不变量（必须随实现落地）
1. **防自锁**：不允许把系统变成「无任何用户可管理角色」——删除/降权 `role:edit` 前必须存在至少一个仍持有 `role:edit` 的启用用户（锁内校验）。
2. **SUPER_ADMIN 保护（需裁决）**：DB 权威下建议 `PATCH /api/roles/:id` 拒绝对 `SUPER_ADMIN` 角色的 `permissionCodes` 修改（保持恒为全集），否则可被一次误操作锁死系统。
3. **越权提升**：持有 `role:edit` 者可为自己所属角色授予任意权限（含 `role:edit` 自身）。是否引入 maker-checker（角色权限变更需第二人审批，复用既有 Workflow）**需 CTO 裁决**。
4. **审计证据**：`role.create/update` 已记录 `permissionCount` + `permissionAdded/Removed`（PR #293）；本 ADR 生效后该审计即为访问控制变更的法定证据链。

### 3.6 回滚
- **不引入 `RBAC_SOURCE=static|db` 运行时开关**（双路径 = 平行真相）。
- 回滚方式 = revert 判定切换 PR；DB 中的 RolePermission 关联对旧代码无影响（旧代码不看它），**数据可保留、无需回滚 migration**（本 ADR 预计**零 Schema/零 Migration**）。

---

## 4. 影响面清单

| 面 | 规模 | 改动性质 |
|---|---|---|
| `api-helpers.authenticate/requirePermission` | 1 文件 | 判定来源切换；**函数签名不变 → 666 个 API 调用点零改动** |
| `/api/auth/me` | 1 端点 | 响应新增 `permissions` |
| 前端判定调用点 | 245（分域分批） | 机械迁移到 `can(code)` |
| `state.user.roles` 使用点 | 80 | 迁移到 `session.permissions` |
| seed | 5 内置角色回填 | 幂等；缺口必须为 0（当前为 0） |
| 单测/CI | 新增判定矩阵 + 权限纯函数单测 | 等价性与 fail-closed 证据 |
| Schema/Migration | **0** | 表结构已存在 |

---

## 5. 分阶段实施（每阶段独立 PR + GitHub CI）

| 阶段 | 内容 | 行为变化 |
|---|---|---|
| **P1** | seed 回填内置角色 + `hasEffectivePermission` 纯函数 + 单测 + 判定矩阵脚本 | **无**（仅数据与工具） |
| **P2** | 后端判定切换（`authenticate`/`requirePermission`）+ `/api/auth/me` 返回 `permissions` | 内置角色等价；自定义角色开始按 DB 生效 |
| **P3** | 前端判定迁移（分域 5-7 批） | 逐域 UI 可见性对齐后端 |
| **P4** | 文档/QA/ROADMAP 收口 + Runtime Acceptance（各角色登录 → 200/403 矩阵） | 收口 |

---

## 6. 未决问题（需 CTO 裁决后方可进入 P1）

1. 是否采纳方案 A？若否决，是否采用方案 C 的显式声明？
2. `SUPER_ADMIN` 角色的 `permissionCodes` 是否禁止修改（建议禁止）？
3. 内置角色 seed 回填策略：仅首次（建议）还是每次强制对齐？
4. 角色权限变更是否引入 maker-checker（第二人审批）？
5. 权限变更后是否需要「强制刷新会话/踢下线」语义（建议：下次请求生效即可）？
6. 自定义角色首次可用是否有额外准入要求（例如必须至少具备某作用域 read 权限）？

---

## 7. 明确不做（边界）

- 不新增/重命名权限码，不改权限目录结构，不放松 ADR-0028 静态目录一致性 Gate。
- 不引入 per-user 权限覆盖表、不做字段级权限、不做数据行级（row-level）权限。
- 不做权限实时推送、不做会话内热更新、不引入运行时双来源开关。
- 不改既有状态机语义（APPROVED ≠ CONFIRMED 等红线不受影响）。

---

## 8. 若长期不实施（维持现状的必备声明）

在方案 A 落地前，系统必须持续如实声明：**权限树与角色权限分配是治理台账与审计证据，不构成访问控制**；访问控制仍由 `packages/shared` 静态角色权限映射决定（该声明已存在于 ADR-0029 附录 A、CHANGELOG、QA、契约卡 §5.3/§5.4）。
