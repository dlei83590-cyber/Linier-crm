# 产品路线图（ROADMAP）

- 版本：v1.1
- 日期：2026-08-05
- 维护者：CIO（JINZA）｜审核：CTO
- 状态说明：✅ 已完成 ｜ 🔄 进行中 ｜ ⬜ 未开始
- **本文件是项目唯一开发路线依据，CTO / CIO / 开发人员一律以此为准，不再依赖聊天记录推进项目。**

---

## 1. 总览（Sprint 1-10）

| Sprint | 主题 | 状态 | 备注 |
| --- | --- | --- | --- |
| Sprint 1 | Infrastructure（基础设施） | ✅ Closed | Release v0.1.0-alpha |
| Sprint 2 | Master Data（主数据） | ✅ Closed | Release v0.2.0-alpha（2A+2B+2C） |
| Sprint 3 | ERP Foundation（ERP 底座） | ✅ Closed | 3A Workflow Foundation ✅（v0.3.0-alpha）+ 3B Platform Capabilities ✅（v0.4.0-alpha）+ 3C Business Foundation ✅（v0.5.0-alpha，3C-1~3C-5 全部完成） |
| Sprint 4 | Sales（销售） | 🔄 | 4A Quotation Foundation ✅（PR #12）；4B Sales Order Foundation ✅（PR #13）；4C Delivery Foundation ✅（PR #14）；4D Invoice 下一步 |
| Sprint 5 | Purchase（采购） | ⬜ | PR/PO/GRN/Supplier Invoice/Payment |
| Sprint 6 | Inventory（库存） | ⬜ | Warehouse/Stock/Batch/Movement/Count/Transfer |
| Sprint 7 | Finance（财务） | ⬜ | AR/AP/Expense/Voucher/Journal/GL/Profit/Cash Flow |
| Sprint 8 | BI（商业智能） | ⬜ | 报表 / Dashboard / 数据分析 |
| Sprint 9 | OA（办公协同） | ⬜ | 审批 / 消息 / 日程 / 知识库 |
| Sprint 10 | Mobile（移动端） | ⬜ | 移动应用 / 小程序 |

> 依赖顺序：1 → 2 → 3 → 4/5/6 → 7 → 8 → 9 → 10
> （Sprint 4-6 可部分并行，但都依赖 Sprint 3 业务底座；Sprint 7 依赖 4-6 的单据）

---

## 2. 分支规范（CTO 规则，Sprint 3 起）

- 每个 Sprint 统一分支：`feature/sprintX-xxxx`（如 `feature/sprint3-platform-foundation`）
- 每个 Sprint 完成后必须六项同步：**Tag / Release / CHANGELOG / QA / ADR / ROADMAP**
- 从 Sprint 3 开始，每个 PR 必须新增 `docs/qa/` 验收文档（如 `docs/qa/Sprint3A_QA.md`），记录：测试内容、测试结果、截图、已知问题、风险、验收人
- **Sprint 3B 起新增 `docs/test-cases/` 测试用例文档**（如 `Menu_API.md` / `Audit_API.md` / `Dashboard_API.md` / `File_API.md`），供自动化测试复用
- **从 v0.3.0 起 Release 必须包含**：Compatibility / Database / Migration / Breaking Changes / Upgrade Guide
- **架构冻结**：基础平台能力（Workflow/Approval/Notification/Dictionary/Settings/Menu/Audit/Dashboard/File）调整必须新增 ADR，禁止直接修改（见 ARCHITECTURE_BASELINE.md）
- **Sprint 3C 起新增规范文档**：`docs/API_GUIDELINES.md`（分页/过滤/排序/搜索/批量/导入/导出/错误码/版本/Headers/Rate Limit/Idempotency 统一约定）、`docs/ERROR_CODES.md`（统一错误码注册表，如 AUTH_001/WORKFLOW_001，供前端国际化与日志统计）、`docs/EVENTS.md`（Domain Events 注册表，如 ProjectCreated/WorkflowApproved/QuotationSubmitted/InvoicePaid/PurchaseCompleted，供 Notification/BI/Webhook 监听，模块间不直接调用）
- **Sprint 4 前必须完成**：① 统一异常码 Error Code Registry（落地 ERROR_CODES.md）② 事件总线 Domain Events（落地 EVENTS.md）

