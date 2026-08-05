# Documentation Guidelines

These instructions apply to every file under `docs/`.

## Roadmap Compliance (Mandatory for All AI Agents)

Every AI agent (CIO, Codex, or any other agent) MUST follow:

- [docs/ROADMAP.md](./ROADMAP.md) as the single development plan.
- Do not develop features outside the roadmap unless approved.

## General Rules

- Treat `PROJECT_MASTER.md` as the product source of truth and keep related documents consistent with it.
- Write concise, actionable Markdown. Prefer checklists and tables where they improve clarity.
- Use RFC 2119 terms (`MUST`, `SHOULD`, and `MAY`) deliberately.
- Do not add secrets, credentials, customer data, or environment-specific values to documentation.
- Update `SPRINT_PLAN.md` when scope or delivery status changes.
- Changes to architecture, APIs, or data models MUST update the corresponding standard in the same pull request.

