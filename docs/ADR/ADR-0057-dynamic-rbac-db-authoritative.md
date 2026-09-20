# ADR-0057：动态 RBAC（DB 权限集为鉴权权威）— Design/Scope Gate

- 状态：**Accepted（2026-09-20 用户指令「执行建议」：采纳方案 A 与下方全部建议项，进入 P1/P2 实施）**
- 日期：2026-09-20（2026-09-20 裁决并进入实施）
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：ADR-0028（静态 RBAC 目录一致性 Gate）、ADR-0029 附录 A（权限树 + 角色权限分配落地及生效边界）、ADR-0045（httpOnly 会话 cookie）、PR #293（权限树/分配）、PR #294（目录零缺口补齐）、AGENTS.md §3/§5

---

## 0. 裁决记录（2026-09-20，「执行建议」= 采纳全部建议项）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| Q1 | 是否采纳方案 A（DB 权限集为鉴权权威） | **采纳 A**；方案 B 否决（回收无效 + 平行真相）、方案 C 不采用 | P2 后端判定切换 |
| Q2 | `SUPER_ADMIN` 角色的 `permissionCodes` 是否禁止修改 | **禁止修改**（保持恒为全集，避免一次误操作锁死系统） | P2（`PATCH /api/roles/:id` 拒绝 SUPER_ADMIN 的 permissionCodes 变更） |
| Q3 | 内置角色 seed 回填策略 | **仅首次回填**（角色当前无任何权限关联时；不覆盖运营侧后续调整） | P1（已实现） |
| Q4 | 是否引入 maker-checker（第二人审批） | **本轮不引入**（最小变更；列为 backlog，需单独 Design Gate） | 不在 P1-P4 范围 |
| Q5 | 权限变更后的会话语义 | **下次请求/刷新生效**（不做实时推送、不做会话内热更新） | P2/P3 |
| Q6 | 自定义角色准入要求 | **不设额外准入**（按 DB 分配真实生效，无隐式门槛） | P2 |

---

## 1. 背景与问题（事实基线，均来自当前 main 实测）

当前访问控制的唯一事实来源是 **静态代码表**：`packages/shared/src/rbac/index.ts` 的 `ROLE_PERMISSIONS`（role **code** → 权限码数组），由 `permissionsForRole` / `hasPermission` 消费。

| 事实 | 实测值 |
|---|---|
| API 判定入口 | `apps/web/src/lib/api-helpers.ts` `requirePermission(user, code)` → `hasPermission(user.roles, code)`；被 **662** 处 `requirePermission(` 引用（**666** 调用点） |
| 前端判定调用点 | `hasPermission(` **231** 处（P3 前实测：`app/(dashboard)` 228 + `lib` 2 + `components` 1）；其中 `state.user.roles` **80** 处 |
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
- 代价：每请求多一次关联查询；前端 231 处判定需迁移（可分域分批）。

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
- 回填前必须校验 `permissionsForRole(code) ⊆ DB 目录`，任何缺口必须 **fail loud**（seed 抛错，禁止静默跳过 / 部分回填）。
- **P1 实测发现并修复的目录缺口（重要）**：静态宇宙并非只有 `ALL_ACTION_PERMISSIONS`——`Object.values(PERMISSIONS)` 中的 10 个 `:write` 码此前**从未注册到 DB 目录**（`purchase-requisition/purchase-order/purchase-receipt/inspection/warehouse-receipt/purchase-return/inventory-transfer/stock-count/inventory-adjustment/inventory-conversion` 的 `:write`）。若不修复，P1 回填会在生产 seed 直接抛错。已在 `prisma/seed.ts` `SEED_PERMISSIONS` 补齐（纯新增行）。修复后实测：DB 目录 **1548** 码，静态宇宙 **1522** 码 ⊆ 目录，**5 个内置角色缺码均为 0**。
- **等价性验收证据（改为 CI 机器校验，替代一次性脚本）**：`packages/shared/src/rbac/index.test.ts` 内置两类不变量——
  （a）**目录前置不变量**：解析 `prisma/seed.ts` 得到 DB 目录，断言静态宇宙与每个内置角色的静态权限集 ⊆ 目录（缺码即 CI 失败）；
  （b）**等价性矩阵**：5 内置角色 × 静态宇宙全量对照 `hasPermission ≡ hasEffectivePermission(permissionsForRole(role))`，不一致即失败。
  生产侧另有运维 SQL 证据查询（见 P2 部署前置）。

