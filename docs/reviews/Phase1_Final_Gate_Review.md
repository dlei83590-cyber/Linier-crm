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
| 6 | GitHub CI 全绿 + QA/Test Cases/CHANGELOG/ROADMAP 同步 | ✅ | 每 PR CI 全绿（Quality/Secret/Build）；QA Phase1A/Phase1B；CHANGELOG；ROADMAP v1.43 Contract Track |

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

## Gate 结论

**Phase 1 完成，6 项事实全部满足。提交 CTO Final Gate Review，等待 APPROVED 后发 Phase 2 START（联系人增强 + 客户查重 + 客户公海）。**
