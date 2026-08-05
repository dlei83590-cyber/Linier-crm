# Sprint 3：ERP Foundation（ERP 底座）⬜

**原则：不开发业务页面，优先 ERP 底座能力；Sprint 3C 只做 CRUD 不做业务。**

| 字段 | 值 |
| --- | --- |
| 状态 | ⬜ 未开始（分支 feature/sprint3-platform-foundation） |
| 上游 | Sprint 2 ✅ Closed（v0.2.0-alpha，main 冻结） |
| 分支规范 | `feature/sprint3-platform-foundation`（以后所有 Sprint 统一 `feature/sprintX-xxxx`） |

## Sprint 3A：系统引擎

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
