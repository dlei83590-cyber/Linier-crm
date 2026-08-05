# Sprint 3：ERP Foundation（ERP 底座）🔄

**原则：不开发业务页面，优先 ERP 底座能力；Sprint 3C 只做 CRUD 不做业务。**

| 字段 | 值 |
| --- | --- |
| 状态 | 🔄 3A ✅（v0.3.0-alpha）/ 3B ✅（v0.4.0-alpha）/ 3C Business Foundation 进行中（分支 feature/sprint3-business-foundation） |
| 上游 | Sprint 2 ✅ Closed（v0.2.0-alpha）→ 3A ✅（v0.3.0-alpha）→ 3B ✅（v0.4.0-alpha） |
| 分支规范 | `feature/sprint3-business-foundation`（以后所有 Sprint 统一 `feature/sprintX-xxxx`） |

## Sprint 3A：系统引擎 ✅ Closed（v0.3.0-alpha，PR #5）

| 模块 | 内容 | 支持 |
| --- | --- | --- |
| Workflow Engine | Workflow Definition / Instance / Step / Action / History / Condition | 审批 / 退回 / 驳回 / 撤销 / 转交 / 结束 |
| Approval Engine | 审批流（基于 Workflow） | 串签 / 会签 / 或签 / 加签 / 抄送 |
| Notification | Notification / Email / System Message / Telegram / Webhook（预留） | 以后企业微信 / 钉钉直接接入 |
| Dictionary | Dictionary Type / Dictionary Item | 行业 / 城市 / 单位 / 品牌等 |
| Settings | System Setting / Tenant Setting / User Setting（Key-Value） | 税率/币种/单据规则等 |

## Sprint 3B：平台能力

| 模块 | 内容 |
| --- | --- |
| Menu | Menu / Menu Permission / Menu Tree / Menu Sort |
| Dashboard API | Dashboard Widget / Layout / KPI |
| Audit（升级） | 在 AuditLog 基础上增加：Object Type / Object ID / IP / Device / Browser / Duration |
| File Center | File / Folder / Version / Preview / Attachment（合同/报价/图片共用） |

## Sprint 3C：业务底座（仅 CRUD，不业务）

- Customer / Supplier / Item / Project / Price List
- 统一能力：List / Search / Filter / Create / Edit / Delete / Export / Import

## Sprint 3B：平台能力 ✅ Closed（v0.4.0-alpha，PR #6）

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| Audit Center | AuditLog +8 字段 + requestMeta + audit-logs API | ✅ |
| Menu Center | MenuGroup + Menu 树 + RouteMeta | ✅ |
| Dashboard API | Widget / Layout / KPI / Chart 数据 API | ✅ |
| File Center | File / Folder / Version / Attachment / Preview | ✅ |
| 架构冻结 | ARCHITECTURE_BASELINE v1.0 | ✅ |

> CTO 评价：综合成熟度 99/100；迁移 0005-0008；ADR-0005~0008

## Sprint 3C：Business Foundation（业务底座，CTO 改名）

**原则：不开发业务页面，只做业务底座（Validation/Permission/Audit/Workflow/Attachment 一起），每个子阶段独立 PR、独立 QA、独立 ADR、独立验收。**

| 子阶段 | 内容 | 状态 |
| --- | --- | --- |
| 3C-1 | Customer Foundation：Customer / Contact / Address / Tag / Industry / Credit | ✅ Closed（PR #7 已合并，main=f0839262） |
| 3C-2 | Supplier Foundation：Supplier + 独有 Qualification/Certificate/Settlement + Partner 共享（Contact/Address/Tag/BankAccount/Credit） | ✅ Closed（PR #8 已合并，main=c27c59130b） |
| 3C-3 | Item Foundation：Item Master（ItemType 10 类/五级层级/多 UOM/ItemSpecification/ItemCost/SupplierItem/ItemRevision/ItemTag） | 🔄 Implementation（PR #9） |
| 3C-4 | Project Foundation：Opportunity / Project / Milestone / Task / Visit / Risk / Expense | ⬜ |
| 3C-5 | Price Foundation：Price List / Price Rule / Customer Price / Region Price / History | ⬜ |

> 新增规范（CTO 要求）：docs/API_GUIDELINES.md（分页/过滤/排序/搜索/批量/导入/导出/错误码/版本/Headers/Rate Limit/Idempotency）、docs/ERROR_CODES.md（统一错误码）、docs/EVENTS.md（Domain Events）

## QA 规则（CTO 批准）

从 Sprint 3 开始，每个 PR 必须新增 `docs/qa/` 验收文档：

- `docs/qa/Sprint3A_QA.md` / `Sprint3B_QA.md` / `Sprint3C_QA.md`
- 记录：测试内容、测试结果、截图、已知问题、风险、验收人

## Release 六项同步（CTO 批准）

每个 Sprint 完成后：**Tag / Release / CHANGELOG / QA / ADR / ROADMAP** 六项全部同步。

## 验收

- Workflow + Approval 可驱动任意业务单（串签/会签/或签/加签/抄送）
- Notification 四通道 + Webhook 预留；Dictionary/Settings 可用
- Menu 数据驱动导航；Dashboard API 可统计；Audit 增强字段；File Center 附件通用
- 主数据 5 模块 CRUD 完整（复用 api-helpers + 动作级权限 + 审计）
