# ADR-0059：密码策略与首次登录强制改密（初始密码 / 自助改密 / 管理员仅重置）

- 状态：**Accepted**（2026-09-21 用户指令：「添加用户时默认密码 123456，首次登录强制改为高强度密码（大小写字母 + 数字，超 8 位）；个人中心可自行更改；忘记密码时管理员只能点『重置密码』回到初始化密码，并在登录时强制改密」）
- 日期：2026-09-21
- 关联：ADR-0045（httpOnly 会话 cookie）、ADR-0057（RBAC 权威 = DB 权限集）、ADR-0058（用户附加授权）、ADR-0029（Pending Pages / 用户管理页面）

---

## 1. 背景

用户管理（Batch 2 / ADR-0029）此前的密码语义是「管理员在新建/编辑页自由设定密码（≥ 6 位）」：

- 新建用户时由管理员输入初始密码 → 弱口令（6 位）与「管理员知悉用户密码」同时存在；
- 编辑页可任意改写用户密码（无强度要求、无强制轮换）；
- 忘记密码 = 管理员再设一个新口令，用户永远不需要自己设置密码。

这在生产环境（真实客户 / 真实账号）不成立：需要「固定初始密码 → 首次登录强制改强密码 → 后续自助改密 →
忘记密码只能重置」的标准闭环。

## 2. 决策

### 2.1 初始密码固定 + 强制改密标记（Schema）

- 新增 `User.mustChangePassword Boolean @default(true)`（Migration 0059）与
  `User.passwordChangedAt DateTime?`（最近一次密码变更时间，审计投影）。
- **新建用户**：`POST /api/users` 不再接受客户端密码，初始密码固定为 `123456`
  （SSOT = `packages/shared/src/validators` 的 `DEFAULT_INITIAL_PASSWORD`），并显式写 `mustChangePassword=true`。
- **管理员重置**：`POST /api/users/:id/reset-password` 把密码重置回 `123456` 且 `mustChangePassword=true`。
- **用户自助改密**：`POST /api/auth/change-password`（需重新验证当前密码）成功后 `mustChangePassword=false`
  + `passwordChangedAt=now`。

### 2.2 强密码策略

- 规则：**大写字母 + 小写字母 + 数字**同时出现，长度 **≥ 8 位**（≤ 128 位，与 bcrypt/列宽一致）。
- SSOT = `packages/shared/src/validators`：`passwordPolicyErrors()` / `isStrongPassword()` / `strongPasswordSchema`，
  **后端与前端消费同一函数**（前端只做即时提示，服务端在改密事务前重新校验，不信任客户端）。
- 固定初始密码 `123456` 本身不满足策略 → 「初始密码」天然只能作为一次性入口。

### 2.3 强制改密 = 服务端 fail-closed Gate（关键不变量）

- 会话解析（`api-helpers.authenticate`）随 DB 读取 `mustChangePassword`（DB 权威，不读客户端声明）。
- `requirePermission()` 在**权限判定之前**先判定强制改密态：命中即
  **403 `PASSWORD_CHANGE_REQUIRED`**（`apps/web/src/lib/api-helpers.ts`）。
- 由于生产内**全部业务 API 都经由 `requirePermission`**（仅 `/api/auth/me` 只用 `authenticate`），
  等价于「初始密码账号在改密前无法触达任何业务能力」，且**不依赖前端自觉**。
- 豁免路径（不经过 `requirePermission`）：`/api/auth/login`、`/api/auth/me`、`/api/auth/logout`、
  `/api/auth/change-password`——保证初始密码账号始终存在唯一出口。

### 2.4 管理员只能「重置密码」（不接受自定义密码）

- `POST /api/users` 与 `PATCH /api/users/:id` 收到 `password` 字段一律 **400 `PASSWORD_DIRECT_SET_FORBIDDEN`**
  （显式 fail closed，不静默忽略——避免旧前端/脚本「以为改了密码，实际没改」）。
- 权限复用既有 `user:edit`（ADMIN / SUPER_ADMIN 默认持有），**不新增权限码**：
  新增受限权限码在生产既有角色上不会自动回填（ADR-0057「仅首次回填」），会造成管理员 403 的功能性回归。
- 重置**幂等**：重复重置结果一致（回到初始密码 + 强制改密态）；审计写 `user.password.reset`（不记录任何密码明文）。

### 2.5 前端闭环

| 场景 | 行为 |
|---|---|
| 新建用户 | 表单不再输入密码，只读展示「初始密码 123456」+ 首次登录强制改密说明 |
| 首次登录 | 登录成功 → 跳转 `/change-password`（服务端同时 403 fail closed）；dashboard shell 对强制改密态只渲染引导页，不渲染业务导航 |
| 个人中心 | `/profile` 新增「修改密码」区（当前密码 + 新密码 + 确认），策略提示与后端同源 |
| 管理员重置 | 用户列表行操作 + 编辑页「重置密码」按钮，二次确认（ConfirmDialog）→ 重置为 123456 + 提示用户下次登录必须修改 |
| 状态可见 | 用户列表新增「密码」列（待修改初始密码 / 用户已设置）；编辑页展示密码状态与上次修改时间 |

