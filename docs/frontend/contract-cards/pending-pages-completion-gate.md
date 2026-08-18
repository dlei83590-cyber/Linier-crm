# Pending Pages Completion — Design / Scope Gate（9 个待开发页面打通）

- 版本：v0.1
- 日期：2026-08-18
- 维护者：CIO（JINZA）｜审核：CTO（Scope Gate 批准后进入实现）
- 关联：ROADMAP v1.22、ADR-0028（API referenced permission ⊆ ALL_ACTION_PERMISSIONS）、docs/frontend/Frontend_Module_Map.md、Page_Route_Map.md
- 状态：**DESIGN / SCOPE GATE — 待批准**（实现分 3 批，每批独立 PR + GitHub CI）

---

## 1. 背景与范围

当前 main 上 9 个前端页面仍为 PlaceholderPage 骨架（用户指令：打通所有页面并验证逻辑）。经 Phase A 事实盘点：

- 9 个页面在模块注册表（apps/web/src/lib/frontend/modules.ts）中全部为 availability=hold + contract=CONTRACT_NONE + ui=UI_NONE（占位页不算开放，红线）。
- **9 个页面全部缺少后端 list/CRUD API 契约**（apps/web/src/app/api 无对应路由），无一能仅靠前端接线完成。
- Prisma 模型全部存在（Sprint 1/2 时代建表），但 API 层从未实现。

本 Gate 批准 = 授权新建 7 个主数据/系统域 CRUD API 面 + 9 个页面，并解除注册表 hold。

## 2. 事实基线（Phase A 输出）

| # | 页面 | 模块 id | Registry | 后端契约现状 | Prisma 模型 | 本 Gate 动作 |
|---|---|---|---|---|---|---|
| 1 | /business-partners | business-partners | hold | 仅 [id]/roles 子资源 | ✅ BusinessPartner | 新建统一 CRUD API + 列表/新建/编辑页 |
| 2 | /technical-standards | technical-standards | hold | 无 | ✅ TechnicalStandard | 新建 CRUD API + 列表/新建/编辑页 |
| 3 | /commercial-terms | commercial-terms | hold | 无 | ✅ CommercialTerm | 新建 CRUD API + 列表/新建/编辑页 |
| 4 | /document-sequences | document-sequences | hold | 无 | ✅ DocumentSequence | 新建 CRUD API + 列表/新建/编辑页（nextNo 只读） |
| 5 | /users | users | hold | 无 | ✅ User | 新建 CRUD API（delete=停用）+ 列表/新建/编辑页 |
| 6 | /departments | departments | hold | 无 | ✅ Department | 新建 CRUD API + 列表/新建/编辑页（树形） |
| 7 | /roles | roles | hold | 无 | ✅ Role + Permission | 新建 CRUD API + 列表/新建/编辑页（权限映射） |
| 8 | /project-visits | project-visits | hold | 仅 projects/[id]/visits | ✅ ProjectVisit | **独立页改引导**（复用项目内子资源，不建平行 CRUD） |
| 9 | /project-risks | project-risks | hold | 仅 projects/[id]/risks | ✅ ProjectRisk | **独立页改引导**（同上） |

**已核实可复用**：统一 API 响应（lib/api/response.ts ok/fail/parsePagination）、认证（lib/api-helpers authenticate/requirePermission/requestMeta/writeAuditLog）、价格表 CRUD 范式（price-lists）、Master-Data 只读列表范式（unit-of-measures/warehouses）、前端 Workspace 原语（AppPage/EntityListWorkspace/useListQuery/PermissionGuard/StatusBadge）。

## 3. RBAC 对齐（ADR-0028，先于实现）

| 模块 | shared PERMISSION_MODULES | seed SEED_ACTION_MODULES | 结论 |
|---|---|---|---|
| business-partner / technical-standard / commercial-term / document-sequence | ✅ 已注册 | ✅ 已注册 | 无 RBAC 改动，权限码直接可用 |
| user / role | ✅ 已注册 | ✅ 已注册 | 无改动 |
| **department** | ❌ 缺失 | ❌ 缺失 | **必须新增**（否则 department:view/create/edit/delete 不在 ALL_ACTION_PERMISSIONS，SUPER_ADMIN 也 403） |

新增动作：constants PERMISSION_MODULES 加 department；seed SEED_ACTION_MODULES 加 department；rbac MANAGER 权限组加 department:view（部门树只读），create/edit/delete 仅 ADMIN/SUPER_ADMIN（默认即如此）。user/role/department 的旧式 user:read/write 等 PERMISSIONS 常量保留不动（向后兼容）。

## 4. Batch 1 — Master Data 4 模块 API 契约（后端范式 = price-lists CRUD）

统一模式：GET 列表（authenticate + requirePermission(module:view) + requestLog + parsePagination + 过滤 + deletedAt:null + orderBy createdAt desc + ok(items, meta)）；POST（requirePermission(module:create) + zod + code 唯一校验 + approvalStatus=APPROVED + createdById/updatedById + writeAuditLog）；GET /:id（view）；PATCH /:id（edit + **version 乐观锁 CAS** + version increment + writeAuditLog）；DELETE /:id（delete + 软删除 deletedAt + isActive=false + writeAuditLog）。

