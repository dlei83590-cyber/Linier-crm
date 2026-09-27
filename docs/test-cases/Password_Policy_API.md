# Password_Policy_API.md — 测试用例（ADR-0059 密码策略 / 强制改密 / 重置密码）

- 日期：2026-09-21
- 关联：ADR-0059、Migration 0059、docs/qa/Password_Policy_Forced_Change_QA.md
- 用途：供自动化/回归测试复用；验证事实源 = GitHub CI（单测）+ 生产 Runtime smoke（CI-First，本地不跑 runtime）

## 1. 强密码策略（纯函数 SSOT = packages/shared/src/validators）

| 用例 | 输入 | 期望 |
|---|---|---|
| PW-1 | `Abcd1234`（大写+小写+数字，8 位） | `passwordPolicyErrors` = []，`isStrongPassword` = true |
| PW-2 | `Abc1234`（7 位） | 拒绝："密码长度至少 8 位" |
| PW-3 | `abcd1234`（无大写） | 拒绝："密码必须包含大写字母" |
| PW-4 | `ABCD1234`（无小写） | 拒绝："密码必须包含小写字母" |
| PW-5 | `Abcdefgh`（无数字） | 拒绝："密码必须包含数字" |
| PW-6 | `Ab1` + 'x'×128（超长） | 拒绝："密码长度最多 128 位" |
| PW-7 | `123456`（初始密码） | 不满足策略（必须作为一次性入口） |
| PW-8 | 前端提示函数与后端校验 | 同一函数（无第二套规则；漂移即回归） |

## 2. POST /api/auth/change-password（自助改密）

| 用例 | 输入 | 期望 |
|---|---|---|
| CP-1 | 无会话 / 过期 token | 401 AUTHENTICATION_ERROR |
| CP-2 | 合法：currentPassword=123456，newPassword=`Abcd1234` | 200；`mustChangePassword=false` + `passwordChangedAt` 写入；审计 `user.password.change` |
| CP-3 | newPassword=`12345678`（纯数字） | 400 PASSWORD_POLICY_VIOLATION；不写库 |
| CP-4 | newPassword=`abcd1234`（无大写） | 400 PASSWORD_POLICY_VIOLATION；`details.errors` 含"密码必须包含大写字母" |
| CP-5 | currentPassword 错误 | 400 PASSWORD_CURRENT_INVALID；不写库 |
| CP-6 | newPassword == currentPassword（合规密码） | 400 PASSWORD_SAME_AS_CURRENT |
| CP-7 | newPassword = `123456`（初始密码） | 400 PASSWORD_POLICY_VIOLATION（不得使用初始密码） |
| CP-8 | 缺少 newPassword 字段 | 400 VALIDATION_ERROR |
| CP-9 | 改密前（强制改密态）调用本接口 | 可调用（不受 Gate 阻塞：唯一出口） |

## 3. requirePermission 强制改密 Gate

| 用例 | 输入 | 期望 |
|---|---|---|
| PG-1 | mustChangePassword=true + 权限命中 | 403，code=`PASSWORD_CHANGE_REQUIRED` |
| PG-2 | mustChangePassword=true + 权限**不**命中 | 403，code=`PASSWORD_CHANGE_REQUIRED`（Gate 先于权限判定） |
| PG-3 | mustChangePassword=false + 权限命中 | 放行（null） |
| PG-4 | 未认证 | 401（不泄漏改密状态） |
| PG-5 | 初始密码账号调用任意业务 API（如 GET /api/users） | 403 PASSWORD_CHANGE_REQUIRED |
| PG-6 | 初始密码账号调用 /api/auth/me | 200（豁免，前端据此引导） |
| PG-7 | 初始密码账号调用 /api/auth/logout | 200（豁免） |

## 4. POST /api/users/:id/reset-password（管理员重置）

| 用例 | 输入 | 期望 |
|---|---|---|
| RP-1 | 无 user:edit 权限（MANAGER / MEMBER） | 403 FORBIDDEN |
| RP-2 | 未认证 | 401 |
| RP-3 | 不存在的用户 id | 404 NOT_FOUND |
| RP-4 | 目标用户 isActive=false | 409 CONFLICT（不重置） |
| RP-5 | 正常重置 | 200；`passwordHash` = bcrypt(123456)，`mustChangePassword=true`，`passwordChangedAt` 写入；审计 `user.password.reset` |
| RP-6 | 连续两次重置（幂等） | 均为 200，结果一致（无法通过响应区分新旧口令） |
| RP-7 | 重置后该用户登录 | 使用 123456 登录成功 → 被强制改密 |
| RP-8 | 重置请求附带自定义密码字段 | 无效：端点不读取请求体，没有自定义密码入口（固定回到 123456） |

## 5. 用户创建 / 更新契约（ADR-0059）

| 用例 | 输入 | 期望 |
|---|---|---|
| UC-1 | POST /api/users { email } 无密码 | 201；初始密码 123456（bcrypt），mustChangePassword=true |
| UC-2 | POST /api/users { email, password:'Whatever1' } | 400 PASSWORD_DIRECT_SET_FORBIDDEN（不静默忽略） |
| UC-3 | POST /api/users 重复 email | 409 CONFLICT |
| UC-4 | 新用户用 123456 登录 | 登录成功 + 跳转 /change-password；业务 API 全部 403 PASSWORD_CHANGE_REQUIRED |
| UC-5 | PATCH /api/users/:id { password } | 400 PASSWORD_DIRECT_SET_FORBIDDEN |
| UC-6 | PATCH /api/users/:id { name } | 200（其它字段不受影响；不改密码状态） |
| UC-7 | GET /api/users 列表 | 每行含 mustChangePassword / passwordChangedAt（前端「密码」列） |
| UC-8 | GET /api/users/:id | 含 mustChangePassword / passwordChangedAt（编辑页密码状态） |

## 6. 存量数据与迁移

| 用例 | 输入 | 期望 |
|---|---|---|
| MG-1 | Migration 0059 之后检查 User 表结构 | 存在 mustChangePassword（BOOLEAN NOT NULL DEFAULT true）、passwordChangedAt（TIMESTAMPTZ 可空） |
| MG-2 | Migration 0059 之前创建的账号 | mustChangePassword=false（grandfather），登录不被强制改密 |
| MG-3 | 迁移后新建的账号 | mustChangePassword=true |
| MG-4 | seed 重跑（bootstrap 管理员 / test user） | mustChangePassword=false（环境变量凭据，不进入强制改密态） |
