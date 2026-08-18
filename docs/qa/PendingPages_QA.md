# Pending Pages Completion — QA 验收记录（9 个待开发页面打通）

- 日期：2026-08-18
- 关联：ADR-0029、docs/frontend/contract-cards/pending-pages-completion-gate.md、CHANGELOG [Unreleased]
- 状态：**CI 验证通过（Batch 1/2/3 提交 CI 全绿）；Runtime Acceptance = 待生产部署后执行（CI-First 模式，本地不跑 runtime 验证）**

## 1. 范围

| Batch | 提交 | 内容 | CI |
|---|---|---|---|
| 1 | 8ca5f06 | Master Data 4 模块 CRUD（business-partners / technical-standards / commercial-terms / document-sequences） | ✅ success |
| 2 | 053e256 | System 3 模块 CRUD（users / departments / roles）+ department RBAC 注册 | ✅ success（经 814b218 lint 修复） |
| 3 | 05183cc | project-visits / project-risks 独立页改引导 | ✅ success |

## 2. 静态验收（本地已核）

- [x] 7 个新 API 面全部 requirePermission 码 ∈ ALL_ACTION_PERMISSIONS（ADR-0028；department 已补注册 PERMISSION_MODULES + seed）
- [x] 零 Schema/Migration 变更（git diff 无 prisma/migrations 改动）
- [x] User/Department/Role 无 version/deletedAt → 无 CAS/软删设计正确（模型字段已核实）
- [x] DocumentSequence.nextNo 客户端不可写（PATCH schema 不含 nextNo）
- [x] users DELETE = 停用（isActive=false，不物理删除）
- [x] departments PATCH 循环引用校验（沿候选父级链，不得设为自身/子孙为父）
- [x] roles 权限按 Permission 目录 code 校验（未知 code → 400 VALIDATION_ERROR）
- [x] 模块注册表：7 模块 hold→ready + ui=UI_LIST_CRUD（不虚报 detail）；走访/风险保持 hold
- [x] 密码服务端 bcryptjs hash（复用 lib/auth.ts hashPassword），响应不返回 passwordHash
- [x] 前端页面全部复用 F2 Workspace 共享层（AppPage / EntityListWorkspace / EntityFormWorkspace / useListQuery / PermissionGuard）
- [x] **中文化审计（2026-08-18）**：9 页面全部 UI 标签/占位/错误消息为中文；uscc 按 GB 32100-2015 18 位校验（服务端大写归一化）；角色名/权限模块/动作经 labels.ts 中文映射展示（seed Role.name 英文不改 DB，仅展示层）

## 3. 需在生产 Runtime 验收（部署后执行，CI-First 模式）

- [ ] 7 模块列表/新建/编辑全链路 smoke（CRUD + 权限守卫 + 分页/过滤）
- [ ] business-partners：code/uscc 唯一冲突 409；type CUSTOMER/SUPPLIER/BOTH
- [ ] document-sequences：nextNo 只读；docType 枚举校验
- [ ] users：创建（密码 hash 落库）/停用/角色全量替换/密码重置；403 权限（无 user:create 的角色）
- [ ] departments：parent 选择 + 循环引用 409
- [ ] roles：无 DELETE；权限只读展示
- [ ] project-visits / project-risks 引导页跳转 /projects
- [ ] 无权限用户访问 → 403（PermissionGuard）

## 4. 已知限制 / 边界

- users/departments/roles 无乐观锁（模型无 version 字段，零迁移边界）；并发编辑以后进者胜
- departments/roles 无 DELETE（无软删字段，物理删除破坏引用完整性/审计链）
- roles 前端权限分配为只读展示（千级权限 checkbox 不可用；分配由 seed/ADMIN 治理，API 层保留 permissionCodes 能力）
- 走访/风险独立页为引导页（CRUD 在项目详情 Tab，B2-1B 已交付）

## 5. 验收人

- CI 验证：GitHub Actions（Quality Gates / Secret Scanning / Build）
- Runtime Acceptance：待生产部署后由 CIO/CTO 执行（本 Gate 未执行，如实声明）