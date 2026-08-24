# Contract Feature Coverage Audit — 合同基线与架构审计（Phase 0）

> 日期：2026-08-24 ｜ CTO Directive：Contract Alignment Program（Phase 0）
> 执行基线：main HEAD `9d23daf`（PR #205–#210 后；CTO 指令基线 `a6ed725` 之前已含 `#207/#208` 商品来源/BOM/生产外协）
> 最新 Migration baseline：**0047**（`prisma/migrations/0047_item_sourcing_bom_production_order`）
> 性质：**纯审计 / 治理文档——未新增任何 Schema/API/Migration**（Gate 0：禁止 Customer Pool / CRM Activity / Check-In Schema）

---

## 0. 审计方法

- 合同原文未入库（仓库无 contract 文档；`PROJECT_MASTER.md` 无合同条款）→ 本审计基于 **CTO Directive 转述的合同范围**，并标注该 Gap（Phase 1 前应把合同原文归档 `docs/contracts/`）
- 事实来源：`prisma/schema.prisma`（178 模型）/ `apps/web/src/app/api/**`（316+ 路由）/ `apps/web/src/app/(dashboard)/**`（130+ 页面）/ `packages/shared/src/constants`（RBAC）/ `docs/EVENTS.md` / `docs/test-cases/**`
- 状态口径：FINAL / PARTIAL / MISSING / DEVIATED / LEGACY/DUPLICATE

---

## 1. 核心事实审计结论（CTO 指令 8 项重点）

| # | CTO 审计重点 | 结论 | 证据 |
|---|---|---|---|
| 1 | **Customer vs BusinessPartner 双真相** | **LEGACY/DUPLICATE**：业务单据全指向 BusinessPartner；Customer 零业务引用 | 见 §2 |
| 2 | **/api/customers 实际调用** | 仅 3 处前端消费（商机新建/编辑选择器、项目新建），且**存在 ID 错配 BUG** | 见 §2.3 |
| 3 | **ProjectVisit 能否作为 CRM 跟进事实** | **PARTIAL**：走访记录（挂 Project），可作 Activity 基座，缺计划/签到/客户直连/评论 | 见 §3 |
| 4 | **ProjectExpense 能否作为报销** | **PARTIAL**：项目费用登记（8 字段），缺报销全链（申请人/部门/类型字典/附件/提交流/审批/过账引用） | 见 §4 |
| 5 | **Dashboard KPI 是经营 BI 还是模块摘要** | **模块入口 + 配置模型**：/dashboard 四区模型（快捷操作/业务入口）；DashboardKpi/Chart 为 SQL 配置表；20 模块 KPI Strip = 模块状态摘要 → **经营/绩效 BI MISSING** | 见 §5 |
| 6 | **BOM 能力与「订单自动算料转消耗吨数」差距** | **基础 FINAL，投影 MISSING**：ItemBom（系数+损耗+吨→米/件/个换算链）已落地；SalesOrderMaterialRequirementProjection 未实现（需求预测，不做 Reservation/MRP） | 见 §6 |
| 7 | **客户匹配多个供应商正式关系** | **FINAL**：SupplierItem（Item↔Supplier M:N）+ PartnerPrice + BusinessPartnerRole 已存在 | 见 §7 |
| 8 | **公海/查重/拜访计划/定位签到隐藏实现** | **全部 MISSING**：全仓库检索 公海/查重/duplicate-check/check-in/签到/latitude/longitude/geolocation/customer-pool 无业务实现（checkin 命中为误报，ownership 仅 Outbox lease 语境） | 见 §8 |

---

## 2. Customer → BusinessPartner 遗留审计

### 2.1 事实源

- `BusinessPartner`（schema L672）= 客户/供应商主体 SSOT：business-partners API CRUD FINAL + 前端 master-data 域页面 ready
- `Customer`（schema L2643）含 partnerId（可选关联 BusinessPartner）+ CustomerContact/CustomerAddress/CustomerTag/CustomerCredit 子模型
- **业务单据 customer 关系全部 → BusinessPartner**：ProjectOpportunity(L1247) / Project(L1288) / Quotation(L3403) / SalesOrder(L3631) / Delivery(L3847) / Invoice(L3978) / AccountsReceivable(L4170) / Receipt(L4305) / CreditDebitNote(L4519) / InvoiceAdjustment(L4609)
- `Customer` 仅被自身子模型引用（L2682/2709/2762/2806）——**零业务引用**

### 2.2 遗留 API 面