### 3.3 前端契约
- `GET /api/auth/me` 响应增加 `permissions: string[]`（`SessionProvider` 持有）。
- 新增会话级判定 `can(code)`（`session-context`）：`PermissionGuard`、`lib/frontend/shell.ts`（导航）、`modules.ts`（模块可见性）、页面内按钮显隐统一改用它。
- 迁移全部页级判定调用点（迁移前实测 231 处）**按域分批**（系统 → 主数据 → 客户与项目 → 销售 → 采购 → 库存 → 财务与分析），每批独立 PR + CI，批内不改业务语义、不顺手重构。
- 生效时机：**下一次请求/刷新**（不做实时推送、不做会话内热更新）。

### 3.4 性能与缓存
- 每请求 1 次关联读取（Permission ≈ 1538 行，Role↔Permission 关联行 ≈ 5×~1000）→ 可接受；**不建议引入进程内缓存**（多实例失效不一致，且权限回收必须即时生效）。
- 若后续确有性能需要：必须带显式失效（`role.create/update` 触发）+ 短 TTL + 默认关闭，并单独裁决。

### 3.5 安全不变量（必须随实现落地）
1. **防自锁**：不允许把系统变成「无任何用户可管理角色」——删除/降权 `role:edit` 前必须存在至少一个仍持有 `role:edit` 的启用用户（锁内校验）。
2. **SUPER_ADMIN 保护（裁决 = 禁止修改）**：`PATCH /api/roles/:id` 与 `POST /api/roles` 拒绝对 `SUPER_ADMIN` 角色的 `permissionCodes` 变更（409/400，保持恒为全集），否则可被一次误操作锁死系统。
3. **越权提升**：持有 `role:edit` 者可为自己所属角色授予任意权限（含 `role:edit` 自身）。裁决 = **本轮不引入 maker-checker**（最小变更），列为独立 backlog（需单独 Design Gate）；当前缓解 = 权限变更全量审计 + SUPER_ADMIN 不可改 + 防自锁校验。
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
| 前端判定调用点 | 231（分域分批；P3 已完成 → 0） | 机械迁移到 `can(code)` |
| `state.user.roles` 使用点 | 80 | 迁移到 `session.permissions` |
| seed | 5 内置角色回填 | 幂等；缺口必须为 0（当前为 0） |
| 单测/CI | 新增判定矩阵 + 权限纯函数单测 | 等价性与 fail-closed 证据 |
| Schema/Migration | **0** | 表结构已存在 |

---

## 5. 分阶段实施（每阶段独立 PR + GitHub CI）

| 阶段 | 内容 | 行为变化 |
|---|---|---|
| **P1 ✅（PR #296）** | `hasEffectivePermission` + `normalizePermissions` 纯函数；seed 首回填内置角色（幂等 + fail loud）；**补齐目录缺失的 10 个 `:write` 码**；`packages/shared/src/rbac/index.test.ts`（目录前置不变量 + 等价性矩阵 + fail-closed） | **无**（仅数据与工具） |
| **P2 ✅（本 PR）** | 后端判定切换（`authenticate`/`requirePermission`）+ `/api/auth/me`、`/api/auth/login` 返回 `permissions` + 项目详情 capabilities 改用有效权限集 + SUPER_ADMIN 保护 + 防自锁校验 | 内置角色等价；自定义角色开始按 DB 生效 |
| **P3 ✅（批次 1-7 全部落地）** | 前端判定迁移（基础设施 3 + 系统域 7 + 6 个域批次 221；`apps/web/src` 内 `hasPermission(` 迁移前实测 **231 处** → 迁移后 **0**） | 前端 UI 可见性与后端判定完全同源 |

