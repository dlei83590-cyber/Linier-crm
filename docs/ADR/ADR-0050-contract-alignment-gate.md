# ADR-0050：合同对齐治理基线（Contract Alignment Gate）

- 状态：**Accepted（Governance，2026-08-24）**
- 日期：2026-08-24
- 维护者：CTO（AI Agent 代理执行）｜审核：CTO
- 关联：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（Phase 0 审计）；CTO Directive Contract Alignment Program（2026-08-24）；ROADMAP v1.43 Contract Alignment Track

---

## 背景

合同验收范围（基础信息/客户档案/联系人/公海/查重/商机/跟进/拜访/签到/报价/订单/销售出库/报销/经营数据/绩效数据）与仓库既有 ERP/CRM 能力需要对齐；Phase 0 审计确认：业务事实链已成熟，但存在 Customer 遗留双真相与 CRM 合同缺口（公海/查重/拜访计划/签到/经营绩效 BI 等 MISSING）。

## 决策

1. **开发主线切换**：合同功能收口优先——「合同功能 → 已有能力复用 → 缺口补齐 → 重复模型收敛 → 前后端闭环 → 自动化验证 → 合同验收」；不是推倒重来，不机械重开发。
2. **SSOT 冻结清单**（禁止再造平行体系）：`BusinessPartner`（客户/供应商）、`Item`（产品/原料）、`ProjectOpportunity`（商机）、`Project`、`Quotation`（报价）、`SalesOrder`（订单）、`InventoryMovement/StockProjection`（库存事实）、Finance/GL（财务事实）、`AuditLog`（审计）、File Center（附件）。
3. **冻结保护**：Sales / Purchase / Inventory / GL / BOM / Project / Pricing 成熟事实链，未经本指令明确授权不重构成熟会计、库存和采购核心。
4. **Customer 遗留治理**：业务单据已全部指向 BusinessPartner；/api/customers 仅剩 3 处前端消费且存在 ID 错配 BUG（P0-1）；Customer 模型 Phase 1 审查→兼容→deprecate 决策，**本阶段禁止 DROP**；新增 CRM 功能禁止继续写旧 Customer SSOT。
5. **Phase 顺序**：Phase 0（审计）→ 1（主数据/客户主体收口）→ 2（客户管理：联系人/查重/公海）→ 3（CRM 活动/跟进/拜访/签到）→ 4（商机/报价/订单收口）→ 5（报销）→ 6（经营/绩效 BI 合同子集）→ 7（Final Audit / Release Gate）。
6. **Gate 纪律**：每 Phase 独立 PR + CI + Runtime QA；Gate 0 禁止直接上 Customer Pool / CRM Activity / Check-In Migration；Phase 0 审计 PR（本 PR）CI PASS + CTO Review APPROVED 后才发 Phase 1 START。
7. **BI 决策**：解除「合同必需子集」HOLD（经营/绩效指标来自正式业务事实 + drill-down）；自助 BI builder / OLAP / DW / AI BI / 非合同报表继续 HOLD；BI 不得提前（等 Phase 2-5 事实源稳定）。
8. **红线**：Reservation/MRP 不借合同整改偷渡；订单算料只做需求预测（SalesOrderMaterialRequirementProjection），不自动 Reservation；绩效禁止管理员手工填最终分（Rule → Source Facts → Computed Result → Drill-down Evidence）。

## 影响

- 新增/更新：docs/reviews/Contract_Feature_Coverage_Audit_2026-08-24.md（20 项矩阵）；ROADMAP v1.43 Contract Alignment Track；docs/contracts/（合同原文归档，P0-2）
- P0 修复：商机/项目新建客户选择 ID 错配（/api/customers → /api/business-partners?type=CUSTOMER）
- 后续每 Phase 的 Schema/API/UI 变更需独立 ADR + Design Gate

## 兼容性

- 零 Schema/Migration 变更（本 PR）；Customer 模型保留（deprecate 决策在 Phase 1）
- 现有 FINAL 事实链零回归（冻结保护）
