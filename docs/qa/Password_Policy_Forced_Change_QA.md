# Password Policy & Forced Change — QA 验收记录（ADR-0059）

- 日期：2026-09-21
- 关联：ADR-0059、Migration 0059、CHANGELOG [Unreleased]、docs/test-cases/Password_Policy_API.md
- 状态：**IMPLEMENTATION COMPLETE — CI PENDING**（CI-First 模式：验证事实源 = GitHub CI；本地不启动服务器、不跑高负载验证）

## 1. 范围

| 项 | 内容 |
|---|---|
| Schema | `User.mustChangePassword`（默认 true）、`User.passwordChangedAt`（可空） |
| Migration | `0059_user_password_policy`（ADD COLUMN ×2 + SET DEFAULT true；存量行 grandfather=false；零业务回填） |
| API 新增 | `POST /api/auth/change-password`、`POST /api/users/:id/reset-password` |
| API 变更 | `POST /api/users`（固定初始密码 123456；拒绝 password 字段）、`PATCH /api/users/:id`（拒绝 password 字段）、`GET /api/auth/me`/`/api/auth/login`/`GET /api/users`/`GET /api/users/:id`（返回密码状态） |
| 鉴权 | `requirePermission` 前置强制改密 Gate（403 `PASSWORD_CHANGE_REQUIRED`） |
| 前端 | `/change-password` 页、登录分流、dashboard shell 引导、个人中心改密区、用户列表「密码」列 + 行内重置、编辑页密码状态 + 重置按钮 |
| 错误码 | 5 个（ERROR_CODES.md 自动生成，CI Gate 校验同步） |

## 2. 静态验收（本地已核，不含运行验证）

- [x] 强密码策略单一来源 = `packages/shared/src/validators`（`passwordPolicyErrors` / `strongPasswordSchema`），前端与后端**同一函数**，无第二套规则
- [x] 服务端重新校验新密码（不信任客户端），失败 → 400 `PASSWORD_POLICY_VIOLATION` + `details.errors`
- [x] 自助改密必须先验证当前密码（`verifyPassword`）→ 失败 400 `PASSWORD_CURRENT_INVALID`
- [x] 改密不返回/不记录任何密码明文（响应只有状态 + 时间；审计只记 `mustChangePassword` 前后值）
- [x] `POST /api/users` / `PATCH /api/users/:id` 携带 `password` → 400 `PASSWORD_DIRECT_SET_FORBIDDEN`（**显式 fail closed，不静默忽略**）
- [x] `PATCH /api/users/:id` 事务内不再写 `passwordHash`（git diff 核实）
- [x] 强制改密 Gate 在 `requirePermission` 内**先于权限判定**执行；全部业务 API 均经 `requirePermission`（静态扫描：仅 `/api/auth/me` 只用 authenticate）
- [x] 豁免面：login / me / logout / change-password（保证初始密码账号存在唯一出口）
- [x] 重置端点幂等（重复重置 = 回到初始密码 + 强制改密态）；停用账号 → 409
- [x] RBAC 静态 Gate：`node scripts/check-rbac-catalog.mjs` 通过（663 处 requirePermission 引用全部合法，未新增权限码）
- [x] 错误码静态 Gate：`node scripts/gen-error-codes.mjs --check` 通过（333 码）
- [x] 无本地 build/test/type-check/lint/dev server 执行（CI-First）
- [x] seed bootstrap 管理员与 test user 显式 `mustChangePassword=false`（凭据来自环境变量，不冻结既有部署/冒烟）

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 新建用户 → 用 123456 登录 → 被强制进入 `/change-password`；改密前访问任意业务页/接口 → 403 `PASSWORD_CHANGE_REQUIRED`
- [ ] 弱密码（`12345678` / `abcd1234` / `ABCD1234` / `Abcdefgh`）→ 前端即时提示 + 服务端 400 `PASSWORD_POLICY_VIOLATION`
- [ ] 合规密码（如 `Abcd1234`）→ 改密成功 → 进入系统，业务功能正常（403 消失）
- [ ] 个人中心「修改密码」：错误当前密码 → 400 `PASSWORD_CURRENT_INVALID`；成功 → Toast + 「上次修改」时间更新
- [ ] 用户列表行内「重置密码」/ 编辑页「重置密码」→ 二次确认 → 提示初始密码 123456；该用户下一次登录被强制改密
- [ ] 旧前端/脚本直接 PATCH `password` → 400 `PASSWORD_DIRECT_SET_FORBIDDEN`（不静默忽略）
- [ ] MANAGER / MEMBER 账号访问 `reset-password` → 403 FORBIDDEN（`user:edit` 门禁）
- [ ] 存量账号（Migration 0059 之前创建）登录 → **不被强制改密**（grandfather 生效）
- [ ] 迁移核对：`SELECT "email","mustChangePassword","passwordChangedAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 20;` 与页面「密码」列一致

## 4. 已知限制 / 边界

- 会话为无状态 JWT（ADR-0045）：改密**不吊销其它设备上的既有会话**；无会话表/黑名单
- 无「密码过期策略」「历史密码不可复用」「登录失败锁定/验证码」——后续独立 Design Gate
- 存量用户不追溯强制改密；如需一次性推行见 ADR-0059 §5 的显式 SQL（需单独批准）
- 重置密码不发送通知给用户（通知/邮件通道不在本范围）；由管理员线下告知
- 强制改密只约束「业务 API + 业务页面」，不改变登录本身可用性（登录成功但仅能改密）
