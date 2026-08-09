# Documentation Guidelines

These instructions apply to every file under `docs/`.

## Roadmap Compliance (Mandatory for All AI Agents)

Every AI agent (CIO, Codex, or any other agent) MUST follow:

- [docs/ROADMAP.md](./ROADMAP.md) as the single development plan.
- Do not develop features outside the roadmap unless approved.

## Verification Policy（验证策略——所有 Agent MUST 遵守）

- **禁止在开发服务器上主动运行高资源验证任务**：`build`、完整 `test`、`typecheck`、`lint`、Playwright/E2E、Prisma 全量验证、Docker build 等均不得在本地主动执行。
- 开发过程中**只允许**：代码修改、静态审阅、必要的轻量文件检查（如 grep / wc / 结构核对）。
- **验证事实源 = GitHub CI**：工作流固定为 `提交 → push → GitHub CI → 根据 CI 结果修复`。不得为了“先在本地确认一下”重复执行高负载任务。
- 若需要验证结果，应**查看远程 CI 状态**（check-runs / Actions 日志），而不是在服务器本地跑验证命令。
- 此策略对 Sprint 5A OpenAPI/Final Docs 及后续 5B 开发一律生效，防止新会话或其他 Agent 忘记该限制。

## General Rules

- Treat `PROJECT_MASTER.md` as the product source of truth and keep related documents consistent with it.
- Write concise, actionable Markdown. Prefer checklists and tables where they improve clarity.
- Use RFC 2119 terms (`MUST`, `SHOULD`, and `MAY`) deliberately.
- Do not add secrets, credentials, customer data, or environment-specific values to documentation.
- Update `SPRINT_PLAN.md` when scope or delivery status changes.
- Changes to architecture, APIs, or data models MUST update the corresponding standard in the same pull request.

