# UI 交互与页面美化补齐批次 QA（feat/ui-polish-batch）

- **日期：** 2026-08-21
- **分支：** feat/ui-polish-batch（基于 origin/main，PR 合并）
- **范围：** 按「交互和页面美化分析与建议」的 P0 + 安全 P1 清单落地（多线并行工作流）：
  1. 列表筛选 URL 同步（replaceState，刷新/分享不丢）+ 已应用筛选 chips + 每页条数选择 + 列显示/隐藏（localStorage）
  2. 主数据引用下拉迁移可搜索 Combobox（客户/供应商/物料/仓库/科目/付款条款）
  3. 中文字体栈 + 弱化文本对比度修正（#94a3b8 → #64748b，WCAG AA）
  4. 登录页左右分栏品牌化 + 密码可见切换
  5. 详情页单据编号复制按钮（CopyButton）
  6. 仪表盘零依赖 Donut 图表（商机阶段分布 / 订单状态分布）
  7. 命令面板「最近访问」（localStorage，最多 8 条）
  8. StateActionBar sticky 能力 + 禁用原因 aria-describedby（读屏可达）
- **验证策略：** CI-First——Quality Gates（lint/type-check/unit）+ Build + Secret Scanning 全绿合入；运行时交互人工登录验证
- **零 Schema / 零 Migration / 零 API 变更**（普通前端补齐，FRT-01 执行循环）

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| P0-1a | useListQuery 新增 syncUrl（opt-in，默认关闭，存量 46 页零行为变化） | ✅ |
| P0-1b | readUrlFilterParams 从 URL 恢复筛选（hydration 后一次性应用，ref 防重，避免 SSR mismatch） | ✅ |
| P0-1c | 列表页 URL 同步 opt-in：sales/orders、supplier-invoices、business-partners、sales/quotations、sales/invoices、purchasing/orders、purchasing/requisitions、gl-journal-entries、items、expenses（10 页） | ✅ |
| P0-1d | EntityListWorkspace activeFilters chips（逐条件 × 清除，中文 label） | ✅ |
| P0-1e | Pagination onPageSizeChange（20/50/100，切换回第 1 页） | ✅ |
| P0-1f | EntityListWorkspace columnsToggleKey 列设置（localStorage 记忆） | ✅ |
| P0-2a | Combobox 迁移 15 处（supplier-invoices/new、gl-journal-entries/new、purchasing/orders/new+edit、quotations/new+edit、transfers/new 的客户/供应商/物料/仓库/库位/科目/付款条件/税率档案）；枚举/状态保留原生 select | ✅ |
| P0-3a | globals.css 中文字体栈（苹方/微软雅黑/Noto Sans SC 回退链） | ✅ |
| P0-3b | tokens.ts inkMuted #94a3b8 → #64748b（弱化文本对比度 2.7:1 → 4.8:1） | ✅ |
| P0-4a | 登录页左右分栏品牌区（4 能力亮点，Icon 无 emoji）+ 密码可见切换（aria-pressed/aria-label） | ✅ |
| P0-5a | CopyButton（navigator.clipboard + Toast 反馈 + 图标回弹）；6 个详情页接线 | ✅ |
| P0-6a | charts.tsx 零依赖 SVG Sparkline/Donut + 单元测试 | ✅ |
| P0-6b | 仪表盘「商机阶段分布」「订单状态分布」Donut（真实聚合数据；空数据不渲染） | ✅ |
| P0-7a | 命令面板最近访问（localStorage linier.recent，≤8 条，去重，可键盘选中） | ✅ |
| P0-8a | StateActionBar sticky prop（能力就绪）；disabled 原因 title + aria-describedby | ✅ |
| S1 | 零业务逻辑变更；零新依赖；零 Schema/API/文档契约变更 | ✅ |
| S2 | 单测：charts.test.tsx（Sparkline/Donut 渲染与占比）、copy-button.test.tsx（成功/失败 Toast） | ✅ |

## Known Risk / 后续项

1. 详情页 sticky 动作栏未接线：详情页动作区经 EntityDetailWorkspace 的 actions prop 渲染，且卡片容器 overflow-hidden 会裁剪 sticky；StateActionBar sticky 能力已就绪，待容器结构调整后启用（backlog）。
2. 列表页 URL 同步 opt-in 覆盖 10 个高流量列表页；其余 36 个列表页为能力就绪、增量接入（backlog）。
3. Sparkline 未接入仪表盘：无月度趋势数据源（无 API 就不显示）；待后端提供趋势端点后接入（Design Gate）。
4. 批量操作（多选/批量删除）未做：需后端批量 API（Design Gate）。
5. 动画/交互需人工登录验证（无 E2E，与 Sprint8 一致）。