`/api/customers` 全套 CRUD 存活：`route.ts` + `[id]/route.ts` + `[id]/addresses` + `[id]/contacts` + `[id]/credit` + `[id]/tags`（各含 [itemId] 子路由）

### 2.3 遗留前端消费（3 处）

| 文件 | 用途 | 风险 |
|---|---|---|
| `(dashboard)/project-opportunities/new/page.tsx` | 客户选择器用 /api/customers，提交 `customerId` | **ID 错配** |
| `(dashboard)/project-opportunities/page.tsx` | 客户筛选/展示用 /api/customers | 列表展示错源 |
| `(dashboard)/projects/new/page.tsx` | 客户选择器用 /api/customers，提交 `customerId` | **ID 错配** |

**ID 错配 BUG（DEVIATED，P0 修复）**：前端提交 `customerId = Customer.id`，但 `POST /api/project-opportunities`（L83）/ `POST /api/projects` 校验查询 `prisma.businessPartner.findFirst({ where: { id: customerId } })` → Customer.id 不在 BusinessPartner → **必然 404「关联客户不存在」**；即商机/项目新建的客户选择当前不可用（除非 Customer 表无数据→下拉空）。**结论：/api/customers 消费面必须迁移到 /api/business-partners?type=CUSTOMER（+ 兼容投影），Customer 模型 Phase 1 审查后 deprecate。**

---

## 3. ProjectVisit 语义审计（CRM 活动候选）

- 字段：projectId（**挂 Project，非 BusinessPartner 直连**）/ visitType / visitedAt / visitorId / contactName / summary / nextAction / reminderAt
- 覆盖合同「跟进」部分能力：沟通纪要、下次行动、提醒时间 ✅
- **缺口**：无拜访计划（planned window/完成状态）、无签到事实、无评论、无审批引用、无客户/商机直连（经 project 间接）、Activity 类型单一（电话/微信/面谈等无法表达）
- **决策点（Phase 3A 必须二选一）**：① 升级 ProjectVisit 为通用 CRM Activity（推荐——避免新建平行活动事实）；② 新建 CRM Activity + ProjectVisit 投影。**禁止双写。**

---

## 4. ProjectExpense 语义审计（报销候选）

- 字段：projectId / category（字符串）/ amount / currency / incurredAt / note / approvalStatus（DRAFT 枚举，无审批流）
- 可复用：金额、科目（字符串）、时间、approvalStatus 骨架 ✅
- **缺口（合同「报销」= Expense Claim / Reimbursement）**：申请人/部门/客户（BusinessPartner 直连）/费用类型字典/费用分类/会计科目引用/附件/Submit/Approval/Finance posting reference 全部缺失；且「申请 ≠ 审批 ≠ 会计过账 ≠ 付款」必须分事实，现状单字段无法表达
- **结论：PARTIAL——不可直接标记合同完成；Phase 5 需 Reimbursement Vertical Slice（复用 ProjectExpense 或新建，先审计后决策）**

---

## 5. Dashboard / 经营 BI 审计

- `/dashboard`（前端四区模型）：今日工作 / 快捷操作 / 业务入口 / 系统状态 —— **模块导航，非经营 BI**
- `DashboardKpi / DashboardChart / DashboardLayout / DashboardWidget`（schema L2444+）：SQL 配置表（code/query/enabled），**非实时聚合指标**
- 20 模块 KPI Strip（PR #206）：每模块状态摘要（count by status），**非合同经营/绩效指标**
- **合同经营数据（公司/区域/渠道/品牌销售、目标完成率、客户分层/成熟度、商机漏斗、跟进/拜访/员工活动）与绩效数据（新增有效客户/有效跟进/拜访完成率/商机/报价/订单/回款/超期事项）→ MISSING**
- CTO 决策：解除 BI「合同必需子集」HOLD（自助 BI builder / OLAP / DW / AI BI 继续 HOLD）；指标必须来自正式业务事实 + drill-down

---

## 6. BOM 与「订单自动算料转消耗吨数」

- **FINAL（P-1~P-4，PR #207/#208）**：Item.sourcingType + ItemBom/Line（qtyPerFinishedUnit + lossRate，吨→米/件/个换算链 = 配方系数）+ ProductionOrder（自产/OEM，POSTED 同事务领料→成品+成本）
- **Gap（Phase 4C-4）**：`SalesOrderMaterialRequirementProjection` 未实现——需求 = `Order Qty × BOM Qty × Loss × UOM Conversion`，输出 rawMaterialId/requiredQty/requiredUom/stockQty/shortageQty（**只做需求预测，不自动变 Reservation/MRP**——Reservation 仍 HOLD）