---

## 3. Sprint 1：Infrastructure ✅ Closed

**Release：v0.1.0-alpha（PR #3 合并，tag 3b7fd546）**

- ✅ 项目脚手架（web / API / 数据库 / shared 契约）
- ✅ 格式化 / lint / 类型检查 / 单测 / 构建命令
- ✅ CI：Quality Gates + Secret Scanning + Build + Generate Lockfile
- ✅ 认证与会话（JWT via jose、bcrypt）
- ✅ 用户 / 部门 / 角色 / 权限 / 用户角色 / 审计日志
- ✅ RBAC 在可健康检查的 API 切片上生效
- ✅ Railway 部署 + 测试账户 + runbook

---

## 4. Sprint 2：Master Data ✅ Closed

**Release：v0.2.0-alpha（PR #4 合并，merge a00d4223e6）**

### Sprint 2A：中国版主数据

- ✅ Item 统一物料（6 类：成品/原材料/配件/外购件/服务/包装物）
- ✅ LinearGuideSpecification（直线导轨专用规格，1:1 扩展）
- ✅ BusinessPartner 统一往来单位（客户/供应商/两者），含统一社会信用代码/纳税人类型/开票/银行/结算
- ✅ PriceList + PriceListItem 含税价格体系（未税/税率/税额/含税）
- ✅ TechnicalStandard + ItemStandard、UnitOfMeasure、CommercialTerm、DocumentSequence
- ✅ 默认币种 CNY；默认税率可配置（DEFAULT_TAX_RATE=13，不写死）
- ✅ 全表审计字段（创建人/修改人/审核人/审批状态/版本/软删除）

### Sprint 2B：项目领域模型

- ✅ 14 模型 + 8 枚举：ProjectOpportunity → Project 双段模型（1:1 可断开）
- ✅ 项目阶段 11 态 / 关系人 5 角色 / 12 子模型
- ✅ 财务字段：客户投入/预计营收/成本/毛利/费用预算/销售目标/回款状态/竞争对手/成功概率

### Sprint 2C：企业字段补强（CTO 评审建议）

- ✅ BusinessPartner +14 企业字段（简称/全称/集团/区域/行业/规模/信用/来源/成立日期/注册资本/员工数/官网/公众号/标签）
- ✅ Item +14 工业字段（品牌/制造商/OEM/客户料号/供应商料号/图号/图纸版本/生命周期/停产/替代料/最小包装/采购周期/MOQ/安全库存）
- ✅ PriceList +priceType（9 类价格：采购/销售/VIP/代理/工程/战略/区域/客户专属/历史）
- ✅ Project +9 财务字段（合同金额/利润/毛利率/回款/开票/应收/评级/失败原因）
- ✅ DocumentSequence +docType（DocumentType 17 种单据）
- ✅ 权限动作级设计：view/create/edit/delete/approve/audit/export/import/assign/close

---

## 5. Sprint 3：ERP Foundation（ERP 底座）✅ Closed

### Sprint 3B：平台能力 ✅ Closed（v0.4.0-alpha，PR #6）

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| Audit Center | AuditLog +8 字段（Before/AfterData/RequestId/TraceId/IP/Device/Browser/Duration/Result）+ requestMeta + audit-logs API | ✅ |
| Menu Center | MenuGroup + Menu 树 + RouteMeta（Icon/Sort/Hidden/Cache/ExternalLink/Permission） | ✅ |
| Dashboard API | Widget / Layout / KPI / Chart 四模型，只提供数据 API | ✅ |
| File Center | File / Folder / Version / Attachment / Preview，业务单据统一引用 | ✅ |
| 架构冻结 | ARCHITECTURE_BASELINE v1.0（调整必须 ADR） | ✅ |

