# Sprint 8 — UI 现代化（现代式界面设计与交互）Design Gate

> 日期：2026-08-20 ｜ 状态：DESIGN APPROVED（CTO 指令：现代式界面设计，和交互）
> 决策输入：CTO 选择「高饱和彩色仪表盘风」视觉方向 + 「全局反馈系统」+「导航与壳层交互」两个交互重点。

---

## 1. 背景与目标

现有 UI 已具备完整底座（F2-1 Design Tokens / Workspace primitives / CARD_CLASS 卡片化 / Admin Shell），但观感偏朴素：
- 所有模块共享单一品牌蓝，缺少业务域视觉分区（10 个一级域无法一眼区分）；
- 侧栏折叠/展开无动画、当前项指示弱、无顶栏搜索；
- 加载态为「加载中…」文本、空态为纯文本、操作无全局反馈（Toast）；
- 移动端抽屉无过渡动画。

目标：在不触碰业务逻辑与数据契约的前提下，将界面升级为高饱和彩色仪表盘风，并补齐全局反馈系统与壳层交互。

## 2. 边界（MUST NOT）

- 零业务逻辑变更：不改 API、Schema、状态机、权限、路由结构。
- 不引入第三方 UI 库（保持零依赖，Tailwind 手工实现）。
- 不动后端 / 不动测试断言（除快照类视觉断言外）。
- 不实现用户未选择的项（表格列排序/批量选择/命令面板 Ctrl+K/深色模式——本轮不做）。

## 3. 视觉方向：高饱和彩色仪表盘风

### 3.1 域色板（Module Accent，10 域高饱和主色）

| 域 id | 域 label | 主色 | 浅底 | 说明 |
| --- | --- | --- | --- | --- |
| workbench | 工作台 | brand blue #2563eb | #eff6ff | 沿用品牌蓝 |
| customer-project | 客户与项目 | violet #7c3aed | #f5f3ff | 客户关系 |
| sales | 销售管理 | emerald #059669 | #ecfdf5 | 销售增长 |
| purchasing | 采购管理 | orange #ea580c | #fff7ed | 采购执行 |
| inventory | 库存管理 | cyan #0891b2 | #ecfeff | 库存流转 |
| supplier-ap | 采购财务 | amber #d97706 | #fffbeb | 应付资金 |
| finance | 财务总账 | rose #e11d48 | #fff1f2 | 财务核心 |
| master-data | 基础资料 | sky #0284c7 | #f0f9ff | 基础数据 |
| system | 系统管理 | slate #475569 | #f8fafc | 系统运维 |
| reports | 分析与报表 | fuchsia #c026d3 | #fdf4ff | 分析洞察 |

### 3.2 应用规则

- 域色只用于壳层导航（域点/当前项指示条/激活底色）与顶栏当前域徽标——业务内容区仍走语义色（status-*），禁止把域色铺进表格/表单。
- 每个域色在 tailwind.config 注册 50/500/600/700 四个梯度（tailwind 类 bg-<id>-50 等）。
- tokens.ts 新增 MODULE_ACCENTS（id -> 主色/浅底/深色）单一事实来源。

## 4. 交互批次规划

### U1 — 壳层与导航交互（单 PR）

| # | 交互 | 实现 |
| --- | --- | --- |
| U1.1 | 侧栏折叠（桌面） | 宽 56px 图标轨道 <-> 224px 全宽；localStorage 记忆；折叠态隐藏文字/域分组仅留色点，hover 显示 tooltip |
| U1.2 | 当前项指示 | 激活项左侧 3px 域色指示条（rounded）+ 域色浅底 + 平滑 transition-colors |
| U1.3 | 域分组视觉 | 域标题前色点 + 折叠 chevron rotate-90 过渡；当前域自动展开 |
| U1.4 | 移动端抽屉 | 滑入动画（translate-x + opacity）+ backdrop blur + 关闭按钮 |
| U1.5 | 顶栏模块搜索 | 顶栏搜索框：按 label/domain 过滤可见模块，Enter/点击直达（命令面板 Lite）；当前模块徽标显示 |

### U2 — 全局反馈系统（单 PR）

| # | 能力 | 实现 |
| --- | --- | --- |
| U2.1 | Toast 系统 | ToastProvider（RootLayout 挂载）+ useToast()；success/error/info/warning 四态；右上堆叠、自动消失（4s）、点击关闭、aria-live、进出场动画；零依赖 |
| U2.2 | 骨架屏 | Skeleton（shimmer 动画，globals.css keyframes）+ SkeletonRow；替换列表 LoadingRow / 表单与详情「加载中…」/ AdminShell 认证加载 |
| U2.3 | 空态升级 | EmptyState（图标+标题+描述+可选操作）；EmptyRow 复用 |
| U2.4 | 按钮内联 loading | 提交/动作按钮 loading 时显示 spinner+文案（EntityFormWorkspace / StateActionBar / 列表工具栏） |
| U2.5 | Toast 接线 | 财务关键流程：销售发票开票对话框、供应商发票提交/过账、GL 手工凭证保存/过账/审核、往来单位编辑保存、系统退出登录；成功/失败均有反馈 |

## 5. 文件清单（预估）

- apps/web/tailwind.config.ts（域色板）
- apps/web/src/components/design-system/tokens.ts / index.ts（MODULE_ACCENTS + MOTION）
- apps/web/src/components/layout/admin-shell.tsx（U1 全部）
- apps/web/src/components/ui/toast.tsx（新）、skeleton.tsx（新）、empty-state.tsx（新）
- apps/web/src/app/globals.css（shimmer/toast 动画 keyframes）
- apps/web/src/app/layout.tsx（挂 ToastProvider）
- apps/web/src/components/ui/list-states.tsx、workspace/entity-form-workspace.tsx、workspace/state-action-bar.tsx 等（U2 接线）
- F1-F4 相关页面（Toast 接线）

## 6. 验收标准

- GitHub CI 全绿（Quality Gates + Build + Secret Scanning）。
- 零业务逻辑变更；无新增依赖。
- 侧栏折叠/展开、域展开、抽屉动画、搜索跳转、Toast 出现/消失、骨架屏渲染均为纯前端可静态审阅。
- Known Risk：运行时交互（折叠动画/Toast 时序）需人工登录验证，无 E2E。

## 7. 不实施（本轮明确排除）

- 深色模式、玻璃拟态、命令面板 Ctrl+K、表格列排序/批量选择/密度切换/粘性表头、页面级路由过渡动画、数字滚动。
- 全部作为 backlog 保留（后续批次按 CTO 指令开启）。