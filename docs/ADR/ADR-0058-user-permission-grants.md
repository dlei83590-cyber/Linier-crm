# ADR-0058：用户附加授权（User Permission Grants）

- 状态：**Accepted**（2026-09-20 用户指令：「权限分配在新建用户时勾选，和用户列表中可编辑更改」→ 用户选定方案 A）
- 日期：2026-09-20
- 关联：ADR-0057（DB 权限集为鉴权权威；本文档是其 §7「不做什么」的定向修订）、ADR-0028（目录一致性）、PR #293（权限树）、PR #300（事件修复）

---

## 1. 背景

ADR-0057 落地后，鉴权与前端可见性都以**会话有效权限集**为准；而权限只挂在**角色**上，用户侧只能勾角色。
实际使用中需要「同一个角色，个别人再多几项权限」的场景（例如某成员临时需要 `reports:view`），当前只能新建一个角色，成本高且角色膨胀。

## 2. 决策（方案 A：附加授权，并集）

- 新增用户 ↔ 权限的直连授权（`User.permissions`，隐式多对多 `_UserPermissions`，Migration 0058，**纯新增表**）。
- **有效权限 = 所选角色权限 ∪ 用户附加授权**（并集，去重排序），由 `authenticate` 计算；`requirePermission` / 前端 `can()` 语义不变。
- **只增不减（无 DENY）**：要「取消」角色已授予的权限，必须调整角色本身。这是刻意的简化——避免同一权限出现「角色给、用户禁」的双重真相，也让审计保持单向可读。
- 写入口：`POST /api/users`、`PATCH /api/users/:id` 接受 `permissionCodes`（PATCH 全量替换；空数组 = 清空附加授权）。未知 code → 400（fail closed，不静默裁剪）；服务端去重。
- 审计：`user.create` 记录 `permissionCount`；`user.update` 记录 `permissionCount` + `permissionAdded` / `permissionRemoved`。
- 前端：复用既有权限树组件（域 → 模块 → 动作，三态/搜索/全选）于「新建用户」「编辑用户」两页；用户列表新增「附加权限」列（计数 + 进入编辑）。

## 3. 为什么不是别的方案

| 方案 | 否决原因 |
|---|---|
| 用户级 GRANT + DENY（完整覆盖） | 引入「角色给 / 用户禁」双重语义，审计与排障成本显著上升；本轮按最小可用取舍 |
| 零迁移：每人一个「个人角色」 | 角色列表被个人角色污染（角色膨胀），且「角色」概念被稀释 |
| 零迁移：只选角色 + 权限预览 | 无法满足「个别人多几项权限」的实际需求 |

## 4. 影响面

| 面 | 变更 |
|---|---|
| Schema | `User.permissions` / `Permission.users`（隐式 m2m） |
| Migration | `0058_user_permission_grants`（CREATE TABLE + INDEX + 2 FK，纯新增，无回填） |
| 鉴权 | `api-helpers.authenticate` 取并集（`normalizePermissions` 去重排序） |
| API | `POST /api/users`、`PATCH /api/users/:id` 增加 `permissionCodes`；`GET /api/users` 增 `_count.permissions`；`GET /api/users/:id` 增 `permissions` |
| 前端 | 用户新建/编辑页接入 `PermissionTree`；用户列表增「附加权限」列 |
| 文档 | OpenAPI（UserCreateRequest / UserUpdateRequest / UserSummary）、CHANGELOG、ROADMAP、QA |

## 5. 不变量与边界

- **fail-closed 不变**：无论来自角色还是附加授权，判定未命中即拒绝；空集即无权限。
- **无静态回退**：不读 `ROLE_PERMISSIONS`（ADR-0057 红线保持）。
- **SUPER_ADMIN 保护不变**：其角色权限恒为全集且 API 禁止修改（ADR-0057 Q2）；附加授权对其无意义但无害。
- **不引入 deny、不引入按用户的角色覆盖**；ADMIN/MANAGER 等角色的基线仍由 seed 治理。
- 生效时机：下一次请求/刷新（不做实时推送）。

## 6. 回滚

- 应用层：revert 本 PR；附加授权数据保留在 `_UserPermissions`（旧代码不读取，无副作用）。
- 数据层：无需回滚 migration（纯新增表；如需彻底清除可 `DROP TABLE "_UserPermissions"` 后删除 migration 记录，仅在完全回退时执行）。
