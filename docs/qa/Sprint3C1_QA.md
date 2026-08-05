# Sprint 3C-1 QA Report（Customer Foundation）

> Sprint 3C-1：Customer Foundation（Customer / Contact / Address / Tag / Industry / Credit）
> 分支：feature/sprint3-business-foundation ｜ PR：#7（待创建）
> 验收人：CTO ｜ 日期：2026-08-05
> 规则：本地禁止 install/build/test，验证靠远程 CI；未实际执行的项目标注 PENDING / NOT RUN。

## 1. Scope

- Customer 主档 CRUD（code 唯一、level 枚举、关联 BusinessPartner/Industry）
- CustomerContact 子资源（多联系人、isPrimary 主联系人唯一性）
- CustomerAddress 子资源（多地址、addressType 枚举、isDefault 唯一性）
- CustomerTag 关联（tagId/tagCode 二选一、重复标签 409）
- CustomerCredit（1:1 upsert、rating/status 枚举、乐观锁）
- Industry / Tag 字典 CRUD
- Seed 幂等（6 行业 + 4 标签）
- RBAC 后端权限（customer 等 7 模块）
- 乐观锁 / 软删除 / AuditLog（requestMeta 完整审计）

## 2. Automated Verification

| Check | Result | Evidence |
|---|---|---|
| Prisma schema validation | PASS | 69 模型 + 33 枚举，Customer 7 模型 + 4 枚举，反向关系配对（partner/industry/contacts/addresses/tags/credit）本地核验 |
| Migration structure | PASS | 0009_customer_foundation：7 表 + 4 枚举 + 索引 + 外键，SQL 逐项核验 |
| Seed idempotency | PASS | SEED_INDUSTRIES 6 + SEED_TAGS 4，稳定 code + upsert，无重复 |
| Lint | PENDING | 远程 CI（Quality Gates） |
| Type check | PENDING | 远程 CI（含 Prisma generate） |
| Unit tests | PENDING | 远程 CI |
| Build | PENDING | 远程 CI（Build） |
| Secret scan | PENDING | 远程 CI（Secret Scanning） |

## 3. API Test Matrix

> 端点已实现并代码审查通过（统一响应/错误、Zod、权限、审计、乐观锁、软删除、transaction、isPrimary/isDefault 唯一性事务）；
> 实际 HTTP 执行待部署环境验证（PENDING）。

| API | Success | Validation | Permission | Not Found | Conflict |
|---|---:|---:|---:|---:|---:|
| GET/POST /api/customers | PASS(代码) | PASS(代码) | PASS(代码) | N/A | PASS(代码) |
| GET/PATCH/DELETE /api/customers/:id | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/customers/:id/contacts | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | N/A |
| PATCH/DELETE /api/customers/:id/contacts/:contactId | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/customers/:id/addresses | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | N/A |
| PATCH/DELETE /api/customers/:id/addresses/:addressId | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/customers/:id/tags | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| DELETE /api/customers/:id/tags/:tagId | PASS(代码) | N/A | PASS(代码) | PASS(代码) | N/A |
| GET/POST /api/customers/:id/credit | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/industries + /:id CRUD | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| GET/POST /api/tags + /:id CRUD | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |

> PASS(代码) = 静态代码审查通过；运行级验证（实际 HTTP 调用）标注 PENDING，待 CI/部署环境执行后回填。

## 4. 业务规则（代码审查通过）

| 规则 | 实现 |
|---|---|
| code 唯一 | Customer.code / Industry.code / Tag.code @unique，重复 409 |
| 主联系人唯一 | POST/PATCH contacts 时 isPrimary=true 事务清除其他主联系人 |
| 默认地址唯一 | POST/PATCH addresses 时 isDefault=true 事务清除其他默认地址 |
| 重复标签 | CustomerTag @@unique([customerId, tagId]) + 409 |
| 信用 1:1 | CustomerCredit.customerId @unique + upsert |
| 乐观锁 | PATCH/upsert 校验 version，不匹配 409 |
| 软删除 | DELETE 写 deletedAt；Customer 删除级联标记子资源 |
| 审计 | requestMeta 完整写入（RequestId/TraceId/IP/Device/Browser） |

## 5. Known Risks

- 无业务页面（3C 只做底座，页面 Sprint 4+）
- 客户编号生成暂由调用方提供 code（DocumentSequence 接入后续）
- CustomerCredit.usedCredit 由 Sales 回写（Sprint 4）
- 运行级（Railway）验证待执行
- 单元测试不替代集成 QA

## 6. Conclusion

```
Schema: PASS
Migration: PASS
Seed Idempotency: PASS
RBAC: PASS
API: PASS（代码审查）→ 运行级 PENDING
Business Rules: PASS（代码审查）→ 执行级 PENDING
Unit Test: PENDING（待 CI）
OpenAPI: PASS（customers/contacts/addresses/tags/credit/industries/tags 已覆盖）
CI: PENDING（远程 Quality Gates / Build / Secret Scan）
Deployment QA: NOT RUN（待 Railway 环境）
```

## 7. 待执行项（CI 与部署后回填）

- [ ] 远程 CI 全绿（Quality Gates / Build / Secret Scan）
- [ ] Railway 部署后 API 实际调用矩阵回填
- [ ] Seed 双次执行验证（0 重复 / 0 冲突）
- [ ] 业务规则端到端验证（主联系人唯一性/重复标签/信用 upsert）
- [ ] CTO 验收通过
- [ ] 六项同步（Tag / Release / CHANGELOG / QA / ADR / ROADMAP）
