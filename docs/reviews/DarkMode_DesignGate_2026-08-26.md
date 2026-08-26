# Design Gate — 暖色深色模式（Dark Mode）与 Canvas 微暖化

- **日期：** 2026-08-26
- **提出方：** 前端补齐批次（2026 热门趋势对比 → P2 项）
- **类型：** Design / Scope Gate（涉及设计系统级「大规模重构」：语义色 CSS 变量化 + 双主题）
- **状态：** 待 Gate 批准后分阶段实施（Phase 1 → 2 → 3，每阶段独立 PR + CI）

---

## 1. 背景与目标

2025–2026 热门趋势对比（调研来源：DEV 社区 "Warm Dark Mode Is the New Dark Mode: 2026 SaaS Design Trends"、Envato 2026 UX/UI 趋势、We Design Marbella 色彩趋势 2026–2027）显示：

1. **暖色暗色模式（Warm Dark Mode）**成为 2026 SaaS 新热点——非纯黑（#000/#111），用暖灰/暖棕黑（#1a1a1f 系）保持柔和与舒适；
2. **「求真实」色彩回归**——大地色/暖中性色回潮，冷灰白 canvas 向暖灰白迁移。

本 Gate 覆盖两项：

- **P2a — Canvas 微暖化**：冷灰白 `#f6f7f9` → 暖灰白 `#f7f6f3`（已随本 PR 落地，低风险）。
- **P2b — 暖色深色模式**：本 Gate 的核心，需分阶段实施。

## 2. 现状与影响面（实测统计，apps/web/src 883 个 tsx/ts 文件）

| 类别 | 数量 | 深色模式影响 |
| --- | --- | --- |
| 语义色消费（bg-canvas/surface/ink-*/status-*/border） | **200 文件** | 变量化后自动跟随主题（无需改页面） |
| 硬编码 brand-*（bg-brand-50/600 等） | **133 文件 / 532 处** | brand 变量化后自动跟随 |
| 硬编码 slate/gray/zinc 类（bg-slate-100/text-slate-500 等） | **59 文件 / 236 处** | **不跟随主题**，需审计替换为语义类 |
| inline style 色值（status-badge/empty-state/charts 等） | 7 文件 | 需改为 var() 引用 |
| 域色 domain-*（10 域 × 4 档） | 8 文件 | 深色下 50 档浅底需深色调适配 |

**结论**：深色模式不是"加一个变量"而是**全站色彩系统治理**。语义类已高度收敛（200 文件），但 236 处硬编码 slate + 532 处硬编码 brand 需要替换或变量化。必须分期，禁止一轮全量。

## 3. 技术方案：CSS 变量 tokens 化 + data-theme 双主题

### 3.1 核心机制（低破坏）

- Tailwind 语义色从静态值改为 `var()` 引用（**类名不变** → 现有页面/测试零改动）：
  ```ts
  // tailwind.config.ts
  colors: {
    canvas: 'var(--color-canvas)',
    surface: 'var(--color-surface)',
    ink: { primary: 'var(--color-ink-primary)', ... },
    status: { success: { bg: 'var(--color-status-success-bg)', ... }, ... },
    brand: { 50: 'var(--color-brand-50)', ... },
    domain: { workbench: { 50: 'var(--color-domain-workbench-50)', ... }, ... },
  }
  ```
- 主题定义在 `globals.css`：
  ```css
  :root { --color-canvas: #f7f6f3; ... }            /* 亮色（暖白） */
  [data-theme="dark"] { --color-canvas: #1b1a18; ... } /* 暖暗色 */
  ```
- 主题切换：`document.documentElement.dataset.theme` + localStorage `linier.theme`（'light' | 'dark'）；顶栏切换按钮（亮/暗两态）；首屏默认亮色（不跟随系统，避免 SSR mismatch——与日期 hydration 同策略）。
- inline style 消费点（status-badge / empty-state / charts）：STATUS_COLORS 值改为 `var(--color-status-*-*)` 字符串，style 直接消费变量，自动跟随主题。

### 3.2 暖暗色板提案（非纯黑，暖灰系）

| Token | 亮色（现状/微调） | 暗色提案 |
| --- | --- | --- |
| canvas | #f7f6f3 | **#1b1a18**（暖炭黑） |
| surface | #ffffff | **#242220**（暖深灰，卡片） |
| border | #e2e8f0 | **#3a3733** |
| borderStrong | #cbd5e1 | **#4a4640** |
| ink.primary | #111827 | **#ece9e4**（暖白文本） |
| ink.secondary | #475569 | **#b8b2a9** |
| ink.muted | #64748b | **#857f76** |
| brand.600（主操作） | #2563eb | **#3b82f6**（暗底提亮） |
| status.*（bg/text/border） | 现三元组 | bg 深色调（如 success bg #0f2e22 / text #6ee7b7 / border #14532d） |
| domain.* 50 档 | 浅底 | 深色浅底（如 workbench 50 #1e2a44），500–700 保持 |

> 具体色值在 Phase 1 实现时按「同一色相、降明度提饱和」原则细化，并以 WCAG 对比度（正文 ≥4.5:1）为准。

## 4. 分期实施计划（每阶段独立 PR + CI 全绿 + 独立验收）

| 阶段 | 范围 | 预计文件 | Gate |
| --- | --- | --- | --- |
| **Phase 1** | 语义色 + brand 变量化（tailwind/globals/tokens）＋ 主题切换骨架（admin-shell 按钮 + localStorage）＋ inline style 消费点改 var() | ~8 文件 | 本 Gate 批准后 |
| **Phase 2** | 59 文件 / 236 处硬编码 slate/gray → 语义类审计替换（bg-slate-50→bg-canvas、text-slate-500→text-ink-muted 等，按语境判定） | ~59 文件 | Phase 1 验收后 |
| **Phase 3** | domain 色板暗色调、charts/print/骨架屏/空态边界、无障碍对比度回归 | ~10 文件 | Phase 2 验收后 |

## 5. 风险

1. **视觉质量无法本地验证**（CI-First / No Local Server）：暗色下叠色/对比度问题需部署后人工 Smoke 回归（列出冒烟清单：壳层/列表/详情/表单/凭证/仪表盘/打印）。
2. **Phase 2 的 236 处硬编码替换**存在语义误判风险（slate-50 在不同语境可能是 canvas 或 surface），需逐处静态判定，禁止机械替换。
3. 测试基于**类名**断言（如 bg-brand-600）——类名不变，断言不受影响（已确认 button/badge/charts/kpi 测试均为类名断言）；但若某测试断言 style 色值需同步。
4. 深色模式与打印 CSS（强制白底）互斥：打印保持强制亮色（现有 @media print 已处理 body 白底）。

## 6. 验收标准

- Phase 1：暗色切换生效（顶栏按钮 + localStorage 记忆 + 刷新保持）；语义色全量跟随（200 文件零改动自动适配）；无 hydration mismatch；CI 全绿。
- Phase 2：236 处硬编码 slate 清零（grep 验证）；无视觉回归（冒烟清单）。
- Phase 3：domain 50 档深色可见；图表/空态/骨架屏可读；对比度抽查 ≥4.5:1；CI 全绿。

## 7. Gate 决策点

- [ ] 批准 Phase 1（语义变量化 + 切换骨架）
- [ ] 批准暖暗色板提案（§3.2）或要求调整
- [ ] 批准分期节奏（Phase 1 → 2 → 3 独立 PR）
- [ ] 驳回 / 变更范围

---

*本 Gate 文档随 P2a（Canvas 微暖化）PR 一并提交；批准后按 Phase 1 开工。*