## 3. 为什么不是别的方案

| 方案 | 否决原因 |
|---|---|
| 登录直接返回 409「必须先改密」且不发会话 | 改密页需要身份（当前密码），要么再设计一套「无会话改密」接口 + 防爆破限流，要么把当前密码当票据传递；复杂度与风险高于收益 |
| 只在登录响应里带标记、前端跳转（不做服务端 Gate） | 纯前端约束可被直接调用 API 绕过（红线：不信任客户端） |
| 新增 `user:reset-password` 权限码 | 生产既有 ADMIN 角色的权限不会自动回填（ADR-0057 首次回填语义）→ 管理员重置功能直接 403；复用 `user:edit` 语义已足够（重置≠提权：只能回到公开初始密码） |
| 允许管理员自定初始密码（仍强制首次改密） | 与用户指令「管理员只能点重置密码，回到初始化密码」冲突，且继续保留「管理员知悉用户密码」的弱语义 |
| 存量用户一并进入强制改密态 | 生产账号的密码是用户自己设置的，追溯强制改密属未授权范围扩张；本轮按 grandfather 处理（见 §4/§5） |

## 4. 影响面

| 面 | 变更 |
|---|---|
| Schema | `User.mustChangePassword`（默认 true）、`User.passwordChangedAt`（可空） |
| Migration | `0059_user_password_policy`（ADD COLUMN ×2 + SET DEFAULT true；**存量行 grandfather = false**，零业务回填、不重建表） |
| Shared | `DEFAULT_INITIAL_PASSWORD` / `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` / `PASSWORD_POLICY_DESCRIPTION` / `passwordPolicyErrors` / `isStrongPassword` / `strongPasswordSchema` |
| 鉴权 | `authenticate` 返回 `mustChangePassword` / `passwordChangedAt`；`requirePermission` 前置强制改密 Gate（403 `PASSWORD_CHANGE_REQUIRED`） |
| API | 新增 `POST /api/auth/change-password`、`POST /api/users/:id/reset-password`；`POST /api/users` 移除 `password`（固定初始密码）；`PATCH /api/users/:id` 移除 `password`（→ 400）；`GET /api/auth/me`、`/api/auth/login`、`GET /api/users`、`GET /api/users/:id` 返回密码状态 |
| 错误码 | `PASSWORD_CHANGE_REQUIRED` / `PASSWORD_POLICY_VIOLATION` / `PASSWORD_CURRENT_INVALID` / `PASSWORD_SAME_AS_CURRENT` / `PASSWORD_DIRECT_SET_FORBIDDEN`（ERROR_CODES.md 自动同步，333 码） |
| 前端 | 新增 `/change-password`；登录跳转；dashboard shell 强制改密引导；个人中心改密区；用户列表「密码」列 + 行内「重置密码」；编辑页密码状态 + 重置按钮（ConfirmDialog） |
| Seed | bootstrap 管理员 / test user 显式 `mustChangePassword=false`（凭据来自环境变量而非固定初始密码，不冻结既有部署与冒烟流程） |
| 文档 | 本 ADR + OpenAPI + CHANGELOG + ROADMAP + QA + Test Cases |

## 5. 不变量与边界

- **服务端 Gate 是唯一权威**：改密前不得触达任何受权限保护 API；前端引导只是体验层，不构成安全边界。
- **密码明文永不落库/落日志/落响应**：`passwordHash` 只经 bcrypt(12)；审计与 API 响应只记录状态与时间。
- **管理员不能知悉/决定用户最终密码**：只能重置为公开初始密码；用户必须在下次登录自行设置。
- **策略单源**：前端提示与后端校验调用同一 shared 函数，不存在「前端允许、后端拒绝」的漂移。
- **存量用户 grandfather**：Migration 0059 之后新建/重置的账号才进入强制改密态。若运维希望一次性让全部历史账号改密，
  可显式执行 `UPDATE "User" SET "mustChangePassword" = true WHERE "passwordChangedAt" IS NULL;`（**需 CTO 单独批准，非本 ADR 默认行为**）。
- **已知限制**：会话为无状态 JWT（ADR-0045），改密**不吊销其它设备上的既有会话**（无会话表/黑名单）；
  改密不改变角色与权限集；无「密码过期策略」「历史密码不可复用」「登录失败锁定」——均属后续独立 Gate。
- **停用账号不可重置**：reset 对 `isActive=false` 返回 409（避免产生无人可用的凭据）。

## 6. 回滚

- 应用层：revert 本 PR → 旧代码不读 `mustChangePassword`，用户回到「管理员可自由设密码」的旧语义（数据列保留，无副作用）。
- 数据层：无需回滚 Migration（纯新增列；如需彻底清除：删除两列后移除 migration 记录，仅在完全回退时执行）。
