# Sprint8 UI 现代化 QA（PR #103-#105）

- **日期：** 2026-08-20
- **范围：** 高饱和彩色仪表盘风（10 域色板）+ 壳层交互（侧栏折叠/域色指示/抽屉动画/顶栏搜索）+ 全局反馈系统（Toast/骨架屏/空态/按钮 loading）+ 财务流程 Toast 接线 + U3 表格现代化与微动效（PR #108-#109）+ **U4-U7（PR #111-#114）：命令面板/密度切换/列排序/数字滚动**
- **验证策略：** CI-First——Quality Gates（lint/type-check/unit）+ Build + Secret Scanning 全绿合入；运行时交互人工登录验证

## 静态验收清单

| # | 检查项 | 结果 |
| --- | --- | --- |
| U1.1 | 侧栏折叠（224px ↔ 64px 色块轨道，localStorage 记忆） | ✅ |
| U1.2 | 当前项左侧域色指示条 + 域色浅底激活 + transition | ✅ |
| U1.3 | 域分组色点 + chevron rotate-90 过渡；当前域自动展开 | ✅ |
| U1.4 | 移动端抽屉滑入动画（drawer-in/fade-in）+ backdrop blur | ✅ |
| U1.5 | 顶栏模块搜索（/ 聚焦、Enter 直达、Esc 关闭、hold 仅展示）+ 当前模块域色徽标 | ✅ |
| U2.1 | Toast 系统（四态/堆叠/自动消失/aria-live/动画）RootLayout 挂载 | ✅ |
| U2.2 | 骨架屏 shimmer（列表 LoadingRow/表单/详情/AdminShell 认证加载） | ✅ |
| U2.3 | 空态 EmptyState（图标+标题+描述+可选操作），EmptyRow 复用 | ✅ |
| U2.4 | 提交/动作按钮内联 loading spinner（EntityFormWorkspace/StateActionBar） | ✅ |
| U2.5 | 财务流程 Toast 接线（销售开票/供应商发票/GL 凭证/往来单位，成功+失败） | ✅ |
| S1 | 零业务逻辑变更；零新依赖 | ✅ |
| S2 | 域色板 tokens.ts（MODULE_ACCENTS）与 tailwind domain-* 一致 | ✅ |

## U3 补充验收（PR #108-#109）

| # | 检查项 | 结果 |
| --- | --- | --- |
| U3.1a | 金额列右对齐 + tabular-nums（销售发票/供应商发票/GL 凭证） | ✅ |
| U3.1b | rowActions hover 浮现操作列（组件能力） | ✅ |
| U3.1c | 表头 sticky + font-semibold 强化；Pagination 样式统一 | ✅ |
| U3.2a | 页面切换淡入（main key=pathname） | ✅ |
| U3.2b | ConfirmActionDialog backdrop fade + 卡片进场 + 确认按钮 spinner | ✅ |
| U3.2c | StatusBadge 语义色圆点 + 进行中状态脉冲 | ✅ |

## U4-U7 补充验收（PR #111-#114）

| # | 检查项 | 结果 |
| --- | --- | --- |
| U4a | Ctrl+K / ⌘K 呼出命令面板；↑↓ 选择 + Enter 跳转；Esc/backdrop 关闭；hold 仅展示 | ✅ |
| U5a | 顶栏密度切换（紧凑/标准）；EntityListWorkspace/AppPage 联动；localStorage 记忆 | ✅ |
| U6a | 表头点击排序（升序→降序→清除）；▲/▼ 指示 + aria-sort；3 个财务列表启用 | ✅ |
| U7a | 页面切换 fade-up；利润表收入/成本/利润数字滚动 | ✅ |

## Known Risk

1. 折叠动画/搜索下拉/抽屉动效/Toast 时序/骨架屏渲染/表格悬浮/页面淡入/徽章脉冲/命令面板/密度切换/列排序/数字滚动需人工登录验证（无 E2E）。
2. 未实现项（Design Gate §7）：深色模式、命令面板 Ctrl+K、表格列排序/批量选择/密度切换、页面级路由过渡、数字滚动——backlog。