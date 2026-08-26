# 菜单功能链路审计（Menu Chain Audit）

- 版本：v1.0
- 日期：2026-08-24
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：✅ 已实施（FRT-01 导航层治理；零 Schema / Migration / API 变更）
- 范围：前端菜单功能链路（导航 SSOT → 路由 → 页面 → 后端契约），**不含后端 API / Schema / 领域模型**

## 1. 菜单链路架构（唯一事实源）

```
Module Registry（apps/web/src/lib/frontend/modules.ts，SSOT 只读）
   ├── Sidebar（AdminShell：域手风琴 + ready/preview 可点、hold 折叠「规划中」）
   ├── 顶栏模块搜索（/ 快捷键）
   ├── 命令面板（Ctrl+K）
   └── Dashboard（快捷操作 = ui.create 投影；业务入口 = ready 域分组）
```

- 全站**无重复 NAV 数组**（禁止 NAV_ITEMS 一维菜单数组的规则持续有效）。
- Registry 一致性由 `modules.test.ts` 强制：ready 模块 route 必须存在 page.tsx、ui.create 必须带权威 createRoute 页面、ui ⊆ contract。
- **链路完整性**：审计后 9 域 52 模块全 ready，route → 页面全部存在；hold 从 3 个降为 0。

## 2. 全量菜单链路清单（审计后）

| 模块 ID | 菜单名 | 路由 | 页面 | 后端契约 | 状态 |
| --- | --- | --- | --- | --- | --- |
| **仪表盘**（1） | | | | | |
| `dashboard` | 仪表盘 | `/dashboard` | ✅ | ✅ | ready |
| **客户与项目**（5） | | | | | |
| `project-opportunities` | 项目机会 | `/project-opportunities` | ✅ | ✅ | ready |
| `projects` | 项目管理 | `/projects` | ✅ | ✅ | ready |
| `customer-pools` | 客户公海 | `/customer-pools` | ✅ | ✅ | ready |
| `expenses` | 报销申请 | `/expenses` | ✅ | ✅ | ready |
| `visits` | 拜访计划 | `/visits` | ✅ | ✅ | ready |
| **销售管理**（4） | | | | | |
| `quotations` | 报价单 | `/sales/quotations` | ✅ | ✅ | ready |
| `sales-orders` | 销售订单 | `/sales/orders` | ✅ | ✅ | ready |
| `deliveries` | 送货单 | `/sales/deliveries` | ✅ | ✅ | ready |
| `sales-invoices` | 销售发票 | `/sales/invoices` | ✅ | ✅ | ready |
| **采购管理**（6） | | | | | |
| `purchase-requisitions` | 采购申请 | `/purchasing/requisitions` | ✅ | ✅ | ready |
| `purchase-orders` | 采购订单 | `/purchasing/orders` | ✅ | ✅ | ready |
| `purchase-receipts` | 到货收货 | `/purchasing/receipts` | ✅ | ✅ | ready |
| `inspections` | 质检记录 | `/purchasing/inspections` | ✅ | ✅ | ready |
| `warehouse-receipts` | 仓库收货 | `/purchasing/warehouse-receipts` | ✅ | ✅ | ready |
| `purchase-returns` | 采购退货 | `/purchasing/returns` | ✅ | ✅ | ready |
| **库存管理**（9） | | | | | |
| `inventory-transfers` | 库存调拨 | `/inventory/transfers` | ✅ | ✅ | ready |
| `stock-counts` | 库存盘点 | `/inventory/stock-counts` | ✅ | ✅ | ready |
| `inventory-adjustments` | 库存调整 | `/inventory/adjustments` | ✅ | ✅ | ready |
| `inventory-conversions` | 库存转换 | `/inventory/conversions` | ✅ | ✅ | ready |
| `stock-projection` | 库存余额投影 | `/inventory/stock-projection` | ✅ | ✅ | ready |
| `inventory-ledger` | 库存流水 | `/inventory/ledger` | ✅ | ✅ | ready |
| `inventory-costs` | 库存成本（移动平均） | `/inventory/costs` | ✅ | ✅ | ready |
| `boms` | 物料配方 | `/inventory/boms` | ✅ | ✅ | ready |
| `production-orders` | 生产/外协工单 | `/inventory/production-orders` | ✅ | ✅ | ready |
| **财务管理**（11） | | | | | |
| `gl` | 记账凭证（GL） | `/finance/gl-journal-entries` | ✅ | ✅ | ready |
| `accounts-receivable` | 应收账款 | `/sales/accounts-receivable` | ✅ | ✅ | ready |
| `receipt-allocation` | 收款核销 | `/sales/receipts` | ✅ | ✅ | ready |
| `credit-debit-notes` | 贷项/借项通知单 | `/sales/credit-debit-notes` | ✅ | ✅ | ready |
| `supplier-invoices` | 供应商发票 | `/supplier-invoices` | ✅ | ✅ | ready |
| `ap-open-items` | 应付未结项 | `/supplier-ap/open-items` | ✅ | ✅ | ready |
| `supplier-cn-dn` | 供应商贷项/借项 | `/supplier-ap/credit-debit-notes` | ✅ | ✅ | ready |
| `payment-allocation` | 付款核销 | `/supplier-ap/payments` | ✅ | ✅ | ready |
| `gl-balance` | 试算平衡 | `/finance/gl-trial-balance` | ✅ | ✅ | ready |
| `gl-period-close` | 期末结转 | `/finance/gl-period-close` | ✅ | ✅ | ready |
| `gl-profit-statement` | 利润表 | `/finance/gl-profit-statement` | ✅ | ✅ | ready |
| **基础资料**（9） | | | | | |
| `items` | 物料管理 | `/items` | ✅ | ✅ | ready |
| `business-partners` | 往来单位 | `/business-partners` | ✅ | ✅ | ready |
| `price-lists` | 价格表 | `/price-lists` | ✅ | ✅ | ready |
| `technical-standards` | 技术标准 | `/technical-standards` | ✅ | ✅ | ready |
| `unit-of-measures` | 计量单位 | `/unit-of-measures` | ✅ | ✅ | ready |
| `commercial-terms` | 商业条款 | `/commercial-terms` | ✅ | ✅ | ready |
| `document-sequences` | 单据序列 | `/document-sequences` | ✅ | ✅ | ready |
| `warehouses` | 仓库 | `/warehouses` | ✅ | ✅ | ready |
| `warehouse-locations` | 库位 | `/warehouse-locations` | ✅ | ✅ | ready |
| **系统管理**（5） | | | | | |
| `users` | 用户管理 | `/users` | ✅ | ✅ | ready |
| `departments` | 部门管理 | `/departments` | ✅ | ✅ | ready |
| `roles` | 角色权限 | `/roles` | ✅ | ✅ | ready |
| `audit-logs` | 操作日志 | `/audit-logs` | ✅ | ✅ | ready |
| `supplier-rating-rules` | 供应商评级规则 | `/settings/supplier-rating-rules` | ✅ | ✅ | ready |
| **分析与报表**（2） | | | | | |
| `operations-report` | 经营数据看板 | `/reports/operations` | ✅ | ✅ | ready |
| `performance-report` | 绩效数据 | `/reports/performance` | ✅ | ✅ | ready |

