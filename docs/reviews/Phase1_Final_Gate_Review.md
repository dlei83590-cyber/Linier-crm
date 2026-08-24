# Phase 1 Final Gate Review — 合同对齐专项 Phase 1 收口

> 日期：2026-08-24 ｜ CTO Directive Phase 1 Final Gate ｜ 基线：main @ `5b97872`（PR #211-#216）
> Migration baseline：**0047**（本 Phase 零 Schema/零 Migration）

---

## Phase 1 Final Gate — 6 项事实逐条证据

| # | 要求 | 结论 | 代码证据（PR） |
|---|---|---|---|
| 1 | 全仓库业务 UI 不再向 BusinessPartner FK 提交 Customer.id | ✅ | P0-1（#212）：前端 /api/customers 消费清零；共享选择器 `lib/frontend/customer-options.ts`（数据源=/api/business-partners?type=CUSTOMER，option.id=BusinessPartner.id）+ 回归测试 ×3 |
| 2 | 新 CRM 功能全部使用 BusinessPartner.id | ✅ | 同上共享选择器 SSOT；商机/项目新建接入 |
| 3 | Customer 360 Workspace 可从客户主体追到销售/项目/财务事实 | ✅ | Phase 1A（#214）：/business-partners/[id] 14 tab（概览/工商/开票/联系人/地址/信用/标签 + 商机/项目/报价/销售订单/应收回款按 customerId 聚合） |
| 4 | 产品/原料 Workspace 完全复用 Item SSOT | ✅ | Phase 1B（#215）：items 详情「产品/原料合同视图」（配方/供应商/库存/成本/生产外协/配方使用）+ GET 只读聚合；零 Product/RawMaterial 表 |
| 5 | Legacy Customer 有完整 Retirement Decision，无未经分析删除 | ✅ | Phase 1C（#216）：ADR-0051 = DEPRECATE（保留兼容窗口，禁止 DROP，删除另开 Migration Gate）+ Dependency Matrix |
| 6 | GitHub CI 全绿 + QA/Test Cases/CHANGELOG/ROADMAP 同步 | ✅（CI）/ ⚠️（Test Case 本 PR 补齐） | 每 PR CI 全绿（Quality/Secret/Build）；QA Phase1A/Phase1B；CHANGELOG；ROADMAP v1.43；**Test Case：BusinessPartner_API.md 新建 + Item_API.md 契约 + Customer_API.md LEGACY 标记（Phase 1.5 Evidence Closure PR 补齐，原 Final Gate 结论在此项证据不足）** |

---

## Phase 1 交付清单

| 工作包 | PR | 内容 | 状态 |
|---|---|---|---|
| P0-1 | #212 | Customer ID 错配根治（共享选择器 + 回归测试） | ✅ merged |
| P0-2 | #213 | 合同证据归档索引 docs/contracts/ | ✅ merged |
| Phase 1A | #214 | BusinessPartner Customer 360 Workspace（14 tab） | ✅ merged |
| Phase 1B | #215 | 产品/原料合同视图（Item SSOT 聚合） | ✅ merged |
| Phase 1C | #216 | Customer Retirement Decision（ADR-0051 DEPRECATE） | ✅ merged |

## Phase 1 红线遵守（冻结边界）

- ✅ Sales / Purchase / Inventory / GL / BOM / Project / Pricing 事实链零改动（Phase 1 全部为只读聚合 + 前端选择器迁移 + 治理文档）
- ✅ 零 Schema / 零 Migration（Migration baseline 保持 0047）
- ✅ 零平行模型（未建 Customer/Product/RawMaterial/CRMProduct 第二主数据表）
- ✅ Customer 表未 DROP（DEPRECATE 决策，删除另开 Migration Gate）

## 遗留 / 已知边界

- P0-2 合同原文文件待 CTO 提供后归档（docs/contracts/ 索引已建）
- 联系人/地址/信用/标签的写操作（CRUD API）未建——Phase 1 只读可见，管理留后续 Phase
- 附件未接入往来单位（FileAttachment 无 BusinessPartner 关联）
- /api/customers 遗留路由保留（DEPRECATE 兼容窗口，观察后 Drop-Later）

## CTO Final Review 阻断项与纠正（Phase 1.5 Evidence Closure）

> CTO Final Review（2026-08-24）结论：代码主体 PASS，3 个 blocker → Phase 2 HOLD。本段为纠正记录。

### Blocker 1 — Runtime QA（待人工）
- 仓库 CI-First / No Local Server：AI 代理无浏览器、禁止启动本地服务器，**无法执行运行时页面验证**。
- 已在 QA 文档（Phase1A / Phase1B）建立「Runtime Acceptance 执行记录」清单（环境/build SHA/执行人/日期/结果字段），**待人工逐项执行并回填，未机械勾选**。
- 状态：**PENDING（需人工 Runtime Acceptance）**

### Blocker 2 — Test Case Closure（本 PR 完成）
- 新建 docs/test-cases/BusinessPartner_API.md（锁定 Phase 1A detail aggregate contract）
- 更新 docs/test-cases/Item_API.md（锁定 Phase 1B 聚合字段契约）
- docs/test-cases/Customer_API.md 顶部加 LEGACY/DEPRECATED — ADR-0051 标记

### Blocker 3 — Contract Evidence（结构 FINAL / 原文 PENDING）
- docs/contracts/README.md 已建立不可变归档清单（来源/版本/日期/SHA-256 校验值/页码字段）；合同原文 PDF 工作目录不存在，**待 CTO/业务方提供后归档并锁定校验值**。

### Governance Finding（CLOSED-BY-CORRECTIVE-ACTION）
- PR #217（Phase 1 Final Gate Review）在 CTO Final Review 之前被 merge——**第二次 Gate 顺序倒置**。
- 纠正：从本 PR 起，任何名称含 Final Gate / Gate Review / Release Gate 的 PR，CTO 明确 APPROVED 前禁止 merge。
- 状态：**CLOSED-BY-CORRECTIVE-ACTION**（不回退 #217，内容为治理文档且 CI 通过）

## Gate 结论（更新）

**Phase 1 Implementation ✅ ACCEPTED；Evidence/Runtime/Governance Gate 🟡 REQUEST CHANGES → 本 PR 补齐 Test Case + Contract Evidence 结构 + Governance Finding；Runtime QA 待人工执行。Phase 2 仍 HOLD，待 CTO 复核 3 blocker 后下发 START。**
