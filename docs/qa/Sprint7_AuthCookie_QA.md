# Sprint7 认证存储升级 QA（ADR-0045）

- **日期：** 2026-08-20
- **范围：** httpOnly 会话 cookie / 双来源认证 / 登出端点 / 前端去 localStorage JWT
- **验证策略：** CI-First（编译/类型/单测由 CI 把关；认证运行时行为需人工登录验证——Known Risk）

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| S1 | login 响应 Set-Cookie linier_session（httpOnly + SameSite=Lax + Secure 生产 + maxAge 7d） | ✅ |
| S2 | authenticate() Bearer → cookie 双来源 | ✅ |
| S3 | POST /api/auth/logout 清除 cookie | ✅ |
| S4 | apiFetch 不再附加 Bearer（同源 cookie 自动携带） | ✅ |
| S5 | SessionProvider.refresh 直接 /api/auth/me；logout 调端点 | ✅ |
| S6 | setAuthToken no-op / getAuthToken null（不再写 localStorage） | ✅ |
| S7 | 登录页 setAuthToken 调用兼容（no-op 不报错） | ✅ |

## 已知限制（人工验证项）

1. 运行时认证行为（登录→会话保持→登出）需浏览器人工验证（CI 无 E2E）。
2. 完整 CSRF token 双提交 / CSP / 会话轮换为 backlog（SameSite=Lax 已阻断经典 CSRF）。
3. 旧 localStorage token 遗留由 clearAuthToken 清理；7 天自然过期。
