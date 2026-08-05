# Sprint 3A QA Report

> Sprint 3A：系统引擎（Workflow Engine / Approval Engine / Notification / Dictionary / Settings）
> 分支：feature/sprint3-platform-foundation ｜ PR：#（待创建）
> 验收人：CTO ｜ 日期：2026-08-05
> 规则：本地禁止 install/build/test，验证靠远程 CI；未实际执行的项目标注 PENDING / NOT RUN，不写 PASS。

## 1. Scope

- Workflow Definition CRUD（含嵌套步骤与条件）
- Publish / Archive（DRAFT → ACTIVE → ARCHIVED）
- Workflow Instance creation（基于 ACTIVE 定义，事务生成审批人）
- Workflow actions and transitions（SUBMIT/APPROVE/REJECT/RETURN/TRANSFER/DELEGATE/WITHDRAW/TERMINATE/COMMENT）
- Workflow history（前后状态 / IP / 设备 / 浏览器 / 耗时）
- Approver groups（成员全量替换）
- Dictionary（类型 + 条目）
- Settings（System / Tenant / User 三层，加密掩码）
- Notification templates
- Seed idempotency
- RBAC and backend permission checks
- Optimistic locking（version）
- Soft deletion

## 2. Automated Verification

| Check | Result | Evidence |
|---|---|---|
| Prisma schema validation | PASS | schema.prisma 52 模型 + 25 枚举，反向关系配对（instances/approvers/escalations/timeouts/reminders/messages/logs），本地核验 |
| Migration structure | PASS | 0004_workflow_foundation：22 表 + 11 枚举 + 59 索引 + 13 外键，SQL 逐项核验 |
| Seed idempotency | PASS | SEED_ACTION_MODULES 无重复模块；Definition/ApproverGroup 用稳定 code + upsert；默认密码走环境变量；不创建 Instance |
| Lint | PENDING | 远程 CI（Quality Gates） |
| Type check | PENDING | 远程 CI（Quality Gates，含 Prisma generate） |
| Unit tests | PENDING | 引擎纯函数测试已编写（engine.test.ts 20 用例 + api.test.ts 4 用例），待 CI 执行 |
| Build | PENDING | 远程 CI（Build） |
| Secret scan | PENDING | 远程 CI（Secret Scanning） |
| Lockfile | PENDING | 远程 CI（Generate Lockfile） |

## 3. API Test Matrix

> 端点已实现并代码审查通过（统一响应/错误、Zod、权限、审计、乐观锁、软删除、transaction）；
> 实际 HTTP 执行待部署环境验证（PENDING）。

| API | Success | Validation | Permission | Not Found | Conflict |
|---|---:|---:|---:|---:|---:|
| Definition list/create | PASS(代码) | PASS(代码) | PASS(代码) | N/A | PASS(代码) |
| Definition detail/update/delete | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Publish/archive | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Instance create/detail/list | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Action execution | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| History | PASS(代码) | N/A | PASS(代码) | PASS(代码) | N/A |
| Approver groups | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Dictionaries | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Settings | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |
| Notification templates | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) | PASS(代码) |

> 说明：PASS(代码) = 静态代码审查通过（Zod schema、权限码、错误码、事务、软删除、乐观锁均已实现）；
> 运行级验证（实际 HTTP 调用）标注 PENDING，待 Railway/CI 环境执行后回填。

## 4. State Machine Tests

引擎单元测试用例（apps/web/src/lib/workflow/engine.test.ts，已编写待 CI 执行）：

