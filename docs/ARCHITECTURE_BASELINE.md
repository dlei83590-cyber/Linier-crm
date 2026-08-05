# ARCHITECTURE_BASELINE 架构冻结基线

- 版本：v1.0
- 日期：2026-08-05
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**已冻结**（Sprint 3A 完成，Sprint 3B 开发前）
- 关联：[ROADMAP.md](./ROADMAP.md) ｜ [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) ｜ [ADR](./ADR/) ｜ [prisma/schema.prisma](../prisma/schema.prisma)

> **冻结规则（CTO 批准）**：以下基础能力为本平台核心设计。后续 Sprint 如需调整，
> **必须新增 ADR** 说明背景/决策/备选方案/影响，**禁止直接修改**。本文件同步更新并记录 ADR 引用。

---

## 1. 当前模块清单（Sprint 3A 完成态）

| 域 | 模型 | 数量 | 状态 |
| --- | --- | --- | --- |
| 主数据（Sprint 2） | Item / LinearGuideSpecification / BusinessPartner / PriceList / PriceListItem / TechnicalStandard / ItemStandard / UnitOfMeasure / CommercialTerm / DocumentSequence | 10 | ✅ |
| 项目领域（Sprint 2） | ProjectOpportunity / Project + 12 子模型 | 14 | ✅ |
| Workflow（Sprint 3A） | WorkflowDefinition / WorkflowStep / WorkflowCondition / WorkflowInstance / WorkflowAction / WorkflowHistory | 6 | ✅ |
| Approval（Sprint 3A） | Approver / ApproverGroup / ApproverGroupMember / ApprovalDelegate / ApprovalEscalation / ApprovalTimeout / ApprovalReminder | 7 | ✅ |
| Notification（Sprint 3A） | NotificationTemplate / NotificationMessage / NotificationChannel / NotificationLog | 4 | ✅ |
| Dictionary（Sprint 3A） | DictionaryType / DictionaryItem | 2 | ✅ |
| Settings（Sprint 3A） | SystemSetting / TenantSetting / UserSetting | 3 | ✅ |
| 平台基础（Sprint 1） | User / Role / Permission / UserRole / Department / AuditLog | 6 | ✅ |
| **合计** | | **52 模型 + 25 枚举** | |

## 2. 领域边界

| 领域 | 边界 | 禁止事项 |
| --- | --- | --- |
| 主数据 | Item/BusinessPartner/PriceList 等全局共享数据 | 业务模块不得重复定义物料/往来单位字段 |
| 项目领域 | 售前机会 → 项目实施全生命周期 | 订单/库存/财务不得内嵌项目阶段逻辑 |
| Workflow | 只负责"流程定义 + 实例流转"（Definition/Step/Condition/Instance/Action/History） | 不得内嵌审批人策略 |
| Approval | 只负责"谁来批"（Approver/Group/Delegate/Escalation/Timeout/Reminder） | 不得内嵌流程推进逻辑 |
| Notification | 只负责"模板 + 消息 + 渠道 + 日志" | 业务模块不得直接调邮件/IM SDK |
| Dictionary | 集中字典（类型/条目） | 业务模块不得硬编码枚举文案 |
| Settings | 三层 Key-Value 参数 | 税率/币种等参数不得写死 |
| Menu / Dashboard / Audit / File（3B） | 平台能力 | 业务模块不得各自实现菜单/审计/文件 |

## 3. API 命名规范（冻结）

- 路由：`/api/{domain}/{resource}`，资源名小写复数（`/api/workflows/definitions`）
- 层级：`/api/{domain}/{resource}/{id}`；子资源 `/api/{domain}/{resource}/{id}/{children}`
- 动作端点：`/api/{resource}/{id}/{action}`（如 `publish` / `archive` / `actions`）
- 方法语义：GET 读 / POST 建（或动作）/ PATCH 改 / DELETE 软删
- 分页参数：`page`（默认 1）+ `pageSize`（默认 20，上限 100）
- 权限码：`{module}:{action}`（module 见 PERMISSION_MODULES；action 固定 10 种：view/create/edit/delete/approve/audit/export/import/assign/close）

## 4. 公共响应规范（冻结）

成功：

```json
{ "success": true, "data": {}, "meta": { "page": 1, "pageSize": 20, "total": 0 } }
```

失败：

```json
{ "success": false, "error": { "code": "WORKFLOW_DEFINITION_NOT_FOUND", "message": "工作流定义不存在", "details": {} } }
```

- 错误码：统一使用 `apps/web/src/lib/api/errors.ts` 的 `ERROR_CODES`，禁止散落魔法字符串
- 创建返回 201；校验失败 400；未授权 401；无权限 403；不存在 404；冲突（重复/版本过期/状态不允许）409；服务器错误 500
- 所有 API 必须：Zod 校验 + 后端权限校验 + AuditLog + 请求日志

## 5. Prisma 统一规范（冻结）

