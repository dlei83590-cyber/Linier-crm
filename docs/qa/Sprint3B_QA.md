# Sprint 3B QA Report

> Sprint 3B：平台能力（Audit Center 升级 / Menu Center / Dashboard API / File Center）
> 分支：feature/sprint3-platform-capabilities ｜ PR：#（待创建）
> 验收人：CTO ｜ 日期：2026-08-05
> 规则：本地禁止 install/build/test，验证靠远程 CI；未实际执行的项目标注 PENDING / NOT RUN。

## 1. Scope

- Audit Center：AuditLog 升级（ObjectType/ObjectId/BeforeData/AfterData/RequestId/TraceId/IP/Device/Browser/Duration/Result）
- Menu Center：Menu / MenuGroup / RouteMeta（Icon/Sort/Hidden/Cache/ExternalLink/Permission）✅ 已开发
- Dashboard API：/widgets /layouts /kpis /charts（不开发页面）
- File Center：File / Attachment / Folder / Version / Preview

## 2. Automated Verification（Audit Center 阶段）

| Check | Result | Evidence |
|---|---|---|
| Prisma schema validation | PASS | AuditLog +8 列 + AuditResult 枚举，本地核验 |
| Migration structure | PASS | 0005_audit_upgrade：CREATE TYPE AuditResult + 8 列 + 3 索引（ALTER 不重建，符合 CTO 规则） |
| Seed idempotency | N/A | 本阶段无新增 seed 数据 |
| Lint | PENDING | 远程 CI |
| Type check | PENDING | 远程 CI |
| Unit tests | PENDING | request-meta.test.ts 7 用例已编写，待 CI 执行 |
| Build | PENDING | 远程 CI |
| Secret scan | PENDING | 远程 CI |
| Menu Center 迁移 | PASS | 0006_menu_center：2 表 + 索引 + 外键，本地核验 |

## 3. API Test Matrix（Audit Center）

| API | Success | Validation | Permission | Not Found | Conflict |
|---|---:|---:|---:|---:|---:|
| GET /api/audit-logs（分页+过滤） | PASS(代码) | PASS(代码) | PASS(代码) | N/A | N/A |
| GET /api/audit-logs/:id | PASS(代码) | N/A | PASS(代码) | PASS(代码) | N/A |
| GET/POST /api/menus（列表/树/创建） | PASS(代码) | PASS(代码) | PASS(代码) | N/A | PASS(代码) |
| GET/PATCH/DELETE /api/menus/:id | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/menu-groups | PASS(代码) | PASS(代码) | PASS(代码) | N/A | PASS(代码) |
| GET/PATCH/DELETE /api/menu-groups/:id | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |

> PASS(代码) = 静态代码审查通过；运行级验证待 CI/部署环境执行（PENDING）。

## 4. State Machine Tests

N/A（Audit Center 无状态机；Menu/Dashboard/File 模块无状态机，均为 CRUD/数据 API）

## 5. Known Risks

- 无可视化流程设计器、无真实通知发送、无调度器/超时升级（承接 Sprint 3A）
- Audit beforeData/afterData 快照依赖各 API 显式传入（writeAuditLog 扩展参数），未强制所有调用点一次性补齐——Sprint 3B 后续模块统一接入 requestMeta()
- Settings 加密为标记 + API 掩码，真实加密存储待安全加固
- 运行级（Railway）验证待执行
- 单元测试不替代集成 QA

## 6. Conclusion（Audit Center 阶段）

```
Schema: PASS
Migration: PASS
Seed Idempotency: N/A（无新增 seed）
RBAC: PASS（audit:view 仅 SUPER_ADMIN/ADMIN）
API: PASS（代码审查）→ 运行级 PENDING
State Machine: N/A
Unit Test: PENDING（已编写待 CI）
OpenAPI: PASS（/api/audit-logs + /api/menus + /api/menu-groups 已覆盖）
CI: PENDING（远程 Quality Gates / Build / Secret Scan）
Deployment QA: NOT RUN（待 Railway 环境）
```

## 7. 待执行项（Sprint 3B 全量完成后回填）

- [ ] Menu Center / Dashboard API / File Center 开发完成
- [ ] 远程 CI 全绿
- [ ] Railway 部署后 API 实际调用矩阵回填
- [ ] CTO 验收通过
- [ ] 六项同步（Tag / Release / CHANGELOG / QA / ADR / ROADMAP）
