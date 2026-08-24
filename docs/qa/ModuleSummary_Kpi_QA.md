# Module Summary KPI QA（模块页仪表盘）

> 日期：2026-08-24 ｜ 指令：用户「在所有的功能的页面都增加该页面的仪表盘」 ｜ 范围确认：仅业务单据模块 + KPI 数字卡片条
> 验证事实源：GitHub CI（Quality Gates / Build / Secret Scanning）——本地未运行 build/test/type-check

## 范围

- **实现**：20 个业务单据模块列表页顶部新增「该页面的仪表盘」——KPI 数字卡片条（全部 + 按状态计数 + 可选金额汇总；点击卡片联动列表状态筛选）
- **后端**：20 个只读 summary API（`GET /api/<module>/summary`）+ GL 列表 API 新增可选 `status` 过滤（手动凭证流状态筛选）
- **共享件**：`ModuleKpiStrip` 组件（workspace primitive）+ `lib/module-summary/types.ts` 契约类型
- **不在范围**：主数据/系统管理/只读报表页；图表类仪表盘；AR/AP 只读投影页

## 变更清单

| 类别 | 文件 |
|---|---|
| 共享组件 | apps/web/src/components/workspace/module-kpi-strip.tsx（+ workspace/index.ts 导出） |
| 契约类型 | apps/web/src/lib/module-summary/types.ts |
| summary API ×20 | apps/web/src/app/api/{quotations,sales-orders,deliveries,invoices,purchase-requisitions,purchase-orders,purchase-receipts,inspections,warehouse-receipts,purchase-returns,inventory-transfers,stock-counts,inventory-adjustments,inventory-conversions,supplier-invoices,supplier-credit-debit-notes,supplier-payments,credit-debit-notes,receipts,gl/journal-entries}/summary/route.ts |
| GL 列表过滤 | apps/web/src/app/api/gl/journal-entries/route.ts（新增 status 可选过滤） |
| 页面接线 ×20 | 各业务单据列表页（useEffect 拉取 + ModuleKpiStrip + 卡片点击联动筛选） |
| 测试 | apps/web/src/app/api/purchase-orders/summary/route.test.ts（路由级：聚合/空库/权限） |
| 文档 | docs/test-cases/ModuleSummary_API.md；docs/frontend/contract-cards/module-summary-dashboard.md；CHANGELOG |

## 验证记录

### 静态复核（本地允许项）

- [x] diff 仅含本 Gate 范围（20 summary 路由 + 20 页接线 + 共享组件 + 文档）
- [x] 状态枚举与页面 STATUS_OPTIONS/STATUS_LABELS 对齐（质检用 result、供应商发票用 documentStatus）
- [x] 金额一律 Decimal 字符串返回（`.toString()`，禁止 toNumber）
- [x] 权限码与各模块列表 API 一致（`<module>:view`，RBAC Catalog CI 门）
- [x] import/export 一致；组件已加入 workspace 统一出口
- [x] 页面筛选联动：卡片点击 setStatusInput + filters + setPage(1)，保留其他筛选

### 运行时验收（需人工登录，无 E2E）

- [ ] 采购订单页顶部出现 KPI 条（全部/草稿/已提交/…/金额）
- [ ] 点击「已确认」卡片 → 列表按 CONFIRMED 过滤且卡片高亮
- [ ] 供应商发票页 KPI 按 documentStatus（草稿/已提交/已匹配/已批准/已过账/已取消）
- [ ] 质检记录页 KPI 按 result（待检/合格/部分合格/拒收）
- [ ] GL 凭证页 KPI 按状态（草稿/已提交/已批准/已过账/已驳回），点击联动 status 过滤
- [ ] summary API 不可用时（如断网）列表正常、KPI 条隐藏

> 运行时验收项为 Known Risk：本仓库 CI-First 模式无本地服务器验证，交付后由人工登录确认。

## 风险与边界

- 金额卡为「全部单据」口径（不随状态筛选变化）——MVP 展示用途，后续可做状态×金额联动
- summary 数据为挂载时一次性拉取；单据增删后需刷新页面（未做实时轮询）
- 质检 result 包含 PENDING（待检）；盘点/调整等行级数量未聚合（MVP 只做单据计数）