### 4.1 /api/business-partners（往来单位统一主数据）
- 列表过滤：code / name / mnemonic / type（CUSTOMER|SUPPLIER|BOTH）/ region / industry / isActive / approvalStatus
- 创建必填：code（唯一内部编码）、name、type（默认 SUPPLIER）；可选：mnemonic/uscc(唯一)/taxpayerType/legalRepresentative/registeredAddress/invoiceInfo(Json)/bankName/bankAccount/settlementTerms/shortName/fullName/groupName/region/industry/companySize/creditRating/sourceChannel/foundedDate/registeredCapital(Decimal)/employeeCount/website/wechatOfficialAccount/tags(Json)/contactPerson/phone/email/address
- 更新：全部可选 + version（refine ≥1 字段）；uscc 冲突 409
- 详情：含 roles（BusinessPartnerRole）摘要
- 边界：**不新建 customers/suppliers 平行业务真相**（Sprint 3C 的 Customer/Supplier 模型各自已有 API，本 API 只覆盖 BusinessPartner 本体主数据）；红线段：type/uscc 变更走常规编辑，无审批流（主数据）
- **中文化（2026-08-18 审计）**：uscc 服务端归一化大写 + GB 32100-2015 18 位校验（不含 I/O/S/V/Z，400 中文错误）；前端展示层新增 `apps/web/src/lib/frontend/labels.ts`（ROLE_LABELS / MODULE_LABELS / ACTION_LABELS）——角色名、权限模块/动作全部中文展示（seed Role.name 为英文，展示层映射，不改 DB）

### 4.2 /api/technical-standards（技术标准）
- 过滤：code / name / isActive / approvalStatus；创建必填 code/name，可选 description；更新同范式；详情含 items 计数

### 4.3 /api/commercial-terms（商业条款）
- 过滤：code / name / isActive；创建必填 code/name，可选 description；同范式

### 4.4 /api/document-sequences（单据序列）
- 过滤：code / name / docType（DocumentType 枚举）/ isActive
- 创建必填：code（唯一，单据类型编码）、name、docType；可选 prefix / padLength（默认 4）
- 更新：**nextNo 不可由客户端修改（编号引擎系统管理，防跳号/并发错号）**——PATCH schema 不含 nextNo；编辑页 nextNo 只读展示
- 详情：含 nextNo + 格式预览（prefix + 补零示例，纯展示）

## 5. Batch 2 — System 3 模块 API 契约

### 5.1 /api/users（用户管理）
- 列表过滤：email / name / departmentId / isActive；include department 摘要 + roles（code）
- 创建（user:create）：email（唯一）+ password（服务端 bcryptjs hash，复用 lib/auth.ts hashPassword，**不落明文**）+ name + departmentId? + roleIds[]（UserRole 批量建）+ isActive（默认 true）
- PATCH（user:edit）：name / departmentId / isActive / password?（非空才重置）/ roleIds?（全量替换 UserRole）；**User 模型无 version 字段 → PATCH 无 CAS**（与 Role 一致，零迁移边界）
- DELETE（user:delete）= **停用语义**：User 无 deletedAt 字段 → isActive=false（前端文案停用），不物理删除（保留审计/单据引用完整性）
- 详情：含 roles + department（不含 passwordHash）
- 安全：禁止返回 passwordHash；创建/重置密码仅允许 user:create / user:edit 授权者操作；auditLog action=user.create/update/deactivate

### 5.2 /api/departments（部门管理）
- 列表过滤：code / name / parentId?；返回扁平列表 + parent 摘要（前端 parent 列展示）
- 创建（department:create）：code（唯一）+ name + parentId?（校验父级存在且非自身）
- PATCH（department:edit）：code? / name / parentId?；**禁止把部门设为自身/子孙为父**（循环引用校验：沿候选父级链向上）；**Department 模型无 version/isActive/deletedAt → 无 CAS、无启停、无 DELETE**
- DELETE：**不提供**（无软删字段，物理删除破坏组织树与审计链）
- 详情：含 parent 摘要 + 用户数 + 子部门数

### 5.3 /api/roles（角色权限）
- 列表过滤：code / name；include permissions（code）计数
- 创建（role:create）：code（唯一，大写）+ name + description? + permissionCodes[]?（按 code connect Permission 目录，未知 code → 400 VALIDATION_ERROR；**前端新建页暂不提供权限勾选——千级 checkbox 不可用 UX，权限分配由 seed/ADMIN 治理**）
- PATCH（role:edit）：name / description? / permissionCodes?（全量替换 RolePermissions，API 能力保留）；Role 无 version 字段 → PATCH 不做 CAS
- DELETE：**不提供**（Role 无软删字段 + UserRole 引用完整性；停用角色 = 从用户移除），API 只读+创建+编辑
- 详情：含 permissions 全量 code 列表（前端编辑页按 module 分组**只读展示**）
- 边界：内置角色（SUPER_ADMIN/ADMIN/MANAGER/MEMBER/VIEWER，seed 定义 ROLE_PERMISSIONS）仍由 seed 治理；本 API 覆盖 DB Role 记录的 CRUD，不改 seed 静态映射语义