---

## 7. 客户-多供应商关系

- `SupplierItem`（L3256，Item↔Supplier M:N + purchasePrice/isPreferred）✅
- `PartnerPrice`（L894）✅ ｜ `BusinessPartnerRole`（L2864，客户/供应商/两者角色）✅
- **合同「客户匹配多个供应商」→ FINAL（复用，无需新表）**

---

## 8. 公海 / 查重 / 拜访计划 / 定位签到

- **公海（Customer Pool）**：MISSING——无 Pool/PoolRule/PoolEntry/Ownership/Claim/Reclaim；需 ADR 后新建（一个客户同一时刻仅一个有效归属事实；领取须 transaction + CAS/row lock + AuditLog + RBAC）
- **客户查重**：MISSING——`POST /api/business-partners/duplicate-check` 不存在；规则（USCC/标准化名称/电话/联系人手机）需新建；Blocking（USCC 重复）vs Potential（名称/电话相似）；**禁止自动合并**
- **拜访计划**：MISSING——日/周/月、客户、负责人、目的、planned window、完成状态、实际活动、签到事实
- **定位签到**：MISSING——latitude/longitude/accuracy/customer reference location/allowed radius/check-in-out/服务端距离校验/visitPlan+activity 引用；**安全红线**：精确定位不进 request log、不放 URL query、仅授权用户可读、AuditLog 只记行为不记完整坐标

---

## 9. 合同功能覆盖矩阵（20 项）

> 状态：FINAL / PARTIAL / MISSING / DEVIATED / LEGACY/DUPLICATE ｜ PR = 已落地 PR 或建议 PR

| # | 合同模块 | 功能 | Schema | API | UI | Permission | Audit/Event | Test | 状态 | Gap | 建议 PR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 基础信息 | 主数据（客户/产品/供应商/原料/单位） | BusinessPartner/Item/SupplierItem/UOM ✅ | FINAL CRUD | ready | FINAL | ✅ | ✅ | **FINAL** | — | — |
| 2 | 客户档案 | 客户统一详情聚合 | BusinessPartner + PartnerContact/Address/Tag/Credit ✅ | FINAL | master-data ready | FINAL | ✅ | ✅ | **PARTIAL** | 详情聚合页缺 CRM 侧（商机/跟进/拜访/文件入口） | Phase 1A |
| 3 | 联系人 | 联系人管理 | PartnerContact ✅ | FINAL | ✅ | FINAL | ✅ | ✅ | **PARTIAL** | 重要日期/生日提醒/纪念日/关系图谱缺失 | Phase 2A |
| 4 | 公海 | 客户公海池 | — | — | — | — | — | — | **MISSING** | 全新领域（Pool/Rule/Entry/Claim） | Phase 2C |
| 5 | 查重 | 客户查重 | — | — | — | — | — | — | **MISSING** | duplicate-check API + Blocking/Potential | Phase 2B |
| 6 | 商机 | 商机管理 | ProjectOpportunity ✅（customer→BP） | FINAL | project-opportunities | FINAL | ✅ | ✅ | **PARTIAL** | 客户选择 ID 错配 BUG；快速报价/最近联系/inactivity 缺 | P0 fix + Phase 4A |
| 7 | 跟进 | 客户跟进 | ProjectVisit（Partial） | FINAL | projects 子资源 | FINAL | ✅ | ✅ | **PARTIAL** | 通用 Activity/超期派生/评论/审批引用缺 | Phase 3A/3B |
| 8 | 拜访 | 拜访计划 | — | — | — | — | — | — | **MISSING** | 计划（日/周/月/window/完成态） | Phase 3C |
| 9 | 签到 | 定位签到 | — | — | — | — | — | — | **MISSING** | 定位/范围/服务端距离校验/安全红线 | Phase 3D |
| 10 | 报价 | 报价管理 | Quotation ✅ | FINAL | sales/quotations | FINAL | ✅ | ✅ | **PARTIAL** | 商机→报价入口、打印模板/PDF 缺 | Phase 4B |
| 11 | 订单 | 订单申请 | SalesOrder ✅ | FINAL | sales/orders | FINAL | ✅ | ✅ | **PARTIAL** | 一单多品批量导入、评级供应商匹配缺 | Phase 4C |
| 12 | 销售出库 | 出库/送货/发票 | Delivery/Invoice/AR ✅ | FINAL | sales 全链 | FINAL | ✅ | ✅ | **FINAL** | — | — |
| 13 | 订单算料 | 自动算料转消耗吨数 | ItemBom ✅（基础） | P-1~P-4 ✅ | boms/production-orders ✅ | FINAL | ✅ | ✅ | **PARTIAL** | SalesOrderMaterialRequirementProjection 缺 | Phase 4C-4 |
| 14 | 报销 | 报销申请 | ProjectExpense（Partial） | FINAL（项目费用） | projects 子资源 | FINAL | ✅ | ✅ | **PARTIAL** | 报销全链（申请人/部门/类型/附件/审批/过账）缺 | Phase 5 |
| 15 | 经营数据 | 销售/区域/渠道/品牌/目标/分层/漏斗 | 事件+单据事实 ✅（数据源） | 单据 API ✅ | KPI Strip（模块摘要） | ✅ | ✅ | ✅ | **MISSING** | 经营指标聚合 API + drill-down 缺 | Phase 6A |
| 16 | 绩效数据 | 新增客户/跟进/拜访/商机/回款/超期 | 单据事实 ✅ | 单据 API ✅ | — | ✅ | ✅ | ✅ | **MISSING** | 绩效规则引擎（Rule→Facts→Result→Evidence）缺 | Phase 6B |
| 17 | 客户投入产出 | 客户 ROI（订单/回款/归属费用） | SalesOrder/AR/ProjectExpense ✅ | 单据 API ✅ | — | ✅ | ✅ | ✅ | **PARTIAL** | 客户侧 ROI 聚合视图缺 | Phase 5/6 |
| 18 | 产品/原料视图 | Item→BOM→原料→Supplier→Price→Stock | Item/ItemBom/SupplierItem ✅ | FINAL | items/boms ✅ | FINAL | ✅ | ✅ | **PARTIAL** | 合同化聚合 Workspace 缺（可 1B 并行） | Phase 1B |
| 19 | 客户多供应商 | 匹配多个供应商 | SupplierItem M:N ✅ | FINAL | items 编辑 ✅ | FINAL | ✅ | ✅ | **FINAL** | — | — |
| 20 | 合同收口 | 合同原文归档/验收 | — | — | — | — | — | — | **MISSING** | 合同文档未入库（docs/contracts/） | Phase 0 补 |