> Release：v0.4.0-alpha（PR #6 合并，merge e54567e67c）；迁移 0005-0008；ADR-0005~0008
> CTO 评价：综合成熟度 99/100

**原则：不开发业务页面，优先 ERP 底座能力；Sprint 3C 只做 CRUD 不做业务。**

### Sprint 3A：系统引擎 ✅ Closed（v0.3.0-alpha，PR #5）

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| Workflow Engine | Workflow Definition / Instance / Step / Action / History / Condition | ✅ 统一动作 9 种 + 4 审批模式 |
| Approval Engine | Approver / ApproverGroup / Delegate / Escalation / Timeout / Reminder（与 Workflow 解耦） | ✅ 建模 + 审批组 CRUD |
| Notification | Template / Message / Channel / Log（SYSTEM/EMAIL/TELEGRAM/WEBHOOK + 企微/钉钉预留） | ✅ 建模 + 模板 CRUD（真实发送后续） |
| Dictionary | Dictionary Type / Dictionary Item | ✅ CRUD |
| Settings | System / Tenant / User 三层 Key-Value | ✅ CRUD + 加密掩码 |

> Release：v0.3.0-alpha（PR #5 合并，merge 42ebf22262）；迁移 0004_workflow_foundation；ADR-0004

### Sprint 3B：平台能力（架构冻结后按序开发）

**开发顺序（CTO 批准，不并行）：Audit Center → Menu Center → Dashboard API → File Center**

| 模块 | 内容 | 优先级 |
| --- | --- | --- |
| Audit Center（升级） | AuditLog + ObjectType/ObjectId/BeforeData/AfterData/RequestId/TraceId/IP/Device/Browser/Duration/Result | 1️⃣ 完成后所有 CRUD 直接可用 |
| Menu Center | Menu / MenuGroup / MenuPermission / RouteMeta / Icon / Sort / Hidden / Cache / ExternalLink | 2️⃣ 前端直接读取 |
| Dashboard API | /widgets /layouts /kpis /charts（不写页面） | 3️⃣ 页面以后开发 |
| File Center | File / Attachment / Folder / Version / Preview | 4️⃣ 报价/合同/SO/Invoice/Project 统一引用 |

> 启动前先创建 `docs/ARCHITECTURE_BASELINE.md`（架构冻结），后续调整必须新增 ADR。
> 新增 `docs/test-cases/`：Menu_API.md / Audit_API.md / Dashboard_API.md / File_API.md。

### Sprint 3C：Business Foundation（业务底座，CTO 改名，非仅 CRUD）

**原则：不开发业务页面，只做业务底座（Validation / Permission / Audit / Workflow / Attachment 一起），每个子阶段独立 PR、独立 QA、独立 ADR、独立验收。**

| 子阶段 | 内容 | 状态 |
| --- | --- | --- |
| 3C-1 | Customer Foundation：Customer / Contact / Address / Tag / Industry / Credit | ✅ |
| 3C-2 | Supplier Foundation：Supplier / Contact / Settlement / Qualification / Certificate | ✅ |
| 3C-3 | Item Foundation：Item / Specification / Category / Brand / UOM / Price / Attachment | ✅ |
| 3C-4 | Price Foundation：Price Policy / Rule / List / Partner Price / Promotion / Tax / Exchange Rate | ✅ |
| 3C-5 | Project Foundation：Opportunity / Project / Milestone / Task / Visit / Risk / Expense | ✅ |

> 统一能力：List / Search / Filter / Create / Edit / Delete / Export / Import + 动作级权限 + 审计 + 附件引用

---

## 6. Sprint 4：Sales（销售）🔄（4A Quotation ✅，4B Sales Order ✅，4C Delivery ✅，4D Invoice 下一步）