- Prisma 版本 6.x；模型名 PascalCase 单数；字段 camelCase
- 枚举集中管理（schema 内 enum 块），业务模块禁止自造状态字符串
- 时间字段：`DateTime @db.Timestamptz(3)`（createdAt/updatedAt）
- 唯一约束：业务编码用 `@unique`（如 code/key）；复合唯一如 `@@unique([typeId, code])`
- 索引：外键 + 高频过滤字段必须建索引；软删除字段 `deletedAt` 建索引
- 关系：所有 `@relation` 必须明确 `onDelete`（Restrict/Cascade/SetNull），禁止默认歧义
- 迁移：手写 SQL 与既有风格一致；已上线迁移禁止修改，改动走新迁移（CTO 规则）

## 6. 审计字段规范（冻结，CTO 规则）

所有业务模型必须包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | String @id @default(cuid()) | 主键 |
| createdAt / createdById | Timestamptz / String? | 创建时间/人 |
| updatedAt / updatedById | Timestamptz / String? | 更新时间/人 |
| version | Int @default(1) | 乐观锁版本 |
| approvalStatus | ApprovalStatus @default(DRAFT) | 审批状态（适用时） |
| isDeleted | Boolean @default(true) | 逻辑删除标记 |
| deletedAt / deletedBy | Timestamptz? / String? | 软删除时间/人 |

- **禁止物理删除业务数据**；DELETE 端点一律软删除（写入 deletedAt）
- 更新必须携带 version，不匹配返回 409 VERSION_CONFLICT

## 7. Workflow 与 Approval 边界（冻结）

- Workflow 定义流程：Definition（版本/状态）→ Step（步骤/审批方式/超时/允许动作）→ Condition（field/operator/value 结构化）
- Approval 执行审批：Approver（实例级审批人）→ Group（可复用集合）→ Delegate/Escalation/Timeout/Reminder（策略）
- 统一动作枚举（WorkflowActionType）：SUBMIT / APPROVE / REJECT / RETURN / TRANSFER / DELEGATE / WITHDRAW / TERMINATE / COMMENT
- 审批模式（ApprovalMode）：SEQUENTIAL（串签）/ PARALLEL（会签全签）/ ANY_ONE（或签）/ COUNTERSIGN（会签人数）
- 实例状态机：RUNNING → COMPLETED / REJECTED / TERMINATED / WITHDRAWN；终态可 SUBMIT 重新提交
- **禁止**：业务模块自定义审批动作；定义发布后修改 code/module/steps（只能改 name/description 或建新版本）

## 8. Notification 边界（冻结）

- 渠道枚举（NotificationChannelType）：SYSTEM / EMAIL / TELEGRAM / WEBHOOK / WECHAT / DINGTALK（后两者预留）
- 状态（NotificationStatus）：PENDING / SENT / FAILED / READ
- 业务模块只写 NotificationTemplate（code 唯一）+ NotificationMessage，不关心渠道实现
- 真实发送（邮件/Telegram/Webhook/企微/钉钉）后续通过渠道执行器接入，本轮不实现
- **禁止**：业务模块直接调外部消息 SDK

## 9. Dictionary 边界（冻结）

- DictionaryType（code 唯一，含 category/language/sort/icon/color/enabled）
- DictionaryItem（typeId+code 唯一，含 label/sort/color/icon/enabled）
- 业务模块枚举文案必须走字典，禁止硬编码
- 删除为软删除（类型删除后条目保留历史）

## 10. Settings 边界（冻结）

- 三层：SystemSetting（key 全局唯一）/ TenantSetting（tenantId+key）/ UserSetting（userId+key）
- 数据类型（SettingDataType）：STRING / NUMBER / BOOLEAN / JSON / SECRET
- `encrypted=true` 时 API 返回掩码（******），不返回明文
- 税率等业务参数走 Settings 或环境变量（DEFAULT_TAX_RATE 默认 13），禁止写死

## 11. 后续 Sprint 禁止破坏的核心设计

1. 统一审计字段 + 软删除 + 乐观锁（第 6 节）
2. 统一 API 响应/错误格式（第 4 节）
3. 动作级权限 `{module}:{action}`（第 3 节）
4. Workflow 与 Approval 解耦（第 7 节）
5. Notification 统一事件模型（第 8 节）
6. 条件结构化存储（field/operator/value，不存任意脚本）
7. Settings 三层 Key-Value（第 10 节）
8. 枚举集中管理 + 已上线迁移不修改（第 5 节）
9. 业务单据通过 `businessType + businessId` 关联 Workflow 实例
10. 错误码统一注册（Sprint 4 前落地 Error Code Registry）+ 事件总线（Domain Events，审批通过后事件驱动通知/日志/后续业务）

## 12. 调整流程（冻结规则）

- 任何对上述冻结设计的调整：**先写 ADR**（背景/决策/备选/影响），CTO 审核通过后实施
- 本文件随 ADR 更新，并记录变更历史

## 13. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-05 | v1.0 | 初始冻结（Sprint 3A 完成后，Sprint 3B 前） |
