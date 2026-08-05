# Sprint 3：System Foundation（系统底座）⬜

**原则：不开发业务页面，优先 ERP 底座能力；完成后再开发业务模块效率更高。**

| 字段 | 值 |
| --- | --- |
| 状态 | ⬜ 未开始 |
| 上游 | Sprint 2（PR #4 合并后） |

## Phase A：系统底座

| 模块 | 内容 | 依赖 |
| --- | --- | --- |
| Workflow Engine | 流程定义 / 流程实例 / 节点 / 流转 / 条件分支 | RBAC |
| Approval Engine | 审批单 / 审批人 / 会签 / 或签 / 委托 / 加签 / 驳回 | Workflow + RBAC |
| Notification | 站内信 / 邮件 / 消息模板 / 已读未读 | — |
| Dictionary | 字典类型 / 字典项（通用下拉数据源） | — |
| System Settings | 参数配置（税率/币种/单据规则等） | — |
| File Center | 文件上传 / 附件关联任意业务 / 下载 / 权限 | Notification |
| Dashboard API | 统计接口（销售漏斗/项目看板/应收/库存/利润） | 业务数据 |
| Menu Management | 菜单树 / 菜单权限绑定（数据驱动导航） | RBAC |

## Phase B：业务底座（主数据 CRUD 完整化）

| 模块 | 内容 | 依赖 |
| --- | --- | --- |
| Customer CRUD | 客户完整增删改查（含 2C 企业字段） | 2A/2B 模型 |
| Supplier CRUD | 供应商完整增删改查 | 2A/2B 模型 |
| Item CRUD | 物料完整增删改查（含工业字段/规格扩展） | 2A/2B 模型 |
| Price List CRUD | 价格表完整增删改查（9 类价格/阶梯/审批） | 2A/2B 模型 |
| Project CRUD | 项目完整增删改查（机会→项目全生命周期） | 2B 模型 |

> CRUD 复用 `apps/web/src/lib/api-helpers.ts`（鉴权/权限/审计）+ 动作级权限 + 审计日志。

## 验收

- 系统底座 8 模块 API 可用，审批流可驱动任意业务单
- 主数据 5 模块 CRUD 完整（搜索/分页/排序/审计/软删除）
- 详见 [ROADMAP.md](../ROADMAP.md) Sprint 3