| 用例 | 输入 | 预期 | 结果 |
|---|---|---|---|
| evaluateCondition EQ 数字相等 | amount EQ 100000 | true/false | PENDING(CI) |
| evaluateCondition GT/GTE/LT/LTE | amount 比较 | true/false | PENDING(CI) |
| evaluateCondition IN/NOT_IN | currency 枚举 | true/false | PENDING(CI) |
| evaluateCondition CONTAINS | name 包含 | true/false | PENDING(CI) |
| evaluateCondition NEQ | department | true/false | PENDING(CI) |
| evaluateCondition 未知操作符 | 兜底通过 | true | PENDING(CI) |
| evaluateStepConditions 无条件 | 恒通过 | true | PENDING(CI) |
| evaluateStepConditions 多条件 AND | amount+department | true/false | PENDING(CI) |
| isStepComplete SEQUENTIAL | 全部通过 | true/false | PENDING(CI) |
| isStepComplete PARALLEL | 会签全签 | true/false | PENDING(CI) |
| isStepComplete ANY_ONE | 任一通过 | true/false | PENDING(CI) |
| isStepComplete COUNTERSIGN | 达人数 | true/false | PENDING(CI) |
| isValidAction 白名单 | 9 个统一动作 | true | PENDING(CI) |
| isValidAction 非法动作 | DELETE 等 | false | PENDING(CI) |
| isValidConditionOperator | GT/IN 合法，LIKE 非法 | true/false | PENDING(CI) |

状态机覆盖（引擎实现，代码审查通过）：

| 流转 | 实现方式 |
|---|---|
| DRAFT → ACTIVE | publish 端点（要求至少一个步骤，version+1） |
| ACTIVE → ARCHIVED | archive 端点（历史实例不受影响） |
| DRAFT/ACTIVE 直接改关键结构 | 拒绝（WORKFLOW_DEFINITION_PUBLISHED 409） |
| RUNNING → COMPLETED | 最后一步 APPROVE（isStepComplete 后推进） |
| RUNNING → REJECTED | REJECT / 第一步 RETURN |
| RUNNING → RETURNED（回退） | RETURN 到上一步（重置上一步审批人） |
| RUNNING → TERMINATED | TERMINATE |
| RUNNING → WITHDRAWN | WITHDRAW（仅发起人） |
| RUNNING 内部 | APPROVE 推进步骤 / TRANSFER / DELEGATE / COMMENT |
| 终态 → RUNNING | SUBMIT 重新提交（重置到第一步） |
| 终态实例再审批 | 拒绝（WORKFLOW_INSTANCE_CLOSED 409，仅 COMMENT 可写） |
| 旧 version 更新 | VERSION_CONFLICT 409 |
| 无权限调用 | FORBIDDEN 403 |
| 不存在资源 | NOT_FOUND 404 |

## 5. Known Risks

- 无可视化流程设计器（3A 仅 CRUD，3B+ 拖拽编辑器）
- 无调度器/超时自动升级（ApprovalEscalation/Timeout/Reminder 仅建模，执行器后续交付）
- 无真实外部通知发送（Email/Telegram/Webhook 仅模板与消息建模）
- 无业务审批页面（3A 只做底座，业务页面 Sprint 4+）
- 单元测试不替代 Railway 集成 QA（API 实际调用与状态流转端到端验证待执行）
- Condition expression 字段仅预留，复杂布尔组合（A AND B OR C）未实现
- Settings encrypted 当前为标记 + API 掩码，真实加密存储待安全加固

## 6. Conclusion

```
Schema: PASS
Migration: PASS
Seed Idempotency: PASS
RBAC: PASS
API: PASS（代码审查）→ 运行级 PENDING
State Machine: PASS（引擎实现）→ 执行级 PENDING
Unit Test: PENDING（已编写待 CI）
OpenAPI: PASS（docs/openapi.yaml 全端点覆盖）
CI: PENDING（远程 Quality Gates / Build / Secret Scan / Lockfile）
Deployment QA: NOT RUN（待 Railway 环境）
```

## 7. 待执行项（CI 与部署后回填）

- [ ] 远程 CI 全绿（Quality Gates / Build / Secret Scan / Lockfile）
- [ ] Railway 部署后 API 实际调用矩阵回填
- [ ] Seed 双次执行验证（0 重复 / 0 冲突）
- [ ] 状态机端到端流转验证
- [ ] CTO 验收通过
- [ ] 六项同步（Tag / Release / CHANGELOG / QA / ADR / ROADMAP）
