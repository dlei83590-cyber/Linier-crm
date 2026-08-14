# Design System — UI 设计系统（F2-1 UI System Foundation）

- 状态：F2-1 Wave 0 交付（2026-08-14）
- 单一事实来源：`apps/web/src/components/design-system/tokens.ts` + `apps/web/tailwind.config.ts`

> **规则（CTO Frontend Full UI Productization）**：业务页面禁止自行组合一套视觉规范。
> 取值只允许来自 Design System；存量页面暂不推倒重写（迁移期），但**新增代码一律消费本系统**。

---

## 1. 令牌清单

| 层             | 令牌        | TS 常量（tokens.ts）                     | Tailwind 语义类                                               |
| -------------- | ----------- | ---------------------------------------- | ------------------------------------------------------------- |
| Typography     | 字号 / 字重 | `TYPOGRAPHY`                             | `text-xs/sm/base/lg/xl/2xl`、`font-*`                         |
| Spacing        | 间距        | `SPACING`                                | 标准 scale（p-2/p-4/p-6…）                                    |
| Radius         | 圆角        | `RADIUS`                                 | `rounded-sm/md/lg/full`                                       |
| Border         | 边框        | `BORDER`                                 | `border-border`、`border-border-strong`                       |
| Elevation      | 阴影        | `ELEVATION`                              | `shadow-elevation-sm/md/lg`                                   |
| Semantic Color | 语义色      | `SEMANTIC_COLORS`                        | `bg-canvas`、`bg-surface`、`text-ink-primary/secondary/muted` |
| Status Color   | 状态色      | `STATUS_COLORS`（bg/text/border 三元组） | `bg-status-{tone}-bg` 等；组件内建议走 `STATUS_COLORS` 常量   |
| Form Density   | 表单密度    | `FORM_DENSITY`（compact/default）        | —（组件 prop `density`）                                      |
| Table Density  | 表格密度    | `TABLE_DENSITY`（compact/default）       | —（组件 prop `density`）                                      |
| Breakpoint     | 响应式断点  | `BREAKPOINTS`                            | `sm/md/lg/xl/2xl`                                             |

## 2. 语义色（Semantic Color）

| Token          | 值        | 用途               |
| -------------- | --------- | ------------------ |
| `canvas`       | `#f8fafc` | 页面背景           |
| `surface`      | `#ffffff` | 卡片 / 表单表面    |
| `border`       | `#e2e8f0` | 默认边框           |
| `borderStrong` | `#cbd5e1` | 强调边框           |
| `inkPrimary`   | `#0f172a` | 主文本             |
| `inkSecondary` | `#475569` | 次级文本           |
| `inkMuted`     | `#94a3b8` | 弱化 / 占位文本    |
| `brand`        | `#2563eb` | 主操作色（按钮等） |

## 3. 状态色（Status Color）

| Tone      | bg      | text    | border  | 语义                     |
| --------- | ------- | ------- | ------- | ------------------------ |
| `neutral` | #f1f5f9 | #475569 | #e2e8f0 | 草稿 / 中性              |
| `info`    | #eff6ff | #1d4ed8 | #bfdbfe | 待处理 / 流转中          |
| `success` | #f0fdf4 | #15803d | #bbf7d0 | 已批准 / 已完成 / 已过账 |
| `warning` | #fffbeb | #b45309 | #fde68a | 部分 / 需关注            |
| `danger`  | #fef2f2 | #b91c1c | #fecaca | 拒绝 / 取消 / 错误       |

> **红线**：状态色只做展示，禁止跨状态语义压缩（如 APPROVED→"完成"）。
> 展示文案可中文化，内部 key 必须保留真实 enum。

## 4. 密度（Density）

- `compact`：表单控件高 2rem，表格行 0.375rem 垂直内边距 —— 数据密集型页面
- `default`：表单控件高 2.5rem，表格行 0.625rem 垂直内边距 —— 标准页面

## 5. 表单控件

统一控件外观常量 `CONTROL_CLASS`（tokens.ts）：
边框 / 圆角 / 字号 / 聚焦态 / disabled 态统一，禁止页面内再写一套 input 样式。

## 6. 页面结构规范（必须遵守）

- 列表页：`Header → Toolbar(Filters) → Table → Pagination`
- 详情页：`Header Summary → Status → Actions → Sections/Tabs → Audit`
- 表单页：`Header → Sections → Lines → Validation → Save/Cancel`
- 实现载体：Workspace Primitives（见 `docs/frontend/Workspace_Primitives.md`）
