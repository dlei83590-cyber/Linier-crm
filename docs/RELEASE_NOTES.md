# Release Notes

## v0.1.0-alpha — Sprint 1: Infrastructure（2026-08-04）

> PR: #3 — `feature/sprint1-infrastructure`（已合并）
> 状态：READY FOR DEPLOYMENT QA（CTO Review 2026-08-04）

### Sprint 1 完成内容

- **Monorepo 骨架**：pnpm workspace + Turborepo 2，`apps/web`（Next.js 15 App Router）+ `packages/{config,shared,types,ui}`
- **工程规范**：ESLint 9 + Prettier + Husky + lint-staged，strict TypeScript
- **Prisma 数据模型（6 个）**：User / Department / Role / Permission / UserRole / AuditLog
- **初始 Migration**：`prisma/migrations/0001_initial`
- **Seed**：Super Admin 角色 + 基础权限 + 默认 Department（ENG）+ 管理员账号
- **认证**：JWT（jose HS256）+ bcryptjs，`/api/auth/login`、`/api/auth/me`
- **健康检查**：`GET /api/health` → 200
- **RBAC**：SUPER_ADMIN/ADMIN/MANAGER/MEMBER/VIEWER

## Sprint 2 预告（PR #4，待合并）

- 中国版主数据 + 项目领域 + 企业字段补强（详见 [CHANGELOG.md](./CHANGELOG.md)）
- 发布时按 [ROADMAP.md](./ROADMAP.md) 编号

---

历史详细记录见 `docs/releases/v0.1.0-alpha.md`。
