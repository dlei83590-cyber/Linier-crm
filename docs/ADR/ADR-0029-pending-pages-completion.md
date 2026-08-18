# ADR-0029：Pending Pages Completion（9 个待开发页面打通 — Design/Scope Gate）

- 状态：**Accepted**（Design/Scope Gate 已批准进入实现；三批已合入 main：8ca5f06 / 053e256 / 05183cc）
- 日期：2026-08-18
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：docs/frontend/contract-cards/pending-pages-completion-gate.md、ADR-0028（API referenced permission ⊆ ALL_ACTION_PERMISSIONS）、ROADMAP v1.23、CHANGELOG [Unreleased]

---

## 背景

main 上 9 个前端页面仍为 PlaceholderPage 骨架（modules.ts 全部 availability=hold + contract NONE）。经 Phase A 事实盘点确认：**9 个页面全部缺少后端 list/CRUD API 契约**，无一能仅靠前端接线完成；Prisma 模型全部存在（Sprint 1/2 建表），API 层从未实现。用户指令：打通所有页面并验证逻辑。

## 决策

1. **分 3 批实现（每批独立 commit + GitHub CI）**：
   - Batch 1（8ca5f06）：Master Data 4 模块 CRUD（business-partners / technical-standards / commercial-terms / document-sequences）——8 个 API 路由 + 12 个页面
   - Batch 2（053e256）：System 3 模块（users / departments / roles）——6 个 API 路由 + 9 个页面 + department 模块 RBAC 注册
   - Batch 3（05183cc）：project-visits / project-risks 独立页改**引导页**（CRUD 在项目详情 Tab，B2-1B 已交付，不建平行 CRUD——AGENTS.md 禁止平行业务真相）
2. **模型事实约束（零迁移边界）**：User / Department / Role 无 version / deletedAt 字段 → PATCH 无 CAS；Department 无 isActive/deletedAt → 无启停、无 DELETE；Role 无软删字段 + UserRole 引用完整性 → 无 DELETE；users DELETE = 停用语义（isActive=false）。DocumentSequence.nextNo 客户端不可写（编号引擎唯一事实源）。
3. **RBAC（ADR-0028 对齐）**：新增 department 模块到 shared PERMISSION_MODULES + seed SEED_ACTION_MODULES + MANAGER/MEMBER department:view；其余 6 模块权限码已注册，直接复用 action 级权限（user/role/business-partner/technical-standard/commercial-term/document-sequence）。
4. **主数据/系统域 CRUD 无审批流**：approvalStatus 常量 APPROVED 沿用 price-lists 先例（主数据不发明 submit/approve 状态机）。
5. **roles 权限分配治理**：后端 PATCH 保留 permissionCodes 全量替换能力（按 Permission 目录 code 校验）；前端编辑页权限**只读分组展示**（千级 checkbox 不可用 UX；权限分配由 seed/ADMIN 治理）。
6. **注册表能力语义**：7 个模块 availability hold→ready、ui=UI_LIST_CRUD（list/create/edit，无独立详情页——主数据简单编辑即详情，ui 层不虚报 detail）；走访/风险保持 hold（独立页无独立能力）。

## 影响

- 9 个 Placeholder 页面全部替换：7 个真实 CRUD（列表/新建/编辑）+ 2 个引导页
- 新增 14 个 API 路由（7 域 × list/get/create/patch/delete 组合），全部 requirePermission 码 ∈ ALL_ACTION_PERMISSIONS（ADR-0028 静态一致）
- department 权限码进入 ALL_ACTION_PERMISSIONS（SUPER_ADMIN/ADMIN 静态授权自动获得；MANAGER/MEMBER 仅 view）
- **零 Schema/Migration 变更**（7 域模型已存在）
- 后续：OpenAPI / 契约文档 / QA / test-cases / ROADMAP / CHANGELOG 同步（见关联文档）

## 后续（独立 backlog，不在本 Gate）

- roles 前端权限勾选式管理（需要权限目录分页/搜索 API + 治理确认）
- department 树形渲染（当前扁平 parent 列展示）
- ADR-0028 CI 静态 Gate 实现（扫描 requirePermission vs PERMISSION_MODULES，独立 Governance backlog）