> 说明：`/sales/accounts-receivable`、`/sales/receipts`、`/sales/credit-debit-notes` 路由保留销售路径（URL 稳定，避免 IA 重构 redirect 风险），菜单归口财务管理域（用户指令 2026-08-21）。

## 3. 问题清单与处置（无用功能清理）

| # | 问题 | 位置 | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | hold 模块「报表中心」route `/reports` **无页面（404 死路由）**；BI（Sprint 8）尚未规划，纯占位噪音 | modules.ts（已删） | 无用 | ✅ 删除 registry 条目 |
| 2 | hold 模块「客户走访 / 项目风险」+ 引导页：侧栏 hold **不可点击**、全站**无任何链接**；能力已完整归属「项目管理 → 详情 → 走访/风险 Tab」（B2-1B） | modules.ts + 2 个 page.tsx（已删） | 无用（不可达重复） | ✅ 删除 2 个引导页 + registry 条目 |
| 3 | 孤儿页「供应商评级规则」：cc-06 真实功能页（客户等级→最低供应商评级门槛，订单推荐消费），但**无菜单入口、无任何链接**（REGISTRY DELTA REQUIRED 悬置） | /settings/supplier-rating-rules | 断链（功能可用但不可达） | ✅ 注册为 system 域 ready 模块补链（ui 只声明 list——行内新建/编辑不虚报 create/edit） |
| 4 | 后端 Menu Center API（`/api/menu-groups`、`/api/menus`，Sprint 3B Menu Center）：前端导航已全面切换 Module Registry，**前端零消费** | apps/web/src/app/api/menu-groups、/menus | 断链死功能 | ⬜ **记录不实施**：删除涉及 Prisma Schema / Seed / RBAC → 需 Design / Scope Gate 后单独处理 |
| 5 | module-icons 中 project-visits / project-risks / reports 模块图标成为孤儿（随 #1/#2 删除） | module-icons.tsx（已删） | 无用 | ✅ 删除；新增 supplier-rating-rules 图标 |

## 4. 本次变更文件

- `apps/web/src/lib/frontend/modules.ts`：删除 3 个 hold 死条目；注册 `supplier-rating-rules`（system 域，route `/settings/supplier-rating-rules`，permission `customer-supplier-rating-rule:view`，contract CRUD / ui list）
- `apps/web/src/components/layout/module-icons.tsx`：删除孤儿模块图标 ×3；新增 supplier-rating-rules 图标
- `apps/web/src/app/(dashboard)/project-visits/page.tsx`、`project-risks/page.tsx`：删除（含空目录）
- 本审计文档

## 5. 边界与遗留建议

- **边界**：未触碰任何后端 API / Prisma Schema / Migration / Seed / RBAC 注册表；未改动 ready 模块的 route / 能力 / 权限码；未改历史文档（Page_Route_Map.md、pending-pages-completion-gate.md、ADR-0029 等为当时交付的历史记录）。
- **遗留 1（需 Gate）**：Menu Center API 死功能清理（见问题 #4）。
- **遗留 2（需 Gate）**：报表中心（BI）入口在 Sprint 8 规划时新建（届时走 Design Gate，禁止复活无页面占位）。
- **治理建议**：Registry 新增/删除模块条目必须随 capability activation PR 同步；孤儿页不允许无菜单入口合入 main（建议扩展 modules.test.ts：`(dashboard)` 下所有 page.tsx 必须被某 ready 模块 route 覆盖或显式豁免）。