---

## 10. Contract Gap ADR 摘要（完整见 docs/ADR/ADR-0050-contract-alignment-gate.md）

- ADR-0050（本 PR 新增）：合同对齐治理基线——SSOT 冻结清单 + Phase 0-7 Gate 顺序 + 冻结边界 + 禁止新建平行模型
- 冻结边界（本指令明确授权外禁止触碰）：Sales/Purchase/Inventory/GL/BOM/Project/Pricing 事实链；`BusinessPartner/Item/ProjectOpportunity/Project/Quotation/SalesOrder/InventoryMovement/StockProjection/AuditLog/File` SSOT 清单
- **禁止再造平行 Customer/Product/RawMaterial/Order/Inventory 数据体系**

---

## 11. 风险与立即行动（P0/P1/P2）

### P0（本 PR 后最先处理）
- **P0-1** 商机/项目新建客户选择 ID 错配 BUG（前端 /api/customers → 迁移 /api/business-partners?type=CUSTOMER）
- **P0-2** 合同原文归档 docs/contracts/（审计基线事实源）

### P1（Phase 1-2 范围）
- P1-1 BusinessPartner Customer Workspace 聚合（1A）
- P1-2 Customer 遗留模型审查→兼容→deprecate 决策（不得 DROP，先审查）
- P1-3 产品/原料合同化 Workspace（1B，可与 1A 并行）
- P1-4 联系人增强（2A）+ 客户查重（2B）+ 公海（2C，ADR 先行）

### P2（Phase 3-6 范围）
- P2-1 CRM Activity（3A 决策）/跟进（3B）/拜访计划（3C）/签到（3D）
- P2-2 商机快速报价/打印模板/订单批量导入/算料投影（4A-4C）
- P2-3 报销 Vertical Slice（5）+ 经营/绩效 BI 合同子集（6）

---

## 12. Phase 1 预计文件清单（审批后）

- P0-1：project-opportunities/new+list、projects/new 客户选择器迁移 + 兼容投影（零 Migration）
- 1A：customer-workspace 前端聚合页（复用现有 API + 只读聚合 Query）+ Customer 遗留引用清单移除
- 1B：产品/原料聚合 Workspace（复用 items/boms/supplier-items API）
- 1C：供应商信用/账期/资质 UI + QA（复用现有 API）
- 文档：ADR-0051+ / test-cases / QA / ROADMAP v1.43+
