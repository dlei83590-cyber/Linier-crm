# UI 统一与美化 — QA 验收记录（批次 1-8，2026-08-20）

- 日期：2026-08-20
- 关联：F2-1 Design System（components/design-system + tailwind.config.ts）、lib/ui-classes.ts、components/ui/form-field.tsx
- 状态：**CI 验证通过（GitHub Actions 全绿，Quality Gates / Build / Secret Scanning）**；Runtime Acceptance = 待生产部署后执行（CI-First，本地不跑 runtime）

## 1. 范围（8 批次）

| 批次 | 内容 | 提交 |
|---|---|---|
| 1 | Admin Shell（品牌渐变 Logo/用户区头像/侧边栏语义色/elevation）、Login（渐变背景+卡片 elevation-lg+聚焦 ring）、Dashboard（四卡片 rounded-xl+分层阴影） | ee7ca1b |
| 2 | 共享组件语义化：EntityListWorkspace/EntityFormWorkspace/Pagination/ListStates（border/ink/status 语义） | 2244665 |
| 3 | FormField 组件 + lib/ui-classes（INPUT_CLASS/BUTTON_*/CARD_CLASS）；31 页 inputClass 共享引用 | 4bb7987 |
| 4 | Field 函数迁移：30 页页面级重复 Field → 共享 FormField（-1046 行） | c8fe32f |
| 5 | 按钮统一：主按钮 120 处 → BUTTON_PRIMARY_CLASS、次按钮 43 处 → BUTTON_SECONDARY_CLASS | 89291c0 |
| 6 | 表格/列表控件：SELECT_CLASS 新增；41 列表页 91 处筛选控件迁移 | cd0ddbb |
| 7 | CARD_CLASS 应用：20 表单/详情页 27 处容器迁移 | 1acc5ec |
| 8 | 残留变体清理：全仓 53 文件约 1380 token（slate→ink、red/amber→status、border/bg 语义化） | 62c25d1 |

## 2. 静态验收（本地已核）

- [x] 共享类单一来源：INPUT_CLASS/SELECT_CLASS/BUTTON_PRIMARY/SECONDARY/CARD_CLASS 集中于 lib/ui-classes.ts；FormField 组件统一字段容器
- [x] 去重成效：Field 函数（30 页）与 inputClass 常量（31 页）全部消除；按钮/筛选/卡片统一引用
- [x] 语义色覆盖：text-slate-* → ink、text-red/amber → status、border-slate-200 → border-border、bg-slate-50 → bg-canvas、bg-red/amber-50 → status-bg（约 1380 token）
- [x] 保留项：健康状态指示点（emerald/red/amber）、hover:bg-slate-100（中性 hover）、bg-slate-900/30（遮罩）——非残留
- [x] 零逻辑变更：全部为 className/import/组件引用替换，无业务逻辑改动；零 API/Migration
- [x] 共享类使用统计：FormField 514 / BUTTON_PRIMARY 187 / SELECT_CLASS 140 / BUTTON_SECONDARY 86 / INPUT_CLASS 62 / CARD_CLASS 46

## 3. 需在生产 Runtime 验收（部署后执行）

- [ ] 登录页/Admin Shell/Dashboard 观感（渐变品牌、卡片分层阴影、用户区头像）
- [ ] 各列表页筛选控件、表单字段、按钮、卡片容器观感一致（共享类生效）
- [ ] 加载/空态/错误态卡片语义色正确；健康状态指示点正常

## 4. 已知限制 / 边界

- 尺寸特化变体保留（px-2/px-4 按钮、w-40 等宽度筛选——维持布局层次）
- 少量 hover 态/遮罩仍用中性色（设计语义如此）；reports（BI）仍 HOLD
- 全仓语义色 99% 统一（62 个剩余 token 均为合理 hover/遮罩）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）