| 模块 | 说明 | 状态 |
| --- | --- | --- |
| Quotation | 报价单（引用价格表，含税/未税，审批流） | ✅ 4A 完成（PR #12，2026-08-07） |
| Contract | 合同（关联订单/项目，金额/条款/附件） | ⬜ |
| Sales Order | 销售订单（引用报价/项目/物料，单据编号走 DocumentSequence） | ✅ 4B 完成（PR #13，2026-08-07） |
| Delivery | 发货单（DO，关联订单，触发库存出库） | ✅ 4C 完成（PR #14，2026-08-07；交付事实源 + 防超交 + POD 投影 + SO 聚合） |
| Invoice | 销售发票（CI，关联发货/订单，应收挂账） | ⬜ 4D 下一步 |
| Payment | 收款（回款核销，更新应收余额） | ⬜ 4E 后续 |

---

## 7. Sprint 5：Purchase（采购）⬜

| 模块 | 说明 |
| --- | --- |
| Purchase Request | 请购单（需求来源：库存预警/项目/手工） |
| Purchase Order | 采购订单（PO，引用供应商/物料/价格） |
| GRN | 收货单（GRN，入库触发库存） |
| Supplier Invoice | 供应商发票（应付挂账） |
| Payment | 付款（核销应付） |

---

## 8. Sprint 6：Inventory（库存）⬜

| 模块 | 说明 |
| --- | --- |
| Warehouse | 仓库 / 库位 |
| Stock | 库存余额（物料×仓库，实时） |
| Batch | 批次管理（批号/效期/追溯） |
| Inventory Movement | 库存流水（出入库/调拨/调整，全追溯） |
| Stock Count | 盘点（盘点单/差异/调整） |
| Transfer | 调拨（仓库间转移） |

> Item 的 2C 字段（安全库存/MOQ/最小包装/采购周期）在此直接复用。

---

## 9. Sprint 7：Finance（财务）⬜

| 模块 | 说明 |
| --- | --- |
| AR | 应收（销售发票/收款核销/账龄） |
| AP | 应付（采购发票/付款核销） |
| Expense | 费用报销（项目费用/日常费用，走审批流） |
| Voucher | 凭证（记账凭证，来源单据自动生成/手工） |
| Journal | 日记账 |
| General Ledger | 总账（科目余额/试算平衡） |
| Profit | 利润（收入-成本-费用，按期间/项目/客户） |
| Cash Flow | 现金流量（收/支/结余） |

---

## 10. Sprint 8：BI（商业智能）⬜

- 报表中心：销售漏斗 / 项目漏斗 / 订单 / 采购 / 库存 / 应收应付 / 利润
- Dashboard（复用 Sprint 3B Dashboard API）
- 导出（Excel/CSV，权限动作 export）
- 数据口径与权限（按角色/部门/区域）

---

## 11. Sprint 9：OA（办公协同）⬜

- 审批中心（统一待办，复用 Approval Engine）
- 消息中心（复用 Notification）
- 日程 / 任务 / 纪要
- 知识库 / 文档（复用 File Center）
- 企业微信 / 钉钉 / 邮件对接（可选）

---

## 12. Sprint 10：Mobile（移动端）⬜

- 移动端应用 / 小程序
- 移动审批 / 单据录入 / 库存查询 / 消息提醒
- 离线能力（可选）

---

## 13. Release 规则（CTO 批准）

每个 Sprint 完成后，以下六项必须同步（不再事后补）：

| 项 | 说明 |
| --- | --- |
| Tag | `vX.Y.Z-alpha` 语义化版本 tag |
| Release | GitHub Release（含变更摘要） |
| CHANGELOG | 更新 `docs/CHANGELOG.md` |
| QA | 更新 `docs/qa/SprintX_QA.md`（测试内容/结果/截图/已知问题/风险/验收人） |
| ADR | 涉及架构决策更新 `docs/ADR/` |
| ROADMAP | 更新本文件（Sprint 状态 ✅/⬜） |

---

## 14. 里程碑与验收