**P3 批次划分与进度**：

| 批次 | 范围 | 状态 |
|---|---|---|
| 1 | 基础设施：`can(user, permission)` / `useCan()`（session-context）、`PermissionGuard`、`shell.filterVisibleGroups` / `quickCreateItems`（导航可见性 + 快捷创建）、admin-shell、shell 单测迁移；**系统域页面**（roles 列表/编辑、users、departments、settings·supplier-rating-rules） | ✅ |
| 2 | 基础资料域（items / business-partners / price-lists / technical-standards / unit-of-measures / commercial-terms / document-sequences / warehouses / warehouse-locations）—— 49 处 / 14 文件 | ✅ |
| 3 | 客户与项目域（projects 详情 40 处 / project-opportunities / visits / expenses）—— 57 处 / 12 文件 | ✅ |
| 4 | 销售域（quotations / orders / deliveries / invoices / receipts / credit-debit-notes）—— 33 处 / 12 文件 | ✅ |
| 5 | 采购域（requisitions / orders / receipts / inspections / warehouse-receipts / returns）—— 38 处 / 24 文件 | ✅ |
| 6 | 库存域（transfers / stock-counts / adjustments / conversions / boms / production-orders）—— 27 处 / 12 文件 | ✅ |
| 7 | 财务与分析域（supplier-invoices / supplier-ap / finance / reports / dashboard）—— 17 处 / 10 文件 | ✅ |

> **迁移已完成（验收口径）**：`apps/web/src` 内 `hasPermission(` 调用点 = **0**（全部改走 `can()`）；`packages/shared` 的 `hasPermission` 已标记 `@deprecated`，仅保留 seed 基线与等价性矩阵单测两种用途。前端 UI 可见性与后端 `requirePermission` 完全同源。
| **P4**(进行中) | 文档/QA/ROADMAP 收口 + Runtime Acceptance（各角色登录 → 200/403 矩阵，需运行环境） | 收口 |

### 5.1 部署前置（**Blocking**，P2 上线必须满足）

1. **P1 已部署且 seed 已执行**：本仓库镜像内置 seed 工具链（Dockerfile 注释「Prisma migrate/seed tooling for Railway pre-deploy command」），生产 pre-deploy 会执行 `pnpm db:seed` → 内置角色权限回填随之落地。**P2 合并前必须确认该前提成立。**
2. **运维证据查询**（回填结果核对，任一环境可执行）：

```sql
SELECT r.code, count(rp."A") AS permission_count
FROM "Role" r LEFT JOIN "_RolePermissions" rp ON rp."B" = r.id
GROUP BY r.code ORDER BY r.code;
```

   期望基数以 `packages/shared/src/rbac/index.test.ts` 的静态为准：`SUPER_ADMIN`/`ADMIN` = **1522**（= 去重后的静态权限宇宙大小），`VIEWER` = **0**，`MANAGER`/`MEMBER` 取其静态集去重后的数量。若任一内置角色为 0 而静态基数不为 0 → 回填未执行，**不得部署 P2**。

3. 未满足时**不得合并 P2**：切换后所有用户（含 SUPER_ADMIN）将恒 403（fail-closed 设计使然，非缺陷）。

---

## 6. 未决问题（**已裁决，见 §0**；保留原始清单供追溯）

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

**P1/P2 已落地后的状态（2026-09-20）**：本 ADR 已 Accepted，P1（seed 回填 + 判权纯函数 + CI 不变量）与 P2（后端判定切换 + 会话 `permissions` + SUPER_ADMIN 保护 + 防自锁）均已实现，ADR-0029 附录 A / QA / 契约卡中的「不构成访问控制」表述已同步更新为「DB 权限集为鉴权权威」。

**仍未闭环**：P4 收口含各角色运行时验收（200/403 矩阵，需部署环境人工执行）。P2 部署前须满足 §5.1 前置（生产已执行 seed）。
