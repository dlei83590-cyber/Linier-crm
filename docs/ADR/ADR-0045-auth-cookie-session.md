# ADR-0045：认证存储升级（httpOnly Cookie + SameSite=Lax）

- 状态：**Accepted（Implemented，2026-08-20）**
- 日期：2026-08-20
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：CTO_Repo_Audit_2026-08-20（代码审计 **P1：JWT 存 localStorage，XSS 可窃取会话**）、Frontend Auth Transport Contract Repair（PR #34）

---

## 背景

代码审计 P1：JWT 存 localStorage（linier_crm_token），任何 XSS 即可窃取会话。

## 决策

1. **httpOnly 会话 cookie**：登录成功时服务端 Set-Cookie `linier_session`（httpOnly + SameSite=Lax + Secure(生产) + path=/ + maxAge 7d）；JWT 不再写入 localStorage（setAuthToken 置 no-op，getAuthToken 返回 null）。
2. **双来源认证（过渡兼容）**：authenticate() 先读 Bearer（legacy 会话），再读会话 cookie（新会话）——部署后旧会话不中断，新会话不再暴露 JWT。
3. **CSRF 缓解**：SameSite=Lax 阻断跨站 POST 携带 cookie（经典表单 CSRF 失效）；完整 CSRF token 双提交为纵深后续（backlog）。
4. **登出**：新增 POST /api/auth/logout（httpOnly cookie 必须服务端清除）；SessionProvider.logout 调用该端点 + 清理 localStorage 遗留。
5. **前端**：apiFetch 不再附加 Bearer（同源请求浏览器自动携带 cookie，credentials="same-origin"）；SessionProvider.refresh 直接 fetch /api/auth/me（cookie 认证）。

## 边界

- 完整 CSRF token 双提交、CSP 头、会话轮换（rotation）为 backlog。
- 不改变 JWT 签发/校验逻辑（jose HS256 不变）；不改 /api/auth/me。

## 影响

- lib/auth.ts（cookie 常量）、api/auth/login（Set-Cookie）、api/auth/logout（新）、api-helpers.authenticate（cookie 回退）、api-client.ts（去 Bearer）、session-context.tsx（refresh/logout）、auth-token.ts（no-op）。