| 里程碑 | 内容 | 判定 |
| --- | --- | --- |
| M1 | Sprint 1 完成 | Release v0.1.0-alpha ✅ |
| M2 | Sprint 2 完成 | Release v0.2.0-alpha ✅（main 冻结） |
| M3 | Sprint 3 完成 | Release v0.5.0-alpha ✅（3A ✅ v0.3.0-alpha；3B ✅ v0.4.0-alpha；3C ✅ v0.5.0-alpha，3C-1~3C-5 全部完成，PR #5-#11 合并） |
| M4 | Sprint 4-6 完成 | 进销存闭环可用 |
| M5 | Sprint 7 完成 | 财务闭环可用 |
| M6 | Sprint 8-10 完成 | 数据驱动 + 移动化 |

## 15. 变更记录

| 日期 | 变更 | 说明 |
| --- | --- | --- |
| 2026-08-07 | 更新 v1.8 | Sprint 4C Delivery Foundation 完成（PR #14 squash 合并 d1d8106；CTO Final Review Cover：docs/reviews/Sprint4C_CTO_Review_Cover.md，Checklist 12 项全 ✅，APPROVE & MERGE；CI 全绿）；Sprint 4 状态 🔄（4A ✅ 4B ✅ 4C ✅）；Delivery 模块 ✅（交付事实源/防超交/POD/SO 聚合），4D Invoice 下一步；保留 feature/sprint4-sales 继续下一阶段；不打新大版本 Tag（待 Sprint 4 Sales 完整闭环（4D + 4E）后统一发布）；整体成熟度约 75% |
| 2026-08-07 | 更新 v1.7 | Sprint 4B Sales Order Foundation 完成（PR #13 squash 合并 3747eba；CTO Final Review 3 阻断项 + 最终复审 1 阻断项修复后 APPROVED；CI 全绿）；Sprint 4 状态 🔄（4A ✅ 4B ✅）；Sales Order 模块 ✅，4C Delivery 设计先行；保留 feature/sprint4-sales 继续下一阶段；不打新大版本 Tag（待 Sprint 4 Sales 更完整后统一发布） |
| 2026-08-07 | 更新 v1.6 | Sprint 4A Quotation Foundation 完成（PR #12 合并，8ee88a0；CTO Final Review 3 阻断项修复后 APPROVED；CI #78 全绿）；Sprint 4 状态 ⬜ → 🔄；Quotation 模块 ✅，4B Sales Order 设计先行；不打新大版本 Tag（待 Sprint 4 Sales 更完整后统一发布） |
| 2026-08-05 | 创建 v1.0 | Sprint 3 拆 Phase A/B，Sprint 4-7 按销售/采购/库存/财务排序，新增 BI/OA/Mobile |
| 2026-08-07 | 更新 v1.5 | Sprint 3C-5 Project Foundation 完成（PR #11 合并，v0.5.0-alpha 正式发布，Sprint 3 全部完成）；整体完成度约 62%-65%（平台底座 95%、主数据与业务底座 100%、核心业务流程约 20%）；Sprint 4 只做设计不写实现 |
| 2026-08-06 | 更新 v1.4 | Sprint 3C-1~3C-4 完成（PR #7/#8/#9/#10 合并，v0.5.0-alpha 发布）；3C-4 Price Foundation 验收通过（CTO 审核：Schema/Migration/Seed/RBAC/Engine/API/OpenAPI/QA/CI 全 PASS）；整体完成度约 60%；3C-5 Project Foundation 启动；Sprint 4 只做设计不写实现 |
| 2026-08-05 | 更新 v1.3 | Sprint 3B Closed（v0.4.0-alpha，PR #6，CTO 99/100）；Sprint 3C 改名 Business Foundation 拆 5 子阶段（Customer/Supplier/Item/Project/Price）；新增 API_GUIDELINES / ERROR_CODES / EVENTS 规范文档 |
| 2026-08-05 | 更新 v1.2 | Sprint 3A Closed（v0.3.0-alpha，PR #5）；Sprint 3B 按 Audit→Menu→Dashboard→File 顺序；新增 ARCHITECTURE_BASELINE 架构冻结 + docs/test-cases/ + Release 五要素 + Sprint 4 前 Error Code Registry 与 Domain Events |
