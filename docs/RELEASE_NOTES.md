# Release Notes

## v0.3.0-alpha — Sprint 3A: Workflow Foundation（2026-08-05）

> PR: #5 — `feature/sprint3-platform-foundation`（已合并，merge commit 42ebf22262）
> 状态：RELEASED（CTO 条件批准，已知风险列入后续计划）

### Sprint 3A 完成内容

- **Workflow Engine（6 模型）**：Definition/Step/Condition/Instance/Action/History；统一动作 9 种；条件结构化存储；4 审批模式
- **Approval Engine（7 模型，解耦）**：Approver/ApproverGroup/Member/Delegate/Escalation/Timeout/Reminder
- **Notification（4 模型）**：Template/Message/Channel/Log（渠道建模，真实发送后续）
- **Dictionary（2 模型）+ Settings（3 模型）**：三层 Key-Value，encrypted 掩码
- **API 12 组端点**：统一响应/错误 + Zod + 权限 + 审计 + 乐观锁 + 软删除 + transaction
- **迁移 0004**：22 表 + 11 枚举 + 59 索引 + 13 外键
- **RBAC**：+21 平台模块动作级权限；**Seed 幂等**（稳定 code + upsert）
- **单测 21 用例 + OpenAPI 全端点 + ADR-0004 + ERD（DOMAIN_MODEL v1.1）+ QA 文档**

### Compatibility / Database / Migration

- **Compatibility**：向下兼容 Sprint 2 数据模型，无 Breaking Changes（仅新增表/枚举/权限）
- **Database**：新增 22 表 + 11 枚举，既有表未修改
- **Migration**：`0004_workflow_foundation`（幂等可重放）

### Known Risks（后续计划，未完成项）

- 无可视化流程设计器、无真实邮件/Telegram/Webhook 发送、无定时调度器/超时自动升级、Settings 加密为标记+掩码、运行级 Railway 验证待执行、业务审批页面 Sprint 4+

### Upgrade Guide

```bash
git pull origin main
pnpm install && pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## v0.2.0-alpha — Sprint 2: Master Data & Project Domain（2026-08-05）

> PR: #4 — `feature/sprint2-master-data`（已合并，merge commit a00d4223e6）
> 状态：RELEASED（CTO 验收）

### Sprint 2 完成内容

- **中国版主数据**：Item 统一物料（6 类）+ LinearGuideSpecification + BusinessPartner 统一往来单位（统一社会信用代码/开票/银行/结算）+ PriceList 含税价格体系 + TechnicalStandard/UnitOfMeasure/CommercialTerm/DocumentSequence
- **项目领域 14 模型 + 8 枚举**：ProjectOpportunity → Project 双段模型、11 阶段、5 关系人角色、里程碑/任务/预算/费用/风险/走访/进展/验收/结项
- **企业字段补强（2C）**：BusinessPartner +14、Item +14、PriceList +priceType（9 类价格）、Project +9 财务字段、DocumentSequence +docType（17 种单据）
- **权限动作级设计**：view/create/edit/delete/approve/audit/export/import/assign/close
- **迁移**：`0002_master_data_cn` + `0003_project_domain`
- **文档体系**：ROADMAP.md、PRODUCT_VISION.md、DOMAIN_MODEL.md、SPRINTS/、ADR/、CHANGELOG.md

### 验收

- CI：Quality Gates ✅ / Secret Scanning ✅ / Build ✅
- PR #4：merged ✅

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

---

历史详细记录见 `docs/releases/`。