## 6. Batch 3 — 走访/风险独立页改引导（复用项目内子资源）

- 用户决策：**不建平行 CRUD**（B2-1B 已在 Project Detail 交付 Risks/Visits 完整 CRUD Tab，路径 /projects/[id]）
- 实现：/project-visits 与 /project-risks 两个 page.tsx 由 PlaceholderPage 替换为**引导页**（AppPage + 说明卡片：走访/风险在 项目管理 → 项目详情 → 风险/走访 Tab 内维护 + 跳转 /projects 按钮 + PermissionGuard project:view）
- 注册表：模块保持 availability=hold（ui 能力仍 NONE——独立页无独立能力，能力归属 projects 模块），注释更新为 独立页=引导，CRUD 在项目详情 Tab
- 红线：不新增跨项目 visits/risks 只读 API（无业务需求，避免范围蔓延）

## 7. 前端页面计划（全部复用 F2 Workspace 共享层）

| 模块 | 页面 | 形态 | 权限守卫 | ui capabilities |
|---|---|---|---|---|
| business-partners | /business-partners + /new + /[id]/edit | 列表（过滤 code/name/type/region）+ 表单（核心字段 + 可选扩展字段分组） | business-partner:view/create/edit | UI_LIST_DETAIL_CRUD |
| technical-standards | /technical-standards + /new + /[id]/edit | 简单表单 | technical-standard:* | UI_LIST_DETAIL_CRUD |
| commercial-terms | /commercial-terms + /new + /[id]/edit | 简单表单 | commercial-term:* | UI_LIST_DETAIL_CRUD |
| document-sequences | /document-sequences + /new + /[id]/edit | 表单 + nextNo 只读预览 | document-sequence:* | UI_LIST_DETAIL_CRUD |
| users | /users + /new + /[id]/edit | 列表（email/name/部门过滤）+ 表单（角色多选 + 密码字段） | user:view/create/edit/delete | UI_LIST_DETAIL_CRUD |
| departments | /departments + /new + /[id]/edit | 树形列表（parent 列）+ 表单（父级选择） | department:* | UI_LIST_DETAIL_CRUD |
| roles | /roles + /new + /[id]/edit | 列表 + 表单（权限按 module 分组多选） | role:* | UI_LIST_DETAIL_CRUD |
| project-visits/risks | 独立页改引导 | 引导卡片 + /projects 跳转 | project:view | 保持 hold |

注册表 ui 层统一更新为真实能力（不再 UI_NONE），availability 从 hold → ready（Batch 1/2 完成后），createRoute/createPermission 按各模块配置。

## 8. 边界（MUST NOT）

- 不触碰 HOLD 领域：Reservation / Costing / 5C-2 / GL / BI / OA / Mobile
- 不新建平行业务真相：BusinessPartner API 不并入 customers/suppliers；走访/风险不建独立 CRUD
- 不改 Schema/Migration（7 域模型已存在，本 Gate **零迁移**；User/Role/Department 无新字段、无 version/deletedAt → 无 CAS/软删，按既有字段能力设计）
- 不提供 roles DELETE（无软删字段 + 引用完整性）；users DELETE = 停用
- 不发明审批流：主数据/系统域 CRUD 无 submit/approve 状态机（approvalStatus 常量 APPROVED 沿用 price-lists 先例）
- DocumentSequence.nextNo 客户端不可写（编号引擎唯一事实源）
- 验证 = GitHub CI（Quality/Build/Secret Scanning）；本地不跑 type-check/build/test

## 9. 文档同步清单（每批随 PR）

1. openapi.yaml：+7 组 paths（Business Partners / Technical Standards / Commercial Terms / Document Sequences / Users / Departments / Roles）+ schemas
2. docs/frontend/Frontend_Module_Map.md + Page_Route_Map.md：解除 7 模块 hold 标记、登记新页面
3. docs/test-cases/：新增 MasterData_Admin_CRUD_API.md（或按模块拆分）
4. docs/qa/：PendingPages_QA.md（每批运行时验收记录）
5. ADR-0029：pending-pages-completion（本 Gate 决策记录；含 department RBAC 注册、roles 无 DELETE、users 停用语义、nextNo 只读）
6. ROADMAP v1.23：Frontend 全页面完成状态
7. CHANGELOG [Unreleased]：Batch 1/2/3 条目
8. SPRINT_PLAN：同步
9. prisma/seed.ts + packages/shared：department 模块注册（§3）

## 10. 验收标准

- 7 个新 API 面全部 CI 全绿（type-check 覆盖 zod/Prisma 类型）
- 9 个页面全部非 Placeholder：7 个真实 CRUD + 2 个引导页
- 注册表 availability ready ×7、hold ×2（引导）；ui 层与页面事实一致
- ADR-0028 静态一致：所有新 requirePermission 码 ∈ ALL_ACTION_PERMISSIONS（含 department 补注册）
- 本地零验证、零迁移；最终验证 = GitHub CI + 生产 runtime smoke（经批准后）