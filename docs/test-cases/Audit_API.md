# Audit API 测试用例

> Sprint 3B - Audit Center（升级）｜分支：feature/sprint3-platform-capabilities
> 用途：自动化测试复用基准，与 docs/qa/Sprint3B_QA.md 配套

## 范围

- AuditLog 升级字段：ObjectType / ObjectId / BeforeData / AfterData / RequestId / TraceId / IP / Device / Browser / Duration / Result
- 所有 CRUD 操作自动写入升级后的审计日志

## 用例

| # | 场景 | 方法 | 路径 | 权限 | 预期 |
| --- | --- | --- | --- | --- | --- |
| A1 | 审计列表（分页） | GET | /api/audit-logs?page=1&pageSize=20 | audit:view | 200 + meta |
| A2 | 按实体过滤 | GET | /api/audit-logs?entityType=workflow-definition | audit:view | 200 |
| A3 | 按操作者过滤 | GET | /api/audit-logs?actorId=xxx | audit:view | 200 |
| A4 | 详情 | GET | /api/audit-logs/:id | audit:view | 200 |
| A5 | 创建操作写入审计 | POST | /api/workflows/definitions | workflow-definition:create | 201 + AuditLog 含 ObjectId/BeforeData/AfterData |
| A6 | 更新操作写入审计 | PATCH | /api/workflows/definitions/:id | workflow-definition:edit | 200 + Before/AfterData |
| A7 | 软删除写入审计 | DELETE | /api/workflows/definitions/:id | workflow-definition:delete | 200 + AuditLog |
| A8 | 无权限访问 | GET | /api/audit-logs | 无权限角色 | 403 |
| A9 | 未认证访问 | GET | /api/audit-logs | 无 token | 401 |
| A10 | 审计日志含 IP/Device/Browser/Duration | POST | 任意写操作 | - | AuditLog 字段齐全 |
| A11 | RequestId/TraceId 关联 | 任意操作 | - | - | 同一请求可串联 |

## 验收

- [ ] 全部用例通过
- [ ] 既有 CRUD 审计自动升级
- [ ] CTO 审核
